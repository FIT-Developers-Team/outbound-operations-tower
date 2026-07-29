import type { NextRequest } from "next/server";
import {
  getChatGPTUser,
  type ChatGPTUser,
} from "@/app/chatgpt-auth";
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

export async function getOutboundAccess(
  request: NextRequest,
): Promise<OutboundAccess> {
  const user = await getChatGPTUser();
  if (user) {
    const allowed = (runtimeEnv("OUTBOUND_ADMIN_EMAILS") ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
    return {
      authenticated: true,
      admin: allowed.includes(user.email.toLowerCase()),
      local: false,
      user,
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
  return isLocalRequest(request)
    ? "Preview lokal belum diberi izin. Siapkan .dev.vars lalu jalankan ulang npm run start."
    : "Masuk diperlukan untuk mengakses data outbound.";
}
