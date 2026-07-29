import { NextRequest, NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import {
  acquireSyncLease,
  beginSyncRun,
  finishSyncRun,
  getStoredConnector,
  releaseSyncLease,
  saveStoredConnector,
} from "@/lib/runtime-storage";
import { jakartaMonth, syncFromSuperset } from "@/lib/superset-sync";

function error(status: number, errorCode: string, message: string) {
  return NextResponse.json({ ok: false, errorCode, message }, { status });
}

async function requireAdmin() {
  const user = await getChatGPTUser();
  if (!user) return { user: null, authenticated: false };
  const allowed = (process.env.OUTBOUND_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return {
    user: allowed.includes(user.email.toLowerCase()) ? user : null,
    authenticated: true,
  };
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.authenticated) {
    return error(401, "AUTH_REQUIRED", "Masuk diperlukan.");
  }
  const user = admin.user;
  if (!user) {
    return error(
      403,
      "ADMIN_REQUIRED",
      "Akun ini belum memiliki izin sinkronisasi.",
    );
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return error(403, "CROSS_ORIGIN_BLOCKED", "Origin tidak diizinkan.");
  }

  const runId = crypto.randomUUID();
  const month = jakartaMonth().key;
  const lease = await acquireSyncLease();
  if (!lease.acquired) {
    return error(
      409,
      "SYNC_ALREADY_RUNNING",
      "Sync lain masih berjalan. Snapshot akan diperbarui setelah proses selesai.",
    );
  }
  try {
    await beginSyncRun(runId, user.email, month);
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
