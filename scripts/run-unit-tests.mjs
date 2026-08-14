#!/usr/bin/env node
// ─── Unit test runner ───────────────────────────────────────────────────
// Runs every scripts/test-*.ts suite in one process chain (sequentially, so
// test-db-wiring's isolated DB copy never overlaps another suite). Cross-
// platform: spawns `npx tsx <file>` via the shell, aggregating the exit
// codes. Exits non-zero when any suite fails.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const suites = readdirSync(__dirname)
  .filter((f) => /^test-.*\.ts$/.test(f))
  .sort();

if (suites.length === 0) {
  console.error("No unit suites found in scripts/ (test-*.ts)");
  process.exit(1);
}

let failed = 0;
for (const suite of suites) {
  const file = path.join(__dirname, suite);
  console.log(`\n=== ${suite} ===`);
  // JSON.stringify quotes the path — safe in both cmd.exe and bash.
  const r = spawnSync(`npx tsx ${JSON.stringify(file)}`, { stdio: "inherit", shell: true });
  if (r.status !== 0) failed++;
}

console.log(`\n${suites.length - failed}/${suites.length} unit suites passed`);
process.exit(failed === 0 ? 0 : 1);
