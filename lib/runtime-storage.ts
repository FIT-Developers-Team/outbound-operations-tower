import type {
  ConnectorPublicConfig,
  DemoDataset,
  SyncHealth,
} from "./outbound-types";
import { runtimeEnv } from "./runtime-env";

type RuntimeBindings = {
  DB?: D1Database;
  SNAPSHOTS?: R2Bucket;
};

async function runtimeBindings(): Promise<RuntimeBindings> {
  try {
    const runtime = await import("cloudflare:workers");
    return runtime.env as RuntimeBindings;
  } catch {
    // Tests import the built Worker under Node, where `cloudflare:workers` does
    // not resolve. The entry point publishes the same bindings on a global
    // before handling a request, which is the bridge runtime-env.ts already
    // relies on for variables.
    return (globalThis.__OUTBOUND_RUNTIME_ENV__ ?? {}) as RuntimeBindings;
  }
}

const DEFAULT_PATH =
  "/api/v1/chart/{sliceId}/data/?format=json&type=full&force=true";
const LEGACY_CSV_PATH =
  "/api/v1/chart/{sliceId}/data/?format=csv&force=true";
const CONNECTOR_ID = "primary";
const SNAPSHOT_ID = "current";
const SNAPSHOT_KEY = "snapshots/current.json";
const COOKIE_SECRET_NAME = "superset_cookie_encryption_key";
const MINIMUM_SECRET_LENGTH = 32;
let schemaReady: Promise<boolean> | null = null;
let generatedSecretCache: string | null = null;

function normalizeExportPath(pathTemplate: string | null | undefined) {
  const path = pathTemplate?.trim();
  if (!path || path === LEGACY_CSV_PATH) return DEFAULT_PATH;
  return path;
}

type ConnectorRow = {
  base_url: string;
  so_slice_id: string;
  staff_slice_id: string;
  path_template: string;
  refresh_interval_minutes: number;
  warehouse_code: string;
  warehouse_name: string;
  warehouse_timezone: string;
  sync_locked_until: string | null;
  sync_lock_token: string | null;
  cookie_ciphertext: string | null;
  cookie_iv: string | null;
  cookie_expires_at: string | null;
  cookie_updated_at: string | null;
  health: SyncHealth;
  last_message: string | null;
  last_verified_at: string | null;
  updated_at: string;
};

type RunRow = {
  started_at: string | null;
  status: string | null;
  message: string | null;
};

type SnapshotRow = {
  dataset_key: string;
  fallback_payload: string | null;
  synced_at: string;
};

export type SnapshotMetadata = {
  datasetKey: string;
  fallbackPayload: string | null;
  syncedAt: string;
};

export type StoredConnector = {
  baseUrl: string;
  soSliceId: string;
  staffSliceId: string;
  pathTemplate: string;
  refreshIntervalMinutes: number;
  warehouseCode: string;
  warehouseName: string;
  warehouseTimezone: string;
  syncLockedUntil: string | null;
  syncLockToken: string | null;
  cookieCiphertext: string | null;
  cookieIv: string | null;
  cookieExpiresAt: string | null;
  cookieUpdatedAt: string | null;
  health: SyncHealth;
  lastMessage: string | null;
  lastVerifiedAt: string | null;
  updatedAt: string;
};

export async function hasPersistentBindings() {
  const env = await runtimeBindings();
  return Boolean(env.DB && env.SNAPSHOTS);
}

export function ensureRuntimeSchema() {
  if (!schemaReady) {
    schemaReady = initializeRuntimeSchema().catch((caught) => {
      schemaReady = null;
      throw caught;
    });
  }
  return schemaReady;
}

