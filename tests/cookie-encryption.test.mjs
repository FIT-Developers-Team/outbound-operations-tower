import assert from "node:assert/strict";
import test from "node:test";

const ADMIN_EMAIL = "supervisor@example.com";
const ADMIN_TOKEN = "0123456789abcdef0123456789abcdef";
const SECRET_NAME = "superset_cookie_encryption_key";

process.env.OUTBOUND_ADMIN_EMAILS = ADMIN_EMAIL;
process.env.OUTBOUND_ADMIN_TOKEN = ADMIN_TOKEN;
process.env.OUTBOUND_TRUST_PLATFORM_AUTH = "false";
process.env.SUPERSET_ALLOWED_HOSTS = "dash.example.com";
delete process.env.SUPERSET_COOKIE_ENCRYPTION_KEY;

const assets = {
  async fetch() {
    return new Response("Not found", { status: 404 });
  },
};

// Enough of the D1 surface for the secret store. Everything the connector
// writes is accepted and ignored; only runtime_secrets is modelled, because
// that is what these assertions are about.
const CONNECTOR_COLUMNS = [
  "id",
  "base_url",
  "so_slice_id",
  "staff_slice_id",
  "path_template",
  "refresh_interval_minutes",
  "warehouse_code",
  "warehouse_name",
  "warehouse_timezone",
  "sync_locked_until",
  "sync_lock_token",
  "cookie_ciphertext",
  "cookie_iv",
  "cookie_expires_at",
  "cookie_updated_at",
  "health",
  "last_message",
  "last_verified_at",
  "updated_at",
];

function createDatabase() {
  const secrets = new Map();

  function statement(sql, params) {
    return {
      bind: (...next) => statement(sql, next),
      async run() {
        if (sql.includes("INSERT OR IGNORE INTO runtime_secrets")) {
          const [name, value] = params ?? [];
          if (!secrets.has(name)) secrets.set(name, value);
        }
        return { success: true };
      },
      async first() {
        if (sql.includes("FROM runtime_secrets")) {
          const value = secrets.get((params ?? [])[0]);
          return value ? { value } : null;
        }
        return null;
      },
      async all() {
        return sql.includes("PRAGMA table_info")
          ? { results: CONNECTOR_COLUMNS.map((name) => ({ name })) }
          : { results: [] };
      },
    };
  }

  return {
    secrets,
    prepare: (sql) => statement(sql),
    async batch(statements) {
      for (const item of statements) await item.run();
      return [];
    },
  };
}

let invocation = 0;

async function call(pathname, init, database) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set(
    "test",
    `${process.pid}-${Date.now()}-${(invocation += 1)}`,
  );
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://outbound.example.com${pathname}`, init),
    { ASSETS: assets, DB: database },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

async function signedInCookie(database) {
  const response = await call(
    "/api/outbound/session",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: ADMIN_EMAIL, token: ADMIN_TOKEN }),
    },
    database,
  );
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

function saveConnector(cookie, database) {
  return call(
    "/api/outbound/config",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        baseUrl: "https://dash.example.com",
        soSliceId: "21208",
        staffSliceId: "21218",
        cookie: "session=contoh-cookie-superset",
        warehouseCode: "CBT",
        warehouseName: "CBT - WH Cibitung",
        warehouseTimezone: "Asia/Jakarta",
      }),
    },
    database,
  );
}

test("a missing encryption key no longer blocks saving the connector", async () => {
  const database = createDatabase();
  const cookie = await signedInCookie(database);

  const response = await saveConnector(cookie, database);

  assert.equal(response.status, 200);
  assert.equal(database.secrets.size, 1);
  assert.ok(
    (database.secrets.get(SECRET_NAME) ?? "").length >= 32,
    "expected a generated key of at least 32 characters",
  );
});

test("the generated key is stored once and reused afterwards", async () => {
  const database = createDatabase();
  const cookie = await signedInCookie(database);

  await saveConnector(cookie, database);
  const first = database.secrets.get(SECRET_NAME);
  await saveConnector(cookie, database);

  assert.equal(database.secrets.size, 1);
  assert.equal(database.secrets.get(SECRET_NAME), first);
});

test("an environment key takes precedence and stores nothing", async () => {
  process.env.SUPERSET_COOKIE_ENCRYPTION_KEY =
    "kunci-environment-yang-cukup-panjang-32";
  try {
    const database = createDatabase();
    const cookie = await signedInCookie(database);

    const response = await saveConnector(cookie, database);

    assert.equal(response.status, 200);
    assert.equal(database.secrets.size, 0);
  } finally {
    delete process.env.SUPERSET_COOKIE_ENCRYPTION_KEY;
  }
});
