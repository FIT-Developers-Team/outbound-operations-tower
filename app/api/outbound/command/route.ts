import { NextRequest, NextResponse } from "next/server";
import {
  applyAssignment,
  CommandValidationError,
  rejectCommand as reject,
} from "@/lib/command-assignment";
import {
  authRequiredMessage,
  isSameOrigin,
  getOutboundAccess,
} from "@/lib/request-auth";
import {
  claimCommand,
  finishCommand,
  getDestinationRoutes,
  loadDatasetSnapshot,
  saveDatasetSnapshot,
  saveDestinationRoutes,
  SnapshotConflictError,
} from "@/lib/runtime-storage";
import type {
  CheckerState,
  DemoDataset,
  DestinationRule,
  MpStatus,
  Picker,
  TargetRule,
} from "@/lib/outbound-types";

const actions = new Set([
  "assignBatch",
  "updateDestinationRule",
  "updateStaffRoster",
  "updateTargetRule",
  "checkerDone",
  "checkerReset",
]);
const MP_STATUSES = new Set<MpStatus>([
  "OJT 1",
  "OJT 2",
  "OJT 3",
  "REGULER",
]);

function error(status: number, errorCode: string, message: string) {
  return NextResponse.json({ ok: false, errorCode, message }, { status });
}

function operationTime(data: DemoDataset) {
  return new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: data.warehouse.timezone || "Asia/Jakarta",
  });
}

function addAudit(
  data: DemoDataset,
  actor: string,
  action: string,
  detail: string,
) {
  data.audit = [
    {
      id: `CMD-${crypto.randomUUID()}`,
      at: operationTime(data),
      actor,
      action,
      detail,
      tone: "success" as const,
    },
    ...data.audit,
  ].slice(0, 40);
}

function cleanList(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length > 100) {
    reject(`${label} tidak valid.`);
  }
  const result = [
    ...new Set(
      value.map((item) => String(item).trim().toUpperCase()).filter(Boolean),
    ),
  ];
  if (result.some((item) => item.length > 60)) reject(`${label} terlalu panjang.`);
  return result;
}

function normalizeRoutingRows(body: Record<string, unknown>) {
  const input = Array.isArray(body.rows) ? body.rows : [];
  if (!input.length || input.length > 200) {
    reject("Mapping routing harus berisi 1–200 baris.");
  }
  return input.map((value) => {
    const row = (value ?? {}) as Partial<DestinationRule>;
    const id = String(row.id ?? "").trim();
    const destinationCode = String(row.destinationCode ?? "")
      .trim()
      .toUpperCase();
    const destinationName = String(row.destinationName ?? destinationCode).trim();
    const wave = String(row.wave ?? "").trim().toUpperCase();
    const drop = String(row.drop ?? "").trim().toUpperCase();
    const effectiveMonth = String(row.effectiveMonth ?? "").trim();
    const sequence = Number(row.sequence);
    if (
      !/^[A-Za-z0-9:._-]{3,140}$/.test(id) ||
      !/^[A-Z0-9_-]{2,16}$/.test(destinationCode) ||
      !destinationName ||
      destinationName.length > 120 ||
      !wave ||
      wave.length > 40 ||
      !drop ||
      drop.length > 40 ||
      !/^\d{4}-\d{2}$/.test(effectiveMonth) ||
      !Number.isInteger(sequence) ||
      sequence < 0 ||
      sequence > 10_000
    ) {
      reject("Mapping destination tidak lengkap atau nilainya tidak valid.");
    }
    return {
      id,
      effectiveMonth,
      destinationCode,
      destinationName,
      wave,
      drop,
      sequence,
      active: row.active !== false,
    } satisfies DestinationRule;
  });
}

