import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDatasetFromRecords,
  monthInTimeZone,
} from "../lib/superset-sync.ts";

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

test("documented Superset aliases produce operational live fields", () => {
  const dataset = buildDatasetFromRecords(
    [
      {
        so_date: "2026-08-02",
        so_number: "SO-0000123",
        quantity: "125",
        destination_id: "APR",
        destination_name: "Ampera",
        so_status: "new",
        remark: "EXPRESS",
        picking_zone: "mza1",
        sku_number: "SKU-1",
        product_name: "Produk",
      },
    ],
    [
      {
        date_key: "2026-08-02",
        staff_id: "P-1",
        staff_name: "Picker One",
        schedule_role: "outbound_picker_staff",
        schedule_start_time: "2026-08-02 05:00:00",
        schedule_description: "PAGI",
        drivers_join_date: "2026-06-01",
        attendance_check_in: "2026-08-02 04:55:00",
        is_active: "1",
        zone: "MZA1, MZA2",
      },
    ],
    "2026-08",
    null,
    undefined,
    { code: "CBT", name: "Cibitung", timezone: "Asia/Jakarta" },
    rules,
  );

  assert.equal(dataset.orders[0].requestQty, 125);
  assert.equal(dataset.orders[0].destinationCode, "APR");
  assert.equal(dataset.orders[0].status, "NEW");
  assert.equal(dataset.orders[0].zone, "MZA1");
  assert.deepEqual(dataset.orders[0].remarks, ["EXPRESS"]);
  assert.equal(dataset.orders[0].mappingStatus, "MAPPED");
  assert.equal(dataset.pickers[0].checkedIn, true);
  assert.equal(dataset.pickers[0].isActive, true);
  assert.deepEqual(dataset.pickers[0].zones, ["MZA1", "MZA2"]);
  assert.equal(dataset.checkerRoutes.length, 1);
  assert.equal(dataset.checkerRoutes[0].route, "APR");
  assert.equal(dataset.checkerRoutes[0].quantity, 125);
  assert.doesNotMatch(dataset.checkerRoutes[0].route, /^Route [A-J]$/);
});

test("warehouse timezone decides the active month", () => {
  const instant = new Date("2026-07-31T16:30:00Z");
  assert.equal(monthInTimeZone("Asia/Jakarta", instant).key, "2026-07");
  assert.equal(monthInTimeZone("Asia/Jayapura", instant).key, "2026-08");
});
