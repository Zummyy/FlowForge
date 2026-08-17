"use server";

import { prisma } from "@/lib/prisma";
import { MAX_ACTIVE_VERSIONS_PER_LYRIC } from "@/lib/lyric-versions";

// ─── Lyrics CRUD ──────────────────────────────────────────────────────

export async function createLyric(data: {
  title: string;
  content: string;
  bpm?: number;
  syllableCount?: number;
  lineCount?: number;
  verseCount?: number;
  wordCount?: number;
}) {
  return prisma.lyric.create({
    data: {
      title: data.title,
      content: data.content,
      bpm: data.bpm,
      syllableCount: data.syllableCount,
      lineCount: data.lineCount,
      verseCount: data.verseCount,
      wordCount: data.wordCount,
    },
  });
}

export async function updateLyric(
  id: string,
  data: {
    title?: string;
    content?: string;
    bpm?: number;
    syllableCount?: number;
    lineCount?: number;
    verseCount?: number;
    wordCount?: number;
    status?: string;
    isPublic?: boolean;
  }
) {
  return prisma.lyric.update({
    where: { id },
    data,
  });
}

export async function getLyric(id: string) {
  return prisma.lyric.findUnique({
    where: { id },
    include: {
      versions: { orderBy: { createdAt: "desc" } },
      moodboardItems: true,
    },
  });
}

export async function getAllLyrics(options?: {
  status?: string;
  isPublic?: boolean;
  limit?: number;
  offset?: number;
  /** Exclude archived tracks (the Vault „Utwory” list — the archive is a
   *  separate section fetched with { status: "archived" }). */
  excludeArchived?: boolean;
}) {
  return prisma.lyric.findMany({
    where: {
      ...(options?.status && { status: options.status }),
      ...(options?.excludeArchived && { status: { not: "archived" } }),
      ...(options?.isPublic !== undefined && { isPublic: options.isPublic }),
    },
    orderBy: { updatedAt: "desc" },
    take: options?.limit || 50,
    skip: options?.offset || 0,
    include: {
      // Version count powers the Vault track list („Utwory”). Counts only
      // ACTIVE versions — archived ones are hidden, so they shouldn't inflate
      // the working-set number.
      _count: { select: { versions: { where: { archivedAt: null } } } },
      // Recent version labels power the „Utwory” search. Deliberately capped
      // at the last 5 per track: labels are mostly „title – timestamp” (already
      // searchable via the title), so older labels aren't worth the payload.
      versions: { select: { label: true }, orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
}

export async function deleteLyric(id: string) {
  return prisma.lyric.delete({ where: { id } });
}

// ─── Publish / share (Lyric.status = "published" + isPublic) ──────────
// Completes the publish story: a published track is public and gets a share
// link (/feed?shared=<id>) rendered by the Feed page.

export async function publishLyric(id: string) {
  return prisma.lyric.update({
    where: { id },
    data: { status: "published", isPublic: true },
  });
}

export async function unpublishLyric(id: string) {
  return prisma.lyric.update({
    where: { id },
    data: { status: "draft", isPublic: false },
  });
}

/**
 * A lyric that was actually published (isPublic) — used by the Feed page's
 * /feed?shared=<id> view. Anything not public returns null, so unpublished
 * or archived tracks can never be shared by guessing an id.
 */
export async function getPublicLyric(id: string) {
  const lyric = await prisma.lyric.findUnique({ where: { id } });
  if (!lyric || !lyric.isPublic) return null;
  return {
    id: lyric.id,
    title: lyric.title,
    content: lyric.content,
    lineCount: lyric.lineCount ?? 0,
    verseCount: lyric.verseCount ?? 0,
    syllableCount: lyric.syllableCount ?? 0,
    wordCount: lyric.wordCount ?? 0,
    publishedAt: lyric.updatedAt.toISOString(),
  };
}

// ─── Dashboard: Recently Edited ───────────────────────────────────────

export async function getRecentLyrics(limit = 5) {
  return prisma.lyric.findMany({
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      lineCount: true,
      wordCount: true,
      syllableCount: true,
      status: true,
      updatedAt: true,
      // Active versions only (archived ones live in the archive, not the
      // working set the dashboard „wersji” meta describes).
      _count: { select: { versions: { where: { archivedAt: null } } } },
    },
  });
}

// ─── Dashboard: writing activity chart ───────────────────────────────
// Day buckets over the last `days` calendar days (server-local time):
// syllables written + versions saved per day, zeros included so the client
// can render a gap-free bar chart. `days` is clamped to 1..90.
export async function getWritingActivity(days: number) {
  const count = Math.max(1, Math.min(90, Math.floor(days)));
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (count - 1));

  const rows = await prisma.lyricVersion.findMany({
    where: { createdAt: { gte: start } },
    select: { createdAt: true, syllableCount: true },
  });

  const buckets = new Map<string, { syllables: number; versions: number }>();
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    buckets.set(localDateKey(d), { syllables: 0, versions: 0 });
  }
  for (const r of rows) {
    const key = localDateKey(r.createdAt);
    const b = buckets.get(key);
    if (b) {
      b.syllables += r.syllableCount ?? 0;
      b.versions += 1;
    }
  }
  return Array.from(buckets, ([date, v]) => ({ date, syllables: v.syllables, versions: v.versions }));
}

/** "YYYY-MM-DD" in the server's local timezone — the bucket key. */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── Lyric Versions ──────────────────────────────────────────────────
// The active-versions cap (MAX_ACTIVE_VERSIONS_PER_LYRIC) lives in
// src/lib/lyric-versions.ts — Next.js only allows async function exports
// from "use server" files, and the Vault client component needs it too.

export async function saveLyricVersion(data: {
  lyricId: string;
  content: string;
  label?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const latestVersion = await tx.lyricVersion.findFirst({
      where: { lyricId: data.lyricId },
      orderBy: { snapshot: "desc" },
    });

    const created = await tx.lyricVersion.create({
      data: {
        lyricId: data.lyricId,
        content: data.content,
        label: data.label,
        snapshot: (latestVersion?.snapshot || 0) + 1,
      },
    });

    // Enforce the active-versions cap: archive the oldest active versions
    // (by createdAt, id as tiebreak) down to the limit.
    const active = await tx.lyricVersion.count({
      where: { lyricId: data.lyricId, archivedAt: null },
    });
    if (active > MAX_ACTIVE_VERSIONS_PER_LYRIC) {
      const overflow = active - MAX_ACTIVE_VERSIONS_PER_LYRIC;
      const oldest = await tx.lyricVersion.findMany({
        where: { lyricId: data.lyricId, archivedAt: null },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: overflow,
      });
      if (oldest.length > 0) {
        await tx.lyricVersion.updateMany({
          where: { id: { in: oldest.map((v) => v.id) } },
          data: { archivedAt: new Date() },
        });
      }
    }

    return created;
  });
}

