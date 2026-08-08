import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDatasetFromRecords,
  carryForwardLocalAssignments,
} from "../lib/superset-sync.ts";
import { applyAssignment } from "../lib/command-assignment.ts";

const rules = [
  {
    id: "RT-2026-08-07-APR",
    effectiveMonth: "2026-08",
    destinationCode: "APR",
    destinationName: "Ampera",
    wave: "WAVE 1",
    drop: "DROP 1",
    sequence: 7,
    active: true,
  },
];

const warehouse = { code: "CBT", name: "Cibitung", timezone: "Asia/Jakarta" };

function soRecord(overrides = {}) {
  return {
    so_date: "2026-08-02",
    // Present so the order lands on the same shift as the picker below;
    // applyAssignment refuses a cross-shift assignment without an override.
    supply_order_created_at: "2026-08-02 05:30:00",
    so_number: "SO-0000123",
    quantity: "125",
    destination_id: "APR",
    destination_name: "Ampera",
    so_status: "new",
    picking_zone: "mza1",
    sku_number: "SKU-1",
    product_name: "Produk",
    ...overrides,
  };
}

function staffRecord(overrides = {}) {
  return {
    date_key: "2026-08-02",
    staff_id: "P-1",
    staff_name: "Picker One",
    // Upper case on purpose: isEligiblePicker compares the stored role
    // literally, so a lower-case export never produces an eligible picker.
    schedule_role: "OUTBOUND_PICKER_STAFF",
    schedule_start_time: "2026-08-02 05:00:00",
    schedule_description: "PAGI",
    drivers_join_date: "2026-06-01",
    attendance_check_in: "2026-08-02 04:55:00",
    is_active: "1",
    zone: "MZA1, MZA2",
    ...overrides,
  };
}

function sync(soRecords, staffRecords, previous) {
  return buildDatasetFromRecords(
    soRecords,
    staffRecords,
    "2026-08",
    previous,
    undefined,
    warehouse,
    rules,
  );
}

/** A first sync, then the operator assigns, exactly as the command route does. */
function datasetWithStagedAssignment() {
  const dataset = sync([soRecord()], [staffRecord()]);
  const result = applyAssignment(dataset, {
    rows: [{ orderId: dataset.orders[0].id, pickerId: "P-1" }],
  });

  assert.equal(result.count, 1);
  assert.equal(dataset.orders[0].pickerId, "P-1");
  assert.equal(dataset.orders[0].assignmentSource, "LOCAL");
  return dataset;
}

test("a fresh export marks an assignment it reports as coming from the source", () => {
  const dataset = sync(
    [soRecord({ picking_staff_id: "P-1", so_status: "assigned" })],
    [staffRecord()],
  );

  assert.equal(dataset.orders[0].pickerId, "P-1");
  assert.equal(dataset.orders[0].assignmentSource, "SOURCE");
});

test("an unassigned order carries no assignment provenance", () => {
  const dataset = sync([soRecord()], [staffRecord()]);

  assert.equal(dataset.orders[0].pickerId, null);
  assert.equal(dataset.orders[0].assignmentSource, null);
});

test("a staged assignment survives a sync the source has not caught up with", () => {
  const staged = datasetWithStagedAssignment();
  // The export is unchanged: WMS has not ingested the bulk upload yet, so the
  // picking_staff_id column is still empty and the status is still NEW.
  const next = sync([soRecord()], [staffRecord()], staged);

  assert.equal(next.orders[0].pickerId, "P-1");
  assert.equal(next.orders[0].status, "ASSIGNED");
  assert.equal(next.orders[0].assignmentSource, "LOCAL");
});

test("the carried assignment still counts against the picker's workload", () => {
  const staged = datasetWithStagedAssignment();
  const next = sync([soRecord()], [staffRecord()], staged);
  const picker = next.pickers.find((candidate) => candidate.id === "P-1");

  assert.equal(picker.assignedQty, 125);
  assert.equal(picker.totalSo, 1);
});

test("the source wins once it reports the picker itself", () => {
  const staged = datasetWithStagedAssignment();
  const next = sync(
    [soRecord({ picking_staff_id: "P-2", so_status: "assigned" })],
    [staffRecord()],
    staged,
  );

  assert.equal(next.orders[0].pickerId, "P-2");
  assert.equal(next.orders[0].assignmentSource, "SOURCE");
});

test("the source wins once the order moves past NEW", () => {
  const staged = datasetWithStagedAssignment();
  const next = sync([soRecord({ so_status: "cancelled" })], [staffRecord()], staged);

  assert.equal(next.orders[0].status, "CANCELLED");
  assert.equal(next.orders[0].pickerId, null);
  assert.equal(next.orders[0].assignmentSource, null);
});

test("an assignment the source reported earlier is never resurrected", () => {
  const previous = sync(
    [soRecord({ picking_staff_id: "P-1", so_status: "assigned" })],
    [staffRecord()],
  );
  assert.equal(previous.orders[0].assignmentSource, "SOURCE");

  // The export retracts the picker. That is the source changing its mind, not
  // this app losing state, so nothing is carried forward.
  const next = sync([soRecord()], [staffRecord()], previous);

  assert.equal(next.orders[0].pickerId, null);
  assert.equal(next.orders[0].assignmentSource, null);
});

test("the sync reports how many assignments it kept and how many were replaced", () => {
  const staged = datasetWithStagedAssignment();
  const kept = sync([soRecord()], [staffRecord()], staged);
  assert.match(kept.audit[0].detail, /1 assignment lokal dipertahankan/);
  assert.match(
    kept.sourceProfile.qualityNotes.at(-1),
    /1 assignment lokal belum terlihat di sumber/,
  );

  const replaced = sync(
    [soRecord({ picking_staff_id: "P-1", so_status: "assigned" })],
    [staffRecord()],
    staged,
  );
  assert.match(replaced.audit[0].detail, /1 assignment lokal digantikan/);
});

test("a snapshot with no staged assignment is returned untouched", () => {
  const orders = [
    { id: "A::MZA1", pickerId: null, status: "NEW", assignmentSource: null },
  ];
  const result = carryForwardLocalAssignments(orders, []);

  assert.equal(result.orders, orders);
  assert.equal(result.carried, 0);
  assert.equal(result.superseded, 0);
});

test("an order that disappeared from the export does not reappear", () => {
  const staged = datasetWithStagedAssignment();
  const next = sync(
    [soRecord({ so_number: "SO-0000999" })],
    [staffRecord()],
    staged,
  );

  assert.equal(next.orders.length, 1);
  assert.equal(next.orders[0].soNumber, "SO-0000999");
});
