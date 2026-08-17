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

export async function exportLyricAsPdf(lyricId: string) {
  const lyric = await prisma.lyric.findUnique({ where: { id: lyricId } });
  if (!lyric) throw new Error("Lyric not found");

  // Log the export so the history panel shows the PDF row (the actual PDF is
  // rendered by the browser via the print view — no server-side PDF engine).
  await prisma.exportLog.create({
    data: { lyricId, format: "pdf" },
  });

  return {
    title: lyric.title,
    content: lyric.content,
    date: new Date().toLocaleDateString("pl-PL"),
    lineCount: lyric.lineCount || 0,
    verseCount: lyric.verseCount || 0,
    syllableCount: lyric.syllableCount || 0,
    wordCount: lyric.wordCount || 0,
    bpm: lyric.bpm ?? null,
  };
}

export async function getExportHistory(lyricId?: string) {
  return prisma.exportLog.findMany({
    where: lyricId ? { lyricId } : {},
    orderBy: { createdAt: "desc" },
    take: 20,
  });
}

/**
 * Wipe the export history — for one track, or the whole table when no id is
 * given. Exposed so the Vault's „🧹 Wyczyść historię” can empty the panel
 * (and so ExportLog stays a real, manageable history source).
 */
export async function clearExportHistory(lyricId?: string) {
  const result = await prisma.exportLog.deleteMany({
    where: lyricId ? { lyricId } : {},
  });
  return result.count;
}

