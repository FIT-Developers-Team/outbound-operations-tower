import { NextRequest, NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import {
  encryptCookie,
  getConnectorPublicConfig,
  getStoredConnector,
  hasPersistentBindings,
  saveStoredConnector,
} from "@/lib/runtime-storage";

const DEFAULT_EXPORT_PATH =
  "/api/v1/chart/{sliceId}/data/?format=csv&force=true";

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

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  const local =
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname) &&
    process.env.NODE_ENV !== "production";
  if (url.protocol !== "https:" && !local) {
    throw new Error("Base URL Superset wajib HTTPS.");
  }
  const allowedHosts = (process.env.SUPERSET_ALLOWED_HOSTS ?? "")
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

export async function GET() {
  const allowAnonymous = process.env.OUTBOUND_ALLOW_ANONYMOUS_READ === "true";
  if (!allowAnonymous && !(await getChatGPTUser())) {
    return error(401, "AUTH_REQUIRED", "Masuk diperlukan.");
  }
  return NextResponse.json({
    ok: true,
    config: await getConnectorPublicConfig(),
    persistenceReady: await hasPersistentBindings(),
  });
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
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(soSliceId)) {
      throw new Error("Slice ID SO tidak valid.");
    }
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(staffSliceId)) {
      throw new Error("Slice ID staff tidak valid.");
    }
    if (cookie && (cookie.length > 16_000 || /[\r\n]/.test(cookie))) {
      throw new Error("Cookie tidak valid.");
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
      cookieCiphertext: encrypted?.ciphertext ?? current.cookieCiphertext,
      cookieIv: encrypted?.iv ?? current.cookieIv,
      cookieExpiresAt: cookie ? null : current.cookieExpiresAt,
      cookieUpdatedAt: cookie ? now : current.cookieUpdatedAt,
      health:
        encrypted || current.cookieCiphertext || process.env.SUPERSET_SESSION_COOKIE
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