export async function getLyricVersionStats(lyricId: string) {
  const [activeCount, archivedCount] = await Promise.all([
    prisma.lyricVersion.count({ where: { lyricId, archivedAt: null } }),
    prisma.lyricVersion.count({ where: { lyricId, archivedAt: { not: null } } }),
  ]);
  return { activeCount, archivedCount, limit: MAX_ACTIVE_VERSIONS_PER_LYRIC };
}

export async function getArchivedLyricVersions(lyricId: string) {
  return prisma.lyricVersion.findMany({
    where: { lyricId, archivedAt: { not: null } },
    orderBy: { createdAt: "desc" },
  });
}

export async function archiveLyricVersion(id: string) {
  return prisma.lyricVersion.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
}

/** Restore an archived version. At the cap, the oldest ACTIVE version is
 *  archived first to make room (the active working set never exceeds the
 *  limit, so restoring can't silently grow it). */
export async function restoreLyricVersion(id: string) {
  return prisma.$transaction(async (tx) => {
    const target = await tx.lyricVersion.findUnique({ where: { id } });
    if (!target) return null;
    const active = await tx.lyricVersion.count({
      where: { lyricId: target.lyricId, archivedAt: null },
    });
    if (active >= MAX_ACTIVE_VERSIONS_PER_LYRIC) {
      const oldest = await tx.lyricVersion.findFirst({
        where: { lyricId: target.lyricId, archivedAt: null, id: { not: id } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      if (oldest) {
        await tx.lyricVersion.update({
          where: { id: oldest.id },
          data: { archivedAt: new Date() },
        });
      }
    }
    return tx.lyricVersion.update({ where: { id }, data: { archivedAt: null } });
  });
}

/** Hard-delete every archived version of a track (the „Wyczyść archiwum”
 *  action — this is what actually keeps the table from growing forever). */
export async function purgeArchivedLyricVersions(lyricId: string) {
  return prisma.lyricVersion.deleteMany({
    where: { lyricId, archivedAt: { not: null } },
  });
}

export async function deleteLyricVersion(id: string) {
  return prisma.lyricVersion.delete({ where: { id } });
}

// ─── Ratings ──────────────────────────────────────────────────────────

export async function ratePost(postId: string, score: number, raterName?: string) {
  return prisma.rating.upsert({
    where: {
      postId_raterName: {
        postId,
        raterName: raterName || "Anonymous",
      },
    },
    update: { score },
    create: {
      postId,
      score,
      raterName: raterName || "Anonymous",
    },
  });
}

// ─── Comments ─────────────────────────────────────────────────────────

export async function addComment(postId: string, content: string, authorName?: string) {
  return prisma.comment.create({
    data: {
      postId,
      content,
      authorName: authorName || "Anonymous",
    },
  });
}
