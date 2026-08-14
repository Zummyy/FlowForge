"use server";

import { prisma } from "@/lib/prisma";

export async function getInspirations(options?: {
  difficulty?: string;
  isFeatured?: boolean;
  limit?: number;
}) {
  return prisma.lyricalInspiration.findMany({
    where: {
      ...(options?.difficulty && { difficulty: options.difficulty }),
      ...(options?.isFeatured !== undefined && { isFeatured: options.isFeatured }),
    },
    orderBy: { createdAt: "desc" },
    take: options?.limit || 50,
  });
}

/**
 * Vote for an inspiration (idempotent toggle: voting again removes the vote).
 * The voted set is tracked per browser in localStorage, so a repeat call from
 * the same browser cancels the previous vote instead of double-counting.
 */
export async function voteInspiration(id: string, voted: boolean) {
  return prisma.lyricalInspiration.update({
    where: { id },
    data: { voteCount: voted ? { increment: 1 } : { decrement: 1 } },
  });
}

export async function createInspiration(data: {
  artist: string;
  songTitle: string;
  lyrics: string;
  analysis?: string;
  tags?: string[];
  difficulty?: string;
  year?: number;
  album?: string;
}) {
  return prisma.lyricalInspiration.create({
    data: {
      ...data,
      tags: data.tags ? JSON.stringify(data.tags) : null,
    },
  });
}
