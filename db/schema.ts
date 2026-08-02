import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const syncConnector = sqliteTable("sync_connector", {
  id: text("id").primaryKey().default("primary"),
  baseUrl: text("base_url").notNull().default(""),
  soSliceId: text("so_slice_id").notNull().default(""),
  staffSliceId: text("staff_slice_id").notNull().default(""),
  pathTemplate: text("path_template")
    .notNull()
    .default(
      "/api/v1/chart/{sliceId}/data/?format=json&type=full&force=true",
    ),
  refreshIntervalMinutes: integer("refresh_interval_minutes")
    .notNull()
    .default(5),
  warehouseCode: text("warehouse_code").notNull().default("CBT"),
  warehouseName: text("warehouse_name")
    .notNull()
    .default("CBT - WH Cibitung"),
  warehouseTimezone: text("warehouse_timezone")
    .notNull()
    .default("Asia/Jakarta"),
  syncLockedUntil: text("sync_locked_until"),
  syncLockToken: text("sync_lock_token"),
  cookieCiphertext: text("cookie_ciphertext"),
  cookieIv: text("cookie_iv"),
  cookieExpiresAt: text("cookie_expires_at"),
  cookieUpdatedAt: text("cookie_updated_at"),
  health: text("health").notNull().default("NOT_CONFIGURED"),
  lastMessage: text("last_message"),
  lastVerifiedAt: text("last_verified_at"),
  updatedAt: text("updated_at").notNull(),
});

export const syncRuns = sqliteTable(
  "sync_runs",
  {
    id: text("id").primaryKey(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    status: text("status").notNull(),
    triggeredBy: text("triggered_by").notNull(),
    month: text("month").notNull(),
    soRows: integer("so_rows").notNull().default(0),
    staffRows: integer("staff_rows").notNull().default(0),
    datasetKey: text("dataset_key"),
    message: text("message"),
  },
  (table) => [
    index("sync_runs_started_at_idx").on(table.startedAt),
    index("sync_runs_status_idx").on(table.status),
  ],
);

export const datasetSnapshots = sqliteTable("dataset_snapshots", {
  id: text("id").primaryKey().default("current"),
  sourceDate: text("source_date").notNull(),
  month: text("month").notNull(),
  datasetKey: text("dataset_key").notNull(),
  fallbackPayload: text("fallback_payload"),
  soRows: integer("so_rows").notNull().default(0),
  staffRows: integer("staff_rows").notNull().default(0),
  syncedAt: text("synced_at").notNull(),
  runId: text("run_id").notNull(),
});

/**
 * Routing is configuration, not snapshot data. Keeping it in its own table
 * means a mapping survives a reload, a redeploy, and the period before any
 * Superset sync has ever succeeded.
 */
export const destinationRoutes = sqliteTable("destination_routes", {
  id: text("id").primaryKey(),
  effectiveMonth: text("effective_month").notNull(),
  destinationCode: text("destination_code").notNull(),
  destinationName: text("destination_name").notNull(),
  wave: text("wave").notNull(),
  drop: text("drop_label").notNull(),
  sequence: integer("sequence").notNull().default(0),
  active: integer("active").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
});

// Secrets the deployment generates for itself when the environment supplies
// none. Rows are written once and then read for the lifetime of the database,
// so material encrypted under a generated key stays readable across redeploys.
export const runtimeSecrets = sqliteTable("runtime_secrets", {
  name: text("name").primaryKey(),
  value: text("value").notNull(),
  createdAt: text("created_at").notNull(),
});
