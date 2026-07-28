import { NextRequest, NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";

const resourceAliases = new Map<string, string>([
  ["health", "health"],
  ["dataset", "dataset"],
  ["overview", "overview"],
  ["sourceprofile", "sourceProfile"],
  ["zones", "zones"],
  ["zone", "zone"],
  ["pickers", "pickers"],
  ["picker", "picker"],
  ["staffroster", "staffRoster"],
  ["sos", "sos"],
  ["so", "so"],
  ["destinationrules", "destinationRules"],
  ["targetrules", "targetRules"],
  ["assignmentplan", "assignmentPlan"],
  ["bulkupload", "bulkUpload"],
]);
const allowedParams = new Set([
  "hour", "wave", "drop", "zone", "status", "mpStatus", "shift", "month",
  "pickerId", "rackZone", "rackLevel", "q",
  "sort", "order", "page", "pageSize", "itemPage", "itemPageSize", "soNumber", "state",
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

function sanitize(searchParams: URLSearchParams) {
  const params: Record<string, string | number> = {};
  searchParams.forEach((raw, key) => {
    if (!allowedParams.has(key)) return;
    const value = raw.trim().slice(0, 160);
    if (!value) return;
    if (["page", "pageSize", "itemPage", "itemPageSize"].includes(key)) {
      const parsed = Math.floor(Number(value));
      if (!Number.isFinite(parsed) || parsed < 1) return;
      const maximum = key.includes("Size") ? (key === "pageSize" ? 100 : 50) : 10_000;
      params[key] = Math.min(parsed, maximum);
      return;
    }
    params[key] = value;
  });
  return params;
}

export async function GET(request: NextRequest) {
  const resourceKey =
    request.nextUrl.searchParams.get("resource")?.trim().toLowerCase() ?? "";
  const resource = resourceAliases.get(resourceKey);
  if (!resource) {
    return error(400, "INVALID_RESOURCE", "Unknown outbound resource.");
  }

  const allowAnonymous = process.env.OUTBOUND_ALLOW_ANONYMOUS_READ === "true";
  if (!allowAnonymous && !(await getChatGPTUser())) {
    return error(401, "AUTH_REQUIRED", "Authentication is required to read outbound data.");
  }

  const endpoint = process.env.OUTBOUND_GAS_ENDPOINT?.trim() ?? "";
  const token = process.env.OUTBOUND_GAS_TOKEN?.trim() ?? "";
  if (!isGasEndpoint(endpoint) || token.length < 20) {
    return error(503, "LIVE_SOURCE_NOT_CONFIGURED", "The live outbound source is not configured.");
  }

  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, resource, params: sanitize(request.nextUrl.searchParams) }),
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (!upstream.ok) return error(502, "UPSTREAM_HTTP_ERROR", "The outbound source is temporarily unavailable.");

    const raw = await upstream.text();
    if (raw.length > 3_000_000) {
      return error(
        502,
        "UPSTREAM_TOO_LARGE",
        "The outbound response exceeded the safe limit.",
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return error(502, "UPSTREAM_INVALID_JSON", "The outbound source returned invalid JSON.");
    }
    if (!payload || typeof payload !== "object" || (payload as { ok?: boolean }).ok !== true) {
      return error(502, "UPSTREAM_REJECTED", "The outbound source rejected the request.");
    }

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (caught) {
    const timedOut = caught instanceof Error && ["TimeoutError", "AbortError"].includes(caught.name);
    return error(
      timedOut ? 504 : 503,
      timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE",
      timedOut ? "The outbound request timed out." : "The outbound source is unavailable.",
    );
  }
}
