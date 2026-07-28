import { NextRequest, NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import {
  aggregateMetrics,
  buildBulkUploadRows,
  summarizeZones,
} from "@/lib/outbound-logic";
import { loadDatasetSnapshot } from "@/lib/runtime-storage";

function error(status: number, errorCode: string, message: string) {
  return NextResponse.json({ ok: false, errorCode, message }, { status });
}

export async function GET(request: NextRequest) {
  const allowAnonymous = process.env.OUTBOUND_ALLOW_ANONYMOUS_READ === "true";
  if (!allowAnonymous && !(await getChatGPTUser())) {
    return error(
      401,
      "AUTH_REQUIRED",
      "Masuk diperlukan untuk membaca data outbound.",
    );
  }

  const resource =
    request.nextUrl.searchParams.get("resource")?.trim().toLowerCase() ??
    "dataset";
  const snapshot = await loadDatasetSnapshot();
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
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
