import type {
  ConnectorPublicConfig,
  DemoDataset,
  DestinationRule,
  SyncHealth,
} from "./outbound-types";
import { runtimeEnv } from "./runtime-env.ts";

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
const SIGN_IN_WINDOW_MS = 15 * 60_000;
const SIGN_IN_MAX_FAILURES = 8;
const memorySignInAttempts = new Map<
  string,
  { failures: number; windowStart: number; blockedUntil: number }
>();

/**
 * CSV names each column once instead of repeating it on every row, which for a
 * wide export is the difference between a month that fits the runtime and one
 * that does not. A path the operator typed themselves is left alone.
 */
function normalizeExportPath(pathTemplate: string | null | undefined) {
  const path = pathTemplate?.trim();
  const preferred =
    runtimeEnv("SUPERSET_EXPORT_FORMAT")?.trim().toLowerCase() === "json"
      ? DEFAULT_PATH
      : LEGACY_CSV_PATH;
  if (!path || path === LEGACY_CSV_PATH || path === DEFAULT_PATH) {
    return preferred;
  }
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
  source_synced_at: string | null;
  synced_at: string;
  run_id: string;
  version: number;
};

export type SnapshotMetadata = {
  datasetKey: string;
  fallbackPayload: string | null;
  sourceSyncedAt: string;
  syncedAt: string;
  runId: string;
  version: number;
};

type CommandReceiptRow = {
  action: string;
  actor: string;
  status: "RUNNING" | "SUCCESS" | "ERROR";
  message: string | null;
};

export class SnapshotConflictError extends Error {
  constructor() {
    super("Snapshot berubah saat command diproses. Muat ulang data lalu coba lagi.");
    this.name = "SnapshotConflictError";
  }
}

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

type DestinationRouteRow = {
  id: string;
  effective_month: string;
  destination_code: string;
  destination_name: string;
  wave: string;
  drop_label: string;
  sequence: number;
  active: number;
};

/**
 * Routing mappings, kept outside the snapshot so they outlive it. They are
 * read on every dataset request, including while the workspace is still on
 * sample data because no sync has succeeded yet.
 */
export async function getDestinationRoutes(): Promise<DestinationRule[]> {
  const env = await runtimeBindings();
  if (!env.DB) return [];
  await ensureRuntimeSchema();
  const rows = await env.DB.prepare(
    `SELECT id, effective_month, destination_code, destination_name, wave,
            drop_label, sequence, active
       FROM destination_routes
      ORDER BY sequence, destination_code`,
  ).all<DestinationRouteRow>();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    effectiveMonth: row.effective_month,
    destinationCode: row.destination_code,
    destinationName: row.destination_name,
    wave: row.wave,
    drop: row.drop_label,
    sequence: row.sequence,
    active: row.active !== 0,
  }));
}

export async function getDestinationRoutesVersion() {
  const env = await runtimeBindings();
  if (!env.DB) return null;
  await ensureRuntimeSchema();
  const row = await env.DB.prepare(
    "SELECT MAX(updated_at) AS updated_at FROM destination_routes",
  ).first<{ updated_at: string | null }>();
  return row?.updated_at ?? null;
}

export async function saveDestinationRoutes(rules: DestinationRule[]) {
  const env = await runtimeBindings();
  if (!env.DB || !rules.length) return false;
  await ensureRuntimeSchema();
  const now = new Date().toISOString();
  await env.DB.batch(
    rules.map((rule) =>
      env.DB!.prepare(
        `INSERT INTO destination_routes
           (id, effective_month, destination_code, destination_name, wave,
            drop_label, sequence, active, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
           effective_month = excluded.effective_month,
           destination_code = excluded.destination_code,
           destination_name = excluded.destination_name,
           wave = excluded.wave,
           drop_label = excluded.drop_label,
           sequence = excluded.sequence,
           active = excluded.active,
           updated_at = excluded.updated_at`,
      ).bind(
        rule.id,
        rule.effectiveMonth,
        rule.destinationCode.toUpperCase(),
        rule.destinationName,
        rule.wave,
        rule.drop,
        rule.sequence,
        rule.active ? 1 : 0,
        now,
      ),
    ),
  );
  return true;
}

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

