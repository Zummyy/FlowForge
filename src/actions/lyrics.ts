"use server";

import { prisma } from "@/lib/prisma";
import { MAX_ACTIVE_VERSIONS_PER_LYRIC } from "@/lib/lyric-versions";
import { awardPoints } from "./achievements";

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

export async function getLyricVersions(lyricId: string) {
  return prisma.lyricVersion.findMany({
    where: { lyricId },
    orderBy: { createdAt: "desc" },
  });
}

export async function deleteLyricVersion(id: string) {
  return prisma.lyricVersion.delete({ where: { id } });
}

// ─── Publish to Feed ──────────────────────────────────────────────────

export async function publishToFeed(data: {
  lyricId?: string;
  title: string;
  content: string;
  authorName?: string;
}) {
  const post = await prisma.communityPost.create({
    data: {
      lyricId: data.lyricId,
      title: data.title,
      content: data.content,
      authorName: data.authorName || "Anonymous",
    },
  });

  // Award points for publishing
  await awardPoints("community-star", "Gwiazda Społeczności", "⭐", "Opublikuj tekst na Ścianie Raperów", 15);

  return post;
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

export async function getPostComments(postId: string) {
  return prisma.comment.findMany({
    where: { postId },
    orderBy: { createdAt: "asc" },
  });
}