async function initializeRuntimeSchema() {
  const env = await runtimeBindings();
  if (!env.DB) return false;
  const db = env.DB;
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS sync_connector (
        id TEXT PRIMARY KEY NOT NULL,
        base_url TEXT NOT NULL DEFAULT '',
        so_slice_id TEXT NOT NULL DEFAULT '',
        staff_slice_id TEXT NOT NULL DEFAULT '',
        path_template TEXT NOT NULL DEFAULT '${DEFAULT_PATH}',
        refresh_interval_minutes INTEGER NOT NULL DEFAULT 5,
        warehouse_code TEXT NOT NULL DEFAULT 'CBT',
        warehouse_name TEXT NOT NULL DEFAULT 'CBT - WH Cibitung',
        warehouse_timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
        sync_locked_until TEXT,
        sync_lock_token TEXT,
        cookie_ciphertext TEXT,
        cookie_iv TEXT,
        cookie_expires_at TEXT,
        cookie_updated_at TEXT,
        health TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
        last_message TEXT,
        last_verified_at TEXT,
        updated_at TEXT NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS sync_runs (
        id TEXT PRIMARY KEY NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        triggered_by TEXT NOT NULL,
        month TEXT NOT NULL,
        so_rows INTEGER NOT NULL DEFAULT 0,
        staff_rows INTEGER NOT NULL DEFAULT 0,
        dataset_key TEXT,
        message TEXT
      )
    `),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS sync_runs_started_at_idx ON sync_runs (started_at)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS sync_runs_status_idx ON sync_runs (status)",
    ),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS runtime_secrets (
        name TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS dataset_snapshots (
        id TEXT PRIMARY KEY NOT NULL,
        source_date TEXT NOT NULL,
        month TEXT NOT NULL,
        dataset_key TEXT NOT NULL,
        fallback_payload TEXT,
        so_rows INTEGER NOT NULL DEFAULT 0,
        staff_rows INTEGER NOT NULL DEFAULT 0,
        synced_at TEXT NOT NULL,
        run_id TEXT NOT NULL
      )
    `),
  ]);
  const tableInfo = await db
    .prepare("PRAGMA table_info(sync_connector)")
    .all<{ name: string }>();
  const columns = new Set(
    (tableInfo.results ?? []).map((column) => column.name),
  );
  if (!columns.has("refresh_interval_minutes")) {
    await db
      .prepare(
        "ALTER TABLE sync_connector ADD COLUMN refresh_interval_minutes INTEGER NOT NULL DEFAULT 5",
      )
      .run();
  }
  if (!columns.has("sync_locked_until")) {
    await db
      .prepare("ALTER TABLE sync_connector ADD COLUMN sync_locked_until TEXT")
      .run();
  }
  if (!columns.has("sync_lock_token")) {
    await db
      .prepare("ALTER TABLE sync_connector ADD COLUMN sync_lock_token TEXT")
      .run();
  }
  if (!columns.has("warehouse_code")) {
    await db
      .prepare(
        "ALTER TABLE sync_connector ADD COLUMN warehouse_code TEXT NOT NULL DEFAULT 'CBT'",
      )
      .run();
  }
  if (!columns.has("warehouse_name")) {
    await db
      .prepare(
        "ALTER TABLE sync_connector ADD COLUMN warehouse_name TEXT NOT NULL DEFAULT 'CBT - WH Cibitung'",
      )
      .run();
  }
  if (!columns.has("warehouse_timezone")) {
    await db
      .prepare(
        "ALTER TABLE sync_connector ADD COLUMN warehouse_timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta'",
      )
      .run();
  }
  return true;
}

