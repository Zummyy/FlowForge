// ─── Isolated DB copy (side-effect module) ─────────────────────────────
// Imported FIRST by scripts/test-db-wiring.ts so process.env.DATABASE_URL
// points at a throwaway copy of prisma/dev.db BEFORE any server action
// module constructs its PrismaClient (src/lib/prisma.ts does so eagerly at
// module load — import order is what makes the override stick).
//
// The wiring test clears whole tables for deterministic assertions; on the
// copy that is harmless, and cleanupIsolatedDb() deletes the copy in a
// finally block. The real prisma/dev.db is never opened.
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC_DB = path.join(ROOT, "prisma", "dev.db");

if (!existsSync(SRC_DB)) {
  throw new Error(
    `prisma/dev.db not found at ${SRC_DB} — run the dev server once or "npm run db:push" first`
  );
}

let isolatedDbFiles: string[] = [];

const dest = path.join(
  tmpdir(),
  `flowforge-wiring-db-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`
);
for (const suffix of ["", "-wal", "-shm", "-journal"]) {
  const f = SRC_DB + suffix;
  if (existsSync(f)) {
    copyFileSync(f, dest + suffix);
    isolatedDbFiles.push(dest + suffix);
  }
}
// Absolute, forward-slashed path so Prisma opens exactly this file.
process.env.DATABASE_URL = "file:" + dest.replace(/\\/g, "/");
console.log(`  • isolated DB copy: ${dest}`);

export async function cleanupIsolatedDb(): Promise<void> {
  for (const f of isolatedDbFiles) {
    // Windows may hold the file a moment after the last query — retry.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        rmSync(f, { force: true });
        break;
      } catch {
        if (attempt === 4) {
          console.error(`  (warn) could not remove ${f}`);
        } else {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
    }
  }
  isolatedDbFiles = [];
}
