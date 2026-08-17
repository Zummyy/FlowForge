#!/usr/bin/env node
// ─── Orphaned recording sweep ─────────────────────────────────────────
// Removes recordings that no longer have both halves of their contract:
//
//   • FILE WITHOUT ROW — a file under uploads/recordings/ whose takeId has
//     no Recording row. Happens after a crashed write (file flushed, row
//     upsert failed) or a manual DB edit. Nothing serves it — getRecording
//     requires the row — so it is pure dead weight.
//   • ROW WITHOUT FILE — a Recording row whose file is gone from disk
//     (e.g. the file was pruned by hand). The GET route 404s anyway, so the
//     row is a broken reference and can go.
//
// What is NOT swept: a row+file pair with no project referencing it. A take
// can live in the live Studio session mirror (localStorage) before the
// project is ever saved, so row+file pairs are always kept.
//
// Usage:
//   npm run sweep:recordings          # delete orphans
//   npm run sweep:recordings -- --dry-run   # report only, delete nothing
//
// The DB is resolved exactly like the app (DATABASE_URL, default prisma/
// dev.db), so the same script works on the real DB or an isolated copy.
import { PrismaClient } from "@prisma/client";
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDbPath, ROOT } from "./db-path.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const recDir = path.join(ROOT, "uploads", "recordings");
const dryRun = process.argv.includes("--dry-run");

/** A take id is the file name minus its extension (ids are [A-Za-z0-9_-]). */
const takeIdFromFile = (f) => f.replace(/\.[^.]+$/, "");

async function main() {
  const dbPath = resolveDbPath();
  const client = new PrismaClient({
    datasources: { db: { url: "file:" + dbPath.replace(/\\/g, "/") } },
  });

  let removedFiles = 0;
  let removedRows = 0;

  // ── 1. Files without rows ─────────────────────────────────────────
  if (existsSync(recDir)) {
    for (const f of readdirSync(recDir)) {
      if (f.startsWith(".")) continue;
      const takeId = takeIdFromFile(f);
      const row = await client.recording.findUnique({ where: { takeId } });
      if (row) continue;
      const full = path.join(recDir, f);
      if (dryRun) {
        console.log(`  • would remove orphaned file: uploads/recordings/${f}`);
      } else {
        rmSync(full, { force: true });
        console.log(`  ✂ removed orphaned file: uploads/recordings/${f}`);
      }
      removedFiles++;
    }
  }

  // ── 2. Rows without files ─────────────────────────────────────────
  const rows = await client.recording.findMany();
  for (const row of rows) {
    if (existsSync(path.join(recDir, row.fileName))) continue;
    if (dryRun) {
      console.log(`  • would remove broken row: ${row.takeId} (${row.fileName} missing)`);
    } else {
      await client.recording.delete({ where: { takeId: row.takeId } });
      console.log(`  ✂ removed broken row: ${row.takeId} (${row.fileName} missing)`);
    }
    removedRows++;
  }

  await client.$disconnect().catch(() => {});
  console.log(
    `${dryRun ? "DRY-RUN — nothing deleted. " : ""}${removedFiles} orphaned file(s), ${removedRows} broken row(s).`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
