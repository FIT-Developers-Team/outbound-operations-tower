/**
 * CBT Outbound Assignment Hub
 *
 * Bind this script to the imported Google Sheet workbook. Keep credentials in
 * Script Properties; never store tokens in cells.
 */

const SHEETS = Object.freeze({
  SETTINGS: "Settings",
  RAW_SO: "Raw_SO",
  RAW_STAFF: "Raw_Staff",
  DESTINATION_RULES: "Config_Wave_Drop",
  TARGET_RULES: "Config_Target",
  STAFF_ROSTER: "Staff_Roster",
  SO_SPLIT: "SO_Zone_Split",
  PLAN: "Assignment_Plan",
  BULK: "Bulk_Upload",
  AUDIT: "Audit_Log",
  CHECKER: "Checker_Routes",
});

const REQUIRED_SO_HEADERS = Object.freeze([
  "so_date",
  "supply_order_created_at",
  "so_number",
  "destination_location_name",
  "status",
  "origin_rack_name",
  "picking_area_name",
  "SUM(request_quantity)",
]);

const REQUIRED_STAFF_HEADERS = Object.freeze([
  "date_key",
  "drivers_join_date",
  "schedule_start_time",
  "staff_id",
  "staff_name",
  "schedule_role",
  "schedule_description",
  "checkin_time",
  "is_active",
]);

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Outbound Hub")
    .addItem("Sync Superset sekarang", "syncSuperset")
    .addItem("Validasi source", "validateSourceSheets")
    .addItem("Refresh formula", "refreshCalculations")
    .addSeparator()
    .addItem("Install trigger 15 menit", "installSyncTrigger")
    .addToUi();
}

