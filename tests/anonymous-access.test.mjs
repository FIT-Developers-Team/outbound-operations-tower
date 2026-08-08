import assert from "node:assert/strict";
import test from "node:test";

// The permissive setting on purpose: these assertions are about what stays
// closed even when a deployment has deliberately opened reads.
process.env.OUTBOUND_ALLOW_ANONYMOUS_READ = "true";
process.env.OUTBOUND_ALLOW_LOCAL_ADMIN = "false";
process.env.OUTBOUND_TRUST_PLATFORM_AUTH = "false";
process.env.OUTBOUND_ADMIN_EMAILS = "supervisor@example.com";

const assets = {
  async fetch() {
    return new Response("Not found", { status: 404 });
  },
};

let invocation = 0;

async function call(pathname, init = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set(
    "test",
    `${process.pid}-${Date.now()}-${(invocation += 1)}`,
  );
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://outbound.example.com${pathname}`, init),
    { ASSETS: assets },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

function sync(mode) {
  return call("/api/outbound/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode }),
  });
}

test("anonymous read reaches the snapshot lookup rather than the auth gate", async () => {
  const response = await call("/api/outbound?resource=overview");

  // No D1 or R2 binding is attached here, so the request runs out of snapshot
  // rather than out of permission. Anything but 401 proves the read was let in.
  assert.equal(response.status, 503);
  assert.match(await response.text(), /LIVE_SNAPSHOT_NOT_READY/);
});

test("anonymous auto sync is refused even while reads are open", async () => {
  const response = await sync("auto");

  assert.equal(response.status, 401);
  assert.match(await response.text(), /AUTH_REQUIRED/);
});

test("anonymous manual sync is refused even while reads are open", async () => {
  const response = await sync("manual");

  assert.equal(response.status, 401);
  assert.match(await response.text(), /AUTH_REQUIRED/);
});

test("a sync body with no mode is treated as manual and still refused", async () => {
  const response = await call("/api/outbound/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });

  assert.equal(response.status, 401);
});

test("anonymous writes stay refused", async () => {
  const response = await call("/api/outbound/command", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "anon-attempt-000001",
    },
    body: JSON.stringify({ action: "checkerReset", routeId: "CHK-1" }),
  });

  assert.equal(response.status, 401);
  assert.match(await response.text(), /AUTH_REQUIRED/);
});

test("anonymous connector changes stay refused", async () => {
  const response = await call("/api/outbound/config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });

  assert.equal(response.status, 401);
  assert.match(await response.text(), /AUTH_REQUIRED/);
});
