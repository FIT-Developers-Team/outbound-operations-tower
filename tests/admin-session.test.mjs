import assert from "node:assert/strict";
import test from "node:test";

const ADMIN_EMAIL = "supervisor@example.com";
const ADMIN_TOKEN = "0123456789abcdef0123456789abcdef";

process.env.OUTBOUND_ADMIN_EMAILS = ADMIN_EMAIL;
process.env.OUTBOUND_ADMIN_TOKEN = ADMIN_TOKEN;
process.env.OUTBOUND_TRUST_PLATFORM_AUTH = "false";

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

function signIn(body) {
  return call("/api/outbound/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function saveConnector(headers) {
  return call("/api/outbound/config", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: "{}",
  });
}

test("identity header alone cannot grant admin without a platform proxy", async () => {
  const response = await saveConnector({
    "oai-authenticated-user-email": ADMIN_EMAIL,
  });

  assert.equal(response.status, 401);
  assert.match(await response.text(), /AUTH_REQUIRED/);
});

test("sign-in answers wrong token and wrong email identically", async () => {
  const wrongToken = await signIn({
    email: ADMIN_EMAIL,
    token: "z".repeat(ADMIN_TOKEN.length),
  });
  const wrongEmail = await signIn({
    email: "intruder@example.com",
    token: ADMIN_TOKEN,
  });

  assert.equal(wrongToken.status, 401);
  assert.equal(wrongEmail.status, 401);
  assert.deepEqual(await wrongToken.json(), await wrongEmail.json());
});

test("sign-in issues an HttpOnly session cookie that grants admin", async () => {
  const response = await signIn({ email: ADMIN_EMAIL, token: ADMIN_TOKEN });
  assert.equal(response.status, 200);

  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /outbound_admin_session=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=strict/i);

  // Reaching config validation proves the request passed both the 401 and the
  // 403 gate, so the cookie was accepted as an admin identity.
  const saved = await saveConnector({ cookie: setCookie.split(";")[0] });
  assert.equal(saved.status, 400);
  assert.match(await saved.text(), /INVALID_CONFIG/);
});

test("a forged session cookie is rejected", async () => {
  const payload = Buffer.from(
    JSON.stringify({
      email: ADMIN_EMAIL,
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString("base64url");
  const signature = Buffer.from("not-a-valid-signature").toString("base64url");

  const response = await saveConnector({
    cookie: `outbound_admin_session=${payload}.${signature}`,
  });

  assert.equal(response.status, 401);
  assert.match(await response.text(), /AUTH_REQUIRED/);
});

test("an expired session cookie stops granting admin", async () => {
  const response = await signIn({ email: ADMIN_EMAIL, token: ADMIN_TOKEN });
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
  const [name, value] = cookie.split("=");
  const [, signature] = value.split(".");
  const expired = Buffer.from(
    JSON.stringify({
      email: ADMIN_EMAIL,
      exp: Math.floor(Date.now() / 1000) - 60,
    }),
  ).toString("base64url");

  const saved = await saveConnector({
    cookie: `${name}=${expired}.${signature}`,
  });

  assert.equal(saved.status, 401);
});

test("sign-out clears the session cookie", async () => {
  const response = await call("/api/outbound/session", { method: "DELETE" });

  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/i);
});

test("a token below the minimum length keeps sign-in disabled", async () => {
  process.env.OUTBOUND_ADMIN_TOKEN = "too-short";
  try {
    const response = await signIn({ email: ADMIN_EMAIL, token: "too-short" });
    assert.equal(response.status, 503);
    assert.match(await response.text(), /SIGNIN_DISABLED/);
  } finally {
    process.env.OUTBOUND_ADMIN_TOKEN = ADMIN_TOKEN;
  }
});