function syncSuperset() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    throw new Error("Sync lain masih berjalan. Coba lagi setelah proses selesai.");
  }

  const startedAt = new Date();
  try {
    const properties = PropertiesService.getScriptProperties();
    const soUrl = requiredProperty_(properties, "SUPERSET_SO_EXPORT_URL");
    const staffUrl = requiredProperty_(properties, "SUPERSET_STAFF_EXPORT_URL");
    const accessToken = requiredProperty_(properties, "SUPERSET_ACCESS_TOKEN");

    const soRows = fetchTabular_(soUrl, accessToken);
    const staffRows = fetchTabular_(staffUrl, accessToken);
    assertHeaders_(soRows[0], REQUIRED_SO_HEADERS, "SO Outbound Assign");
    assertHeaders_(staffRows[0], REQUIRED_STAFF_HEADERS, "Staff Assign");

    replaceSheetData_(SHEETS.RAW_SO, soRows);
    replaceSheetData_(SHEETS.RAW_STAFF, staffRows);
    refreshCalculations();
    appendAudit_("SUPERSET_SYNC", "SUCCESS", {
      so_rows: Math.max(0, soRows.length - 1),
      staff_rows: Math.max(0, staffRows.length - 1),
      elapsed_ms: new Date().getTime() - startedAt.getTime(),
    });
  } catch (error) {
    appendAudit_("SUPERSET_SYNC", "FAILED", {
      message: String(error && error.message ? error.message : error),
    });
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function fetchTabular_(url, accessToken) {
  if (!/^https:\/\//i.test(url)) {
    throw new Error("Superset export URL wajib HTTPS.");
  }
  const response = UrlFetchApp.fetch(url, {
    method: "get",
    muteHttpExceptions: true,
    followRedirects: true,
    headers: { Authorization: "Bearer " + accessToken },
  });
  const status = response.getResponseCode();
  const text = response.getContentText("UTF-8");
  if (status < 200 || status >= 300) {
    throw new Error("Superset export gagal dengan HTTP " + status + ".");
  }
  if (text.length > 45 * 1024 * 1024) {
    throw new Error("Superset export melebihi batas aman 45 MB.");
  }

  const contentType = String(response.getHeaders()["Content-Type"] || "").toLowerCase();
  if (contentType.indexOf("json") >= 0 || /^[\[{]/.test(text.trim())) {
    const payload = JSON.parse(text);
    const records = Array.isArray(payload) ? payload : payload.result || payload.data;
    return objectsToRows_(records);
  }
  return parseDelimited_(text);
}

function parseDelimited_(text) {
  const firstLine = String(text).split(/\r?\n/, 1)[0];
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  if (tabCount > commaCount) {
    return String(text)
      .split(/\r?\n/)
      .filter(function (line) { return line.length > 0; })
      .map(function (line) { return line.split("\t"); });
  }
  return Utilities.parseCsv(text);
}

function objectsToRows_(records) {
  if (!Array.isArray(records) || !records.length) {
    throw new Error("Superset JSON tidak berisi record.");
  }
  const headers = Object.keys(records[0]);
  const rows = records.map(function (record) {
    return headers.map(function (header) {
      const value = record[header];
      return value === null || value === undefined ? "" : value;
    });
  });
  return [headers].concat(rows);
}

function assertHeaders_(actualHeaders, requiredHeaders, label) {
  const normalized = actualHeaders.map(function (value) {
    return String(value).trim().toLowerCase();
  });
  const missing = requiredHeaders.filter(function (header) {
    return normalized.indexOf(String(header).toLowerCase()) < 0;
  });
  if (missing.length) {
    throw new Error(label + " kehilangan kolom: " + missing.join(", "));
  }
}

function replaceSheetData_(sheetName, rows) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sheet) throw new Error("Sheet tidak ditemukan: " + sheetName);
  sheet.getDataRange().clearContent();
  if (!rows.length) return;

  const columnCount = Math.max.apply(null, rows.map(function (row) { return row.length; }));
  const normalized = rows.map(function (row) {
    const output = row.slice();
    while (output.length < columnCount) output.push("");
    return output;
  });

  const batchSize = 5000;
  for (let offset = 0; offset < normalized.length; offset += batchSize) {
    const batch = normalized.slice(offset, offset + batchSize);
    sheet.getRange(offset + 1, 1, batch.length, columnCount).setValues(batch);
  }
  sheet.setFrozenRows(1);
}

function validateSourceSheets() {
  const spreadsheet = SpreadsheetApp.getActive();
  const soSheet = spreadsheet.getSheetByName(SHEETS.RAW_SO);
  const staffSheet = spreadsheet.getSheetByName(SHEETS.RAW_STAFF);
  if (!soSheet || !staffSheet) throw new Error("Raw sheet belum lengkap.");

  assertHeaders_(soSheet.getRange(1, 1, 1, soSheet.getLastColumn()).getValues()[0], REQUIRED_SO_HEADERS, SHEETS.RAW_SO);
  assertHeaders_(staffSheet.getRange(1, 1, 1, staffSheet.getLastColumn()).getValues()[0], REQUIRED_STAFF_HEADERS, SHEETS.RAW_STAFF);
  appendAudit_("SOURCE_VALIDATION", "SUCCESS", {
    raw_so_rows: Math.max(0, soSheet.getLastRow() - 1),
    raw_staff_rows: Math.max(0, staffSheet.getLastRow() - 1),
  });
  SpreadsheetApp.getUi().alert("Source valid. Formula assignment dapat diproses.");
}

function refreshCalculations() {
  SpreadsheetApp.flush();
  const settings = SpreadsheetApp.getActive().getSheetByName(SHEETS.SETTINGS);
  if (settings) settings.getRange("B3").setValue(new Date());
}

function installSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === "syncSuperset") ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger("syncSuperset").timeBased().everyMinutes(15).create();
  appendAudit_("TRIGGER_INSTALL", "SUCCESS", { interval_minutes: 15 });
}

function doGet(event) {
  return json_({
    ok: false,
    errorCode: "METHOD_NOT_ALLOWED",
    message: "Gunakan POST agar token tidak masuk URL, history, atau access log.",
  });
}

