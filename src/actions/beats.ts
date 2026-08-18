"use server";

import { prisma } from "@/lib/prisma";
import { collectRecordingTakeIds, deleteRecording } from "@/lib/recordings";
import type { SavedProject } from "../components/studio/types";

// ─── Saved Studio projects („Gotowe Numery” library) ──────────────────
// DB-primary with a localStorage mirror (flowforge-beats) as the offline
// cache — same pattern as the moodboard / release plan.

export async function saveProject(data: SavedProject) {
  const row = await prisma.savedProject.create({
    data: { title: data.title, data: JSON.stringify(data) },
  });
  // Return the payload with the stable DB id adopted — the caller mirrors
  // this back into localStorage so offline reloads keep the same ids.
  return { ...data, id: row.id, dbId: row.id };
}

export async function getProjects() {
  const rows = await prisma.savedProject.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map((r) => {
    try {
      const parsed = JSON.parse(r.data) as SavedProject;
      // `sourceId` = the project's original client id (proj-…), kept so the
      // /beats page can dedupe legacy localStorage entries against DB rows.
      // `createdAt` drives the „Data” sort on /beats.
      return {
        ...parsed,
        id: r.id,
        dbId: r.id,
        title: r.title,
        sourceId: parsed.id,
        createdAt: r.createdAt.toISOString(),
      };
    } catch {
      return null;
    }
  }).filter((p): p is NonNullable<typeof p> => p !== null);
}

export async function deleteProject(id: string, recordingsDirOverride?: string) {
  // The project's takes may point at durable recordings (/api/recordings/<takeId>
  // → file in uploads/ + Recording row). Studio's deleteTake already prunes a
  // take's recording, but deleting the whole PROJECT would otherwise leave
  // those files and rows behind forever — so collect every referenced take id
  // from the payload and prune each one (best-effort: a missing/broken
  // recording must never block the project deletion).
  const row = await prisma.savedProject.findUnique({ where: { id } });
  if (row) {
    for (const takeId of collectRecordingTakeIds(row.data)) {
      await deleteRecording(takeId, recordingsDirOverride).catch(() => {});
    }
  }
  // Unknown id → the underlying delete throws P2025 exactly as before.
  return prisma.savedProject.delete({ where: { id } });
}

// The dashboard „Ostatnio zapisane projekty” tile — lightweight rows (no full
// payload): title + take count (parsed from the stored JSON) + DB createdAt.
export async function getRecentProjects(limit = 5) {
  const rows = await prisma.savedProject.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((r) => {
    let takeCount = 0;
    try {
      const parsed = JSON.parse(r.data) as { takes?: unknown[] };
      takeCount = Array.isArray(parsed.takes) ? parsed.takes.length : 0;
    } catch {
      /* payload not parseable — the row just shows its title */
    }
    return { id: r.id, title: r.title, takeCount, createdAt: r.createdAt.toISOString() };
  });
}

// ─── Beats CRUD ───────────────────────────────────────────────────────

export async function createBeat(data: {
  title: string;
  artist?: string;
  bpm: number;
  key?: string;
  genre?: string;
  tags?: string[];
  duration?: number;
  filePath?: string;
  isStems?: boolean;
  stemsData?: Record<string, string>;
}) {
  return prisma.beat.create({
    data: {
      title: data.title,
      artist: data.artist,
      bpm: data.bpm,
      key: data.key,
      genre: data.genre,
      tags: data.tags?.join(","),
      duration: data.duration,
      filePath: data.filePath,
      isStems: data.isStems || false,
      stemsData: data.stemsData ? JSON.stringify(data.stemsData) : null,
      // Uploading a beat counts as using it — it lands in the recent list.
      lastPlayedAt: new Date(),
    },
  });
}

/** The most recently PLAYED beats (Beat.lastPlayedAt) — real history. */
export async function getRecentlyPlayedBeats(limit = 5) {
  return prisma.beat.findMany({
    where: { lastPlayedAt: { not: null } },
    orderBy: { lastPlayedAt: "desc" },
    take: limit,
  });
}

/** One beat by id — used by the Studio deep-link (?beatId=...). */
export async function getBeatById(id: string) {
  return prisma.beat.findUnique({ where: { id } });
}

/** Record that a beat was actually played/used (updates lastPlayedAt). */
export async function recordBeatPlayed(id: string) {
  return prisma.beat.update({
    where: { id },
    data: { lastPlayedAt: new Date() },
  });
}

export async function getBeats(options?: {
  genre?: string;
  minBpm?: number;
  maxBpm?: number;
  search?: string;
  limit?: number;
}) {
  return prisma.beat.findMany({
    where: {
      ...(options?.genre && { genre: options.genre }),
      ...(options?.minBpm && { bpm: { gte: options.minBpm } }),
      ...(options?.maxBpm && { bpm: { lte: options.maxBpm } }),
      ...(options?.search && {
        OR: [
          { title: { contains: options.search } },
          { artist: { contains: options.search } },
          { tags: { contains: options.search } },
        ],
      }),
    },
    orderBy: { createdAt: "desc" },
    take: options?.limit || 50,
  });
}

export async function updateBeat(id: string, data: {
  title?: string;
  artist?: string | null;
  bpm?: number;
  key?: string | null;
  genre?: string | null;
  tags?: string[];
}) {
  return prisma.beat.update({
    where: { id },
    data: {
      ...data,
      tags: data.tags?.join(","),
    },
  });
}

export async function deleteBeat(id: string) {
  return prisma.beat.delete({ where: { id } });
}
