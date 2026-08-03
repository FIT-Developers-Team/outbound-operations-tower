import { runtimeEnv } from "./runtime-env";

/**
 * Admin sign-in for deployments without a platform auth proxy.
 *
 * Sites authenticates operators before a request reaches the Worker. A
 * self-hosted runtime has no such layer, so an operator proves admin identity
 * with a shared token and receives an HMAC-signed session cookie in return.
 */
export const ADMIN_SESSION_COOKIE = "outbound_admin_session";
const MINIMUM_TOKEN_LENGTH = 32;
// A cookie has to carry some expiry, so "does not expire" is ten years.
const PERMANENT_SESSION_DAYS = 3_650;

/**
 * How long a signed-in operator stays signed in. The default does not expire,
 * because operators were being signed out mid-shift for no operational gain:
 * revocation never depended on it. The allowlist is re-read on every request,
 * so removing an address from OUTBOUND_ADMIN_EMAILS ends that operator's access
 * immediately, whatever their cookie says. Set OUTBOUND_ADMIN_SESSION_DAYS to a
 * number of days to reintroduce a shorter limit.
 */
export function adminSessionTtlSeconds() {
  const configured = Number(runtimeEnv("OUTBOUND_ADMIN_SESSION_DAYS"));
  const days =
    Number.isFinite(configured) && configured > 0
      ? Math.min(configured, PERMANENT_SESSION_DAYS)
      : PERMANENT_SESSION_DAYS;
  return Math.round(days * 24 * 60 * 60);
}

type SessionPayload = {
  email: string;
  exp: number;
};

export function adminSignInEnabled() {
  return (runtimeEnv("OUTBOUND_ADMIN_TOKEN")?.trim().length ?? 0) >=
    MINIMUM_TOKEN_LENGTH;
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

// The raw token is never used as key material directly. Hashing it first gives
// the HMAC a full-length key regardless of how the operator wrote the secret.
async function signingKey() {
  const token = runtimeEnv("OUTBOUND_ADMIN_TOKEN")?.trim() ?? "";
  if (token.length < MINIMUM_TOKEN_LENGTH) {
    throw new Error(
      `OUTBOUND_ADMIN_TOKEN minimal ${MINIMUM_TOKEN_LENGTH} karakter belum dikonfigurasi.`,
    );
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`outbound-admin-session:${token}`),
  );
  return crypto.subtle.importKey(
    "raw",
    digest,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createAdminSession(email: string) {
  const payload: SessionPayload = {
    email,
    exp: Math.floor(Date.now() / 1000) + adminSessionTtlSeconds(),
  };
  const body = toBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(),
    new TextEncoder().encode(body),
  );
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

/** Returns the signed-in email, or null when the cookie is absent or invalid. */
export async function readAdminSession(
  value: string | undefined,
): Promise<string | null> {
  if (!value) return null;
  const [body, signature] = value.split(".");
  if (!body || !signature) return null;

  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(),
      fromBase64Url(signature),
      new TextEncoder().encode(body),
    );
    if (!valid) return null;
    const payload = JSON.parse(
      new TextDecoder().decode(fromBase64Url(body)),
    ) as SessionPayload;
    if (typeof payload.email !== "string" || typeof payload.exp !== "number") {
      return null;
    }
    if (payload.exp * 1000 <= Date.now()) return null;
    return payload.email;
  } catch {
    return null;
  }
}

/**
 * Compares digests rather than the raw strings so neither the length nor the
 * content of the configured token leaks through comparison timing.
 */
export async function adminTokenMatches(candidate: string) {
  const token = runtimeEnv("OUTBOUND_ADMIN_TOKEN")?.trim() ?? "";
  if (token.length < MINIMUM_TOKEN_LENGTH) return false;
  const encoder = new TextEncoder();
  const [candidateDigest, tokenDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(token)),
  ]);
  const left = new Uint8Array(candidateDigest);
  const right = new Uint8Array(tokenDigest);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}
