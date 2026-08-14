#!/usr/bin/env node
// Restore a backup created by scripts/backup-db.mjs (or `npm run db:backup`).
//
//   npm run db:restore                 → newest backup in <db-dir>/backups/
//   npm run db:restore -- <path>       → a specific backup file
//
// Overwrites the live database — refuses to run without `--yes`. The journal
// siblings of the CURRENT db are removed first, then the backup set is copied
// back (main file + its -wal/-shm/-journal if the snapshot had any).
//
// ⚠️ Stop the dev server first: a running process holding the DB open may
// overwrite the restored files with its own next write.
import { copyFileSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { resolveDbPath, backupsDir, ROOT } from "./db-path.mjs";

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const explicit = args.find((a) => a !== "--yes");

const dest = resolveDbPath();
const dir = backupsDir(dest);

let backup = explicit;
if (!backup) {
  // Newest by modification time — the filenames only sort correctly when
  // every backup shares the same prefix (e.g. dev-<timestamp>.db).
  const candidates = readdirSync(dir)
    .filter((f) => f.endsWith(".db"))
    .map((f) => path.join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (candidates.length === 0) {
    console.error(`✗ No backups found in ${path.relative(ROOT, dir)}.`);
    console.error(`  Create one with: npm run db:backup`);
    process.exit(1);
  }
  backup = candidates[0];
}

if (!existsSync(backup)) {
  console.error(`✗ Backup not found: ${backup}`);
  process.exit(1);
}

if (!yes) {
  console.error(`This would OVERWRITE ${path.relative(ROOT, dest)} with:`);
  console.error(`  ${path.relative(ROOT, backup)}`);
  console.error(`Re-run with --yes to confirm (stop the dev server first!).`);
  process.exit(1);
}

// Drop the CURRENT journal siblings so a stale -wal/-shm can't mix with the
// restored main file.
for (const suffix of ["", "-wal", "-shm", "-journal"]) {
  rmSync(dest + suffix, { force: true });
}
// Copy the backup set back over the target.
let restored = 0;
for (const suffix of ["", "-wal", "-shm", "-journal"]) {
  const f = backup + suffix;
  if (existsSync(f)) {
    copyFileSync(f, dest + suffix);
    restored++;
  }
}

console.log(`✅ Restored ${path.relative(ROOT, dest)} from ${path.relative(ROOT, backup)} (${restored} file(s)).`);
console.log(`   Restart the dev server to pick up the restored data.`);
