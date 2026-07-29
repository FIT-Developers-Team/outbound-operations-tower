import { NextRequest, NextResponse } from "next/server";
import {
  anonymousReadEnabled,
  authRequiredMessage,
  getOutboundAccess,
} from "@/lib/request-auth";
import {
  encryptCookie,
  getConnectorPublicConfig,
  getStoredConnector,
  hasPersistentBindings,
  saveStoredConnector,
} from "@/lib/runtime-storage";
import { runtimeEnv } from "@/lib/runtime-env";

const DEFAULT_EXPORT_PATH =
  "/api/v1/chart/{sliceId}/data/?format=json&type=full&force=true";

function error(status: number, errorCode: string, message: string) {
  return NextResponse.json({ ok: false, errorCode, message }, { status });
}

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  const local =
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname) &&
    process.env.NODE_ENV !== "production";
  if (url.protocol !== "https:" && !local) {
    throw new Error("Base URL Superset wajib HTTPS.");
  }
  const allowedHosts = (runtimeEnv("SUPERSET_ALLOWED_HOSTS") ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (
    allowedHosts.length &&
    !allowedHosts.includes(url.hostname.toLowerCase())
  ) {
    throw new Error("Hostname tidak ada di SUPERSET_ALLOWED_HOSTS.");
  }
  return url.origin;
}

export async function GET(request: NextRequest) {
  const access = await getOutboundAccess(request);
  if (!anonymousReadEnabled() && !access.authenticated) {
    return error(401, "AUTH_REQUIRED", authRequiredMessage(request));
  }
  return NextResponse.json({
    ok: true,
    config: await getConnectorPublicConfig(),
    persistenceReady: await hasPersistentBindings(),
  });
}

export async function POST(request: NextRequest) {
  const access = await getOutboundAccess(request);
  if (!access.authenticated) {
    return error(401, "AUTH_REQUIRED", authRequiredMessage(request));
  }
  if (!access.admin) {
    return error(
      403,
      "ADMIN_REQUIRED",
      "Akun ini belum ada di OUTBOUND_ADMIN_EMAILS.",
    );
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return error(415, "JSON_REQUIRED", "Gunakan application/json.");
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return error(403, "CROSS_ORIGIN_BLOCKED", "Origin tidak diizinkan.");
  }
  const raw = await request.text();
  if (raw.length > 25_000) {
    return error(413, "CONFIG_TOO_LARGE", "Payload konfigurasi terlalu besar.");
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return error(400, "INVALID_JSON", "JSON tidak valid.");
  }

  try {
    const current = await getStoredConnector();
    const baseUrl = normalizeBaseUrl(String(body.baseUrl ?? ""));
    const soSliceId = String(body.soSliceId ?? "").trim();
    const staffSliceId = String(body.staffSliceId ?? "").trim();
    const cookie = String(body.cookie ?? "").trim();
    const refreshIntervalMinutes = Math.min(
      60,
      Math.max(1, Number(body.refreshIntervalMinutes) || 5),
    );
    const warehouseCode = String(body.warehouseCode ?? "CBT")
      .trim()
      .toUpperCase();
    const warehouseName = String(
      body.warehouseName ?? "CBT - WH Cibitung",
    ).trim();
    const warehouseTimezone = String(
      body.warehouseTimezone ?? "Asia/Jakarta",
    ).trim();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(soSliceId)) {
      throw new Error("Slice ID SO tidak valid.");
    }
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(staffSliceId)) {
      throw new Error("Slice ID staff tidak valid.");
    }
    if (cookie && (cookie.length > 16_000 || /[\r\n]/.test(cookie))) {
      throw new Error("Cookie tidak valid.");
    }
    if (!/^[A-Z0-9_-]{2,16}$/.test(warehouseCode)) {
      throw new Error("Kode warehouse harus 2-16 karakter.");
    }
    if (!warehouseName || warehouseName.length > 120) {
      throw new Error("Nama warehouse tidak valid.");
    }
    try {
      new Intl.DateTimeFormat("id-ID", { timeZone: warehouseTimezone });
    } catch {
      throw new Error("Zona waktu warehouse tidak valid.");
    }
    const encrypted = cookie ? await encryptCookie(cookie) : null;
    const now = new Date().toISOString();
    await saveStoredConnector({
      ...current,
      baseUrl,
      soSliceId,
      staffSliceId,
      pathTemplate: DEFAULT_EXPORT_PATH,
      refreshIntervalMinutes,
      warehouseCode,
      warehouseName,
      warehouseTimezone,
      cookieCiphertext: encrypted?.ciphertext ?? current.cookieCiphertext,
      cookieIv: encrypted?.iv ?? current.cookieIv,
      cookieExpiresAt: cookie ? null : current.cookieExpiresAt,
      cookieUpdatedAt: cookie ? now : current.cookieUpdatedAt,
      health:
        encrypted || current.cookieCiphertext || runtimeEnv("SUPERSET_SESSION_COOKIE")
          ? "READY"
          : "NOT_CONFIGURED",
      lastMessage: "Koneksi disimpan. Jalankan uji sync.",
      updatedAt: now,
    });
    return NextResponse.json({
      ok: true,
      config: await getConnectorPublicConfig(),
    });
  } catch (caught) {
    return error(
      400,
      "INVALID_CONFIG",
      caught instanceof Error ? caught.message : "Konfigurasi tidak valid.",
    );
  }
}