function doPost(event) {
  let payload = {};
  try {
    payload = JSON.parse(event.postData && event.postData.contents ? event.postData.contents : "{}");
  } catch (error) {
    return json_({ ok: false, errorCode: "INVALID_JSON", message: "Body harus JSON." });
  }
  return handleApi_(payload);
}

function handleApi_(payload) {
  try {
    authorize_(payload.token);
    if (payload.action) return handleCommand_(payload);
    return handleResource_(String(payload.resource || ""), payload.params || {});
  } catch (error) {
    return json_({
      ok: false,
      errorCode: "OUTBOUND_API_ERROR",
      message: String(error && error.message ? error.message : error),
    });
  }
}

function handleResource_(resource, params) {
  const resources = {
    health: null,
    staffRoster: SHEETS.STAFF_ROSTER,
    pickers: SHEETS.STAFF_ROSTER,
    picker: SHEETS.STAFF_ROSTER,
    destinationRules: SHEETS.DESTINATION_RULES,
    targetRules: SHEETS.TARGET_RULES,
    assignmentPlan: SHEETS.PLAN,
    bulkUpload: SHEETS.BULK,
    sos: SHEETS.SO_SPLIT,
    so: SHEETS.SO_SPLIT,
    zones: SHEETS.SO_SPLIT,
    zone: SHEETS.SO_SPLIT,
  };
  if (resource === "health") {
    return json_({ ok: true, resource: "health", syncedAt: getSetting_("B3") });
  }
  if (resource === "dataset") {
    const dataset = buildDataset_();
    return json_({
      ok: true,
      resource: "dataset",
      data: dataset,
      syncedAt: getSetting_("B3"),
    });
  }
  if (resource === "sourceProfile" || resource === "overview") {
    const dataset = buildDataset_();
    return json_({
      ok: true,
      resource: resource,
      data: resource === "sourceProfile" ? dataset.sourceProfile : dataset,
      syncedAt: getSetting_("B3"),
    });
  }
  if (!resources[resource]) throw new Error("Resource tidak diizinkan.");
  const allRows = readSheetObjects_(resources[resource], 5000);
  const filtered = filterRows_(allRows, params);
  const pageSize = Math.max(1, Math.min(500, Number(params.pageSize || 100)));
  const page = Math.max(1, Number(params.page || 1));
  const offset = (page - 1) * pageSize;
  const rows = filtered.slice(offset, offset + pageSize);
  return json_({
    ok: true,
    resource: resource,
    rows: rows,
    count: rows.length,
    total: filtered.length,
    page: page,
    pageSize: pageSize,
  });
}

