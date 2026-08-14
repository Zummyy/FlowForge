// ─── DB-primary sync helpers ──────────────────────────────────────────────
// Pages that are backed by the Prisma server actions follow the same pattern:
//   1. On mount, load from the DB via a server action.
//   2. If the server is unavailable, fall back to a localStorage cache.
//   3. Every write goes to the server AND is mirrored into the cache, so the
//      UI keeps working offline and the cache doubles as a migration source
//      for data that existed before the backend was wired up.

export function loadCache<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveCache(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota errors — cache is best-effort */
  }
}

/**
 * Load data from the DB via `loader`, caching the result. If the DB call
 * throws (server/DB down), fall back to the cache. Returns `fallback` when
 * neither source has data.
 */
export async function fetchDbOrCache<T>(
  key: string,
  loader: () => Promise<T | null | undefined>,
  fallback: T
): Promise<T> {
  try {
    const db = await loader();
    if (db != null) {
      saveCache(key, db);
      return db;
    }
  } catch {
    /* DB unavailable — fall through to the cache */
  }
  return loadCache(key, fallback);
}

/**
 * Fire-and-forget write to the DB with an offline fallback. Returns true when
 * the write reached the server (or there was nothing to write).
 */
export async function tryDbWrite<T>(write: () => Promise<T>): Promise<boolean> {
  try {
    await write();
    return true;
  } catch {
    return false;
  }
}
