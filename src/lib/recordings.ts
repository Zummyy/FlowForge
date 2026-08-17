// ─── Durable Studio take recordings ─────────────────────────────────────
// Audio bytes live on disk under uploads/recordings/ (gitignored); the
// Recording table is the DB-primary index (takeId → file). Route handlers
// (src/app/api/recordings) stream the body in/out; this module keeps the
// file + DB logic in one place so unit tests can exercise it directly with
// an isolated database and a throwaway directory.

import { mkdir, writeFile, unlink, access } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";

/** Default on-disk location: <project>/uploads/recordings/. */
export function recordingsDir(): string {
  return path.join(process.cwd(), "uploads", "recordings");
}

/**
 * Restrict take ids to a safe character set — they become file names, so
 * anything else (path separators, "..", …) is rejected outright.
 */
export function sanitizeTakeId(takeId: string): string | null {
  return /^[A-Za-z0-9_-]{1,64}$/.test(takeId) ? takeId : null;
}

/** Map a MIME type to a file extension (defaults to webm). */
export function extensionForMime(mimeType: string): string {
  const mime = (mimeType || "").split(";")[0].trim().toLowerCase();
  if (mime === "audio/ogg") return "ogg";
  if (mime === "audio/mp4" || mime === "audio/m4a") return "m4a";
  if (mime === "audio/mpeg") return "mp3";
  if (mime === "audio/wav" || mime === "audio/x-wav") return "wav";
  return "webm";
}

export interface RecordingFileMeta {
  takeId: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  size: number;
}

/**
 * Persist a recording: write the bytes to disk (replacing any previous file
 * for the same take) and upsert the Recording row. Idempotent per takeId —
 * re-saving the same take simply overwrites the file and keeps one row.
 */
export async function saveRecording(opts: {
  takeId: string;
  mimeType: string;
  data: Buffer;
  /** Overridable for tests — defaults to uploads/recordings/. */
  dir?: string;
}): Promise<RecordingFileMeta> {
  const takeId = sanitizeTakeId(opts.takeId);
  if (!takeId) throw new Error(`Invalid take id: ${opts.takeId}`);
  const dir = opts.dir ?? recordingsDir();
  await mkdir(dir, { recursive: true });
  const mimeType = opts.mimeType || "audio/webm";
  const fileName = `${takeId}.${extensionForMime(mimeType)}`;
  const filePath = path.join(dir, fileName);
  await writeFile(filePath, opts.data);
  await prisma.recording.upsert({
    where: { takeId },
    create: { takeId, fileName, mimeType, size: opts.data.length },
    update: { fileName, mimeType, size: opts.data.length },
  });
  return { takeId, fileName, filePath, mimeType, size: opts.data.length };
}

/** Row + on-disk path for a take, or null when the recording is unknown. */
export async function getRecording(
  takeId: string,
  dir: string = recordingsDir()
): Promise<
  | (RecordingFileMeta & { duration: number | null; createdAt: Date })
  | null
> {
  const safe = sanitizeTakeId(takeId);
  if (!safe) return null;
  const row = await prisma.recording.findUnique({ where: { takeId: safe } });
  if (!row) return null;
  const filePath = path.join(dir, row.fileName);
  try {
    await access(filePath);
  } catch {
    // Row without a file — treat as missing (the file may have been pruned).
    return null;
  }
  return {
    takeId: row.takeId,
    fileName: row.fileName,
    filePath,
    mimeType: row.mimeType,
    size: row.size ?? 0,
    duration: row.duration,
    createdAt: row.createdAt,
  };
}

/**
 * Collect the take ids a saved-project payload references — every take with
 * a durable `audioUrl` of the form `/api/recordings/<takeId>`. Legacy takes
 * store a base64 `dataUrl` (no server file) and are skipped. Pure (no I/O),
 * so tests can assert on it directly; `deleteProject` uses it to prune a
 * project's recordings when the project is deleted.
 */
export function collectRecordingTakeIds(payloadJson: string): string[] {
  let parsed: { takes?: unknown[] };
  try {
    parsed = JSON.parse(payloadJson) as { takes?: unknown[] };
  } catch {
    return [];
  }
  const takes = Array.isArray(parsed?.takes) ? parsed.takes : [];
  const ids = new Set<string>();
  for (const t of takes) {
    const audioUrl = (t as { audioUrl?: unknown } | null)?.audioUrl;
    if (typeof audioUrl !== "string") continue;
    const m = audioUrl.match(/\/api\/recordings\/([A-Za-z0-9_-]{1,64})/);
    if (m && sanitizeTakeId(m[1])) ids.add(m[1]);
  }
  return [...ids];
}

/**
 * Remove a recording: delete the file (if any) and the row. Safe no-op when
 * the take was never uploaded.
 */
export async function deleteRecording(
  takeId: string,
  dir: string = recordingsDir()
): Promise<boolean> {
  const safe = sanitizeTakeId(takeId);
  if (!safe) return false;
  const row = await prisma.recording.findUnique({ where: { takeId: safe } });
  if (row) {
    await prisma.recording.delete({ where: { takeId: safe } });
    await unlink(path.join(dir, row.fileName)).catch(() => {
      /* file already gone — fine */
    });
    return true;
  }
  return false;
}