function handleCommand_(payload) {
  const allowed = [
    "assignBatch",
    "updateStaffRoster",
    "updateDestinationRule",
    "updateTargetRule",
    "generateAssignmentPlan",
    "exportBulkUpload",
    "checkerDone",
    "checkerReset",
  ];
  if (allowed.indexOf(payload.action) < 0) throw new Error("Action tidak diizinkan.");
  if (Array.isArray(payload.rows) && payload.rows.length > 500) throw new Error("Maksimum 500 row per command.");
  const idempotencyKey = String(payload.idempotencyKey || "");
  if (!/^[A-Za-z0-9:._-]{12,100}$/.test(idempotencyKey)) {
    throw new Error("idempotencyKey tidak valid.");
  }

  const cache = CacheService.getScriptCache();
  const cacheKey = "command:" + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idempotencyKey)
  ).slice(0, 40);
  const cached = cache.get(cacheKey);
  if (cached) {
    return json_({ ok: true, action: payload.action, duplicate: true });
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) throw new Error("Command lain masih diproses.");
  try {
    if (cache.get(cacheKey)) {
      return json_({ ok: true, action: payload.action, duplicate: true });
    }

    let result = {};
    if (payload.action === "assignBatch") {
      result = assignBatch_(payload.rows || []);
    } else if (payload.action === "updateStaffRoster") {
      result = updateStaffRoster_(payload.rows || []);
    } else if (payload.action === "updateDestinationRule") {
      result = updateDestinationRules_(payload.rows || []);
    } else if (payload.action === "updateTargetRule") {
      result = updateTargetRules_(payload.rows || []);
    } else if (payload.action === "generateAssignmentPlan") {
      refreshCalculations();
      result = { refreshed: true };
    } else if (payload.action === "exportBulkUpload") {
      result = { rows: readSheetObjects_(SHEETS.BULK, 5000) };
    } else {
      result = updateCheckerRoute_(
        payload.routeId,
        payload.action === "checkerDone" ? "DONE" : "WAITING"
      );
    }

    SpreadsheetApp.flush();
    cache.put(cacheKey, "1", 21600);
    appendAudit_(payload.action, "SUCCESS", {
      actor: payload.actor || "",
      idempotency_key: idempotencyKey,
      row_count: Array.isArray(payload.rows) ? payload.rows.length : 0,
      result: result,
    });
    return json_({ ok: true, action: payload.action, result: result });
  } catch (error) {
    appendAudit_(payload.action, "FAILED", {
      actor: payload.actor || "",
      idempotency_key: idempotencyKey,
      message: String(error && error.message ? error.message : error),
    });
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function buildDataset_() {
  const orders = readSheetObjects_(SHEETS.SO_SPLIT, 5000).map(mapOrder_);
  const pickers = readSheetObjects_(SHEETS.STAFF_ROSTER, 5000).map(mapPicker_);
  const destinationRules = readSheetObjects_(SHEETS.DESTINATION_RULES, 5000).map(mapDestinationRule_);
  const targetRules = readSheetObjects_(SHEETS.TARGET_RULES, 100).map(mapTargetRule_);
  const audit = readSheetObjects_(SHEETS.AUDIT, 100).slice(-24).reverse().map(function (row) {
    return {
      id: String(value_(row, ["id", "event_id"], Utilities.getUuid())),
      at: String(value_(row, ["at", "timestamp", "created_at"], "")),
      actor: String(value_(row, ["actor", "user"], "system")),
      action: String(value_(row, ["action"], "EVENT")),
      detail: String(value_(row, ["detail"], "")),
      tone: String(value_(row, ["status"], "")).toUpperCase() === "FAILED" ? "warning" : "info",
    };
  });
  const checkerSheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.CHECKER);
  const checkerRoutes = checkerSheet
    ? readSheetObjects_(SHEETS.CHECKER, 500).map(mapCheckerRoute_)
    : [];
  const zoneRules = buildZoneRules_(orders);
  const hourly = buildHourly_(orders, pickers);
  const rawSoSheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.RAW_SO);
  const rawStaffSheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.RAW_STAFF);
  const distinctSo = unique_(orders.map(function (order) { return order.soNumber; })).length;
  const splitCounts = groupCount_(orders, "soNumber");
  const multiZoneSo = Object.keys(splitCounts).filter(function (so) {
    return splitCounts[so] > 1;
  }).length;
  const eligiblePickers = pickers.filter(function (picker) {
    return picker.isActive && picker.checkedIn &&
      picker.role === "OUTBOUND_PICKER_STAFF" &&
      picker.zones.length > 0 &&
      picker.scheduleStartTime.length > 0;
  }).length;
  const newOrders = orders.filter(function (order) { return order.status === "NEW"; });

  return {
    orders: orders,
    pickers: pickers,
    destinationRules: destinationRules,
    zoneRules: zoneRules,
    targetRules: targetRules,
    checkerRoutes: checkerRoutes,
    audit: audit,
    hourly: hourly,
    sourceProfile: {
      sourceDate: operationDate_(),
      soRows: rawSoSheet ? Math.max(0, rawSoSheet.getLastRow() - 1) : 0,
      distinctSo: distinctSo,
      soZoneSplits: orders.length,
      multiZoneSo: multiZoneSo,
      newRows: newOrders.length,
      newSo: unique_(newOrders.map(function (order) { return order.soNumber; })).length,
      newQty: newOrders.reduce(function (sum, order) { return sum + order.requestQty; }, 0),
      distinctZones: unique_(orders.map(function (order) { return order.zone; })).length,
      staffRows: rawStaffSheet ? Math.max(0, rawStaffSheet.getLastRow() - 1) : 0,
      pickerRows: pickers.length,
      eligiblePickers: eligiblePickers,
      checkedInRows: pickers.filter(function (picker) { return picker.checkedIn; }).length,
      qualityNotes: [],
    },
  };
}

