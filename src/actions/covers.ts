"use server";

import { prisma } from "@/lib/prisma";

// ─── Cover Art („Generator Okładek”) ──────────────────────────────────
// DB-primary with a localStorage mirror (flowforge-covers) as the offline
// cache — same pattern as the moodboard / release plan / saved projects.
// `imageUrl` holds the full-res PNG data URL (or an SVG data URL for the
// seeded examples); `layoutData` keeps the extra effect settings (noise,
// vignette, filter value) that don't have dedicated columns.

export async function saveCover(data: {
  title: string;
  artistName: string;
  bgPattern?: string; // gradient preset id: dark, amber, red, …
  textColor?: string;
  bgColor?: string;
  filterStyle?: string; // filter id: none, grain, vintage, …
  fontSize?: number;
  fontFamily?: string;
  imageUrl?: string;
  layoutData?: string; // JSON: { noiseOpacity, vignetteOpacity, filterValue }
}) {
  return prisma.coverArt.create({
    data: {
      title: data.title,
      artistName: data.artistName,
      bgPattern: data.bgPattern || null,
      textColor: data.textColor || "#f59e0b",
      bgColor: data.bgColor || "#09090b",
      filterStyle: data.filterStyle || "none",
      fontSize: data.fontSize ?? 48,
      fontFamily: data.fontFamily || "Inter",
      imageUrl: data.imageUrl || null,
      layoutData: data.layoutData || null,
    },
  });
}

export async function getCovers() {
  return prisma.coverArt.findMany({ orderBy: { createdAt: "desc" } });
}

export async function deleteCover(id: string) {
  return prisma.coverArt.delete({ where: { id } });
}
