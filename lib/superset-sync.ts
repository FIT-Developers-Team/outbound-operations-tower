import { createDemoDataset } from "./demo-data";
import {
  deriveMpStatus,
  derivePickingZone,
  deriveShift,
  extractDestinationCode,
  extractWmsSoId,
  resolveDestinationRule,
} from "./outbound-logic";
import {
  getSessionCookie,
  getStoredConnector,
  loadDatasetSnapshot,
  saveDatasetSnapshot,
  saveRawExport,
  saveStoredConnector,
} from "./runtime-storage";
import type {
  DemoDataset,
  DestinationRule,
  HourlyPoint,
  MpStatus,
  OrderStatus,
  Picker,
  SupplyOrder,
  TargetRule,
  ZoneRule,
} from "./outbound-types";

type RawRecord = Record<string, string>;

type ExportResult = {
  body: string;
  contentType: string;
  records: RawRecord[];
};

export type SyncResult = {
  dataset: DemoDataset;
  soRows: number;
  staffRows: number;
  month: string;
  syncedAt: string;
  datasetKey: string;
  runId: string;
};

const DEFAULT_TARGETS: TargetRule[] = [
  {
    mpStatus: "OJT 1",
    targetQty: 700,
    maxLoadPct: 90,
    description: "Hari 1–7; pendampingan ketat.",
  },
  {
    mpStatus: "OJT 2",
    targetQty: 1_100,
    maxLoadPct: 95,
    description: "Hari 8–14; beban bertahap.",
  },
  {
    mpStatus: "OJT 3",
    targetQty: 1_500,
    maxLoadPct: 100,
    description: "Hari 15–20; mendekati reguler.",
  },
  {
    mpStatus: "REGULER",
    targetQty: 1_900,
    maxLoadPct: 105,
    description: "Mulai hari ke-21.",
  },
];

