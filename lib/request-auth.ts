import type { NextRequest } from "next/server";
import {
  getChatGPTUser,
  type ChatGPTUser,
} from "@/app/chatgpt-auth";
import {
  ADMIN_SESSION_COOKIE,
  adminSignInEnabled,
  readAdminSession,
} from "./admin-session";
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

export function adminEmails() {
  return (runtimeEnv("OUTBOUND_ADMIN_EMAILS") ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Sites authenticates the operator in front of the Worker and controls the
 * identity header itself. A self-hosted runtime sits behind a proxy that
 * forwards client headers verbatim, where trusting the header would let any
 * caller name themselves an admin, so the container image sets this to false.
 */
function platformAuthTrusted() {
  return (
    runtimeEnv("OUTBOUND_TRUST_PLATFORM_AUTH")?.trim().toLowerCase() !== "false"
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
  return adminSignInEnabled()
    ? "Masuk diperlukan untuk mengakses data outbound. Buka /masuk lalu masuk sebagai admin."
    : "Masuk diperlukan untuk mengakses data outbound.";
}
