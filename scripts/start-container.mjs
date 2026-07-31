/**
 * Container entry point for self-hosted deployments (Docker/Coolify).
 *
 * The Worker reads configuration through Cloudflare bindings, and Wrangler
 * builds those bindings from its own files rather than from the host process
 * environment. Platform-injected variables are therefore materialised into an
 * env file before workerd starts, and local D1 is migrated on every boot.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const wranglerEntry = path.join(
  projectRoot,
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);
const wranglerConfig = path.join(projectRoot, "dist", "server", "wrangler.json");
const stateDirectory =
  process.env.OUTBOUND_STATE_DIR ??
  path.join(projectRoot, ".wrangler", "state");
// Secrets stay outside the persisted volume so they never outlive the
// container that received them.
const runtimeVariablesFile = path.join(os.tmpdir(), "outbound-runtime.vars");
const listenAddress = process.env.HOST ?? "0.0.0.0";
const listenPort = process.env.PORT ?? "3000";

// Only warehouse and connector configuration may cross into the Worker.
// Platform plumbing (PATH, HOSTNAME, COOLIFY_*) must never become a binding.
const RUNTIME_VARIABLE_PREFIXES = ["OUTBOUND_", "SUPERSET_"];
const EXCLUDED_VARIABLES = new Set(["OUTBOUND_STATE_DIR"]);

// Mirrors the minimum enforced by lib/admin-session.ts.
const MINIMUM_ADMIN_TOKEN_LENGTH = 32;

// Mirrors the minimum environment documented in README.
const EXPECTED_VARIABLES = [
  "OUTBOUND_ADMIN_EMAILS",
  "OUTBOUND_ALLOW_ANONYMOUS_READ",
  "OUTBOUND_WAREHOUSE_CODE",
  "OUTBOUND_WAREHOUSE_NAME",
  "OUTBOUND_WAREHOUSE_TIMEZONE",
  "SUPERSET_ALLOWED_HOSTS",
  "SUPERSET_COOKIE_ENCRYPTION_KEY",
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!existsSync(wranglerConfig)) {
  fail(
    `Build tidak ditemukan pada ${wranglerConfig}. Image harus dibuat melalui build stage yang menjalankan \`npm run build\`.`,
  );
}

if (!existsSync(wranglerEntry)) {
  fail(
    "Wrangler tidak ada di node_modules. Image harus menyalin node_modules dari build stage.",
  );
}

try {
  mkdirSync(stateDirectory, { recursive: true });
  accessSync(stateDirectory, constants.W_OK);
} catch {
  fail(
    `Direktori state ${stateDirectory} tidak bisa ditulis. Pasang volume Docker pada /data dan pastikan pemiliknya uid 1000 (user \`node\`).`,
  );
}

// Values stay out of the log. Only names are printed so an operator can see
// which variables reached the container without exposing cookie or key.
const runtimeVariables = Object.entries(process.env)
  .filter(
    ([name, value]) =>
      typeof value === "string" &&
      value.length > 0 &&
      !EXCLUDED_VARIABLES.has(name) &&
      RUNTIME_VARIABLE_PREFIXES.some((prefix) => name.startsWith(prefix)),
  )
  .sort(([left], [right]) => left.localeCompare(right));

function toEnvFileLine([name, value]) {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
  return `${name}="${escaped}"`;
}

writeFileSync(
  runtimeVariablesFile,
  `${runtimeVariables.map(toEnvFileLine).join("\n")}\n`,
  { mode: 0o600 },
);

console.log(
  `Runtime variable untuk Worker: ${
    runtimeVariables.length > 0
      ? runtimeVariables.map(([name]) => name).join(", ")
      : "(kosong)"
  }`,
);

const missingVariables = EXPECTED_VARIABLES.filter(
  (name) => !runtimeVariables.some(([present]) => present === name),
);

if (missingVariables.length > 0) {
  console.warn(
    `Peringatan: variable minimum belum diset: ${missingVariables.join(", ")}.`,
  );
}

// Without platform auth the token is the only way to become admin, and a token
// that is absent or too short disables sign-in silently. Saying so at start-up
// keeps that from surfacing later as an unexplained 401 in the workspace.
const adminToken = process.env.OUTBOUND_ADMIN_TOKEN?.trim() ?? "";
const platformAuthTrusted =
  process.env.OUTBOUND_TRUST_PLATFORM_AUTH?.trim().toLowerCase() !== "false";

if (!platformAuthTrusted && adminToken.length < MINIMUM_ADMIN_TOKEN_LENGTH) {
  console.warn(
    adminToken.length === 0
      ? "Peringatan: OUTBOUND_ADMIN_TOKEN belum diset. Masuk admin nonaktif, sehingga Simpan koneksi dan sync manual akan ditolak 401."
      : `Peringatan: OUTBOUND_ADMIN_TOKEN hanya ${adminToken.length} karakter, minimal ${MINIMUM_ADMIN_TOKEN_LENGTH}. Masuk admin tetap nonaktif sampai diperbaiki.`,
  );
}

if (process.env.OUTBOUND_ALLOW_LOCAL_ADMIN?.trim().toLowerCase() === "true") {
  console.warn(
    "Peringatan: OUTBOUND_ALLOW_LOCAL_ADMIN aktif. Jangan dipakai pada deployment production.",
  );
}

const configuration = JSON.parse(readFileSync(wranglerConfig, "utf8"));
const database = configuration.d1_databases?.[0];

if (!database?.binding) {
  fail("Binding D1 tidak ada pada dist/server/wrangler.json.");
}

// The build generates `migrations_dir`, so the path is read back instead of
// assumed. The Dockerfile copies drizzle/*.sql to the directory it resolves to.
const migrationsDirectory = path.resolve(
  path.dirname(wranglerConfig),
  database.migrations_dir ?? "migrations",
);

if (
  !existsSync(migrationsDirectory) ||
  readdirSync(migrationsDirectory).filter((entry) => entry.endsWith(".sql"))
    .length === 0
) {
  fail(
    `Folder migration ${migrationsDirectory} kosong atau tidak ada. Salin drizzle/*.sql ke path tersebut saat build image.`,
  );
}

const migration = spawnSync(
  process.execPath,
  [
    wranglerEntry,
    "d1",
    "migrations",
    "apply",
    database.binding,
    "--local",
    "--persist-to",
    stateDirectory,
    "--config",
    wranglerConfig,
  ],
  { cwd: projectRoot, env: process.env, stdio: "inherit" },
);

if (migration.status !== 0) {
  fail(
    "Migration D1 lokal gagal. Runtime tidak dijalankan agar schema tidak dipakai setengah jadi.",
  );
}

const child = spawn(
  process.execPath,
  [
    wranglerEntry,
    "dev",
    "--config",
    wranglerConfig,
    "--local",
    "--ip",
    listenAddress,
    "--port",
    listenPort,
    "--persist-to",
    stateDirectory,
    "--env-file",
    runtimeVariablesFile,
    "--show-interactive-dev-session=false",
    ...process.argv.slice(2),
  ],
  { cwd: projectRoot, env: process.env, stdio: "inherit" },
);

// Coolify stops containers with `docker stop --timeout=30`, so the signal is
// forwarded and workerd is given the chance to close its state cleanly.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Wrangler berhenti karena signal ${signal}.`);
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(`Wrangler gagal dimulai: ${error.message}`);
  process.exit(1);
});
