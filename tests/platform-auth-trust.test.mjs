import assert from "node:assert/strict";
import test from "node:test";

const ADMIN_EMAIL = "supervisor@example.com";

process.env.OUTBOUND_ADMIN_EMAILS = ADMIN_EMAIL;
// Kept out of the way so a rejection here is always about the identity header
// and never about a localhost bypass or an available token sign-in.
process.env.OUTBOUND_ADMIN_TOKEN = "";
process.env.OUTBOUND_ALLOW_LOCAL_ADMIN = "false";
process.env.OUTBOUND_ALLOW_ANONYMOUS_READ = "false";

const assets = {
  async fetch() {
    return new Response("Not found", { status: 404 });
  },
};

let invocation = 0;

// A non-local host keeps the localhost admin bypass out of these assertions.
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

// Reaching config validation proves a request cleared both the 401 auth gate
// and the 403 admin gate, so a 400 here means the identity was accepted.
function saveConnector(headers) {
  return call("/api/outbound/config", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: "{}",
  });
}

function withTrust(value, body) {
  const previous = process.env.OUTBOUND_TRUST_PLATFORM_AUTH;
  if (value === undefined) delete process.env.OUTBOUND_TRUST_PLATFORM_AUTH;
  else process.env.OUTBOUND_TRUST_PLATFORM_AUTH = value;
  return (async () => {
    try {
      return await body();
    } finally {
      if (previous === undefined) {
        delete process.env.OUTBOUND_TRUST_PLATFORM_AUTH;
      } else {
        process.env.OUTBOUND_TRUST_PLATFORM_AUTH = previous;
      }
    }
  })();
}

test("an unset trust variable refuses the identity header", () =>
  withTrust(undefined, async () => {
    const response = await saveConnector({
      "oai-authenticated-user-email": ADMIN_EMAIL,
    });

    assert.equal(response.status, 401);
    assert.match(await response.text(), /AUTH_REQUIRED/);
  }));

test("the rejection names the variable that decides it", () =>
  withTrust(undefined, async () => {
    const response = await saveConnector({
      "oai-authenticated-user-email": ADMIN_EMAIL,
    });
    const payload = await response.json();

    assert.match(payload.message, /OUTBOUND_TRUST_PLATFORM_AUTH/);
  }));

test("only the literal true opts in, not other truthy spellings", async () => {
  for (const value of ["1", "yes", "on", "false", ""]) {
    const status = await withTrust(value, async () => {
      const response = await saveConnector({
        "oai-authenticated-user-email": ADMIN_EMAIL,
      });
      return response.status;
    });

    assert.equal(status, 401, `trust=${JSON.stringify(value)} must not grant admin`);
  }
});

test("an explicit true accepts the header as identity", () =>
  withTrust("true", async () => {
    const response = await saveConnector({
      "oai-authenticated-user-email": ADMIN_EMAIL,
    });

    assert.equal(response.status, 400);
    assert.match(await response.text(), /INVALID_CONFIG/);
  }));

test("trust is case-insensitive and tolerates surrounding whitespace", () =>
  withTrust("  TRUE  ", async () => {
    const response = await saveConnector({
      "oai-authenticated-user-email": ADMIN_EMAIL,
    });

    assert.equal(response.status, 400);
  }));

test("an address outside the allowlist stays out even when trust is on", () =>
  withTrust("true", async () => {
    const response = await saveConnector({
      "oai-authenticated-user-email": "intruder@example.com",
    });

    assert.equal(response.status, 403);
    assert.match(await response.text(), /ADMIN_REQUIRED/);
  }));

test("a header that is not shaped like an address is discarded", () =>
  withTrust("true", async () => {
    for (const value of ["not-an-email", "a@b", `${"x".repeat(320)}@e.com`]) {
      const response = await saveConnector({
        "oai-authenticated-user-email": value,
      });

      assert.equal(
        response.status,
        401,
        `${value.slice(0, 24)} must not be read as an identity`,
      );
    }
  }));
