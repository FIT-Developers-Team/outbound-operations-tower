import assert from "node:assert/strict";
import test from "node:test";
import { applyAssignment } from "../lib/command-assignment.ts";

function order(id, zone, qty) {
  return {
    id,
    soNumber: "SO-1",
    wmsSoId: "0000001",
    destination: "APR - Ampera",
    destinationCode: "APR",
    zone,
    pickingAreaNames: [],
    originRackNames: [],
    wave: "WAVE 1",
    drop: "DROP 1",
    mappingStatus: "MAPPED",
    status: "NEW",
    priority: "High",
    remarks: [],
    requestQty: qty,
    pickedQty: 0,
    skuCount: 1,
    skuDetails: [],
    lineCount: 1,
    rackLevel: "L1",
    pickerId: null,
    shift: "PAGI",
    deadline: "14:00",
    createdAt: "2026-08-02 05:00:00",
    updatedAt: "05:00",
  };
}

function picker() {
  return {
    id: "P-1",
    name: "Picker One",
    joinDate: "2026-06-01",
    tenureDays: 63,
    mpStatus: "REGULER",
    mpStatusOverride: null,
    scheduleStartTime: "2026-08-02 05:00:00",
    scheduleDescription: "PAGI",
    role: "OUTBOUND_PICKER_STAFF",
    shift: "PAGI",
    checkedIn: true,
    isActive: true,
    zones: ["MZA1", "MZA2"],
    waves: ["WAVE 1"],
    targetQty: 1000,
    targetOverride: null,
    targetPerHour: 125,
    activeHours: 1,
    assignedQty: 999,
    pickedQty: 0,
    totalSo: 99,
    state: "ACTIVE",
  };
}

function dataset() {
  return {
    warehouse: { code: "CBT", name: "Cibitung", timezone: "Asia/Jakarta" },
    orders: [order("SO-1::MZA1", "MZA1", 100), order("SO-1::MZA2", "MZA2", 200)],
    pickers: [picker()],
    destinationRules: [],
    zoneRules: [],
    targetRules: [
      {
        mpStatus: "REGULER",
        targetQty: 1000,
        maxLoadPct: 100,
        description: "Reguler",
      },
    ],
    checkerRoutes: [],
    audit: [],
    hourly: [],
    pickerProductivity: [],
    sourceProfile: {
      sourceDate: "2026-08-02",
      soRows: 2,
      distinctSo: 1,
      soZoneSplits: 2,
      multiZoneSo: 1,
      newRows: 2,
      newSo: 1,
      newQty: 300,
      distinctZones: 2,
      staffRows: 1,
      pickerRows: 1,
      eligiblePickers: 1,
      checkedInRows: 1,
      qualityNotes: [],
    },
  };
}

test("server assignment refuses a partial multi-zone SO", () => {
  const data = dataset();
  assert.throws(
    () =>
      applyAssignment(data, {
        rows: [{ orderId: "SO-1::MZA1", pickerId: "P-1", allowOverride: true, operatorNote: "Supervisor menyetujui" }],
      }),
    /seluruh split zona/,
  );
});

test("server assignment recomputes workload after an approved override", () => {
  const data = dataset();
  const result = applyAssignment(data, {
    rows: [
      { orderId: "SO-1::MZA1", pickerId: "P-1", allowOverride: true, operatorNote: "Supervisor menyetujui" },
      { orderId: "SO-1::MZA2", pickerId: "P-1", allowOverride: true, operatorNote: "Supervisor menyetujui" },
    ],
  });

  assert.equal(result.count, 2);
  assert.equal(result.overrideCount, 2);
  assert.ok(data.orders.every((item) => item.pickerId === "P-1"));
  assert.equal(data.pickers[0].assignedQty, 300);
  assert.equal(data.pickers[0].totalSo, 1);
});

test("server assignment blocks an ambiguous WMS SO ID", () => {
  const data = dataset();
  data.orders[1] = {
    ...data.orders[1],
    id: "SO-2::MZA2",
    soNumber: "SO-2",
  };

  assert.throws(
    () =>
      applyAssignment(data, {
        rows: [
          {
            orderId: "SO-1::MZA1",
            pickerId: "P-1",
            allowOverride: true,
            operatorNote: "Supervisor menyetujui",
          },
        ],
      }),
    /WMS SO ID/,
  );
});
