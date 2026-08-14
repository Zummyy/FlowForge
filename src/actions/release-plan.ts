"use server";

import { prisma } from "@/lib/prisma";

// ─── Board-level persistence ──────────────────────────────────────────
// The release plan (milestones, project status and target release date) is
// persisted as a single ReleasePlan row with the whole state JSON-encoded in
// `content`. localStorage stays as an offline mirror, but the DB row is the
// source of truth — the plan now survives browser storage wipes.

export interface Milestone {
  id: string;
  label: string;
  category: "production" | "promo" | "custom";
  done: boolean;
  dueDate?: string;
}

export interface ReleasePlanData {
  milestones: Milestone[];
  projectStatus: string;
  targetDate: string;
}

function isMilestone(x: unknown): x is Milestone {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.label === "string" &&
    (o.category === "production" || o.category === "promo" || o.category === "custom") &&
    typeof o.done === "boolean" &&
    (o.dueDate === undefined || typeof o.dueDate === "string")
  );
}

function parsePlan(content: string): ReleasePlanData | null {
  try {
    const d = JSON.parse(content) as Record<string, unknown>;
    if (!Array.isArray(d.milestones)) return null;
    return {
      // Drop malformed rows, but honor a legitimately empty list (a user who
      // deleted every milestone must not get the defaults back).
      milestones: d.milestones.filter(isMilestone),
      projectStatus: typeof d.projectStatus === "string" ? d.projectStatus : "draft",
      targetDate: typeof d.targetDate === "string" ? d.targetDate : "",
    };
  } catch {
    return null;
  }
}

export async function getReleasePlan(): Promise<ReleasePlanData | null> {
  const row = await prisma.releasePlan.findUnique({ where: { id: "default" } });
  if (!row?.content) return null;
  return parsePlan(row.content);
}

export async function saveReleasePlan(data: ReleasePlanData) {
  const content = JSON.stringify(data);
  return prisma.releasePlan.upsert({
    where: { id: "default" },
    update: { content },
    create: { id: "default", content },
  });
}