function applyPickerUpdate(data: DemoDataset, body: Record<string, unknown>) {
  const row = (Array.isArray(body.rows) ? body.rows[0] : null) as
    | Partial<Picker>
    | null;
  const id = String(row?.id ?? "").trim();
  const current = data.pickers.find((picker) => picker.id === id);
  if (!current) reject("Staff ID tidak ditemukan pada roster live.");
  const mpStatusOverride = row?.mpStatusOverride ?? null;
  if (mpStatusOverride !== null && !MP_STATUSES.has(mpStatusOverride)) {
    reject("Status MP override tidak valid.");
  }
  const rawTarget = row?.targetOverride;
  const targetOverride =
    rawTarget === null || rawTarget === undefined ? null : Number(rawTarget);
  if (
    targetOverride !== null &&
    (!Number.isFinite(targetOverride) || targetOverride <= 0 || targetOverride > 1_000_000)
  ) {
    reject("Target override tidak valid.");
  }
  const isActive = row?.isActive === true;
  const checkedIn = row?.checkedIn === true;
  const updated = {
    ...current,
    mpStatusOverride,
    targetOverride,
    zones: cleanList(row?.zones, "Skill zona"),
    waves: cleanList(row?.waves, "Familiar wave"),
    isActive,
    checkedIn,
    state: isActive && checkedIn ? ("ACTIVE" as const) : ("OFFLINE" as const),
  };
  data.pickers = data.pickers.map((picker) =>
    picker.id === id ? updated : picker,
  );
  return id;
}

function applyTargetUpdate(data: DemoDataset, body: Record<string, unknown>) {
  const input = (Array.isArray(body.rows) ? body.rows[0] : null) as
    | Partial<TargetRule>
    | null;
  const mpStatus = input?.mpStatus;
  const targetQty = Number(input?.targetQty);
  const maxLoadPct = Number(input?.maxLoadPct);
  const description = String(input?.description ?? "").trim();
  if (
    !mpStatus ||
    !MP_STATUSES.has(mpStatus) ||
    !Number.isFinite(targetQty) ||
    targetQty <= 0 ||
    targetQty > 1_000_000 ||
    !Number.isFinite(maxLoadPct) ||
    maxLoadPct <= 0 ||
    maxLoadPct > 500 ||
    description.length > 500 ||
    !data.targetRules.some((rule) => rule.mpStatus === mpStatus)
  ) {
    reject("Target rule tidak valid.");
  }
  const rule: TargetRule = { mpStatus, targetQty, maxLoadPct, description };
  data.targetRules = data.targetRules.map((item) =>
    item.mpStatus === mpStatus ? rule : item,
  );
  return rule;
}

