"use server";

import { prisma } from "@/lib/prisma";

export async function exportLyricAsText(lyricId: string): Promise<string> {
  const lyric = await prisma.lyric.findUnique({
    where: { id: lyricId },
    include: { versions: true },
  });

  if (!lyric) throw new Error("Lyric not found");

  let output = `═══════════════════════════════════════\n`;
  output += `  ${lyric.title}\n`;
  output += `  Wygenerowano przez FlowForge\n`;
  output += `  Data: ${new Date().toLocaleDateString("pl-PL")}\n`;
  output += `═══════════════════════════════════════\n\n`;
  output += lyric.content;
  output += `\n\n═══════════════════════════════════════\n`;
  output += `  Statystyki:\n`;
  output += `  • Linii: ${lyric.lineCount || 0}\n`;
  output += `  • Zwrotek: ${lyric.verseCount || 0}\n`;
  output += `  • Sylab: ${lyric.syllableCount || 0}\n`;
  output += `  • Słów: ${lyric.wordCount || 0}\n`;
  output += `  • BPM: ${lyric.bpm || "nie ustawiono"}\n`;
  output += `═══════════════════════════════════════\n`;

  // Log export
  await prisma.exportLog.create({
    data: {
      lyricId,
      format: "txt",
    },
  });

  return output;
}

export async function getExportHistory(lyricId?: string) {
  return prisma.exportLog.findMany({
    where: lyricId ? { lyricId } : {},
    orderBy: { createdAt: "desc" },
    take: 20,
  });
}

export async function generateShareLink(lyricId: string): Promise<string> {
  const lyric = await prisma.lyric.update({
    where: { id: lyricId },
    data: { isPublic: true },
  });

  return `/feed?shared=${lyric.id}`;
}
