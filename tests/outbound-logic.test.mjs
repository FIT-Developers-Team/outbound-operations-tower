import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBulkUploadRows,
  buildManualAssignments,
  bulkAuditCsv,
  checkManualAssignment,
  compareRouteLabels,
  deriveMpStatus,
  isEligiblePicker,
  minutesUntil,
  proposeAssignments,
  splitSupplyOrderLines,
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
    remarks: ["PRIORITAS"],
    skuDetails: [
      {
        skuNumber: "SKU-1",
        productId: "PROD-1",
        productName: "Produk Satu",
        requestQty: 100,
        pickedQty: 0,
        lineCount: 1,
      },
    ],
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
    mode: "RECOMMENDATION",
    operatorNote: null,
    ...overrides,
  };
}

function picker(overrides = {}) {
  return {
    id: "P-1",
    name: "Picker One",
    joinDate: "2026-06-01",
    tenureDays: 58,
    mpStatus: "REGULER",
    mpStatusOverride: null,
    scheduleStartTime: "2026-07-28 05:00:00",
    scheduleDescription: "P5 (05:00 - 14:00)",
    role: "OUTBOUND_PICKER_STAFF",
    shift: "PAGI",
    checkedIn: true,
    isActive: true,
    zones: ["MZA1", "MZA2"],
    waves: ["WAVE 12"],
    targetQty: 1_000,
    targetOverride: null,
    targetPerHour: 125,
    activeHours: 2,
    assignedQty: 100,
    pickedQty: 80,
    totalSo: 1,
    state: "ACTIVE",
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

test("routing labels are dynamic and naturally sorted", () => {
  const labels = ["WAVE 12", "WAVE 2+", "WAVE 2", "EXPRESS", "UNMAPPED"];
  assert.deepEqual(labels.sort(compareRouteLabels), [
    "WAVE 2",
    "WAVE 2+",
    "WAVE 12",
    "EXPRESS",
    "UNMAPPED",
  ]);
});

test("manual assignment locks all SO splits and requires a reason for override", () => {
  const orders = [
    order(),
    order({ id: "SO-1::MZA2", zone: "MZA2", requestQty: 80 }),
  ];
  const targetRules = [
    {
      mpStatus: "REGULER",
      targetQty: 1_000,
      maxLoadPct: 100,
      description: "Regular",
    },
  ];
  const baseInput = {
    orderIds: ["SO-1::MZA1"],
    pickerId: "P-1",
    lockWholeSo: true,
    requireActive: true,
    requireCheckIn: true,
    requireRole: true,
    requireShift: true,
    requireZone: true,
    enforceCapacity: true,
    allowOverride: false,
    note: "",
  };
  const valid = checkManualAssignment(
    orders,
    [picker()],
    targetRules,
    baseInput,
  );
  assert.equal(valid.orderIds.length, 2);
  assert.equal(valid.canStage, true);
  assert.equal(
    buildManualAssignments(orders, [picker()], targetRules, baseInput).length,
    2,
  );

  const invalid = checkManualAssignment(
    orders,
    [picker({ zones: [] })],
    targetRules,
    baseInput,
  );
  assert.equal(invalid.canStage, false);
  assert.match(invalid.violations.join(" "), /Skill zona/);
  const overridden = checkManualAssignment(
    orders,
    [picker({ zones: [] })],
    targetRules,
    {
      ...baseInput,
      allowOverride: true,
      note: "Disetujui TL karena prioritas ekspedisi.",
    },
  );
  assert.equal(overridden.canStage, true);
});

test("SO split keeps remarks and aggregates SKU details", () => {
  const lines = [
    {
      soDate: "2026-07-28",
      createdAt: "2026-07-28T05:00:00+07:00",
      soNumber: "SO-1",
      originId: "WH-1",
      originLocationName: "Warehouse",
      destination: "CBT Jakarta",
      pickingAreaName: "MZA1",
      originRackName: "WH-MZA1-L1-01",
      productId: "PROD-1",
      productName: "Produk Satu",
      skuNumber: "SKU-1",
      status: "NEW",
      priority: "High",
      requestQty: 60,
      pickingStaffId: null,
      pickerName: null,
      pickingStartAt: null,
      pickingEndAt: "2026-07-28T06:00:00+07:00",
      remarks: "EXPRESS",
    },
    {
      soDate: "2026-07-28",
      createdAt: "2026-07-28T05:00:00+07:00",
      soNumber: "SO-1",
      originId: "WH-1",
      originLocationName: "Warehouse",
      destination: "CBT Jakarta",
      pickingAreaName: "MZA1",
      originRackName: "WH-MZA1-L1-02",
      productId: "PROD-1",
      productName: "Produk Satu",
      skuNumber: "SKU-1",
      status: "NEW",
      priority: "High",
      requestQty: 40,
      pickingStaffId: null,
      pickerName: null,
      pickingStartAt: null,
      pickingEndAt: null,
      remarks: "EXPRESS",
    },
  ];
  const result = splitSupplyOrderLines(lines, []);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].remarks, ["EXPRESS"]);
  assert.equal(result[0].skuDetails.length, 1);
  assert.equal(result[0].skuDetails[0].requestQty, 100);
  assert.equal(result[0].skuDetails[0].pickedQty, 60);
});

test("recommendation filter follows schedule_description and remarks", () => {
  const result = proposeAssignments(
    [order()],
    [picker()],
    [
      {
        mpStatus: "REGULER",
        targetQty: 1_000,
        maxLoadPct: 120,
        description: "Regular",
      },
    ],
    undefined,
    {
      shifts: ["PAGI"],
      scheduleDescriptions: ["P5 (05:00 - 14:00)"],
      mpStatuses: ["REGULER"],
      zones: ["MZA1"],
      waves: ["WAVE 1"],
      drops: ["DROP 1"],
      remarks: ["PRIORITAS"],
    },
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].pickerId, "P-1");
});
