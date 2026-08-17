"use server";

import { prisma } from "@/lib/prisma";
import type { ChallengeState } from "@/lib/challenges";

// ─── Personal challenge progress (DB-primary) ───────────────────────────
// The achievement-style challenges on /challenges keep their progress (stats
// + completion timestamps) in a single ChallengeProgress row. localStorage
// stays as the offline mirror (see lib/challenges.ts).

const DEFAULT_STATS = {
  takes: 0,
  splits: 0,
  trims: 0,
  volumeChanges: 0,
  beats: 0,
  lyricsLines: 0,
  teleprompterOpens: 0,
  projectsSaved: 0,
};

export async function getChallengeProgress(): Promise<ChallengeState | null> {
  const row = await prisma.challengeProgress.findUnique({ where: { id: "default" } });
  if (!row?.content) return null;
  try {
    const d = JSON.parse(row.content) as Record<string, unknown>;
    // Merge with defaults so new stats added later default to 0 instead of
    // breaking old saves.
    return {
      completed:
        d.completed && typeof d.completed === "object"
          ? (d.completed as Record<string, string>)
          : {},
      stats: {
        ...DEFAULT_STATS,
        ...(d.stats && typeof d.stats === "object" ? (d.stats as Partial<typeof DEFAULT_STATS>) : {}),
      },
      updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function saveChallengeProgress(state: ChallengeState) {
  return prisma.challengeProgress.upsert({
    where: { id: "default" },
    update: { content: JSON.stringify(state) },
    create: { id: "default", content: JSON.stringify(state) },
  });
}

export async function deleteChallengeProgress() {
  return prisma.challengeProgress.deleteMany({});
}

export async function createChallenge(data: {
  title: string;
  description: string;
  theme?: string;
  rules?: string;
  endDate: Date;
  maxParticipants?: number;
  prize?: string;
}) {
  return prisma.challenge.create({ data });
}

export async function getActiveChallenges() {
  return prisma.challenge.findMany({
    where: { isActive: true },
    include: {
      submissions: {
        orderBy: { voteCount: "desc" },
      },
    },
    orderBy: { endDate: "asc" },
  });
}

/**
 * The next active, not-yet-ended challenge for the dashboard tile, plus
 * whether the current user already submitted (matched by display name) and
 * the total submission count. Returns null when there is nothing to show.
 */
export async function getDashboardChallenge() {
  const [challenge, profile] = await Promise.all([
    prisma.challenge.findFirst({
      where: { isActive: true, endDate: { gt: new Date() } },
      include: {
        submissions: { select: { id: true, authorName: true }, orderBy: { voteCount: "desc" } },
      },
      orderBy: { endDate: "asc" },
    }),
    prisma.userProfile.findUnique({ where: { id: "default" } }),
  ]);
  if (!challenge) return null;
  const userName = profile?.displayName || "MC";
  return {
    id: challenge.id,
    title: challenge.title,
    description: challenge.description,
    theme: challenge.theme ?? null,
    prize: challenge.prize ?? null,
    endDate: challenge.endDate.toISOString(),
    submitted: challenge.submissions.some((s) => s.authorName === userName),
    submissionCount: challenge.submissions.length,
    userName,
  };
}

export async function submitToChallenge(data: {
  challengeId: string;
  authorName?: string;
  title: string;
  content: string;
  lyricsId?: string;
}) {
  const submission = await prisma.challengeSubmission.create({
    data: {
      challengeId: data.challengeId,
      authorName: data.authorName || "Anonymous",
      title: data.title,
      content: data.content,
      lyricsId: data.lyricsId,
    },
  });

  // Award points for participating
  try {
    const { awardPoints } = await import("./achievements");
    await awardPoints("challenger", "Wyzwaniowiec", "🔥", "Weź udział w pierwszym wyzwaniu", 20);
  } catch {}

  return submission;
}

/** Parse the voters JSON column (anonymous voter ids that already voted). */
function parseVoters(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export interface VoteResult {
  ok: boolean;
  alreadyVoted: boolean;
  voteCount: number;
}

/**
 * Vote for a cypher submission. DB-primary dedup: each anonymous voter id
 * (persisted in localStorage by the client) can vote once — the voters JSON
 * column is read + updated inside a transaction, so double clicks or replays
 * never inflate the count. Throws when the submission doesn't exist.
 */
export async function voteSubmission(submissionId: string, voterId: string): Promise<VoteResult> {
  const voter = String(voterId || "").trim();
  if (!voter) return { ok: false, alreadyVoted: true, voteCount: 0 };
  return prisma.$transaction(async (tx) => {
    const row = await tx.challengeSubmission.findUnique({
      where: { id: submissionId },
      select: { id: true, voteCount: true, voters: true },
    });
    if (!row) throw new Error(`Submission ${submissionId} not found`);
    const voters = parseVoters(row.voters);
    if (voters.includes(voter)) {
      return { ok: false, alreadyVoted: true, voteCount: row.voteCount };
    }
    const updated = await tx.challengeSubmission.update({
      where: { id: submissionId },
      data: {
        voteCount: { increment: 1 },
        voters: JSON.stringify([...voters, voter]),
      },
      select: { voteCount: true },
    });
    return { ok: true, alreadyVoted: false, voteCount: updated.voteCount };
  });
}


