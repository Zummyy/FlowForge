// Shared resolver for the SQLite database path, used by scripts/backup-db.mjs
// and scripts/restore-db.mjs so both operate on exactly the file the app
// uses (and, during tests, on the throwaway copy DATABASE_URL points at).
//
// Prisma resolves relative `file:` URLs against the prisma/ directory, so
// `file:./dev.db` → <repo>/prisma/dev.db.
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");

export function resolveDbPath() {
  const raw = process.env.DATABASE_URL || "file:./dev.db";
  // Strip the scheme and any query string (SQLite allows "file:path?k=v").
  let p = raw.replace(/^file:/, "").split("?")[0];
  if (p.startsWith("//")) p = p.slice(2); // file:///path form
  return path.isAbsolute(p) ? p : path.resolve(ROOT, "prisma", p);
}

/** Directory the backups of `src` live in — next to the DB, `backups/`. */
export function backupsDir(src) {
  return path.join(path.dirname(src), "backups");
}
