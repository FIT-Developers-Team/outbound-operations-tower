import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBulkUploadRows,
  bulkAuditCsv,
  deriveMpStatus,
  isEligiblePicker,
  minutesUntil,
} from "../lib/outbound-logic.ts";

function order(overrides = {}) {
  return {
    id: "SO-1::MZA1",
    soNumber: "SO-1",
    wmsSoId: "0000001",
    destination: "CBT Jakarta",
    destinationCode: "CBT",
    zone: "MZA1",
    pickingAreaNames: ["Area A"],
    originRackNames: ["WH-MZA1-L1-01"],
    wave: "WAVE 1",
    drop: "DROP 1",
    mappingStatus: "MAPPED",
    status: "NEW",
    priority: "High",
    requestQty: 100,
    pickedQty: 0,
    skuCount: 1,
    lineCount: 1,
    rackLevel: "L1",
    pickerId: null,
    shift: "PAGI",
    deadline: "14:00",
    createdAt: "2026-07-28T05:00:00+07:00",
    updatedAt: "05:00",
    ...overrides,
  };
}

function proposal(overrides = {}) {
  return {
    orderId: "SO-1::MZA1",
    soNumber: "SO-1",
    zone: "MZA1",
    pickerId: "P-1",
    pickerName: "Picker One",
    mpStatus: "REGULER",
    targetQty: 1000,
    score: 100,
    confidence: "HIGH",
    reason: "zone match",
    projectedLoadPct: 10,
    blockingReason: null,
    ...overrides,
  };
}

test("day 21 has an unambiguous REGULER status", () => {
  assert.equal(deriveMpStatus("2026-07-08", "2026-07-28"), "REGULER");
});

test("deadline math uses Asia/Jakarta and supports night-shift rollover", () => {
  const morning = new Date("2026-07-28T03:20:00Z");
  assert.equal(minutesUntil("11:00", morning), 40);
  const evening = new Date("2026-07-28T13:00:00Z");
  assert.equal(minutesUntil("02:00", evening), 360);
  assert.equal(minutesUntil("invalid", morning), Number.POSITIVE_INFINITY);
});

test("picker eligibility requires schedule and zone skill", () => {
  const picker = {
    isActive: true,
    checkedIn: true,
    role: "OUTBOUND_PICKER_STAFF",
    state: "ACTIVE",
    tenureDays: 30,
    scheduleStartTime: "2026-07-28T05:00:00+07:00",
    scheduleDescription: "Shift Pagi",
    zones: ["MZA1"],
  };
  assert.equal(isEligiblePicker(picker), true);
  assert.equal(isEligiblePicker({ ...picker, zones: [] }), false);
  assert.equal(isEligiblePicker({ ...picker, scheduleStartTime: "" }), false);
});

test("bulk upload blocks partial multi-zone selection", () => {
  const rows = [
    order(),
    order({ id: "SO-1::MZA2", zone: "MZA2", requestQty: 80 }),
  ];
  const result = buildBulkUploadRows(rows, [proposal()]);
  assert.equal(result.length, 1);
  assert.equal(result[0].ready, false);
  assert.equal(result[0].error_message, "INCOMPLETE_MULTI_ZONE_SELECTION");
});

test("bulk upload blocks over-target proposals and WMS collisions", () => {
  const overTarget = buildBulkUploadRows(
    [order()],
    [proposal({ blockingReason: "OVER_TARGET_REVIEW" })],
  );
  assert.equal(overTarget[0].error_message, "OVER_TARGET_REVIEW");

  const collisionOrders = [
    order(),
    order({
      id: "SO-2::MZA1",
      soNumber: "SO-2",
      wmsSoId: "0000001",
    }),
  ];
  const collision = buildBulkUploadRows(collisionOrders, [
    proposal(),
    proposal({ orderId: "SO-2::MZA1", soNumber: "SO-2" }),
  ]);
  assert.ok(collision.every((row) => row.error_message === "WMS_SO_ID_COLLISION"));
});

test("CSV exports neutralize spreadsheet formulas", () => {
  const csv = bulkAuditCsv([
    {
      error_message: "",
      so_id: "=1+1",
      staff_id: "+PICKER",
      soNumber: "SO-1",
      zone: "MZA1",
      wave: "WAVE 1",
      drop: "DROP 1",
      pickerName: "@operator",
      requestQty: 100,
      ready: true,
    },
  ]);
  assert.match(csv, /'=1\+1/);
  assert.match(csv, /'\+PICKER/);
  assert.match(csv, /'@operator/);
});
