// ─── Level & writing-streak helpers (pure, unit-testable) ──────────────
// Level: cumulative points → level via threshold ladder (shared with the
// achievements backend). Streak: consecutive calendar days (local timezone)
// with at least one writing event — a saved lyric version (LyricVersion.
// createdAt) or a track edit (Lyric.updatedAt) — ending today or yesterday
// (a streak stays alive until the day is over — you don't lose it for not
// having written yet today).

export const LEVEL_THRESHOLDS = [0, 50, 150, 300, 500, 750, 1000, 1500, 2000, 3000];

export function calculateLevel(points: number): number {
  let level = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (points >= LEVEL_THRESHOLDS[i]) level = i + 1;
  }
  return level;
}

export interface LevelProgress {
  level: number;
  /** Points threshold the user is currently above. */
  current: number;
  /** Points threshold of the next level (same as `current` at max level). */
  next: number;
  /** 0..1 progress between `current` and `next`. */
  progress: number;
}

export function getLevelProgress(points: number): LevelProgress {
  const level = calculateLevel(points);
  const current = LEVEL_THRESHOLDS[level - 1] ?? 0;
  const next = LEVEL_THRESHOLDS[level];
  if (next === undefined) {
    return { level, current, next: current, progress: 1 };
  }
  return {
    level,
    current,
    next,
    progress: Math.min(1, Math.max(0, (points - current) / (next - current))),
  };
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export interface StreakInfo {
  /** Consecutive writing days ending today (or yesterday — still alive). */
  streak: number;
  /** Local date (YYYY-M-D) of the most recent writing day, or null. */
  lastWritingDay: string | null;
}

export function calculateStreak(versionDates: Date[]): StreakInfo {
  if (versionDates.length === 0) return { streak: 0, lastWritingDay: null };
  const days = new Set(versionDates.map((t) => dayKey(new Date(t))));
  const today = new Date();

  // A streak is alive if the user wrote today, or yesterday (today simply
  // hasn't been written yet). Anything older means the run is broken.
  let cursor = dayKey(today);
  if (!days.has(cursor)) cursor = dayKey(addDays(today, -1));

  let streak = 0;
  while (days.has(cursor)) {
    streak++;
    const [y, m, d] = cursor.split("-").map(Number);
    cursor = dayKey(new Date(y, m - 1, d - 1));
  }

  const lastWritingDay = [...days].sort().pop() ?? null;
  return { streak, lastWritingDay };
}

/** Whole days since the last writing day (0 = today, 1 = yesterday). */
export function daysSince(isoDate: string | null): number | null {
  if (!isoDate) return null;
  const [y, m, d] = isoDate.split("-").map(Number);
  const last = new Date(y, m - 1, d);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((startOfToday.getTime() - last.getTime()) / 86400000);
}