export async function getStoredConnector(): Promise<StoredConnector> {
  const env = await runtimeBindings();
  const now = new Date().toISOString();
  const fromEnvironment = {
    baseUrl: runtimeEnv("SUPERSET_BASE_URL")?.trim() ?? "",
    soSliceId: runtimeEnv("SUPERSET_SO_SLICE_ID")?.trim() ?? "",
    staffSliceId: runtimeEnv("SUPERSET_STAFF_SLICE_ID")?.trim() ?? "",
    pathTemplate:
      runtimeEnv("SUPERSET_EXPORT_PATH_TEMPLATE")?.trim() || DEFAULT_PATH,
    refreshIntervalMinutes: Math.min(
      60,
      Math.max(
        1,
        Number(runtimeEnv("SUPERSET_REFRESH_INTERVAL_MINUTES")) || 5,
      ),
    ),
    warehouseCode: runtimeEnv("OUTBOUND_WAREHOUSE_CODE")?.trim() || "CBT",
    warehouseName:
      runtimeEnv("OUTBOUND_WAREHOUSE_NAME")?.trim() || "CBT - WH Cibitung",
    warehouseTimezone:
      runtimeEnv("OUTBOUND_WAREHOUSE_TIMEZONE")?.trim() || "Asia/Jakarta",
  };
  if (!env.DB) {
    return {
      ...fromEnvironment,
      cookieCiphertext: null,
      cookieIv: null,
      syncLockedUntil: null,
      syncLockToken: null,
      cookieExpiresAt: runtimeEnv("SUPERSET_COOKIE_EXPIRES_AT")?.trim() || null,
      cookieUpdatedAt: null,
      health:
        fromEnvironment.baseUrl &&
        fromEnvironment.soSliceId &&
        fromEnvironment.staffSliceId
          ? "READY"
          : "NOT_CONFIGURED",
      lastMessage: null,
      lastVerifiedAt: null,
      updatedAt: now,
    };
  }
  await ensureRuntimeSchema();
  const row = await env.DB.prepare(
    `SELECT base_url, so_slice_id, staff_slice_id, path_template,
            refresh_interval_minutes, warehouse_code, warehouse_name,
            warehouse_timezone, sync_locked_until, sync_lock_token,
            cookie_ciphertext, cookie_iv, cookie_expires_at, cookie_updated_at,
            health, last_message, last_verified_at, updated_at
       FROM sync_connector WHERE id = ?1`,
  )
    .bind(CONNECTOR_ID)
    .first<ConnectorRow>();
  if (!row) {
    return {
      ...fromEnvironment,
      cookieCiphertext: null,
      cookieIv: null,
      syncLockedUntil: null,
      syncLockToken: null,
      cookieExpiresAt: runtimeEnv("SUPERSET_COOKIE_EXPIRES_AT")?.trim() || null,
      cookieUpdatedAt: null,
      health:
        fromEnvironment.baseUrl &&
        fromEnvironment.soSliceId &&
        fromEnvironment.staffSliceId
          ? "READY"
          : "NOT_CONFIGURED",
      lastMessage: null,
      lastVerifiedAt: null,
      updatedAt: now,
    };
  }
  return {
    baseUrl: row.base_url || fromEnvironment.baseUrl,
    soSliceId: row.so_slice_id || fromEnvironment.soSliceId,
    staffSliceId: row.staff_slice_id || fromEnvironment.staffSliceId,
    pathTemplate: normalizeExportPath(
      row.path_template || fromEnvironment.pathTemplate,
    ),
    refreshIntervalMinutes:
      row.refresh_interval_minutes || fromEnvironment.refreshIntervalMinutes,
    warehouseCode: row.warehouse_code || fromEnvironment.warehouseCode,
    warehouseName: row.warehouse_name || fromEnvironment.warehouseName,
    warehouseTimezone:
      row.warehouse_timezone || fromEnvironment.warehouseTimezone,
    syncLockedUntil: row.sync_locked_until,
    syncLockToken: row.sync_lock_token,
    cookieCiphertext: row.cookie_ciphertext,
    cookieIv: row.cookie_iv,
    cookieExpiresAt:
      row.cookie_expires_at ||
      runtimeEnv("SUPERSET_COOKIE_EXPIRES_AT")?.trim() ||
      null,
    cookieUpdatedAt: row.cookie_updated_at,
    health: row.health,
    lastMessage: row.last_message,
    lastVerifiedAt: row.last_verified_at,
    updatedAt: row.updated_at,
  };
}

export async function saveStoredConnector(
  connector: StoredConnector,
): Promise<void> {
  const env = await runtimeBindings();
  if (!env.DB) throw new Error("D1 binding DB belum tersedia.");
  await ensureRuntimeSchema();
  await env.DB.prepare(`
    INSERT INTO sync_connector (
      id, base_url, so_slice_id, staff_slice_id, path_template,
      refresh_interval_minutes, warehouse_code, warehouse_name, warehouse_timezone,
      sync_locked_until, sync_lock_token, cookie_ciphertext,
      cookie_iv, cookie_expires_at, cookie_updated_at,
      health, last_message, last_verified_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
    ON CONFLICT(id) DO UPDATE SET
      base_url = excluded.base_url,
      so_slice_id = excluded.so_slice_id,
      staff_slice_id = excluded.staff_slice_id,
      path_template = excluded.path_template,
      refresh_interval_minutes = excluded.refresh_interval_minutes,
      warehouse_code = excluded.warehouse_code,
      warehouse_name = excluded.warehouse_name,
      warehouse_timezone = excluded.warehouse_timezone,
      sync_locked_until = excluded.sync_locked_until,
      sync_lock_token = excluded.sync_lock_token,
      cookie_ciphertext = excluded.cookie_ciphertext,
      cookie_iv = excluded.cookie_iv,
      cookie_expires_at = excluded.cookie_expires_at,
      cookie_updated_at = excluded.cookie_updated_at,
      health = excluded.health,
      last_message = excluded.last_message,
      last_verified_at = excluded.last_verified_at,
      updated_at = excluded.updated_at
  `)
    .bind(
      CONNECTOR_ID,
      connector.baseUrl,
      connector.soSliceId,
      connector.staffSliceId,
      connector.pathTemplate,
      connector.refreshIntervalMinutes,
      connector.warehouseCode,
      connector.warehouseName,
      connector.warehouseTimezone,
      connector.syncLockedUntil,
      connector.syncLockToken,
      connector.cookieCiphertext,
      connector.cookieIv,
      connector.cookieExpiresAt,
      connector.cookieUpdatedAt,
      connector.health,
      connector.lastMessage,
      connector.lastVerifiedAt,
      connector.updatedAt,
    )
    .run();
}

