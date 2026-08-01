/**
 * Production server for self-hosted deployments.
 *
 * `wrangler dev` is a development harness: it watches files, runs an inspector,
 * and keeps a dev registry alive. None of that is wanted on a VPS, so this
 * boots the same runtime (workerd, through Miniflare) directly and nothing
 * else. Binding shapes are read from the generated Wrangler config so a build
 * change cannot silently drift from what is served.
 */
import {
  existsSync,
  mkdirSync,
  accessSync,
  constants,
  readdirSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const serverDirectory = path.join(projectRoot, "dist", "server");
const configPath = path.join(serverDirectory, "wrangler.json");
const stateDirectory =
  process.env.OUTBOUND_STATE_DIR ??
  path.join(projectRoot, ".wrangler", "state");
const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);

// Only warehouse and connector configuration crosses into the Worker. Platform
// plumbing (PATH, HOSTNAME, COOLIFY_*) must never become a binding.
const VARIABLE_PREFIXES = ["OUTBOUND_", "SUPERSET_"];
const EXCLUDED_VARIABLES = new Set([
  "OUTBOUND_STATE_DIR",
  "OUTBOUND_TRUST_PLATFORM_AUTH",
]);
const MINIMUM_SECRET_LENGTH = 32;

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!existsSync(configPath)) {
  fail(`Build tidak ditemukan pada ${configPath}. Jalankan \`npm run build\`.`);
}

try {
  mkdirSync(stateDirectory, { recursive: true });
  accessSync(stateDirectory, constants.W_OK);
} catch {
  fail(
    `Direktori state ${stateDirectory} tidak bisa ditulis. Pasang volume pada /data dengan pemilik uid 1000.`,
  );
}

const config = JSON.parse(readFileSync(configPath, "utf8"));

const bindings = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name, value]) =>
      typeof value === "string" &&
      value.length > 0 &&
      !EXCLUDED_VARIABLES.has(name) &&
      VARIABLE_PREFIXES.some((prefix) => name.startsWith(prefix)),
  ),
);

// Read by lib/request-auth.ts. A reverse proxy forwards client headers
// verbatim, so the Sites identity header is never proof of identity here.
bindings.OUTBOUND_TRUST_PLATFORM_AUTH =
  process.env.OUTBOUND_TRUST_PLATFORM_AUTH ?? "false";

const adminToken = process.env.OUTBOUND_ADMIN_TOKEN?.trim() ?? "";
// The localhost bypass still grants admin without a token, so saying the
// request will be refused would be wrong on a developer machine.
const localAdmin =
  process.env.OUTBOUND_ALLOW_LOCAL_ADMIN?.trim().toLowerCase() === "true";
if (
  bindings.OUTBOUND_TRUST_PLATFORM_AUTH === "false" &&
  adminToken.length < MINIMUM_SECRET_LENGTH
) {
  const reason =
    adminToken.length === 0
      ? "OUTBOUND_ADMIN_TOKEN belum diset"
      : `OUTBOUND_ADMIN_TOKEN hanya ${adminToken.length} karakter, minimal ${MINIMUM_SECRET_LENGTH}`;
  console.warn(
    localAdmin
      ? `Peringatan: ${reason}. Admin hanya berlaku lewat hostname localhost karena OUTBOUND_ALLOW_LOCAL_ADMIN aktif; lewat domain akan ditolak 401.`
      : `Peringatan: ${reason}. Masuk admin nonaktif, sehingga Simpan koneksi dan sync manual akan ditolak 401.`,
  );
}

const encryptionKey = process.env.SUPERSET_COOKIE_ENCRYPTION_KEY?.trim() ?? "";
if (encryptionKey.length > 0 && encryptionKey.length < MINIMUM_SECRET_LENGTH) {
  console.warn(
    `Peringatan: SUPERSET_COOKIE_ENCRYPTION_KEY hanya ${encryptionKey.length} karakter, minimal ${MINIMUM_SECRET_LENGTH}. Kunci tersimpan di D1 dipakai sebagai gantinya.`,
  );
}

console.log(
  `Binding variable: ${Object.keys(bindings).sort().join(", ") || "(kosong)"}`,
);

// Wrangler nests local state under `v3/`. Keeping that layout means an existing
// volume carries over unchanged.
const persistRoot = path.join(stateDirectory, "v3");

// The server bundle reaches its route chunks through dynamic import, which
// Miniflare cannot follow statically, so every emitted module is registered up
// front. The entry point has to come first; Miniflare treats it as the Worker.
function collectModules(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectModules(entryPath);
    return /\.m?js$/.test(entry.name) ? [entryPath] : [];
  });
}

const entryPath = path.join(serverDirectory, config.main);
const modules = [
  entryPath,
  ...collectModules(serverDirectory).filter((file) => file !== entryPath),
].map((file) => ({
  type: "ESModule",
  path: file,
  contents: readFileSync(file),
}));

const miniflare = new Miniflare({
  modules,
  modulesRoot: serverDirectory,
  compatibilityDate: config.compatibility_date,
  compatibilityFlags: config.compatibility_flags ?? [],
  bindings,
  d1Databases: Object.fromEntries(
    (config.d1_databases ?? []).map((database) => [
      database.binding,
      database.database_id ?? database.database_name,
    ]),
  ),
  r2Buckets: (config.r2_buckets ?? []).map((bucket) => bucket.binding),
  assets: {
    directory: path.resolve(serverDirectory, config.assets.directory),
    binding: "ASSETS",
    // Without this the asset router answers 404 for anything it cannot find on
    // disk instead of handing the request to the Worker that renders pages.
    routerConfig: { has_user_worker: true },
  },
  d1Persist: path.join(persistRoot, "d1"),
  r2Persist: path.join(persistRoot, "r2"),
  kvPersist: path.join(persistRoot, "kv"),
  cachePersist: path.join(persistRoot, "cache"),
  host,
  port,
  liveReload: false,
  unsafeInspectorProxy: false,
});

await miniflare.ready;

// 0.0.0.0 is a bind address, not one a browser can open. Printing it sends
// people to `localhost`, which on Windows resolves to ::1 first and can reach
// a different process that holds the same port on IPv6.
const reachableHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
console.log(`Siap pada http://${reachableHost}:${port} (bind ${host})`);

let closing = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    void miniflare.dispose().then(() => process.exit(0));
  });
}