/**
 * The single definition of the D1 schema.
 *
 * A parallel set of Drizzle migrations used to be generated from db/schema.ts
 * and packaged into the build, which meant a Sites deployment applied those at
 * deploy time while a self-hosted one only ever ran the statements below. The
 * two had already drifted — this function creates destination_routes_code_idx
 * and the migrations never did — so a database's shape depended on which path
 * had deployed it. The migrations are gone; this is what runs everywhere.
 *
 * Adding a column: extend the CREATE TABLE for new databases, then add a
 * PRAGMA-guarded ALTER below it so existing ones catch up. Both are needed.
 */
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
      CREATE TABLE IF NOT EXISTS destination_routes (
        id TEXT PRIMARY KEY NOT NULL,
        effective_month TEXT NOT NULL,
        destination_code TEXT NOT NULL,
        destination_name TEXT NOT NULL,
        wave TEXT NOT NULL,
        drop_label TEXT NOT NULL,
        sequence INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      )
    `),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS destination_routes_code_idx ON destination_routes (destination_code)",
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
        source_synced_at TEXT,
        synced_at TEXT NOT NULL,
        run_id TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS command_receipts (
        idempotency_key TEXT PRIMARY KEY NOT NULL,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT,
        created_at TEXT NOT NULL,
        finished_at TEXT
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS sign_in_attempts (
        key TEXT PRIMARY KEY NOT NULL,
        failures INTEGER NOT NULL DEFAULT 0,
        window_start TEXT NOT NULL,
        blocked_until TEXT,
        updated_at TEXT NOT NULL
      )
    `),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS sign_in_attempts_updated_at_idx ON sign_in_attempts (updated_at)",
    ),
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
  const snapshotInfo = await db
    .prepare("PRAGMA table_info(dataset_snapshots)")
    .all<{ name: string }>();
  const snapshotColumns = new Set(
    (snapshotInfo.results ?? []).map((column) => column.name),
  );
  if (!snapshotColumns.has("source_synced_at")) {
    await db
      .prepare("ALTER TABLE dataset_snapshots ADD COLUMN source_synced_at TEXT")
      .run();
    await db
      .prepare(
        "UPDATE dataset_snapshots SET source_synced_at = synced_at WHERE source_synced_at IS NULL",
      )
      .run();
  }
  if (!snapshotColumns.has("version")) {
    await db
      .prepare(
        "ALTER TABLE dataset_snapshots ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
      )
      .run();
  }
  return true;
}

