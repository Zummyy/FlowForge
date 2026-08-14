// Backup the SQLite database BEFORE a destructive reset, so `db:reset` is
// reversible. Resolves the DB from DATABASE_URL (default prisma/dev.db) and
// snapshots it into `<db-dir>/backups/dev-<timestamp>.db`.
//
// It also PREPARES the source for `prisma db push --force-reset`: a WAL-mode
// database whose -wal/-shm siblings are missing (SQLite removes them on a
// clean close) makes the schema engine report „database disk image is
// malformed” on Windows. So we flush the WAL and switch the source to
// DELETE journal mode — after that the main file alone is complete and push
// works. The copy then includes whatever journal files remain (usually just
// the main file), so the snapshot is complete either way. The seed re-asserts
// WAL mode after the reset.
//
// Exits 0 with a notice when there is no database yet, so `db:reset` on a
// fresh clone (no dev.db) still proceeds to create + seed it.
import { PrismaClient } from "@prisma/client";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { resolveDbPath, backupsDir, ROOT } from "./db-path.mjs";

async function main() {
  const src = resolveDbPath();

  if (!existsSync(src)) {
    console.log(`ℹ️  No database at ${path.relative(ROOT, src)} — nothing to back up.`);
    return;
  }

  // ── Flush + switch the source out of WAL mode (best-effort) ─────────
  // wal_checkpoint(TRUNCATE) flushes un-checkpointed commits into the main
  // file; journal_mode=DELETE then converts the file and removes the
  // -wal/-shm siblings, so the main file alone is complete AND the upcoming
  // `db push --force-reset` can describe it. If the DB is busy (the dev
  // server is writing), we fall through and copy the sibling set instead.
  try {
    const client = new PrismaClient();
    await client.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
    await client.$queryRawUnsafe("PRAGMA journal_mode=DELETE");
    await client.$disconnect().catch(() => {});
  } catch {
    /* best-effort — the set copy below is still consistent */
  }

  const outDir = backupsDir(src);
  mkdirSync(outDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = path.basename(src).replace(/\.db$/, "");
  const dest = path.join(outDir, `${base}-${stamp}.db`);

  const copied: string[] = [];
  let bytes = 0;
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const f = src + suffix;
    if (existsSync(f)) {
      copyFileSync(f, dest + suffix);
      copied.push(path.basename(f));
      bytes += statSync(f).size;
    }
  }

  const kb = Math.max(1, Math.round(bytes / 1024));
  console.log(`💾 Backup: ${path.relative(ROOT, dest)} (${kb} kB — ${copied.join(", ")})`);
  console.log(`   Restore with: npm run db:restore -- "${dest}"`);

  // ── Integrity check on the snapshot ────────────────────────────────
  // A copy taken mid-write (e.g. the dev server is checkpointing) can be
  // torn — SQLite then reports „database disk image is malformed” on restore.
  // Verify the backup opens cleanly and warn loudly instead of silently
  // shipping a corrupt snapshot.
  try {
    const check = new PrismaClient({
      datasources: { db: { url: "file:" + dest.replace(/\\/g, "/") } },
    });
    const rows = await check.$queryRawUnsafe<Array<{ integrity_check: string }>>(
      "PRAGMA integrity_check"
    );
    await check.$disconnect().catch(() => {});
    if (rows[0]?.integrity_check !== "ok") {
      console.warn(
        `⚠️  Backup integrity check FAILED (${rows[0]?.integrity_check ?? "unknown"}). The dev server may be writing right now — stop it and re-run db:backup.`
      );
    }
  } catch {
    /* the backup may still be restorable; the warning above covers the usual case */
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
