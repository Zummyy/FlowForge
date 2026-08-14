"use server";

import { prisma } from "@/lib/prisma";

// ─── Board-level persistence ──────────────────────────────────────────
// The moodboard is a single global board (vibes, palette, keywords and
// inspiration cards) persisted as one MoodboardItem row (type "board")
// with the whole state JSON-encoded in `content`. localStorage stays as an
// offline mirror, but the DB row is the source of truth — the board now
// survives browser storage wipes.

export interface MoodboardInspiration {
  id: string;
  title: string;
  url: string;
  type: "image" | "link";
  /** Data URL of an uploaded image. */
  dataUrl?: string;
}

export interface MoodboardData {
  selectedVibes: string[];
  palette: string[];
  keywords: string[];
  inspirations: MoodboardInspiration[];
}

const BOARD_TYPE = "board";

function isInspiration(x: unknown): x is MoodboardInspiration {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.title === "string" &&
    typeof o.url === "string" &&
    (o.type === "image" || o.type === "link") &&
    (o.dataUrl === undefined || typeof o.dataUrl === "string")
  );
}

function parseBoard(content: string): MoodboardData | null {
  try {
    const d = JSON.parse(content) as Record<string, unknown>;
    if (!Array.isArray(d.selectedVibes) || !Array.isArray(d.palette) || !Array.isArray(d.keywords) || !Array.isArray(d.inspirations)) {
      return null;
    }
    return {
      selectedVibes: d.selectedVibes.filter((v): v is string => typeof v === "string"),
      palette: d.palette.filter((c): c is string => typeof c === "string"),
      keywords: d.keywords.filter((k): k is string => typeof k === "string"),
      inspirations: d.inspirations.filter(isInspiration),
    };
  } catch {
    return null;
  }
}

export async function getMoodboard(): Promise<MoodboardData | null> {
  const row = await prisma.moodboardItem.findFirst({
    where: { type: BOARD_TYPE },
    orderBy: { createdAt: "asc" },
  });
  if (!row?.content) return null;
  return parseBoard(row.content);
}

export async function saveMoodboard(data: MoodboardData) {
  const content = JSON.stringify(data);
  const existing = await prisma.moodboardItem.findFirst({ where: { type: BOARD_TYPE } });
  if (existing) {
    return prisma.moodboardItem.update({ where: { id: existing.id }, data: { content } });
  }
  return prisma.moodboardItem.create({
    data: { type: BOARD_TYPE, title: "Moodboard", content },
  });
}