export async function claimCommand(
  idempotencyKey: string,
  action: string,
  actor: string,
) {
  const env = await runtimeBindings();
  if (!env.DB) return { acquired: true, receipt: null };
  await ensureRuntimeSchema();
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60_000).toISOString();
  await env.DB.prepare("DELETE FROM command_receipts WHERE created_at < ?1")
    .bind(cutoff)
    .run();
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO command_receipts
       (idempotency_key, action, actor, status, created_at)
     VALUES (?1, ?2, ?3, 'RUNNING', ?4)`,
  )
    .bind(idempotencyKey, action, actor, new Date().toISOString())
    .run();
  if ((result.meta?.changes ?? 0) === 1) {
    return { acquired: true, receipt: null };
  }
  const receipt = await env.DB.prepare(
    `SELECT action, actor, status, message
       FROM command_receipts WHERE idempotency_key = ?1`,
  )
    .bind(idempotencyKey)
    .first<CommandReceiptRow>();
  return { acquired: false, receipt: receipt ?? null };
}

export async function finishCommand(
  idempotencyKey: string,
  status: "SUCCESS" | "ERROR",
  message: string,
) {
  const env = await runtimeBindings();
  if (!env.DB) return;
  await env.DB.prepare(
    `UPDATE command_receipts
        SET status = ?1, message = ?2, finished_at = ?3
      WHERE idempotency_key = ?4`,
  )
    .bind(status, message, new Date().toISOString(), idempotencyKey)
    .run();
}

export async function checkSignInThrottle(keys: string[]) {
  const uniqueKeys = [...new Set(keys)];
  const now = Date.now();
  const env = await runtimeBindings();
  let retryAfterSeconds = 0;

  if (!env.DB) {
    uniqueKeys.forEach((key) => {
      const attempt = memorySignInAttempts.get(key);
      if (!attempt) return;
      if (attempt.blockedUntil > now) {
        retryAfterSeconds = Math.max(
          retryAfterSeconds,
          Math.ceil((attempt.blockedUntil - now) / 1_000),
        );
      } else if (now - attempt.windowStart >= SIGN_IN_WINDOW_MS) {
        memorySignInAttempts.delete(key);
      }
    });
    return { allowed: retryAfterSeconds === 0, retryAfterSeconds };
  }

  await ensureRuntimeSchema();
  for (const key of uniqueKeys) {
    const row = await env.DB.prepare(
      "SELECT blocked_until FROM sign_in_attempts WHERE key = ?1",
    )
      .bind(key)
      .first<{ blocked_until: string | null }>();
    const blockedUntil = row?.blocked_until
      ? Date.parse(row.blocked_until)
      : Number.NaN;
    if (Number.isFinite(blockedUntil) && blockedUntil > now) {
      retryAfterSeconds = Math.max(
        retryAfterSeconds,
        Math.ceil((blockedUntil - now) / 1_000),
      );
    }
  }
  return { allowed: retryAfterSeconds === 0, retryAfterSeconds };
}

export async function recordSignInFailure(keys: string[]) {
  const uniqueKeys = [...new Set(keys)];
  const now = Date.now();
  const env = await runtimeBindings();

  if (!env.DB) {
    uniqueKeys.forEach((key) => {
      const previous = memorySignInAttempts.get(key);
      const current =
        !previous || now - previous.windowStart >= SIGN_IN_WINDOW_MS
          ? { failures: 1, windowStart: now, blockedUntil: 0 }
          : { ...previous, failures: previous.failures + 1 };
      if (current.failures >= SIGN_IN_MAX_FAILURES) {
        current.blockedUntil = now + SIGN_IN_WINDOW_MS;
      }
      memorySignInAttempts.set(key, current);
    });
    return;
  }

  await ensureRuntimeSchema();
  const nowIso = new Date(now).toISOString();
  const cutoffIso = new Date(now - SIGN_IN_WINDOW_MS).toISOString();
  const blockedUntilIso = new Date(now + SIGN_IN_WINDOW_MS).toISOString();
  await env.DB.batch(
    uniqueKeys.map((key) =>
      env.DB!.prepare(`
        INSERT INTO sign_in_attempts
          (key, failures, window_start, blocked_until, updated_at)
        VALUES (?1, 1, ?2, NULL, ?2)
        ON CONFLICT(key) DO UPDATE SET
          failures = CASE
            WHEN sign_in_attempts.window_start < ?3 THEN 1
            ELSE sign_in_attempts.failures + 1
          END,
          window_start = CASE
            WHEN sign_in_attempts.window_start < ?3 THEN ?2
            ELSE sign_in_attempts.window_start
          END,
          blocked_until = CASE
            WHEN sign_in_attempts.window_start < ?3 THEN NULL
            WHEN sign_in_attempts.failures + 1 >= ${SIGN_IN_MAX_FAILURES} THEN ?4
            ELSE sign_in_attempts.blocked_until
          END,
          updated_at = ?2
      `).bind(key, nowIso, cutoffIso, blockedUntilIso),
    ),
  );
}

export async function clearSignInFailures(keys: string[]) {
  const uniqueKeys = [...new Set(keys)];
  const env = await runtimeBindings();
  if (!env.DB) {
    uniqueKeys.forEach((key) => memorySignInAttempts.delete(key));
    return;
  }
  await ensureRuntimeSchema();
  await env.DB.batch(
    uniqueKeys.map((key) =>
      env.DB!.prepare("DELETE FROM sign_in_attempts WHERE key = ?1").bind(key),
    ),
  );
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
  options: {
    expectedVersion?: number | null;
    sourceSyncedAt?: string;
  } = {},
) {
  const env = await runtimeBindings();
  const payload = JSON.stringify(dataset);
  const sourceSyncedAt = options.sourceSyncedAt ?? syncedAt;
  const datasetKey = env.DB
    ? `snapshots/${encodeURIComponent(runId)}.json`
    : SNAPSHOT_KEY;
  if (env.SNAPSHOTS) {
    await env.SNAPSHOTS.put(datasetKey, payload, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { runId, month, syncedAt },
    });
  }
  if (env.DB) {
    await ensureRuntimeSchema();
    const fallbackPayload = payload.length <= 1_500_000 ? payload : null;
    const previous = await getDatasetSnapshotMetadata();
    let result: D1Result;
    if (!previous && options.expectedVersion == null) {
      result = await env.DB.prepare(`
        INSERT OR IGNORE INTO dataset_snapshots (
          id, source_date, month, dataset_key, fallback_payload,
          so_rows, staff_rows, source_synced_at, synced_at, run_id, version
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1)
      `)
        .bind(
          SNAPSHOT_ID,
          dataset.sourceProfile.sourceDate,
          month,
          datasetKey,
          fallbackPayload,
          dataset.sourceProfile.soRows,
          dataset.sourceProfile.staffRows,
          sourceSyncedAt,
          syncedAt,
          runId,
        )
        .run();
    } else {
      const expectedVersion = options.expectedVersion ?? previous?.version;
      if (!expectedVersion) throw new SnapshotConflictError();
      result = await env.DB.prepare(`
        UPDATE dataset_snapshots
           SET source_date = ?1, month = ?2, dataset_key = ?3,
               fallback_payload = ?4, so_rows = ?5, staff_rows = ?6,
               source_synced_at = ?7, synced_at = ?8, run_id = ?9,
               version = version + 1
         WHERE id = ?10 AND version = ?11
      `)
        .bind(
          dataset.sourceProfile.sourceDate,
          month,
          datasetKey,
          fallbackPayload,
          dataset.sourceProfile.soRows,
          dataset.sourceProfile.staffRows,
          sourceSyncedAt,
          syncedAt,
          runId,
          SNAPSHOT_ID,
          expectedVersion,
        )
        .run();
    }
    if ((result.meta?.changes ?? 0) !== 1) {
      if (env.SNAPSHOTS && datasetKey !== SNAPSHOT_KEY) {
        await env.SNAPSHOTS.delete(datasetKey).catch(() => undefined);
      }
      throw new SnapshotConflictError();
    }
    if (
      env.SNAPSHOTS &&
      previous?.datasetKey &&
      previous.datasetKey !== SNAPSHOT_KEY &&
      previous.datasetKey !== datasetKey
    ) {
      await env.SNAPSHOTS.delete(previous.datasetKey).catch(() => undefined);
    }
  }
  return {
    datasetKey,
    fallbackPayload: payload.length <= 1_500_000 ? payload : null,
    sourceSyncedAt,
    syncedAt,
    runId,
    version: (options.expectedVersion ?? 0) + 1,
  } satisfies SnapshotMetadata;
}

export async function getDatasetSnapshotMetadata(): Promise<SnapshotMetadata | null> {
  const env = await runtimeBindings();
  if (!env.DB) return null;
  await ensureRuntimeSchema();
  const row = await env.DB.prepare(
    `SELECT dataset_key, fallback_payload, source_synced_at, synced_at,
            run_id, version
       FROM dataset_snapshots WHERE id = ?1`,
  )
    .bind(SNAPSHOT_ID)
    .first<SnapshotRow>();
  return row
    ? {
        datasetKey: row.dataset_key,
        fallbackPayload: row.fallback_payload,
        sourceSyncedAt: row.source_synced_at ?? row.synced_at,
        syncedAt: row.synced_at,
        runId: row.run_id,
        version: row.version || 1,
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
      // A snapshot written before assignment provenance existed carries no
      // marker. Reading those as SOURCE keeps the first sync after this deploy
      // from resurrecting an assignment the export had legitimately retracted.
      // The cost is that assignments staged in the minutes before the deploy
      // are still dropped once, which is the old behaviour rather than a new
      // one. An unassigned order resolves to null either way.
      assignmentSource:
        order.assignmentSource ?? (order.pickerId ? "SOURCE" : null),
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
  stateUpdatedAt: string;
  datasetKey: string;
  version: number;
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
        syncedAt: metadata?.sourceSyncedAt ?? new Date().toISOString(),
        stateUpdatedAt: metadata?.syncedAt ?? new Date().toISOString(),
        datasetKey: key,
        version: metadata?.version ?? 0,
      };
    }
  }
  if (metadata?.fallbackPayload) {
    const data = JSON.parse(metadata.fallbackPayload) as DemoDataset;
    return {
      data: normalizeDataset(data),
      syncedAt: metadata.sourceSyncedAt,
      stateUpdatedAt: metadata.syncedAt,
      datasetKey: key,
      version: metadata.version,
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