export async function acquireSyncLease() {
  const env = await runtimeBindings();
  if (!env.DB) return { acquired: true, token: "ephemeral" };
  await ensureRuntimeSchema();
  await env.DB.prepare(
    `INSERT INTO sync_connector (id, updated_at)
     VALUES (?1, ?2)
     ON CONFLICT(id) DO NOTHING`,
  )
    .bind(CONNECTOR_ID, new Date().toISOString())
    .run();
  const token = crypto.randomUUID();
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + 5 * 60_000).toISOString();
  await env.DB.prepare(
    `UPDATE sync_connector
        SET sync_locked_until = ?1, sync_lock_token = ?2
      WHERE id = ?3
        AND (sync_locked_until IS NULL OR sync_locked_until <= ?4)`,
  )
    .bind(lockedUntil, token, CONNECTOR_ID, now.toISOString())
    .run();
  const row = await env.DB.prepare(
    "SELECT sync_lock_token FROM sync_connector WHERE id = ?1",
  )
    .bind(CONNECTOR_ID)
    .first<{ sync_lock_token: string | null }>();
  return { acquired: row?.sync_lock_token === token, token };
}

export async function releaseSyncLease(token: string) {
  const env = await runtimeBindings();
  if (!env.DB || token === "ephemeral") return;
  await env.DB.prepare(
    `UPDATE sync_connector
        SET sync_locked_until = NULL, sync_lock_token = NULL
      WHERE id = ?1 AND sync_lock_token = ?2`,
  )
    .bind(CONNECTOR_ID, token)
    .run();
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function environmentCookieSecret() {
  const secret = runtimeEnv("SUPERSET_COOKIE_ENCRYPTION_KEY")?.trim() ?? "";
  return secret.length >= MINIMUM_SECRET_LENGTH ? secret : null;
}

/**
 * A deployment that supplies the key through the environment keeps full
 * control of it. Everything else gets a key generated once and kept in D1, so
 * a self-hosted runtime needs no manual secret and cookies encrypted earlier
 * stay readable across redeploys.
 *
 * Trade-off worth knowing: a generated key lives in the same database as the
 * ciphertext it protects, so anyone who can read that database can read the
 * cookie. Set the environment variable when the key must live elsewhere.
 */
async function cookieSecret() {
  const fromEnvironment = environmentCookieSecret();
  if (fromEnvironment) return fromEnvironment;
  if (generatedSecretCache) return generatedSecretCache;

  const env = await runtimeBindings();
  if (!env.DB) {
    throw new Error(
      "Kunci enkripsi cookie tidak tersedia. Set SUPERSET_COOKIE_ENCRYPTION_KEY minimal 32 karakter, atau sediakan binding D1 agar kunci dapat dibuat otomatis.",
    );
  }
  await ensureRuntimeSchema();

  // Insert-or-ignore then read back. Two first requests racing each other must
  // not each store a different key and leave one of them unable to decrypt.
  await env.DB.prepare(
    "INSERT OR IGNORE INTO runtime_secrets (name, value, created_at) VALUES (?1, ?2, ?3)",
  )
    .bind(
      COOKIE_SECRET_NAME,
      toBase64(crypto.getRandomValues(new Uint8Array(32))),
      new Date().toISOString(),
    )
    .run();

  const row = await env.DB.prepare(
    "SELECT value FROM runtime_secrets WHERE name = ?1",
  )
    .bind(COOKIE_SECRET_NAME)
    .first<{ value: string }>();
  if (!row?.value) {
    throw new Error("Kunci enkripsi cookie gagal disiapkan pada D1.");
  }
  generatedSecretCache = row.value;
  return generatedSecretCache;
}

async function cookieKey() {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(await cookieSecret()),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptCookie(value: string) {
  const key = await cookieKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(value),
  );
  return {
    ciphertext: toBase64(new Uint8Array(encrypted)),
    iv: toBase64(iv),
  };
}

export async function getSessionCookie(connector: StoredConnector) {
  const environmentCookie = runtimeEnv("SUPERSET_SESSION_COOKIE")?.trim();
  if (environmentCookie) return environmentCookie;
  if (!connector.cookieCiphertext || !connector.cookieIv) return "";
  const key = await cookieKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(connector.cookieIv) },
    key,
    fromBase64(connector.cookieCiphertext),
  );
  return new TextDecoder().decode(decrypted);
}

