"use server";

import { prisma } from "@/lib/prisma";
import { calculateLevel, getLevelProgress, calculateStreak } from "@/lib/progress";

// ─── Points & Achievements ───────────────────────────────────────────

export async function awardPoints(
  badgeId: string,
  badgeName: string,
  badgeIcon: string,
  badgeDescription: string,
  points: number
) {
  // Check if already earned
  const existing = await prisma.userAchievement.findUnique({
    where: { badgeId },
  });

  if (existing) return existing;

  // Award the achievement
  const achievement = await prisma.userAchievement.create({
    data: {
      badgeId,
      badgeName,
      badgeIcon,
      badgeDescription,
      points,
    },
  });

  // Recompute total points from achievements so the profile row always
  // matches getProfile() — even after achievements are deleted (reset flow).
  // Upsert (not update) so a fresh, unseeded DB never throws.
  const achievements = await prisma.userAchievement.findMany();
  const newTotal = achievements.reduce((sum, a) => sum + a.points, 0);
  const newLevel = calculateLevel(newTotal);
  await prisma.userProfile.upsert({
    where: { id: "default" },
    update: { totalPoints: newTotal, level: newLevel },
    create: {
      id: "default",
      displayName: "MC",
      totalPoints: newTotal,
      level: newLevel,
      avatarEmoji: "🎤",
      bio: "",
    },
  });

  return achievement;
}

export async function deleteAchievement(badgeId: string) {
  return prisma.userAchievement.deleteMany({ where: { badgeId } });
}

export async function updateProfile(data: {
  displayName?: string;
  bio?: string;
  avatarEmoji?: string;
}) {
  return prisma.userProfile.upsert({
    where: { id: "default" },
    update: data,
    create: {
      id: "default",
      displayName: data.displayName || "MC",
      bio: data.bio || "",
      avatarEmoji: data.avatarEmoji || "🎤",
    },
  });
}

export async function getProfile() {
  const profile = await prisma.userProfile.findUnique({ where: { id: "default" } });
  const achievements = await prisma.userAchievement.findMany();
  const totalPoints = achievements.reduce((sum, a) => sum + a.points, 0);

  return {
    ...profile,
    totalPoints,
    level: calculateLevel(totalPoints),
    achievements,
  };
}

// ─── Stats ────────────────────────────────────────────────────────────

export async function getDashboardStats() {
  const [lyricCount, beatCount, projectCount, postCount, achievementCount, exportCount, lyricVersions, lyrics] = await Promise.all([
    prisma.lyric.count(),
    prisma.beat.count(),
    prisma.savedProject.count(),
    prisma.communityPost.count(),
    prisma.userAchievement.count(),
    prisma.exportLog.count(),
    prisma.lyricVersion.findMany({ select: { createdAt: true } }),
    prisma.lyric.findMany({ select: { updatedAt: true } }),
  ]);

  const profile = await prisma.userProfile.findUnique({ where: { id: "default" } });
  const totalPoints = profile?.totalPoints || 0;
  // A writing day = a saved version OR a track edit (Lyric.updatedAt bumps on
  // save / track switch, even without clicking „Zapisz wersję”).
  const writingDates = [
    ...lyricVersions.map((v) => v.createdAt),
    ...lyrics.map((l) => l.updatedAt),
  ];
  const { streak, lastWritingDay } = calculateStreak(writingDates);

  return {
    lyricCount,
    // „Numery” = the whole Gotowe Numery library: uploaded beats + Studio
    // projects (both are DB-primary now, so the card matches /beats).
    beatCount: beatCount + projectCount,
    postCount,
    achievementCount,
    exportCount,
    totalPoints,
    level: calculateLevel(totalPoints),
    levelProgress: getLevelProgress(totalPoints),
    displayName: profile?.displayName || "MC",
    avatarEmoji: profile?.avatarEmoji || "🎤",
    streak,
    lastWritingDay,
  };
}
