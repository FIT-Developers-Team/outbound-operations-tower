/**
 * Dependency audit gate.
 *
 * `npm audit --omit=dev` was the previous gate and it reported a clean tree
 * while five high-severity undici advisories sat in the code that actually
 * serves production: scripts/serve.mjs boots Miniflare, and Miniflare arrives
 * through the dev tree. The audit therefore has to cover every installed
 * package, not the subset npm labels as runtime.
 *
 * Auditing everything is only sustainable if triaged findings can be recorded,
 * so this reads scripts/audit-allowlist.json. An allowlist that never expires
 * is just a slower blindfold, so an entry fails the build once it is past its
 * review date, and an entry that no longer matches any live advisory fails too
 * rather than lingering after the dependency was fixed.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const THRESHOLD = process.env.AUDIT_THRESHOLD ?? "high";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const allowlistPath = path.join(projectRoot, "scripts", "audit-allowlist.json");

function runAudit() {
  try {
    // npm exits non-zero whenever it finds anything, so the report is read from
    // stdout either way and only a missing/unparsable report is a real failure.
    // A fixed command string rather than execFileSync with an args array:
    // npm is a .cmd shim on Windows, which Node refuses to spawn without a
    // shell, and passing an args array through a shell is deprecated. Nothing
    // here is interpolated, so there is no argument to escape.
    return execSync("npm audit --json", {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (caught) {
    if (caught.stdout) return caught.stdout;
    throw caught;
  }
}

const report = JSON.parse(runAudit());
const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));
const today = new Date().toISOString().slice(0, 10);

// One row per (package, advisory) so an allowlist entry can name exactly what
// it tolerates instead of muting a package wholesale.
const findings = [];
for (const [name, entry] of Object.entries(report.vulnerabilities ?? {})) {
  if (RANK[entry.severity] < RANK[THRESHOLD]) continue;
  const advisories = (entry.via ?? []).filter(
    (via) => typeof via === "object" && via.url,
  );
  if (!advisories.length) {
    // Purely transitive: the package is flagged only because something it
    // depends on is. The dependency itself is reported separately.
    continue;
  }
  for (const advisory of advisories) {
    findings.push({
      package: name,
      severity: entry.severity,
      id: advisory.url.split("/").pop(),
      title: advisory.title,
      url: advisory.url,
    });
  }
}

const allowed = allowlist.allow ?? [];
const matched = new Set();
const problems = [];
const unresolved = [];

for (const finding of findings) {
  const rule = allowed.find(
    (candidate) =>
      candidate.package === finding.package &&
      candidate.advisories.includes(finding.id),
  );
  if (!rule) {
    unresolved.push(finding);
    continue;
  }
  matched.add(`${rule.package}|${finding.id}`);
  if (!rule.reviewOn || rule.reviewOn < today) {
    problems.push(
      `${rule.package} ${finding.id}: pengecualian audit sudah lewat tanggal tinjau (${rule.reviewOn ?? "tidak diisi"}). Tinjau ulang atau perbarui tanggalnya.`,
    );
  }
}

for (const rule of allowed) {
  const stale = rule.advisories.filter(
    (id) => !matched.has(`${rule.package}|${id}`),
  );
  if (stale.length === rule.advisories.length) {
    problems.push(
      `${rule.package}: pengecualian audit untuk ${stale.join(", ")} tidak lagi cocok dengan temuan apa pun. Hapus entri ini dari scripts/audit-allowlist.json.`,
    );
  }
}

if (unresolved.length) {
  console.error(
    `\nTemuan audit ${THRESHOLD}+ yang belum ditriase (${unresolved.length}):\n`,
  );
  for (const finding of unresolved) {
    console.error(`  ${finding.severity.padEnd(8)} ${finding.package}`);
    console.error(`           ${finding.title}`);
    console.error(`           ${finding.url}\n`);
  }
  console.error(
    "Perbaiki dependensinya, atau catat pengecualian beralasan di scripts/audit-allowlist.json.\n",
  );
}

if (problems.length) {
  console.error(`Masalah pada daftar pengecualian (${problems.length}):\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("");
}

if (unresolved.length || problems.length) process.exit(1);

const tolerated = findings.length;
console.log(
  tolerated
    ? `Audit bersih pada ambang ${THRESHOLD}: ${tolerated} temuan sudah ditriase di scripts/audit-allowlist.json.`
    : `Audit bersih pada ambang ${THRESHOLD}: tidak ada temuan.`,
);