export async function getConnectorPublicConfig(): Promise<ConnectorPublicConfig> {
  const env = await runtimeBindings();
  const connector = await getStoredConnector();
  const expiryTime = connector.cookieExpiresAt
    ? Date.parse(connector.cookieExpiresAt)
    : Number.NaN;
  const cookieExpired =
    Number.isFinite(expiryTime) && expiryTime <= Date.now();
  let lastRun: RunRow | null = null;
  if (env.DB) {
    lastRun = await env.DB.prepare(
      "SELECT started_at, status, message FROM sync_runs ORDER BY started_at DESC LIMIT 1",
    ).first<RunRow>();
  }
  const environmentCookie = Boolean(
    runtimeEnv("SUPERSET_SESSION_COOKIE")?.trim(),
  );
  return {
    baseUrl: connector.baseUrl,
    soSliceId: connector.soSliceId,
    staffSliceId: connector.staffSliceId,
    pathTemplate: connector.pathTemplate,
    refreshIntervalMinutes: connector.refreshIntervalMinutes,
    warehouseCode: connector.warehouseCode,
    warehouseName: connector.warehouseName,
    warehouseTimezone: connector.warehouseTimezone,
    currentMonthOnly: true,
    cookiePresent: environmentCookie || Boolean(connector.cookieCiphertext),
    cookieSource: environmentCookie
      ? "environment"
      : connector.cookieCiphertext
        ? "stored"
        : "none",
    cookieExpiresAt: connector.cookieExpiresAt,
    cookieUpdatedAt: connector.cookieUpdatedAt,
    // Encryption is ready when a key can be obtained, whether it comes from the
    // environment or is generated into D1 on first use.
    encryptionReady: Boolean(environmentCookieSecret()) || Boolean(env.DB),
    encryptionKeySource: environmentCookieSecret()
      ? "environment"
      : env.DB
        ? "generated"
        : "none",
    health: cookieExpired ? "EXPIRED" : connector.health,
    lastMessage: connector.lastMessage,
    lastVerifiedAt: connector.lastVerifiedAt,
    lastRunAt: lastRun?.started_at ?? null,
    lastRunStatus: lastRun?.status ?? null,
    // Kept separate from the connector's lastMessage, which a later save
    // overwrites and which would otherwise erase why a sync failed.
    lastRunMessage: lastRun?.message ?? null,
  };
}

export async function beginSyncRun(
  id: string,
  triggeredBy: string,
  month: string,
) {
  const env = await runtimeBindings();
  if (!env.DB) return;
  await ensureRuntimeSchema();
  await env.DB.prepare(
    `INSERT INTO sync_runs
      (id, started_at, status, triggered_by, month)
     VALUES (?1, ?2, 'RUNNING', ?3, ?4)`,
  )
    .bind(id, new Date().toISOString(), triggeredBy, month)
    .run();
}

export async function finishSyncRun(input: {
  id: string;
  status: "SUCCESS" | "ERROR";
  soRows: number;
  staffRows: number;
  message: string;
  datasetKey?: string;
}) {
  const env = await runtimeBindings();
  if (!env.DB) return;
  await env.DB.prepare(
    `UPDATE sync_runs
        SET finished_at = ?1, status = ?2, so_rows = ?3, staff_rows = ?4,
            dataset_key = ?5, message = ?6
      WHERE id = ?7`,
  )
    .bind(
      new Date().toISOString(),
      input.status,
      input.soRows,
      input.staffRows,
      input.datasetKey ?? null,
      input.message,
      input.id,
    )
    .run();
}

