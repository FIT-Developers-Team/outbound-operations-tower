import assert from "node:assert/strict";
import test from "node:test";
import {
  parseDelimited,
  parseSupersetExport,
  validateSupersetRecords,
} from "../lib/superset-payload.ts";

test("parses nested Superset chart data and normalizes epoch timestamps", () => {
  const payload = JSON.stringify({
    result: [
      {
        status: "success",
        colnames: [
          "so_date",
          "so_number",
          "origin_rack_name",
          "SUM(request_quantity)",
        ],
        data: [
          {
            so_date: 1785196800000,
            so_number: "INV/SO/20260728/772/5898367",
            origin_rack_name: "CBT-SRB1-03-08-L1-02",
            "SUM(request_quantity)": 552,
          },
        ],
      },
    ],
  });

  const records = parseSupersetExport(payload, "application/json");

  assert.equal(records.length, 1);
  assert.equal(records[0].so_date, "2026-07-28 00:00:00");
  assert.equal(records[0]["sum(request_quantity)"], "552");
  assert.equal(
    validateSupersetRecords(records, "so", "2026-07", "21208")
      .currentMonthRows,
    1,
  );
});

test("parses Superset array rows using colnames", () => {
  const payload = JSON.stringify({
    result: [
      {
        colnames: ["date_key", "staff_id", "staff_name", "schedule_role"],
        data: [
          [
            "28/07/2026 00:00:00",
            64851,
            "Parhan Nabidi",
            "OUTBOUND_PICKER_STAFF",
          ],
        ],
      },
    ],
  });

  const records = parseSupersetExport(payload, "application/json");

  assert.deepEqual(records[0], {
    date_key: "2026-07-28 00:00:00",
    staff_id: "64851",
    staff_name: "Parhan Nabidi",
    schedule_role: "OUTBOUND_PICKER_STAFF",
  });
  assert.equal(
    validateSupersetRecords(records, "staff", "2026-07", "21218")
      .currentMonthRows,
    1,
  );
});

test("parses quoted TSV fields without shifting columns", () => {
  const records = parseDelimited(
    'so_date\tso_number\tSUM(request_quantity)\n2026-07-28 00:00:00\t"SO\t001"\t1,250\n',
  );

  assert.equal(records[0].so_number, "SO\t001");
  assert.equal(records[0]["sum(request_quantity)"], "1,250");
});

test("rejects a successful response whose chart schema is not operational", () => {
  const records = parseSupersetExport(
    JSON.stringify({
      result: [{ data: [{ label: "NEW", metric: 42 }] }],
    }),
    "application/json",
  );

  assert.throws(
    () => validateSupersetRecords(records, "so", "2026-07", "21208"),
    /Kolom wajib yang belum terbaca/,
  );
});

test("rejects an out-of-month snapshot instead of overwriting live data with zero", () => {
  const records = [
    {
      so_date: "2026-06-30 00:00:00",
      so_number: "SO-OLD",
      "sum(request_quantity)": "10",
    },
  ];

  assert.throws(
    () => validateSupersetRecords(records, "so", "2026-07", "21208"),
    /tidak memiliki data bulan 2026-07/,
  );
});
