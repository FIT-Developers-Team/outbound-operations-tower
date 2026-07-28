import { NextRequest, NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";

const actions = new Set([
  "assignBatch",
  "checkerDone",
  "checkerReset",
  "updateStaffRoster",
  "updateDestinationRule",
  "updateTargetRule",
  "generateAssignmentPlan",
  "exportBulkUpload",
]);

function error(status: number, errorCode: string, message: string) {
  return NextResponse.json({ ok: false, errorCode, message }, { status });
}

function isGasEndpoint(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "script.google.com" &&
      /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const user = await getChatGPTUser();
  if (!user) return error(401, "AUTH_REQUIRED", "Sign in is required for outbound commands.");

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return error(415, "JSON_REQUIRED", "Outbound commands require application/json.");
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return error(403, "CROSS_ORIGIN_BLOCKED", "Cross-origin commands are not allowed.");
  }
  const allowedEmails = (process.env.OUTBOUND_COMMAND_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (!allowedEmails.length) {
    return error(
      503,
      "COMMAND_AUTHORIZATION_NOT_CONFIGURED",
      "The command writer allowlist is not configured.",
    );
  }
  if (!allowedEmails.includes(user.email.toLowerCase())) {
    return error(403, "COMMAND_FORBIDDEN", "This account does not have command access.");
  }

  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9:._-]{12,100}$/.test(idempotencyKey)) {
    return error(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "A valid Idempotency-Key header is required.",
    );
  }

  const raw = await request.text();
  if (raw.length > 250_000) return error(413, "COMMAND_TOO_LARGE", "The command payload exceeded the safe limit.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return error(400, "INVALID_JSON", "The command body must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return error(400, "INVALID_COMMAND", "The command body must be a JSON object.");
  }
  const payload = parsed as Record<string, unknown>;

  const action = typeof payload.action === "string" ? payload.action : "";
  if (!actions.has(action)) return error(400, "INVALID_ACTION", "Unknown outbound command.");
  if (Array.isArray(payload.rows) && payload.rows.length > 500) {
    return error(400, "TOO_MANY_ROWS", "A command can contain at most 500 rows.");
  }

  const endpoint = (
    process.env.OUTBOUND_COMMAND_GAS_ENDPOINT ||
    process.env.OUTBOUND_GAS_ENDPOINT ||
    ""
  ).trim();
  const token = process.env.OUTBOUND_COMMAND_GAS_TOKEN?.trim() ?? "";
  if (!isGasEndpoint(endpoint) || token.length < 20) {
    return error(503, "COMMAND_SOURCE_NOT_CONFIGURED", "The outbound command source is not configured.");
  }

  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        action,
        token,
        actor: user.email,
        actorName: user.displayName,
        idempotencyKey,
      }),
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(25_000),
    });
    if (!upstream.ok) return error(502, "COMMAND_UPSTREAM_ERROR", "The command service is temporarily unavailable.");

    const responseText = await upstream.text();
    if (responseText.length > 500_000) return error(502, "COMMAND_RESPONSE_TOO_LARGE", "The command response exceeded the safe limit.");

    let responsePayload: unknown;
    try {
      responsePayload = JSON.parse(responseText);
    } catch {
      return error(502, "COMMAND_INVALID_RESPONSE", "The command service returned invalid JSON.");
    }
    if (
      !responsePayload ||
      typeof responsePayload !== "object" ||
      (responsePayload as { ok?: boolean }).ok !== true
    ) {
      return error(502, "COMMAND_INVALID_RESPONSE", "The command service returned an invalid response.");
    }

    return NextResponse.json(
      { ...(responsePayload as Record<string, unknown>), idempotencyKey },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (caught) {
    const timedOut = caught instanceof Error && ["TimeoutError", "AbortError"].includes(caught.name);
    return error(
      timedOut ? 504 : 503,
      timedOut ? "COMMAND_TIMEOUT" : "COMMAND_UNAVAILABLE",
      timedOut ? "The command timed out." : "The command service is unavailable.",
    );
  }
}
