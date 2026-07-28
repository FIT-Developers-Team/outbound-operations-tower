import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const clientRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dist/client",
);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const assets = {
  async fetch(request) {
    const pathname = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, "");
    const filename = path.resolve(clientRoot, pathname);
    if (!filename.startsWith(`${clientRoot}${path.sep}`)) {
      return new Response("Forbidden", { status: 403 });
    }
    try {
      const body = await readFile(filename);
      return new Response(body, {
        headers: {
          "content-type":
            contentTypes[path.extname(filename)] ?? "application/octet-stream",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  },
};

async function render(pathname = "/", init = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html", ...(init.headers ?? {}) },
      ...init,
    }),
    { ASSETS: assets },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the outbound assignment hub", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");

  const html = await response.text();
  assert.match(html, /CBT Outbound Operations Hub/i);
  assert.match(html, /Ringkasan outbound/i);
  assert.match(html, /Request vs selesai pick/i);
  assert.doesNotMatch(html, /Spatial operations|spatial-hero/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("rejects unauthenticated live reads and commands", async () => {
  const readResponse = await render("/api/outbound?resource=overview");
  assert.equal(readResponse.status, 401);
  assert.match(await readResponse.text(), /AUTH_REQUIRED/);

  const commandResponse = await render("/api/outbound/command", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "checkerReset", route_key: "RT-01" }),
  });
  assert.equal(commandResponse.status, 401);
  assert.match(await commandResponse.text(), /AUTH_REQUIRED/);
});

test("server-renders every operational area", async () => {
  const routes = [
    ["/planning", /Pool assignment/i],
    ["/zones", /Detail zona/i],
    ["/people", /Roster picker/i],
    ["/orders", /Index SO/i],
    ["/checker", /Route checker/i],
    ["/reports", /Kualitas sumber/i],
    ["/settings", /Koneksi Superset/i],
    ["/guide", /Alur kerja/i],
  ];

  for (const [pathname, expected] of routes) {
    const response = await render(pathname);
    assert.equal(response.status, 200, pathname);
    assert.match(await response.text(), expected, pathname);
  }
});

test("production package contains every referenced CSS and JavaScript asset", async () => {
  const response = await render("/");
  const html = await response.text();
  const paths = [
    ...new Set(
      [...html.matchAll(/(?:href|src)="([^"]+\.(?:css|js))"/g)].map(
        (match) => match[1],
      ),
    ),
  ];
  assert.ok(paths.length > 0, "expected rendered HTML to reference assets");
  for (const assetPath of paths) {
    const assetResponse = await assets.fetch(
      new Request(`http://localhost${assetPath}`),
    );
    assert.equal(assetResponse.status, 200, assetPath);
    assert.match(
      assetResponse.headers.get("content-type") ?? "",
      /text\/(?:css|javascript)/,
      assetPath,
    );
  }
});