function mapOrder_(row) {
  const soNumber = String(value_(row, ["so_number", "soNumber"], ""));
  const zone = String(value_(row, ["picking_zone", "zone"], "UNMAPPED"));
  return {
    id: String(value_(row, ["id"], soNumber + "::" + zone)),
    soNumber: soNumber,
    wmsSoId: String(value_(row, ["so_id", "wms_so_id", "wmsSoId"], trailingSoId_(soNumber))),
    destination: String(value_(row, ["destination_location_name", "destination"], "")),
    destinationCode: String(value_(row, ["destination_code", "destinationCode"], "")),
    zone: zone,
    pickingAreaNames: list_(value_(row, ["picking_area_name", "pickingAreaNames"], "")),
    originRackNames: list_(value_(row, ["origin_rack_name", "originRackNames"], "")),
    wave: String(value_(row, ["wave"], "UNMAPPED")),
    drop: String(value_(row, ["drop"], "UNMAPPED")),
    mappingStatus: String(value_(row, ["mapping_status", "mappingStatus"], "MAPPED")),
    status: String(value_(row, ["status"], "NEW")),
    priority: String(value_(row, ["priority"], "Medium")),
    requestQty: number_(value_(row, ["request_quantity", "request_qty"], 0)),
    pickedQty: number_(value_(row, ["picked_quantity", "picked_qty"], 0)),
    skuCount: number_(value_(row, ["sku_count"], 0)),
    lineCount: number_(value_(row, ["line_count", "raw_row_count"], 0)),
    rackLevel: String(value_(row, ["rack_level"], "-")),
    pickerId: nullable_(value_(row, ["manual_override_staff_id", "staff_id", "picker_id"], "")),
    shift: String(value_(row, ["shift"], "PAGI")),
    deadline: String(value_(row, ["deadline"], "14:00")),
    createdAt: String(value_(row, ["supply_order_created_at", "created_at"], "")),
    updatedAt: String(value_(row, ["updated_at"], "")),
  };
}

function mapPicker_(row) {
  const checkedValue = value_(row, ["checked_in", "checkin_time"], "");
  return {
    id: String(value_(row, ["staff_id", "id"], "")),
    name: String(value_(row, ["staff_name", "name"], "")),
    joinDate: String(value_(row, ["drivers_join_date", "join_date"], "")),
    tenureDays: number_(value_(row, ["tenure_days"], 0)),
    mpStatus: String(value_(row, ["mp_status"], "REGULER")),
    mpStatusOverride: nullable_(value_(row, ["mp_status_override"], "")),
    scheduleStartTime: String(value_(row, ["schedule_start_time"], "")),
    scheduleDescription: String(value_(row, ["schedule_description"], "")),
    role: String(value_(row, ["schedule_role", "role"], "")),
    shift: String(value_(row, ["shift"], "PAGI")),
    checkedIn: bool_(checkedValue),
    isActive: bool_(value_(row, ["is_active"], false)),
    zones: list_(value_(row, ["zone_skills", "zones"], "")),
    waves: list_(value_(row, ["wave_skills", "waves"], "")),
    targetQty: number_(value_(row, ["target_qty"], 1)),
    targetOverride: nullableNumber_(value_(row, ["target_override"], "")),
    targetPerHour: number_(value_(row, ["target_per_hour"], 0)),
    activeHours: number_(value_(row, ["active_hours"], 0)),
    assignedQty: number_(value_(row, ["assigned_qty"], 0)),
    pickedQty: number_(value_(row, ["picked_qty"], 0)),
    totalSo: number_(value_(row, ["total_so"], 0)),
    state: String(value_(row, ["state"], bool_(checkedValue) ? "ACTIVE" : "OFFLINE")),
  };
}

