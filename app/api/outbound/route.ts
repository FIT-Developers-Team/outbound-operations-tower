import { NextRequest, NextResponse } from "next/server";
import {
  aggregateMetrics,
  buildBulkUploadRows,
  summarizeZones,
} from "@/lib/outbound-logic";
import {
  getDatasetSnapshotMetadata,
  loadDatasetSnapshot,
} from "@/lib/runtime-storage";
import {
  anonymousReadEnabled,
  authRequiredMessage,
  getOutboundAccess,
} from "@/lib/request-auth";

function error(status: number, errorCode: string, message: string) {
  return NextResponse.json({ ok: false, errorCode, message }, { status });
}

export async function GET(request: NextRequest) {
  const access = await getOutboundAccess(request);
  if (!anonymousReadEnabled() && !access.authenticated) {
    return error(
      401,
      "AUTH_REQUIRED",
      authRequiredMessage(request),
    );
  }

  const resource =
    request.nextUrl.searchParams.get("resource")?.trim().toLowerCase() ??
    "dataset";
  const metadata = await getDatasetSnapshotMetadata();
  const etag = metadata?.syncedAt
    ? `"snapshot-${metadata.syncedAt}"`
    : null;
  if (etag && request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  }
  const snapshot = await loadDatasetSnapshot(metadata);
  if (!snapshot) {
    return error(
      503,
      "LIVE_SNAPSHOT_NOT_READY",
      "Snapshot live belum tersedia. Buka Konfigurasi lalu jalankan sync pertama.",
    );
  }

  const data = snapshot.data;
  let payload: unknown;
  switch (resource) {
    case "dataset":
      payload = data;
      break;
    case "overview":
      payload = aggregateMetrics(data.orders, data.pickers);
      break;
    case "sourceprofile":
      payload = data.sourceProfile;
      break;
    case "zones":
      payload = summarizeZones(data.orders, data.pickers);
      break;
    case "pickers":
    case "staffroster":
      payload = data.pickers;
      break;
    case "sos":
      payload = data.orders;
      break;
    case "destinationrules":
      payload = data.destinationRules;
      break;
    case "targetrules":
      payload = data.targetRules;
      break;
    case "bulkupload":
      payload = buildBulkUploadRows(data.orders, []);
      break;
    case "health":
      payload = {
        status: "ok",
        sourceDate: data.sourceProfile.sourceDate,
        syncedAt: snapshot.syncedAt,
      };
      break;
    default:
      return error(400, "INVALID_RESOURCE", "Resource outbound tidak dikenal.");
  }

  return NextResponse.json(
    {
      ok: true,
      data: payload,
      syncedAt: snapshot.syncedAt,
    },
    {
      headers: {
        "Cache-Control": "private, max-age=0, must-revalidate",
        ...(etag ? { ETag: etag } : {}),
      },
    },
  );
}
