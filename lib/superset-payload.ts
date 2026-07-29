export type RawRecord = Record<string, string>;

export type SupersetResource = "so" | "staff";

const REQUIRED_COLUMNS: Record<SupersetResource, string[][]> = {
  so: [
    ["so_date", "supply_order_created_at"],
    ["so_number"],
    [
      "sum(request_quantity)",
      "request_quantity",
      "request_qty",
    ],
  ],
  staff: [
    ["date_key"],
    ["staff_id"],
    ["staff_name"],
    ["schedule_role"],
  ],
};

const REQUIRED_LABELS: Record<SupersetResource, string[]> = {
  so: ["so_date/supply_order_created_at", "so_number", "request_quantity"],
  staff: ["date_key", "staff_id", "staff_name", "schedule_role"],
};

export function normalizeSupersetHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function firstLine(value: string) {
  const index = value.search(/\r?\n/);
  return index === -1 ? value : value.slice(0, index);
}

function detectDelimiter(value: string) {
  const header = firstLine(value);
  const tabs = (header.match(/\t/g) ?? []).length;
  const commas = (header.match(/,/g) ?? []).length;
  return tabs > commas ? "\t" : ",";
}

function isTemporalColumn(header: string) {
  return (
    /(^|_)(date|datetime|timestamp|dttm)(_|$)/.test(header) ||
    /_(at|time)$/.test(header)
  );
}

function formatEpoch(value: number) {
  const milliseconds = Math.abs(value) < 100_000_000_000 ? value * 1_000 : value;
  const parsed = new Date(milliseconds);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

function normalizeTemporalValue(value: string | number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return formatEpoch(value);
  }
  const text = String(value).trim();
  if (!text) return "";
  if (/^-?\d{10,13}$/.test(text)) {
    return formatEpoch(Number(text)) || text;
  }
  const dayFirst = text.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (dayFirst) {
    const [, day, month, year, hour = "00", minute = "00", second = "00"] =
      dayFirst;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")} ${hour.padStart(2, "0")}:${minute}:${second}`;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    return text.replace("T", " ").replace(/\.\d{3}Z?$/, "").replace(/Z$/, "");
  }
  if (
    /[A-Za-z]{3,}/.test(text) &&
    !/^\d{1,2}:\d{2}(?::\d{2})?$/.test(text)
  ) {
    const parsed = Date.parse(text);
    if (!Number.isNaN(parsed)) return formatEpoch(parsed) || text;
  }
  return text;
}

function normalizeCell(header: string, value: unknown) {
  if (value === null || value === undefined) return "";
  if (isTemporalColumn(header) && (typeof value === "number" || typeof value === "string")) {
    return normalizeTemporalValue(value);
  }
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeRecord(record: Record<string, unknown>): RawRecord {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => {
      const header = normalizeSupersetHeader(key);
      return [header, normalizeCell(header, value)];
    }),
  );
}

/**
 * RFC-4180 compatible parser for Superset CSV/TSV exports, including quoted
 * delimiters and quoted line breaks.
 */
export function parseDelimited(value: string): RawRecord[] {
  const delimiter = detectDelimiter(value);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (character === '"' && value[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === delimiter) {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const headers = (rows.shift() ?? []).map(normalizeSupersetHeader);
  return rows
    .filter((values) => values.some((item) => item.trim().length > 0))
    .map((values) =>
      Object.fromEntries(
        headers.map((header, index) => [
          header,
          normalizeCell(header, values[index] ?? ""),
        ]),
      ),
    );
}

function columnNames(object: Record<string, unknown>, inherited: string[]) {
  const candidate = object.colnames ?? object.columns;
  if (!Array.isArray(candidate)) return inherited;
  const names = candidate
    .map((item) =>
      typeof item === "string"
        ? item
        : item && typeof item === "object" && "name" in item
          ? String((item as { name: unknown }).name)
          : "",
    )
    .filter(Boolean)
    .map(normalizeSupersetHeader);
  return names.length ? names : inherited;
}

function recordsFromJson(value: unknown, inheritedColumns: string[] = []): RawRecord[] {
  if (Array.isArray(value)) {
    if (
      inheritedColumns.length &&
      value.some((row) => Array.isArray(row))
    ) {
      return value
        .filter((row): row is unknown[] => Array.isArray(row))
        .map((row) =>
          Object.fromEntries(
            inheritedColumns.map((header, index) => [
              header,
              normalizeCell(header, row[index]),
            ]),
          ),
        );
    }
    return value
      .filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) && typeof row === "object" && !Array.isArray(row),
      )
      .map(normalizeRecord);
  }
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  const columns = columnNames(object, inheritedColumns);
  if (typeof object.data === "string") return parseDelimited(object.data);
  if (Array.isArray(object.data)) {
    const records = recordsFromJson(object.data, columns);
    if (records.length) return records;
  }
  if (Array.isArray(object.result)) {
    for (const result of object.result) {
      const records = recordsFromJson(result, columns);
      if (records.length) return records;
    }
  }
  if (object.query_data) return recordsFromJson(object.query_data, columns);
  return [];
}

export function parseSupersetExport(
  body: string,
  contentType: string,
): RawRecord[] {
  const trimmed = body.trimStart();
  if (
    contentType.includes("json") ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("[")
  ) {
    const parsed = JSON.parse(body) as unknown;
    return recordsFromJson(parsed);
  }
  return parseDelimited(body);
}

function compactColumns(records: RawRecord[]) {
  const columns = new Set<string>();
  records.slice(0, 100).forEach((record) =>
    Object.keys(record).forEach((column) => columns.add(column)),
  );
  return [...columns].sort();
}

function datePart(value: string) {
  return value.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
}

export function validateSupersetRecords(
  records: RawRecord[],
  resource: SupersetResource,
  month: string,
  sliceId: string,
) {
  if (!records.length) {
    throw new Error(`Slice ${sliceId} tidak mengembalikan baris data.`);
  }
  const columns = compactColumns(records);
  const columnSet = new Set(columns);
  const missing = REQUIRED_COLUMNS[resource]
    .map((aliases, index) => ({
      aliases,
      label: REQUIRED_LABELS[resource][index],
    }))
    .filter(({ aliases }) => !aliases.some((alias) => columnSet.has(alias)))
    .map(({ label }) => label);
  if (missing.length) {
    const readableColumns = columns.slice(0, 12).join(", ") || "tidak ada";
    throw new Error(
      `Struktur Slice ${sliceId} tidak sesuai data ${resource === "so" ? "Supply Order" : "staff"}. Kolom wajib yang belum terbaca: ${missing.join(", ")}. Kolom terbaca: ${readableColumns}.`,
    );
  }

  const dateAliases =
    resource === "so"
      ? ["so_date", "supply_order_created_at"]
      : ["date_key"];
  const dates = records
    .map((row) => {
      for (const alias of dateAliases) {
        if (row[alias]) return datePart(row[alias]);
      }
      return "";
    })
    .filter(Boolean);
  const currentMonthRows = dates.filter((date) => date.startsWith(month)).length;
  if (!currentMonthRows) {
    const ordered = [...new Set(dates)].sort();
    const range = ordered.length
      ? `${ordered[0]} s.d. ${ordered.at(-1)}`
      : "format tanggal tidak dikenali";
    throw new Error(
      `Slice ${sliceId} tidak memiliki data bulan ${month} (${range}). Periksa filter waktu yang tersimpan di chart Superset.`,
    );
  }
  return {
    columns,
    currentMonthRows,
    sourceRows: records.length,
  };
}
