import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
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
const localVariables = path.join(projectRoot, ".dev.vars");

if (!existsSync(wranglerConfig)) {
  console.error("Build belum tersedia. Jalankan `npm run build` terlebih dahulu.");
  process.exit(1);
}

if (!existsSync(localVariables)) {
  console.error(
    "File .dev.vars belum tersedia. Salin .dev.vars.example menjadi .dev.vars.",
  );
  process.exit(1);
}

const child = spawn(
  process.execPath,
  [
    wranglerEntry,
    "dev",
    "--config",
    wranglerConfig,
    "--local",
    "--env-file",
    localVariables,
    ...process.argv.slice(2),
  ],
  {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  },
);

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
