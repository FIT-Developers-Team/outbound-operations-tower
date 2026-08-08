import assert from "node:assert/strict";
import test from "node:test";
import { parseDelimited } from "../lib/superset-payload.ts";

// `so_number` and `product_name` are not temporal columns, so normalizeCell
// leaves their text alone beyond trimming. That keeps these assertions about
// the scanner rather than about value normalisation.

test("a quoted field keeps a delimiter that would otherwise split it", () => {
  const rows = parseDelimited(
    'so_number,product_name\nSO-1,"Ampera, Jakarta Selatan"',
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].product_name, "Ampera, Jakarta Selatan");
});

test("a quoted field keeps an embedded line break", () => {
  const rows = parseDelimited(
    'so_number,product_name\nSO-1,"baris satu\nbaris dua"\nSO-2,Produk',
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0].product_name, "baris satu\nbaris dua");
  assert.equal(rows[1].so_number, "SO-2");
});

test("a doubled quote becomes one literal quote", () => {
  const rows = parseDelimited(
    'so_number,product_name\nSO-1,"Produk ""spesial"" nomor 1"',
  );

  assert.equal(rows[0].product_name, 'Produk "spesial" nomor 1');
});

test("a field that is only an escaped quote survives", () => {
  const rows = parseDelimited('so_number,product_name\nSO-1,""""');

  assert.equal(rows[0].product_name, '"');
});

test("text resumes in the same field after a closing quote", () => {
  const rows = parseDelimited('so_number,product_name\nSO-1,"ab"cd');

  assert.equal(rows[0].product_name, "abcd");
});

test("CRLF line endings do not leave a carriage return on the last column", () => {
  const rows = parseDelimited(
    "so_number,product_name\r\nSO-1,Produk\r\nSO-2,Lainnya\r\n",
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0].product_name, "Produk");
  assert.equal(rows[1].product_name, "Lainnya");
});

test("a row with fewer cells than headers fills the rest with empty strings", () => {
  const rows = parseDelimited("so_number,product_name,remarks\nSO-1,Produk");

  assert.equal(rows[0].so_number, "SO-1");
  assert.equal(rows[0].product_name, "Produk");
  assert.equal(rows[0].remarks, "");
});

test("a row with more cells than headers drops the surplus", () => {
  const rows = parseDelimited("so_number\nSO-1,tidak-terpakai");

  assert.deepEqual(Object.keys(rows[0]), ["so_number"]);
  assert.equal(rows[0].so_number, "SO-1");
});

test("entirely blank rows are dropped", () => {
  const rows = parseDelimited(
    "so_number,product_name\nSO-1,Produk\n,\n\nSO-2,Lainnya\n",
  );

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.so_number),
    ["SO-1", "SO-2"],
  );
});

test("a final row without a trailing newline is still emitted", () => {
  const rows = parseDelimited("so_number,product_name\nSO-1,Produk");

  assert.equal(rows.length, 1);
  assert.equal(rows[0].product_name, "Produk");
});

test("a header-only export yields no records", () => {
  assert.deepEqual(parseDelimited("so_number,product_name"), []);
  assert.deepEqual(parseDelimited("so_number,product_name\n"), []);
});

test("an empty export yields no records", () => {
  assert.deepEqual(parseDelimited(""), []);
});

test("a tab-separated export is detected from its header", () => {
  const rows = parseDelimited(
    "so_number\tproduct_name\nSO-1\tAmpera, Jakarta Selatan",
  );

  // The comma stays inside the value because the delimiter is the tab.
  assert.equal(rows[0].product_name, "Ampera, Jakarta Selatan");
});

test("a byte order mark does not corrupt the first header", () => {
  const rows = parseDelimited("﻿so_number,product_name\nSO-1,Produk");

  assert.equal(rows[0].so_number, "SO-1");
});

test("headers are normalised to snake case", () => {
  const rows = parseDelimited("SO Number,Product Name\nSO-1,Produk");

  assert.equal(rows[0].so_number, "SO-1");
  assert.equal(rows[0].product_name, "Produk");
});

test("an unterminated quote consumes the rest of the export without looping", () => {
  const rows = parseDelimited('so_number,product_name\nSO-1,"belum ditutup');

  assert.equal(rows.length, 1);
  assert.equal(rows[0].product_name, "belum ditutup");
});

// A month-sized export is the case the scanner exists for. The assertion is
// correctness at volume; a parser that degenerates to per-character work fails
// this by exhausting the timeout rather than by returning something wrong.
test("a large export parses correctly at volume", { timeout: 30_000 }, () => {
  const rows = 120_000;
  const lines = ["so_number,product_name,remarks"];
  for (let index = 0; index < rows; index += 1) {
    lines.push(
      `SO-${index},"Produk ""x"" ${index}, varian",${index % 5 === 0 ? "EXPRESS" : ""}`,
    );
  }

  const parsed = parseDelimited(lines.join("\n"));

  assert.equal(parsed.length, rows);
  assert.equal(parsed[0].product_name, 'Produk "x" 0, varian');
  assert.equal(parsed.at(-1).so_number, `SO-${rows - 1}`);
  assert.equal(parsed.at(-1).remarks, "");
});
