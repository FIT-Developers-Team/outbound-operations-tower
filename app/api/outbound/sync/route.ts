import { NextRequest, NextResponse } from "next/server";
import {
  acquireSyncLease,
  beginSyncRun,
  finishSyncRun,
  getDatasetSnapshotMetadata,
  getStoredConnector,
  releaseSyncLease,
  saveStoredConnector,
} from "@/lib/runtime-storage";
import {
  anonymousReadEnabled,
  authRequiredMessage,
  isSameOrigin,
  getOutboundAccess,
} from "@/lib/request-auth";
import { monthInTimeZone, syncFromSuperset } from "@/lib/superset-sync";

function error(status: number, errorCode: string, message: string) {
  return NextResponse.json({ ok: false, errorCode, message }, { status });
}

async function freshSnapshot() {
  const [connector, snapshot] = await Promise.all([
    getStoredConnector(),
    getDatasetSnapshotMetadata(),
  ]);
  if (!snapshot) return null;
  const ageMs = Date.now() - Date.parse(snapshot.sourceSyncedAt);
  const maxAgeMs = connector.refreshIntervalMinutes * 60_000;
  return ageMs >= 0 && ageMs < maxAgeMs ? snapshot : null;
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return error(403, "CROSS_ORIGIN_BLOCKED", "Origin tidak diizinkan.");
  }
  const body = request.headers
    .get("content-type")
    ?.startsWith("application/json")
    ? await request.json().catch(() => ({}))
    : {};
  const mode =
    body &&
    typeof body === "object" &&
    (body as Record<string, unknown>).mode === "auto"
      ? "auto"
      : "manual";
  const access = await getOutboundAccess(request);
  if (
    (!access.authenticated && !anonymousReadEnabled()) ||
    (mode === "manual" && !access.authenticated)
  ) {
    return error(401, "AUTH_REQUIRED", authRequiredMessage(request));
  }
  if (mode === "manual" && !access.admin) {
    return error(
      403,
      "ADMIN_REQUIRED",
      "Akun ini belum memiliki izin sinkronisasi.",
    );
  }

  if (mode === "auto") {
    const snapshot = await freshSnapshot();
    if (snapshot) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        message: "Snapshot masih dalam interval refresh.",
        syncedAt: snapshot.sourceSyncedAt,
      });
    }
  }

  const runId = crypto.randomUUID();
  const month = monthInTimeZone(
    (await getStoredConnector()).warehouseTimezone,
  ).key;
  const lease = await acquireSyncLease();
  if (!lease.acquired) {
    const snapshot = await getDatasetSnapshotMetadata();
    return NextResponse.json(
      {
        ok: true,
        skipped: true,
        message: "Sync lain sedang berjalan.",
        syncedAt: snapshot?.sourceSyncedAt ?? null,
      },
      { status: 202 },
    );
  }
  try {
    if (mode === "auto") {
      const snapshot = await freshSnapshot();
      if (snapshot) {
        return NextResponse.json({
          ok: true,
          skipped: true,
          message: "Snapshot sudah diperbarui oleh pengguna lain.",
          syncedAt: snapshot.sourceSyncedAt,
        });
      }
    }
    await beginSyncRun(
      runId,
      access.user?.email ?? "auto-refresh",
      month,
    );
    const result = await syncFromSuperset(runId);
    const message = `${result.soRows.toLocaleString("id-ID")} baris SO dan ${result.staffRows.toLocaleString("id-ID")} baris staff tersinkron.`;
    await finishSyncRun({
      id: runId,
      status: "SUCCESS",
      soRows: result.soRows,
      staffRows: result.staffRows,
      message,
      datasetKey: result.datasetKey,
    });
    return NextResponse.json({
      ok: true,
      message,
      syncedAt: result.syncedAt,
      month: result.month,
    });
  } catch (caught) {
    const message =
      caught instanceof Error ? caught.message : "Sinkronisasi gagal.";
    await finishSyncRun({
      id: runId,
      status: "ERROR",
      soRows: 0,
      staffRows: 0,
      message,
    });
    const connector = await getStoredConnector();
    const expired = /cookie|sesi|login|401|403/i.test(message);
    await saveStoredConnector({
      ...connector,
      health: expired ? "EXPIRED" : "ERROR",
      lastMessage: message,
      lastVerifiedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return error(
      expired ? 401 : 502,
      expired ? "SUPERSET_SESSION_EXPIRED" : "SUPERSET_SYNC_FAILED",
      message,
    );
  } finally {
    await releaseSyncLease(lease.token);
  }
}