function mapDestinationRule_(row) {
  const destinationCode = String(value_(row, ["destination_code"], ""));
  const effectiveMonth = String(value_(row, ["effective_month"], ""));
  return {
    id: String(value_(row, ["id"], effectiveMonth + "::" + destinationCode)),
    effectiveMonth: effectiveMonth,
    destinationCode: destinationCode,
    destinationName: String(value_(row, ["destination_location_name", "destination_name"], "")),
    wave: String(value_(row, ["wave"], "UNMAPPED")),
    drop: String(value_(row, ["drop"], "UNMAPPED")),
    sequence: number_(value_(row, ["sequence"], 0)),
    active: bool_(value_(row, ["active"], true)),
  };
}

function mapTargetRule_(row) {
  return {
    mpStatus: String(value_(row, ["mp_status"], "REGULER")),
    targetQty: number_(value_(row, ["target_qty"], 1)),
    maxLoadPct: number_(value_(row, ["max_load_pct"], 100)),
    description: String(value_(row, ["description"], "")),
  };
}

function mapCheckerRoute_(row) {
  return {
    id: String(value_(row, ["id", "route_id"], "")),
    route: String(value_(row, ["route"], "")),
    wave: String(value_(row, ["wave"], "UNMAPPED")),
    quantity: number_(value_(row, ["quantity"], 0)),
    deadline: String(value_(row, ["deadline"], "")),
    status: String(value_(row, ["status"], "WAITING")),
    worker: nullable_(value_(row, ["worker"], "")),
    updatedAt: String(value_(row, ["updated_at"], "")),
  };
}

function assignBatch_(rows) {
  if (!rows.length) throw new Error("Assignment batch kosong.");
  const sheet = requiredSheet_(SHEETS.PLAN);
  let updated = 0;
  rows.forEach(function (row) {
    updated += patchMatchingRow_(sheet, [
      { headers: ["so_number"], value: row.soNumber },
      { headers: ["picking_zone", "zone"], value: row.zone },
    ], {
      manual_override_staff_id: row.pickerId,
      staff_id: row.pickerId,
      updated_at: new Date(),
    });
  });
  if (updated !== rows.length) {
    throw new Error("Tidak semua split ditemukan pada Assignment_Plan.");
  }
  return { updated: updated };
}

function updateStaffRoster_(rows) {
  const sheet = requiredSheet_(SHEETS.STAFF_ROSTER);
  let updated = 0;
  rows.forEach(function (row) {
    updated += patchMatchingRow_(sheet, [
      { headers: ["staff_id", "id"], value: row.id },
    ], {
      staff_name: row.name,
      schedule_start_time: row.scheduleStartTime,
      schedule_description: row.scheduleDescription,
      schedule_role: row.role,
      shift: row.shift,
      mp_status_override: row.mpStatusOverride || "",
      target_override: row.targetOverride || "",
      zone_skills: Array.isArray(row.zones) ? row.zones.join(", ") : row.zones,
      wave_skills: Array.isArray(row.waves) ? row.waves.join(", ") : row.waves,
      is_active: row.isActive,
      checkin_time: row.checkedIn ? (row.checkinTime || new Date()) : "",
      state: row.state,
    });
  });
  if (updated !== rows.length) throw new Error("Staff roster target tidak lengkap.");
  return { updated: updated };
}

function updateDestinationRules_(rows) {
  const sheet = requiredSheet_(SHEETS.DESTINATION_RULES);
  let updated = 0;
  rows.forEach(function (row) {
    updated += patchMatchingRow_(sheet, [
      { headers: ["effective_month"], value: row.effectiveMonth },
      { headers: ["destination_code"], value: row.destinationCode },
    ], {
      destination_location_name: row.destinationName,
      wave: row.wave,
      drop: row.drop,
      sequence: row.sequence,
      active: row.active,
    });
  });
  if (updated !== rows.length) throw new Error("Destination rule target tidak lengkap.");
  return { updated: updated };
}