function normalizeHeader(value: string) {
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

/**
 * RFC-4180 compatible enough for Superset CSV, with TSV auto-detection and
 * support for quoted delimiters/newlines.
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
  const headers = (rows.shift() ?? []).map(normalizeHeader);
  return rows
    .filter((values) => values.some((item) => item.trim().length > 0))
    .map((values) =>
      Object.fromEntries(
        headers.map((header, index) => [header, values[index]?.trim() ?? ""]),
      ),
    );
}

function recordsFromJson(value: unknown): RawRecord[] {
  if (Array.isArray(value)) {
    return value.filter(
      (row): row is RawRecord =>
        Boolean(row) && typeof row === "object" && !Array.isArray(row),
    );
  }
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  if (typeof object.data === "string") return parseDelimited(object.data);
  if (Array.isArray(object.data)) return recordsFromJson(object.data);
  if (Array.isArray(object.result)) {
    for (const result of object.result) {
      const records = recordsFromJson(result);
      if (records.length) return records;
    }
  }
  if (object.query_data) return recordsFromJson(object.query_data);
  return [];
}

export function parseSupersetExport(
  body: string,
  contentType: string,
): RawRecord[] {
  const trimmed = body.trimStart();
  if (contentType.includes("json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = JSON.parse(body) as unknown;
    return recordsFromJson(parsed).map((record) =>
      Object.fromEntries(
        Object.entries(record).map(([key, value]) => [
          normalizeHeader(key),
          String(value ?? "").trim(),
        ]),
      ),
    );
  }
  return parseDelimited(body);
}

function jakartaMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const nextMonth = Number(month) === 12 ? 1 : Number(month) + 1;
  const nextYear = Number(month) === 12 ? Number(year) + 1 : Number(year);
  return {
    key: `${year}-${month}`,
    from: `${year}-${month}-01`,
    to: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`,
  };
}

function validateBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Base URL Superset tidak valid.");
  }
  const local =
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname) &&
    process.env.NODE_ENV !== "production";
  if (url.protocol !== "https:" && !local) {
    throw new Error("Base URL Superset wajib memakai HTTPS.");
  }
  const allowlist = (process.env.SUPERSET_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.length && !allowlist.includes(url.hostname.toLowerCase())) {
    throw new Error(
      "Hostname Superset tidak ada di SUPERSET_ALLOWED_HOSTS.",
    );
  }
  return url;
}

function exportUrl(
  baseUrl: string,
  template: string,
  sliceId: string,
  month: ReturnType<typeof jakartaMonth>,
) {
  const base = validateBaseUrl(baseUrl);
  const path = template
    .replaceAll("{sliceId}", encodeURIComponent(sliceId))
    .replaceAll("{from}", encodeURIComponent(month.from))
    .replaceAll("{to}", encodeURIComponent(month.to))
    .replaceAll("{month}", encodeURIComponent(month.key));
  const url = new URL(path, base);
  if (url.origin !== base.origin) {
    throw new Error("Export path harus tetap berada pada origin Superset.");
  }
  return url;
}

async function fetchExport(
  baseUrl: string,
  pathTemplate: string,
  sliceId: string,
  cookie: string,
  month: ReturnType<typeof jakartaMonth>,
): Promise<ExportResult> {
  const url = exportUrl(baseUrl, pathTemplate, sliceId, month);
  const response = await fetch(url, {
    headers: {
      Accept: "text/csv, application/json;q=0.9",
      Cookie: cookie,
      "User-Agent": "CBT-Outbound-Hub/1.0",
    },
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(55_000),
  });
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if ([301, 302, 303, 307, 308, 401, 403].includes(response.status)) {
    throw new Error(
      `Sesi Superset ditolak (${response.status}). Perbarui cookie lalu uji kembali.`,
    );
  }
  if (!response.ok) {
    throw new Error(`Export slice ${sliceId} gagal (${response.status}).`);
  }
  const body = await response.text();
  if (
    contentType.includes("text/html") ||
    /<title>.*(login|sign in)/i.test(body.slice(0, 4_000))
  ) {
    throw new Error(
      "Superset mengarahkan ke halaman login. Cookie kemungkinan kedaluwarsa.",
    );
  }
  if (body.length > 45_000_000) {
    throw new Error("Export Superset melebihi batas aman 45 MB.");
  }
  const records = parseSupersetExport(body, contentType);
  if (!records.length) {
    throw new Error(`Slice ${sliceId} tidak mengembalikan baris data.`);
  }
  return { body, contentType, records };
}

function value(row: RawRecord, ...names: string[]) {
  for (const name of names) {
    const resolved = row[normalizeHeader(name)];
    if (resolved !== undefined) return resolved;
  }
  return "";
}

function datePart(input: string) {
  return input.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
}

function normalizePriority(raw: string): "High" | "Medium" | "Low" {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "high") return "High";
  if (normalized === "medium") return "Medium";
  return "Low";
}

function maxDate(values: string[], fallback: string) {
  return values
    .map(datePart)
    .filter(Boolean)
    .sort()
    .at(-1) ?? fallback;
}

function normalizeStatus(raw: string): OrderStatus {
  return raw.trim().toUpperCase() || "UNKNOWN";
}

function buildOrders(
  records: RawRecord[],
  month: string,
  rules: DestinationRule[],
): SupplyOrder[] {
  type Group = {
    first: RawRecord;
    requestQty: number;
    pickedQty: number;
    racks: Set<string>;
    areas: Set<string>;
    skus: Set<string>;
    skuDetails: Map<
      string,
      {
        skuNumber: string;
        productId: string;
        productName: string;
        requestQty: number;
        pickedQty: number;
        lineCount: number;
      }
    >;
    remarks: Set<string>;
    lineCount: number;
    pickerIds: Set<string>;
  };
  const groups = new Map<string, Group>();
  records.forEach((row) => {
    const soDate = value(row, "so_date", "supply_order_created_at");
    if (!soDate.startsWith(month)) return;
    const soNumber = value(row, "so_number");
    if (!soNumber) return;
    const rack = value(row, "origin_rack_name");
    const zone = derivePickingZone(rack);
    const key = `${soNumber}::${zone}`;
    const quantity = Math.max(
      0,
      Number(
        value(
          row,
          "SUM(request_quantity)",
          "sum(request_quantity)",
          "request_quantity",
          "request_qty",
        ).replaceAll(",", ""),
      ) || 0,
    );
    const endAt = value(row, "picking_end_at");
    const pickerId = value(row, "picking_staff_id");
    const group = groups.get(key) ?? {
      first: row,
      requestQty: 0,
      pickedQty: 0,
      racks: new Set<string>(),
      areas: new Set<string>(),
      skus: new Set<string>(),
      skuDetails: new Map(),
      remarks: new Set<string>(),
      lineCount: 0,
      pickerIds: new Set<string>(),
    };
    group.requestQty += quantity;
    if (endAt) group.pickedQty += quantity;
    if (rack) group.racks.add(rack);
    const area = value(row, "picking_area_name");
    if (area) group.areas.add(area);
    const sku = value(row, "sku_number", "product_id");
    if (sku) group.skus.add(sku);
    if (sku) {
      const currentSku = group.skuDetails.get(sku) ?? {
        skuNumber: value(row, "sku_number"),
        productId: value(row, "product_id"),
        productName: value(row, "product_name") || `SKU ${sku}`,
        requestQty: 0,
        pickedQty: 0,
        lineCount: 0,
      };
      currentSku.requestQty += quantity;
      currentSku.pickedQty += endAt ? quantity : 0;
      currentSku.lineCount += 1;
      group.skuDetails.set(sku, currentSku);
    }
    const remark = value(row, "remarks");
    if (remark) group.remarks.add(remark);
    if (pickerId) group.pickerIds.add(pickerId);
    group.lineCount += 1;
    groups.set(key, group);
  });

  return [...groups.entries()].map(([id, group]) => {
    const row = group.first;
    const soDate = datePart(value(row, "so_date")) || `${month}-01`;
    const createdAt = value(
      row,
      "supply_order_created_at",
      "created_at",
      "so_date",
    );
    const destination = value(row, "destination_location_name", "destination");
    const zone = id.split("::").at(-1) ?? "UNMAPPED";
    const rule = resolveDestinationRule(destination, soDate, rules);
    const racks = [...group.racks].sort();
    const levels = racks
      .map((rack) => rack.match(/-(L\d+)-/i)?.[1]?.toUpperCase())
      .filter((item): item is string => Boolean(item));
    const status = normalizeStatus(value(row, "status"));
    return {
      id,
      soNumber: value(row, "so_number"),
      wmsSoId: extractWmsSoId(value(row, "so_number")),
      destination,
      destinationCode: extractDestinationCode(destination),
      zone,
      pickingAreaNames: [...group.areas].sort(),
      originRackNames: racks,
      wave: rule?.wave ?? "UNMAPPED",
      drop: rule?.drop ?? "UNMAPPED",
      mappingStatus: rule ? "MAPPED" : "UNMAPPED",
      status,
      priority: normalizePriority(value(row, "supply_order_priority", "priority")),
      remarks: [...group.remarks].sort(),
      requestQty: group.requestQty,
      pickedQty: Math.min(group.requestQty, group.pickedQty),
      skuCount: group.skus.size,
      skuDetails: [...group.skuDetails.values()].sort(
        (a, b) => b.requestQty - a.requestQty || a.skuNumber.localeCompare(b.skuNumber),
      ),
      lineCount: group.lineCount,
      rackLevel: [...new Set(levels)].join(", ") || "-",
      pickerId: group.pickerIds.size === 1 ? [...group.pickerIds][0] : null,
      shift: deriveShift(createdAt),
      deadline: "14:00",
      createdAt,
      updatedAt:
        value(row, "picking_end_at", "picking_start_at", "supply_order_created_at")
          .slice(11, 16) || "-",
    };
  });
}

function targetForStatus(status: MpStatus, rules: TargetRule[]) {
  return rules.find((rule) => rule.mpStatus === status)?.targetQty ?? 1_000;
}

function buildPickers(
  records: RawRecord[],
  month: string,
  operationDate: string,
  orders: SupplyOrder[],
  targetRules: TargetRule[],
  previous: Picker[],
): Picker[] {
  const latestByStaff = new Map<string, RawRecord>();
  records.forEach((row) => {
    const date = value(row, "date_key");
    const id = value(row, "staff_id");
    if (!id || !date.startsWith(month)) return;
    const existing = latestByStaff.get(id);
    if (!existing || value(existing, "date_key") <= date) {
      latestByStaff.set(id, row);
    }
  });
  const assigned = new Map<string, { qty: number; picked: number; so: Set<string> }>();
  orders.forEach((order) => {
    if (!order.pickerId) return;
    const current = assigned.get(order.pickerId) ?? {
      qty: 0,
      picked: 0,
      so: new Set<string>(),
    };
    current.qty += order.requestQty;
    current.picked += order.pickedQty;
    current.so.add(order.soNumber);
    assigned.set(order.pickerId, current);
  });
  const previousById = new Map(previous.map((picker) => [picker.id, picker]));

  return [...latestByStaff.values()]
    .filter(
      (row) => value(row, "schedule_role").trim() === "OUTBOUND_PICKER_STAFF",
    )
    .map((row) => {
      const id = value(row, "staff_id");
      const prior = previousById.get(id);
      const joinDate = datePart(value(row, "drivers_join_date"));
      const scheduleStartTime = value(row, "schedule_start_time");
      const role = value(row, "schedule_role");
      const checkedIn = Boolean(value(row, "checkin_time"));
      const isActive = value(row, "is_active").toLowerCase() === "true";
      const mpStatus = deriveMpStatus(joinDate, operationDate);
      const work = assigned.get(id);
      return {
        id,
        name: value(row, "staff_name") || `Staff ${id}`,
        joinDate,
        tenureDays: Math.max(
          0,
          Math.floor(
            (Date.parse(`${operationDate}T00:00:00Z`) -
              Date.parse(`${joinDate}T00:00:00Z`)) /
              86_400_000,
          ) + 1,
        ),
        mpStatus,
        mpStatusOverride: prior?.mpStatusOverride ?? null,
        scheduleStartTime,
        scheduleDescription: value(row, "schedule_description"),
        role,
        shift: deriveShift(scheduleStartTime),
        checkedIn,
        isActive,
        zones: prior?.zones ?? [],
        waves: prior?.waves ?? [],
        targetQty: targetForStatus(mpStatus, targetRules),
        targetOverride: prior?.targetOverride ?? null,
        targetPerHour: Math.round(targetForStatus(mpStatus, targetRules) / 8),
        activeHours: checkedIn ? 1 : 0,
        assignedQty: work?.qty ?? 0,
        pickedQty: work?.picked ?? 0,
        totalSo: work?.so.size ?? 0,
        state: isActive && checkedIn ? ("ACTIVE" as const) : ("OFFLINE" as const),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "id"));
}

function buildHourly(records: RawRecord[], month: string): HourlyPoint[] {
  const byHour = new Map<string, HourlyPoint>();
  records.forEach((row) => {
    const soDate = value(row, "so_date", "supply_order_created_at");
    if (!soDate.startsWith(month)) return;
    const created = value(row, "supply_order_created_at");
    const createdHour = created.slice(11, 13);
    const quantity =
      Number(
        value(
          row,
          "SUM(request_quantity)",
          "sum(request_quantity)",
          "request_quantity",
        ).replaceAll(",", ""),
      ) || 0;
    if (createdHour) {
      const point = byHour.get(createdHour) ?? {
        hour: createdHour,
        requestQty: 0,
        pickedQty: 0,
        activeMp: 0,
      };
      point.requestQty += quantity;
      byHour.set(createdHour, point);
    }
    const completed = value(row, "picking_end_at");
    const completedHour = completed.slice(11, 13);
    if (completedHour) {
      const point = byHour.get(completedHour) ?? {
        hour: completedHour,
        requestQty: 0,
        pickedQty: 0,
        activeMp: 0,
      };
      point.pickedQty += quantity;
      byHour.set(completedHour, point);
    }
  });
  return [...byHour.values()].sort((a, b) => a.hour.localeCompare(b.hour));
}

function deriveZoneRules(orders: SupplyOrder[]): ZoneRule[] {
  const areas = new Map<string, Set<string>>();
  orders.forEach((order) => {
    const set = areas.get(order.zone) ?? new Set<string>();
    order.pickingAreaNames.forEach((area) => set.add(area));
    areas.set(order.zone, set);
  });
  return [...areas.entries()]
    .map(([zone, names]) => ({
      zone,
      pickingAreaNames: [...names].sort(),
      enabled: zone !== "UNMAPPED",
    }))
    .sort((a, b) => a.zone.localeCompare(b.zone));
}

function buildDataset(
  soRecords: RawRecord[],
  staffRecords: RawRecord[],
  month: string,
  previous: DemoDataset | null,
): DemoDataset {
  const fallback = createDemoDataset();
  const sourceDate = maxDate(
    [
      ...soRecords.map((row) => value(row, "so_date")),
      ...staffRecords.map((row) => value(row, "date_key")),
    ],
    `${month}-01`,
  );
  const destinationRules = previous?.destinationRules ?? [];
  const targetRules = previous?.targetRules ?? DEFAULT_TARGETS;
  const orders = buildOrders(soRecords, month, destinationRules);
  const pickers = buildPickers(
    staffRecords,
    month,
    sourceDate,
    orders,
    targetRules,
    previous?.pickers ?? [],
  );
  const distinctSo = new Set(orders.map((order) => order.soNumber)).size;
  const bySo = new Map<string, number>();
  orders.forEach((order) =>
    bySo.set(order.soNumber, (bySo.get(order.soNumber) ?? 0) + 1),
  );
  const pickerSourceRows = staffRecords.filter(
    (row) =>
      value(row, "date_key").startsWith(month) &&
      value(row, "schedule_role") === "OUTBOUND_PICKER_STAFF",
  );
  const missingSchedule = pickerSourceRows.filter(
    (row) => !value(row, "schedule_start_time"),
  ).length;
  const missingCheckIn = pickerSourceRows.filter(
    (row) => !value(row, "checkin_time"),
  ).length;
  const completedLineQty = soRecords
    .filter(
      (row) =>
        value(row, "so_date").startsWith(month) &&
        Boolean(value(row, "picking_end_at")),
    )
    .reduce(
      (sum, row) =>
        sum +
        (Number(
          value(
            row,
            "SUM(request_quantity)",
            "sum(request_quantity)",
            "request_quantity",
          ).replaceAll(",", ""),
        ) || 0),
      0,
    );

  return {
    orders,
    pickers,
    destinationRules,
    zoneRules: deriveZoneRules(orders),
    targetRules,
    checkerRoutes: previous?.checkerRoutes ?? fallback.checkerRoutes,
    audit: [
      {
        id: `SYNC-${Date.now()}`,
        at: new Date().toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Jakarta",
        }),
        actor: "Superset connector",
        action: "Snapshot bulan berjalan diperbarui",
        detail: `${soRecords.length.toLocaleString("id-ID")} baris SO dan ${staffRecords.length.toLocaleString("id-ID")} baris staff diproses.`,
        tone: "success" as const,
      },
      ...(previous?.audit ?? []),
    ].slice(0, 40),
    hourly: buildHourly(soRecords, month),
    sourceProfile: {
      sourceDate,
      soRows: soRecords.filter((row) =>
        value(row, "so_date").startsWith(month),
      ).length,
      distinctSo,
      soZoneSplits: orders.length,
      multiZoneSo: [...bySo.values()].filter((count) => count > 1).length,
      newRows: soRecords.filter(
        (row) =>
          value(row, "so_date").startsWith(month) &&
          normalizeStatus(value(row, "status")) === "NEW",
      ).length,
      newSo: new Set(
        soRecords
          .filter(
            (row) =>
              value(row, "so_date").startsWith(month) &&
              normalizeStatus(value(row, "status")) === "NEW",
          )
          .map((row) => value(row, "so_number")),
      ).size,
      newQty: orders
        .filter((order) => order.status === "NEW")
        .reduce((sum, order) => sum + order.requestQty, 0),
      distinctZones: new Set(orders.map((order) => order.zone)).size,
      staffRows: staffRecords.filter((row) =>
        value(row, "date_key").startsWith(month),
      ).length,
      pickerRows: new Set(pickerSourceRows.map((row) => value(row, "staff_id")))
        .size,
      eligiblePickers: new Set(
        pickerSourceRows
          .filter(
            (row) =>
              value(row, "is_active").toLowerCase() === "true" &&
              Boolean(value(row, "checkin_time")) &&
              Boolean(value(row, "schedule_start_time")),
          )
          .map((row) => value(row, "staff_id")),
      ).size,
      checkedInRows: pickerSourceRows.filter((row) =>
        Boolean(value(row, "checkin_time")),
      ).length,
      completedLineQty,
      dateRange: { from: `${month}-01`, to: sourceDate },
      qualityNotes: [
        "Grain SO dipertahankan sebagai SO × picking zone.",
        "Picked quantity hanya dihitung dari line dengan picking_end_at terisi.",
        `${missingSchedule} picker row tanpa jadwal; ${missingCheckIn} tanpa check-in.`,
        "Wave dan Drop berasal dari konfigurasi, bukan dari enum aplikasi.",
      ],
    },
  };
}

export async function syncFromSuperset(
  runId = crypto.randomUUID(),
): Promise<SyncResult> {
  const connector = await getStoredConnector();
  if (
    !connector.baseUrl ||
    !connector.soSliceId ||
    !connector.staffSliceId
  ) {
    throw new Error("Base URL dan kedua Slice ID belum lengkap.");
  }
  if (
    connector.cookieExpiresAt &&
    Date.parse(connector.cookieExpiresAt) <= Date.now()
  ) {
    throw new Error(
      "Cookie Superset sudah kedaluwarsa. Perbarui cookie lalu uji kembali.",
    );
  }
  const cookie = await getSessionCookie(connector);
  if (!cookie) {
    throw new Error("Cookie Superset belum tersedia.");
  }
  const month = jakartaMonth();
  const [soExport, staffExport, previous] = await Promise.all([
    fetchExport(
      connector.baseUrl,
      connector.pathTemplate,
      connector.soSliceId,
      cookie,
      month,
    ),
    fetchExport(
      connector.baseUrl,
      connector.pathTemplate,
      connector.staffSliceId,
      cookie,
      month,
    ),
    loadDatasetSnapshot(),
  ]);
  const dataset = buildDataset(
    soExport.records,
    staffExport.records,
    month.key,
    previous?.data ?? null,
  );
  const syncedAt = new Date().toISOString();
  await Promise.all([
    saveRawExport(
      month.key,
      "so",
      soExport.body,
      soExport.contentType || "text/csv",
    ),
    saveRawExport(
      month.key,
      "staff",
      staffExport.body,
      staffExport.contentType || "text/csv",
    ),
  ]);
  const datasetKey = await saveDatasetSnapshot(
    dataset,
    runId,
    month.key,
    syncedAt,
  );
  await saveStoredConnector({
    ...connector,
    health: "CONNECTED",
    lastMessage: `${dataset.sourceProfile.soRows.toLocaleString("id-ID")} SO rows / ${dataset.sourceProfile.staffRows.toLocaleString("id-ID")} staff rows`,
    lastVerifiedAt: syncedAt,
    updatedAt: syncedAt,
  });
  return {
    dataset,
    soRows: dataset.sourceProfile.soRows,
    staffRows: dataset.sourceProfile.staffRows,
    month: month.key,
    syncedAt,
    datasetKey,
    runId,
  };
}

export { buildDataset as buildDatasetFromRecords, jakartaMonth };
