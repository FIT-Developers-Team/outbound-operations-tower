import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  adminSessionTtlSeconds,
  adminSignInEnabled,
  adminTokenMatches,
  createAdminSession,
} from "@/lib/admin-session";
import {
  adminEmails,
  getOutboundAccess,
  isSameOrigin,
} from "@/lib/request-auth";

function error(status: number, errorCode: string, message: string) {
  return NextResponse.json({ ok: false, errorCode, message }, { status });
}

// Coolify and most reverse proxies terminate TLS, so the request reaching the
// Worker is plain HTTP. The forwarded protocol decides the Secure attribute.
function isSecureRequest(request: NextRequest) {
  const forwarded = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  return (forwarded ?? request.nextUrl.protocol.replace(":", "")) === "https";
}

function rejectCrossOrigin(request: NextRequest) {
  return isSameOrigin(request)
    ? null
    : error(403, "CROSS_ORIGIN_BLOCKED", "Origin tidak diizinkan.");
}

export async function GET(request: NextRequest) {
  const access = await getOutboundAccess(request);
  return NextResponse.json(
    {
      ok: true,
      signInEnabled: adminSignInEnabled(),
      authenticated: access.authenticated,
      admin: access.admin,
      email: access.user?.email ?? null,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  if (!adminSignInEnabled()) {
    return error(
      503,
      "SIGNIN_DISABLED",
      "Masuk admin belum aktif. Set OUTBOUND_ADMIN_TOKEN minimal 32 karakter pada deployment.",
    );
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return error(415, "JSON_REQUIRED", "Gunakan application/json.");
  }

  const raw = await request.text();
  if (raw.length > 20_000) {
    return error(413, "PAYLOAD_TOO_LARGE", "Payload terlalu besar.");
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return error(400, "INVALID_JSON", "JSON tidak valid.");
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const token = String(body.token ?? "");

  // A wrong address and a wrong token return the same answer so the response
  // cannot be used to enumerate which operators are admins.
  const [tokenValid, emailAllowed] = [
    await adminTokenMatches(token),
    adminEmails().includes(email),
  ];
  if (!tokenValid || !emailAllowed) {
    return error(
      401,
      "SIGNIN_REJECTED",
      "Email atau token admin tidak cocok.",
    );
  }

  const response = NextResponse.json({ ok: true, email });
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: await createAdminSession(email),
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: "strict",
    path: "/",
    maxAge: adminSessionTtlSeconds(),
  });
  return response;
}

export async function DELETE(request: NextRequest) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