function updateTargetRules_(rows) {
  const sheet = requiredSheet_(SHEETS.TARGET_RULES);
  let updated = 0;
  rows.forEach(function (row) {
    updated += patchMatchingRow_(sheet, [
      { headers: ["mp_status"], value: row.mpStatus },
    ], {
      target_qty: row.targetQty,
      max_load_pct: row.maxLoadPct,
      description: row.description,
    });
  });
  if (updated !== rows.length) throw new Error("Target rule target tidak lengkap.");
  return { updated: updated };
}

function updateCheckerRoute_(routeId, state) {
  const sheet = requiredSheet_(SHEETS.CHECKER);
  const updated = patchMatchingRow_(sheet, [
    { headers: ["id", "route_id"], value: routeId },
  ], { status: state, updated_at: new Date() });
  if (!updated) throw new Error("Checker route tidak ditemukan.");
  return { updated: updated };
}

function filterRows_(rows, params) {
  const ignored = { page: true, pageSize: true, sort: true, order: true };
  const keys = Object.keys(params || {}).filter(function (key) {
    return !ignored[key] && String(params[key] || "").trim().length > 0;
  });
  let output = rows.filter(function (row) {
    return keys.every(function (key) {
      const expected = String(params[key]).trim().toLowerCase();
      if (key === "q") {
        return Object.keys(row).some(function (header) {
          return String(row[header] || "").toLowerCase().indexOf(expected) >= 0;
        });
      }
      const actual = value_(row, [key], "");
      return String(actual).trim().toLowerCase() === expected;
    });
  });
  const sortKey = String(params.sort || "");
  if (sortKey) {
    const direction = String(params.order || "asc").toLowerCase() === "desc" ? -1 : 1;
    output = output.sort(function (left, right) {
      return String(value_(left, [sortKey], "")).localeCompare(
        String(value_(right, [sortKey], "")),
        undefined,
        { numeric: true }
      ) * direction;
    });
  }
  return output;
}

function buildZoneRules_(orders) {
  const zones = {};
  orders.forEach(function (order) {
    zones[order.zone] = zones[order.zone] || [];
    order.pickingAreaNames.forEach(function (area) {
      if (zones[order.zone].indexOf(area) < 0) zones[order.zone].push(area);
    });
  });
  return Object.keys(zones).sort().map(function (zone) {
    return { zone: zone, pickingAreaNames: zones[zone].sort(), enabled: zone !== "UNMAPPED" };
  });
}

function buildHourly_(orders, pickers) {
  const buckets = {};
  orders.forEach(function (order) {
    const match = String(order.createdAt || order.updatedAt).match(/[T\s](\d{2}):/);
    const hour = match ? match[1] : "00";
    buckets[hour] = buckets[hour] || { requestQty: 0, pickedQty: 0 };
    buckets[hour].requestQty += order.requestQty;
    buckets[hour].pickedQty += order.pickedQty;
  });
  return Object.keys(buckets).sort().map(function (hour) {
    return {
      hour: hour,
      requestQty: buckets[hour].requestQty,
      pickedQty: buckets[hour].pickedQty,
      activeMp: pickers.filter(function (picker) {
        return picker.checkedIn && picker.isActive &&
          String(picker.scheduleStartTime).indexOf(hour + ":") >= 0;
      }).length,
    };
  });
}

function operationDate_() {
  const value = getSetting_("B2");
  if (value) return value.slice(0, 10);
  return Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyy-MM-dd");
}

function groupCount_(rows, key) {
  return rows.reduce(function (output, row) {
    const value = String(row[key] || "");
    output[value] = (output[value] || 0) + 1;
    return output;
  }, {});
}

function unique_(values) {
  return values.filter(function (value, index) {
    return value !== "" && values.indexOf(value) === index;
  });
}

function normalizeKey_(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function value_(row, aliases, fallback) {
  const keys = Object.keys(row || {});
  for (let aliasIndex = 0; aliasIndex < aliases.length; aliasIndex += 1) {
    const target = normalizeKey_(aliases[aliasIndex]);
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      if (normalizeKey_(keys[keyIndex]) === target) {
        const value = row[keys[keyIndex]];
        return value === undefined || value === null ? fallback : value;
      }
    }
  }
  return fallback;
}

