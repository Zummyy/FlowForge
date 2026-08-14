import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// WAL journaling: SQLite keeps readers + a single writer working concurrently
// without whole-file locks (dev server, seed, studio tools and tests can run
// side by side). journal_mode is PERSISTENT in the database file, so this
// only needs to succeed once per database — fire-and-forget, and the next
// boot retries if the DB was busy (e.g. another process mid-switch).
// $queryRawUnsafe (not $executeRawUnsafe): PRAGMA journal_mode returns a
// result row, which $executeRaw rejects on SQLite (P2010).
prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL").catch(() => {});