export async function POST(request: NextRequest) {
  const access = await getOutboundAccess(request);
  if (!access.authenticated) {
    return error(401, "AUTH_REQUIRED", authRequiredMessage(request));
  }
  if (!access.admin || !access.user) {
    return error(403, "ADMIN_REQUIRED", "Akun ini belum ada di OUTBOUND_ADMIN_EMAILS.");
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return error(415, "JSON_REQUIRED", "Gunakan application/json.");
  }
  if (!isSameOrigin(request)) {
    return error(403, "CROSS_ORIGIN_BLOCKED", "Origin tidak diizinkan.");
  }
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9:._-]{12,100}$/.test(idempotencyKey)) {
    return error(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key yang valid diperlukan.");
  }
  const raw = await request.text();
  if (raw.length > 250_000) {
    return error(413, "COMMAND_TOO_LARGE", "Payload command terlalu besar.");
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return error(400, "INVALID_JSON", "JSON tidak valid.");
  }
  const action = String(body.action ?? "");
  if (!actions.has(action)) {
    return error(400, "INVALID_ACTION", "Command tidak dikenal.");
  }

  try {
    const routingRows =
      action === "updateDestinationRule" ? normalizeRoutingRows(body) : [];
    const snapshot = await loadDatasetSnapshot();
    if (!snapshot && action !== "updateDestinationRule") {
      return error(409, "SNAPSHOT_NOT_READY", "Jalankan sync pertama sebelum menyimpan perubahan.");
    }

    const claim = await claimCommand(idempotencyKey, action, access.user.email);
    if (!claim.acquired) {
      if (!claim.receipt) {
        return error(409, "COMMAND_IN_PROGRESS", "Command sedang diproses.");
      }
      if (
        claim.receipt.action !== action ||
        claim.receipt.actor !== access.user.email
      ) {
        return error(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency-Key sudah dipakai untuk command lain.");
      }
      if (claim.receipt.status === "SUCCESS") {
        return NextResponse.json({
          ok: true,
          message: claim.receipt.message ?? "Command sebelumnya sudah selesai.",
          idempotentReplay: true,
          idempotencyKey,
        });
      }
      return error(
        409,
        claim.receipt.status === "RUNNING"
          ? "COMMAND_IN_PROGRESS"
          : "COMMAND_PREVIOUSLY_FAILED",
        claim.receipt.message ?? "Command dengan key ini belum dapat diulang.",
      );
    }

    try {
      if (action === "updateDestinationRule") {
        await saveDestinationRoutes(routingRows);
        const message = `${routingRows.length} mapping routing tersimpan.`;
        await finishCommand(idempotencyKey, "SUCCESS", message);
        return NextResponse.json({
          ok: true,
          message,
          destinationRules: await getDestinationRoutes(),
          idempotencyKey,
        });
      }

      if (!snapshot) throw new CommandValidationError("Snapshot belum tersedia.");
      const data = structuredClone(snapshot.data);
      if (action === "assignBatch") {
        const result = applyAssignment(data, body);
        addAudit(
          data,
          access.user.email,
          "Assignment batch disimpan",
          `${result.count} SO-zona diperbarui${
            result.overrideCount ? `; ${result.overrideCount} memakai override beralasan` : ""
          }.`,
        );
      } else if (action === "updateStaffRoster") {
        const pickerId = applyPickerUpdate(data, body);
        addAudit(data, access.user.email, "Profil picker diperbarui", `${pickerId}: skill dan override diperbarui.`);
      } else if (action === "updateTargetRule") {
        const rule = applyTargetUpdate(data, body);
        addAudit(data, access.user.email, "Target MP diperbarui", `${rule.mpStatus}: ${rule.targetQty} unit / ${rule.maxLoadPct}% load.`);
      } else if (action === "checkerDone" || action === "checkerReset") {
        const routeId = String(body.routeId ?? "").trim();
        const status: CheckerState = action === "checkerDone" ? "DONE" : "WAITING";
        if (!data.checkerRoutes.some((route) => route.id === routeId)) {
          reject("Checker route tidak ditemukan.");
        }
        data.checkerRoutes = data.checkerRoutes.map((route) =>
          route.id === routeId
            ? {
                ...route,
                status,
                worker: status === "DONE" ? access.user!.displayName : null,
                updatedAt: operationTime(data),
              }
            : route,
        );
        addAudit(
          data,
          access.user.email,
          status === "DONE" ? "Checker route selesai" : "Checker route dibuka ulang",
          `${routeId} menjadi ${status}.`,
        );
      }

      const now = new Date().toISOString();
      await saveDatasetSnapshot(
        data,
        `command-${idempotencyKey}`,
        data.sourceProfile.sourceDate.slice(0, 7),
        now,
        {
          expectedVersion: snapshot.version,
          sourceSyncedAt: snapshot.syncedAt,
        },
      );
      const message = "Perubahan tersimpan.";
      await finishCommand(idempotencyKey, "SUCCESS", message);
      return NextResponse.json({
        ok: true,
        message,
        idempotencyKey,
        syncedAt: snapshot.syncedAt,
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Command ditolak.";
      await finishCommand(idempotencyKey, "ERROR", message);
      throw caught;
    }
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Command ditolak.";
    if (caught instanceof SnapshotConflictError) {
      return error(409, "SNAPSHOT_CONFLICT", message);
    }
    if (caught instanceof CommandValidationError) {
      return error(400, "COMMAND_REJECTED", message);
    }
    return error(500, "COMMAND_FAILED", "Command gagal disimpan. Coba lagi atau periksa log server.");
  }
}

export {
  applyPickerUpdate as applyPickerUpdateForTest,
  normalizeRoutingRows as normalizeRoutingRowsForTest,
};