function number_(value) {
  const parsed = Number(String(value === undefined ? "" : value).replace(/,/g, ""));
  return isFinite(parsed) ? parsed : 0;
}

function bool_(value) {
  if (typeof value === "boolean") return value;
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return false;
  return ["false", "0", "no", "n", "inactive", "off"].indexOf(normalized) < 0;
}

function nullable_(value) {
  const normalized = String(value === undefined || value === null ? "" : value).trim();
  return normalized ? normalized : null;
}

function nullableNumber_(value) {
  const normalized = String(value === undefined || value === null ? "" : value).trim();
  return normalized ? number_(normalized) : null;
}

function list_(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value || "").split(/\s*(?:,|\|)\s*/).filter(Boolean);
}

function trailingSoId_(soNumber) {
  const digits = String(soNumber || "").replace(/\D/g, "");
  return ("0000000" + digits.slice(-7)).slice(-7);
}

function requiredSheet_(sheetName) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sheet) throw new Error("Sheet tidak ditemukan: " + sheetName);
  return sheet;
}

function patchMatchingRow_(sheet, matches, patch) {
  if (sheet.getLastRow() < 2) return 0;
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function (header) { return String(header).trim(); });
  const headerIndex = {};
  headers.forEach(function (header, index) {
    headerIndex[normalizeKey_(header)] = index;
  });
  const matchIndexes = matches.map(function (match) {
    let index = -1;
    match.headers.some(function (header) {
      const candidate = headerIndex[normalizeKey_(header)];
      if (candidate !== undefined) {
        index = candidate;
        return true;
      }
      return false;
    });
    if (index < 0) throw new Error("Kolom key tidak ditemukan: " + match.headers.join("/"));
    return { index: index, value: String(match.value || "").trim() };
  });
  let targetRow = -1;
  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    const matchesAll = matchIndexes.every(function (match) {
      return String(values[rowIndex][match.index] || "").trim() === match.value;
    });
    if (matchesAll) {
      targetRow = rowIndex + 1;
      break;
    }
  }
  if (targetRow < 0) return 0;

  Object.keys(patch).forEach(function (key) {
    const columnIndex = headerIndex[normalizeKey_(key)];
    if (columnIndex === undefined || patch[key] === undefined) return;
    sheet.getRange(targetRow, columnIndex + 1).setValue(patch[key]);
  });
  return 1;
}

function readSheetObjects_(sheetName, limit) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const rowCount = Math.min(Math.max(0, sheet.getLastRow() - 1), limit);
  const values = sheet.getRange(1, 1, rowCount + 1, sheet.getLastColumn()).getDisplayValues();
  const headers = values.shift().map(function (value) { return String(value).trim(); });
  return values.map(function (row) {
    const output = {};
    headers.forEach(function (header, index) { output[header] = row[index]; });
    return output;
  });
}

function appendAudit_(action, status, detail) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.AUDIT);
  if (!sheet) return;
  sheet.appendRow([
    Utilities.getUuid(),
    new Date(),
    Session.getActiveUser().getEmail() || "system",
    action,
    status,
    JSON.stringify(detail || {}),
  ]);
}

function getSetting_(cell) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.SETTINGS);
  return sheet ? sheet.getRange(cell).getDisplayValue() : "";
}

function authorize_(suppliedToken) {
  const expected = PropertiesService.getScriptProperties().getProperty("OUTBOUND_API_TOKEN");
  if (!expected || expected.length < 20) throw new Error("OUTBOUND_API_TOKEN belum dikonfigurasi.");
  if (String(suppliedToken || "") !== expected) throw new Error("Unauthorized.");
}

function requiredProperty_(properties, name) {
  const value = String(properties.getProperty(name) || "").trim();
  if (!value) throw new Error("Script Property belum diisi: " + name);
  return value;
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
