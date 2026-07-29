import { NextRequest, NextResponse } from "next/server";
import { resolveDestinationRule } from "@/lib/outbound-logic";
import {
  authRequiredMessage,
  getOutboundAccess,
} from "@/lib/request-auth";
import {
  loadDatasetSnapshot,
  saveDatasetSnapshot,
} from "@/lib/runtime-storage";
import type {
  CheckerState,
  DemoDataset,
  DestinationRule,
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

function error(status: number, errorCode: string, message: string) {
  return NextResponse.json({ ok: false, errorCode, message }, { status });
}

function addAudit(
  data: DemoDataset,
  actor: string,
  action: string,
  detail: string,
) {
  data.audit = [
    {
      id: `CMD-${Date.now()}`,
      at: new Date().toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Jakarta",
      }),
      actor,
      action,
      detail,
      tone: "success" as const,
    },
    ...data.audit,
  ].slice(0, 40);
}

export async function POST(request: NextRequest) {
  const access = await getOutboundAccess(request);
  if (!access.authenticated) {
    return error(401, "AUTH_REQUIRED", authRequiredMessage(request));
  }
  if (!access.admin || !access.user) {
    return error(
      403,
      "ADMIN_REQUIRED",
      "Akun ini belum ada di OUTBOUND_ADMIN_EMAILS.",
    );
  }
  const user = access.user;
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return error(415, "JSON_REQUIRED", "Gunakan application/json.");
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return error(403, "CROSS_ORIGIN_BLOCKED", "Origin tidak diizinkan.");
  }
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9:._-]{12,100}$/.test(idempotencyKey)) {
    return error(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "Idempotency-Key yang valid diperlukan.",
    );
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
  const snapshot = await loadDatasetSnapshot();
  if (!snapshot) {
    return error(
      409,
      "SNAPSHOT_NOT_READY",
      "Jalankan sync pertama sebelum menyimpan perubahan.",
    );
  }
  const data = structuredClone(snapshot.data);

  try {
    if (action === "assignBatch") {
      const rows = Array.isArray(body.rows)
        ? (body.rows as Array<Record<string, unknown>>)
        : [];
      if (!rows.length || rows.length > 500) {
        throw new Error("Batch assignment harus berisi 1–500 split.");
      }
      const byOrder = new Map(
        rows.map((row) => [
          String(row.orderId ?? ""),
          String(row.pickerId ?? ""),
        ]),
      );
      data.orders = data.orders.map((order) => {
        const pickerId = byOrder.get(order.id);
        return pickerId
          ? {
              ...order,
              pickerId,
              status: "ASSIGNED",
              updatedAt: new Date().toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Asia/Jakarta",
              }),
            }
          : order;
      });
      addAudit(
        data,
        user.email,
        "Assignment batch disimpan",
        `${rows.length} SO-zone split diperbarui.`,
      );
    }

    if (action === "updateDestinationRule") {
      const rule = (Array.isArray(body.rows) ? body.rows[0] : null) as
        | DestinationRule
        | null;
      if (!rule?.id || !rule.wave?.trim() || !rule.drop?.trim()) {
        throw new Error("Mapping destination tidak lengkap.");
      }
      const existing = data.destinationRules.some((item) => item.id === rule.id);
      data.destinationRules = existing
        ? data.destinationRules.map((item) => (item.id === rule.id ? rule : item))
        : [...data.destinationRules, rule];
      data.orders = data.orders.map((order) => {
        const resolved = resolveDestinationRule(
          order.destination,
          data.sourceProfile.sourceDate,
          data.destinationRules,
        );
        return {
          ...order,
          wave: resolved?.wave ?? "UNMAPPED",
          drop: resolved?.drop ?? "UNMAPPED",
          mappingStatus: resolved ? ("MAPPED" as const) : ("UNMAPPED" as const),
        };
      });
      addAudit(
        data,
        user.email,
        "Mapping routing diperbarui",
        `${rule.destinationCode}: ${rule.wave} / ${rule.drop}.`,
      );
    }

    if (action === "updateStaffRoster") {
      const picker = (Array.isArray(body.rows) ? body.rows[0] : null) as
        | Picker
        | null;
      if (!picker?.id) throw new Error("Staff ID tidak valid.");
      data.pickers = data.pickers.map((item) =>
        item.id === picker.id ? picker : item,
      );
      addAudit(
        data,
        user.email,
        "Profil picker diperbarui",
        `${picker.id}: skill, shift, atau target override diperbarui.`,
      );
    }

    if (action === "updateTargetRule") {
      const rule = (Array.isArray(body.rows) ? body.rows[0] : null) as
        | TargetRule
        | null;
      if (!rule || rule.targetQty <= 0 || rule.maxLoadPct <= 0) {
        throw new Error("Target rule tidak valid.");
      }
      data.targetRules = data.targetRules.map((item) =>
        item.mpStatus === rule.mpStatus ? rule : item,
      );
      addAudit(
        data,
        user.email,
        "Target MP diperbarui",
        `${rule.mpStatus}: ${rule.targetQty} unit / ${rule.maxLoadPct}% load.`,
      );
    }

    if (action === "checkerDone" || action === "checkerReset") {
      const routeId = String(body.routeId ?? "");
      const status: CheckerState =
        action === "checkerDone" ? "DONE" : "WAITING";
      if (!data.checkerRoutes.some((route) => route.id === routeId)) {
        throw new Error("Checker route tidak ditemukan.");
      }
      data.checkerRoutes = data.checkerRoutes.map((route) =>
        route.id === routeId
          ? {
              ...route,
              status,
              worker: status === "DONE" ? user.displayName : null,
              updatedAt: new Date().toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Asia/Jakarta",
              }),
            }
          : route,
      );
      addAudit(
        data,
        user.email,
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
    );
    return NextResponse.json({
      ok: true,
      message: "Perubahan tersimpan.",
      idempotencyKey,
      syncedAt: now,
    });
  } catch (caught) {
    return error(
      400,
      "COMMAND_REJECTED",
      caught instanceof Error ? caught.message : "Command ditolak.",
    );
  }
}
