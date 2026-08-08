import type { NextRequest } from "next/server";
import {
  getChatGPTUser,
  USER_EMAIL_HEADER,
  type ChatGPTUser,
} from "@/app/chatgpt-auth";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "./admin-session";
import { runtimeEnv, runtimeFlag } from "./runtime-env";

export type OutboundAccess = {
  authenticated: boolean;
  admin: boolean;
  local: boolean;
  user: ChatGPTUser | null;
};

function isLocalRequest(request: NextRequest) {
  return ["localhost", "127.0.0.1", "::1"].includes(
    request.nextUrl.hostname.toLowerCase(),
  );
}

function forwardedValue(request: NextRequest, header: string) {
  return request.headers.get(header)?.split(",")[0]?.trim() || null;
}

/**
 * Same-origin guard for write routes.
 *
 * A TLS-terminating proxy forwards the request as plain HTTP, so the URL the
 * Worker sees carries scheme `http` while the browser sends an `https` origin.
 * Comparing against the Worker's own URL therefore rejects genuine same-origin
 * requests. The forwarded headers describe what the browser actually asked for.
 *
 * Only a browser sets `Origin`, and no page can forge it for another site, so
 * trusting the forwarded scheme here does not weaken the CSRF protection.
 */
export function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const host =
    forwardedValue(request, "x-forwarded-host") ??
    request.headers.get("host") ??
    request.nextUrl.host;
  const protocol =
    forwardedValue(request, "x-forwarded-proto") ??
    request.nextUrl.protocol.replace(":", "");

  return origin === `${protocol}://${host}` || origin === request.nextUrl.origin;
}

export function adminEmails() {
  return (runtimeEnv("OUTBOUND_ADMIN_EMAILS") ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Whether `oai-authenticated-user-email` may be read as proof of identity.
 *
 * Sites authenticates the operator in front of the Worker and controls that
 * header itself. A plain reverse proxy forwards client headers verbatim, so
 * anyone could send the header and name themselves an admin.
 *
 * Trust is therefore opt-in and requires the literal string `true`. An unset
 * or unrecognised value means "no proxy owns this header", which is the only
 * safe reading for a runtime nobody has configured yet — a deployment that
 * forgets the variable loses platform sign-in rather than silently accepting a
 * forged one. authRequiredMessage() explains the situation when it happens.
 */
function platformAuthTrusted() {
  return (
    runtimeEnv("OUTBOUND_TRUST_PLATFORM_AUTH")?.trim().toLowerCase() === "true"
  );
}

export async function getOutboundAccess(
  request: NextRequest,
): Promise<OutboundAccess> {
  const allowed = adminEmails();

  const user = platformAuthTrusted() ? await getChatGPTUser() : null;
  if (user) {
    return {
      authenticated: true,
      admin: allowed.includes(user.email.toLowerCase()),
      local: false,
      user,
    };
  }

  // The allowlist is re-checked on every request, so removing an address from
  // OUTBOUND_ADMIN_EMAILS revokes access without waiting for the cookie to age
  // out.
  const sessionEmail = await readAdminSession(
    request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
  );
  if (sessionEmail && allowed.includes(sessionEmail.toLowerCase())) {
    return {
      authenticated: true,
      admin: true,
      local: false,
      user: {
        displayName: sessionEmail,
        email: sessionEmail,
        fullName: null,
      },
    };
  }

  const local =
    isLocalRequest(request) &&
    runtimeFlag("OUTBOUND_ALLOW_LOCAL_ADMIN");
  if (local) {
    return {
      authenticated: true,
      admin: true,
      local: true,
      user: {
        displayName: "Local operator",
        email: "local-operator@localhost",
        fullName: "Local operator",
      },
    };
  }

  return {
    authenticated: false,
    admin: false,
    local: false,
    user: null,
  };
}

export function anonymousReadEnabled() {
  return runtimeFlag("OUTBOUND_ALLOW_ANONYMOUS_READ");
}

export function authRequiredMessage(request: NextRequest) {
  if (isLocalRequest(request)) {
    return "Preview lokal belum diberi izin. Siapkan .dev.vars lalu jalankan ulang npm run start.";
  }
  // The identity header arriving while trust is off is the one rejection an
  // operator cannot diagnose from a bare 401: the deployment looks signed in
  // and is refused anyway. Name the variable that decides it, because on a
  // platform runtime this is a missing setting, and behind a plain reverse
  // proxy it is the header being forwarded from the client as it should be.
  if (!platformAuthTrusted() && request.headers.get(USER_EMAIL_HEADER)) {
    return "Header identitas platform diterima tetapi tidak dipercaya karena OUTBOUND_TRUST_PLATFORM_AUTH belum diset true. Set variabel itu hanya bila ada auth proxy yang menghapus lalu menyuntikkan ulang header tersebut; bila tidak, masuk lewat /masuk.";
  }
  // A self-hosted runtime has no platform sign-in to fall back on, so the
  // operator is always sent to /masuk. That page reports whether the token is
  // missing or too short, which this message cannot do on its own.
  return platformAuthTrusted()
    ? "Masuk diperlukan untuk mengakses data outbound."
    : "Masuk diperlukan untuk mengakses data outbound. Buka /masuk untuk masuk sebagai admin.";
}