export async function saveDatasetSnapshot(
  dataset: DemoDataset,
  runId: string,
  month: string,
  syncedAt: string,
) {
  const env = await runtimeBindings();
  const payload = JSON.stringify(dataset);
  if (env.SNAPSHOTS) {
    await env.SNAPSHOTS.put(SNAPSHOT_KEY, payload, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { runId, month, syncedAt },
    });
  }
  if (env.DB) {
    await ensureRuntimeSchema();
    const fallbackPayload = payload.length <= 1_500_000 ? payload : null;
    await env.DB.prepare(`
      INSERT INTO dataset_snapshots (
        id, source_date, month, dataset_key, fallback_payload,
        so_rows, staff_rows, synced_at, run_id
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
      ON CONFLICT(id) DO UPDATE SET
        source_date = excluded.source_date,
        month = excluded.month,
        dataset_key = excluded.dataset_key,
        fallback_payload = excluded.fallback_payload,
        so_rows = excluded.so_rows,
        staff_rows = excluded.staff_rows,
        synced_at = excluded.synced_at,
        run_id = excluded.run_id
    `)
      .bind(
        SNAPSHOT_ID,
        dataset.sourceProfile.sourceDate,
        month,
        SNAPSHOT_KEY,
        fallbackPayload,
        dataset.sourceProfile.soRows,
        dataset.sourceProfile.staffRows,
        syncedAt,
        runId,
      )
      .run();
  }
  return SNAPSHOT_KEY;
}

export async function getDatasetSnapshotMetadata(): Promise<SnapshotMetadata | null> {
  const env = await runtimeBindings();
  if (!env.DB) return null;
  await ensureRuntimeSchema();
  const row = await env.DB.prepare(
    "SELECT dataset_key, fallback_payload, synced_at FROM dataset_snapshots WHERE id = ?1",
  )
    .bind(SNAPSHOT_ID)
    .first<SnapshotRow>();
  return row
    ? {
        datasetKey: row.dataset_key,
        fallbackPayload: row.fallback_payload,
        syncedAt: row.synced_at,
      }
    : null;
}

function normalizeDataset(data: DemoDataset): DemoDataset {
  return {
    ...data,
    warehouse: data.warehouse ?? {
      code: "CBT",
      name: "CBT - WH Cibitung",
      timezone: "Asia/Jakarta",
    },
    pickerProductivity: data.pickerProductivity ?? [],
    orders: data.orders.map((order) => ({
      ...order,
      remarks: order.remarks ?? [],
      skuDetails: order.skuDetails ?? [],
    })),
    sourceProfile: {
      ...data.sourceProfile,
      savedChartFilters: data.sourceProfile.savedChartFilters ?? {
        so: [],
        staff: [],
        rejected: [],
      },
    },
  };
}

export async function loadDatasetSnapshot(
  knownMetadata?: SnapshotMetadata | null,
): Promise<{
  data: DemoDataset;
  syncedAt: string;
} | null> {
  const env = await runtimeBindings();
  const metadata =
    knownMetadata === undefined
      ? await getDatasetSnapshotMetadata()
      : knownMetadata;
  const key = metadata?.datasetKey ?? SNAPSHOT_KEY;
  if (env.SNAPSHOTS) {
    const object = await env.SNAPSHOTS.get(key);
    if (object) {
      const data = await object.json<DemoDataset>();
      return {
        data: normalizeDataset(data),
        syncedAt: metadata?.syncedAt ?? new Date().toISOString(),
      };
    }
  }
  if (metadata?.fallbackPayload) {
    const data = JSON.parse(metadata.fallbackPayload) as DemoDataset;
    return {
      data: normalizeDataset(data),
      syncedAt: metadata.syncedAt,
    };
  }
  return null;
}

export async function saveRawExport(
  month: string,
  resource: "so" | "staff",
  body: string,
  contentType: string,
) {
  const env = await runtimeBindings();
  if (!env.SNAPSHOTS) return null;
  const extension = contentType.includes("json") ? "json" : "csv";
  const key = `raw/${month}/${resource}-latest.${extension}`;
  await env.SNAPSHOTS.put(key, body, {
    httpMetadata: { contentType },
    customMetadata: { month, resource, savedAt: new Date().toISOString() },
  });
  return key;
}
