// ─── Wyzwania — point-based scoring system ──────────────────────────────────
// Pure challenge definitions + completion/score logic (unit-testable) and a
// DB-primary persistence layer (with a localStorage offline mirror). Studio /
// The Vault / Gotowe Numery fire `recordChallengeEvent(...)` when relevant
// actions happen; the Challenges page reads the same store and auto-awards
// points for newly completed challenges.

import {
  getChallengeProgress as getChallengeProgressDb,
  saveChallengeProgress,
  deleteChallengeProgress,
} from "@/actions/challenges";

export type ChallengeStat =
  | "takes" // recorded vocal takes
  | "splits" // timeline splits (Rozetnij)
  | "trims" // edge trims (Minimalista)
  | "volumeChanges" // volume adjustments
  | "beats" // uploaded beats / instrumentals
  | "lyricsLines" // current line count in The Vault
  | "teleprompterOpens" // opened the teleprompter with Vault text
  | "projectsSaved"; // projects saved to „Gotowe Numery”

export interface ChallengeDef {
  id: string;
  title: string;
  icon: string;
  description: string;
  points: number;
  /** Stat that drives the progress bar + completion. */
  stat: ChallengeStat;
  /** Threshold of `stat` required to complete. */
  target: number;
  /** Compound conditions (beyond the simple stat threshold). */
  requires?: { stat: ChallengeStat; target: number }[];
}

export interface ChallengeState {
  /** challengeId → ISO timestamp when it was completed. */
  completed: Record<string, string>;
  stats: Record<ChallengeStat, number>;
  updatedAt: string;
}

// ─── The 10 challenges ──────────────────────────────────────────────────────
export const CHALLENGES: ChallengeDef[] = [
  { id: "szybki-start", title: "Szybki Start", icon: "⚡", points: 50, stat: "takes", target: 1, description: "Nagraj pierwszy take wokalny w Studio." },
  { id: "mistrz-rymu", title: "Mistrz Rymu", icon: "🎤", points: 100, stat: "lyricsLines", target: 8, description: "Napisz co najmniej 8 wersów w The Vault." },
  { id: "ciecie-chirurgiczne", title: "Cięcie Chirurgiczne", icon: "✂️", points: 150, stat: "splits", target: 1, description: "Rozetnij fragment na osi czasu („Rozetnij”)." },
  { id: "zloty-srodek", title: "Złoty Środek", icon: "🎚️", points: 100, stat: "volumeChanges", target: 1, description: "Dostosuj głośność fragmentu lub take'a." },
  { id: "dzwiek-z-pamieci", title: "Dźwięk z Pamięci", icon: "🧠", points: 200, stat: "takes", target: 3, description: "Nagraj 3 take'y wokalne w Studio." },
  { id: "bit-i-slowo", title: "Bit i Słowo", icon: "🎵", points: 150, stat: "beats", target: 1, requires: [{ stat: "takes", target: 1 }], description: "Wgraj bit i nagraj na nim wokal." },
  { id: "maraton-wersow", title: "Maraton Wersów", icon: "📜", points: 200, stat: "lyricsLines", target: 30, description: "Napisz 30 wersów w The Vault." },
  { id: "minimalista", title: "Minimalista", icon: "🪶", points: 300, stat: "trims", target: 1, description: "Przytnij krawędź fragmentu na osi czasu." },
  { id: "teleprompter-pro", title: "Teleprompter Pro", icon: "📺", points: 100, stat: "teleprompterOpens", target: 1, description: "Otwórz teleprompter z tekstem z The Vault." },
  { id: "mistrz-archiwum", title: "Mistrz Archiwum", icon: "🗂️", points: 100, stat: "projectsSaved", target: 1, description: "Zapisz projekt w Gotowych Numerach." },
];

export const CHALLENGE_BY_ID: Record<string, ChallengeDef> = Object.fromEntries(
  CHALLENGES.map((c) => [c.id, c])
);

/** Sum of all challenge points — the maximum achievable score. */
export const MAX_SCORE = CHALLENGES.reduce((sum, c) => sum + c.points, 0);

// ─── Pure logic (no storage access — unit-testable) ─────────────────────────

export function emptyChallengeState(): ChallengeState {
  return {
    completed: {},
    stats: {
      takes: 0,
      splits: 0,
      trims: 0,
      volumeChanges: 0,
      beats: 0,
      lyricsLines: 0,
      teleprompterOpens: 0,
      projectsSaved: 0,
    },
    updatedAt: new Date().toISOString(),
  };
}

/** Whether the challenge's condition is met by the current stats. */
export function isChallengeConditionMet(state: ChallengeState, def: ChallengeDef): boolean {
  if (state.stats[def.stat] < def.target) return false;
  if (def.requires) {
    for (const req of def.requires) {
      if (state.stats[req.stat] < req.target) return false;
    }
  }
  return true;
}

/** Score from all currently completed challenges. */
export function getTotalScore(state: ChallengeState): number {
  let total = 0;
  for (const c of CHALLENGES) {
    if (state.completed[c.id]) total += c.points;
  }
  return total;
}

/** Number of completed challenges (0..CHALLENGES.length). */
export function getCompletedCount(state: ChallengeState): number {
  return CHALLENGES.filter((c) => state.completed[c.id]).length;
}

/** 0..1 progress toward completing a challenge (for the progress bar). */
export function getChallengeProgress(state: ChallengeState, def: ChallengeDef): number {
  if (state.completed[def.id]) return 1;
  return Math.min(1, state.stats[def.stat] / def.target);
}

/**
 * Challenges whose condition is satisfied but are NOT yet marked complete —
 * used right after an event to award new points. Pure.
 */
export function evaluateNewlyCompleted(state: ChallengeState): ChallengeDef[] {
  return CHALLENGES.filter((c) => !state.completed[c.id] && isChallengeConditionMet(state, c));
}

// ─── Persistence ────────────────────────────────────────────────────────────

export const CHALLENGE_STORAGE_KEY = "flowforge-challenge-state";

/** Debounce-safe: dispatch an event so open pages (Challenges) refresh live. */
export function notifyChallengeUpdate(): void {
  try {
    window.dispatchEvent(new CustomEvent("flowforge-challenges-updated"));
  } catch {
    /* ignore */
  }
}

export function loadChallengeState(): ChallengeState {
  const base = emptyChallengeState();
  if (typeof window === "undefined") return base;
  try {
    const raw = window.localStorage.getItem(CHALLENGE_STORAGE_KEY);
    if (!raw) return base;
    return parseChallengeState(JSON.parse(raw));
  } catch {
    return base;
  }
}

/**
 * Validate + normalize an unknown payload into a ChallengeState. Merge keeps
 * new stats added later at 0 instead of breaking old saves.
 */
export function parseChallengeState(raw: unknown): ChallengeState {
  const base = emptyChallengeState();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  return {
    completed:
      o.completed && typeof o.completed === "object"
        ? (o.completed as Record<string, string>)
        : {},
    stats: {
      ...base.stats,
      ...(o.stats && typeof o.stats === "object" ? (o.stats as Partial<Record<ChallengeStat, number>>) : {}),
    },
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : base.updatedAt,
  };
}

/** Whether a saved (non-empty) mirror exists in localStorage. */
function hasLocalChallengeSave(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return !!window.localStorage.getItem(CHALLENGE_STORAGE_KEY);
  } catch {
    return false;
  }
}

export function saveChallengeState(state: ChallengeState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHALLENGE_STORAGE_KEY, JSON.stringify(state));
    notifyChallengeUpdate();
  } catch {
    /* quota errors — challenge progress is best-effort */
  }
}

export type ChallengeEvent =
  | { type: "increment"; stat: ChallengeStat }
  | { type: "setLyricsLines"; lines: number };

/**
 * Pure core of event application: bump the stat, auto-complete any challenges
 * that are now satisfied, and return the new state + newly completed
 * definitions. Idempotent — repeating an event never re-awards.
 */
export function applyChallengeEvent(
  state: ChallengeState,
  event: ChallengeEvent
): { state: ChallengeState; newly: ChallengeDef[] } {
  const next: ChallengeState = {
    ...state,
    stats: { ...state.stats },
    completed: { ...state.completed },
  };
  if (event.type === "increment") {
    next.stats[event.stat] += 1;
  } else {
    // Line count is the *current* value, not cumulative.
    next.stats.lyricsLines = Math.max(next.stats.lyricsLines, event.lines);
  }
  const newly = evaluateNewlyCompleted(next);
  if (newly.length > 0) {
    const now = new Date().toISOString();
    for (const c of newly) next.completed[c.id] = now;
  }
  next.updatedAt = new Date().toISOString();
  return { state: next, newly };
}

/**
 * Apply an event DB-primary (with a localStorage offline mirror) and return
 * the newly completed definitions so callers can show an award toast.
 * Never rejects — DB failures degrade to the mirror.
 */
export async function recordChallengeEvent(event: ChallengeEvent): Promise<ChallengeDef[]> {
  // DB-primary, but take whichever of DB / mirror is newer: a failed DB write
  // (offline) leaves the mirror ahead, and we must not clobber that progress.
  let dbState: ChallengeState | null = null;
  try {
    dbState = await getChallengeProgressDb();
  } catch {
    /* DB unavailable */
  }
  const localState = loadChallengeState();
  const localHasSave = hasLocalChallengeSave();
  const state =
    dbState && (!localHasSave || dbState.updatedAt >= localState.updatedAt)
      ? dbState
      : localState;

  const { state: next, newly } = applyChallengeEvent(state, event);
  saveChallengeState(next); // mirror — immediate, offline-safe
  try {
    await saveChallengeProgress(next);
  } catch {
    /* offline — the localStorage mirror above already holds the state */
  }
  return newly;
}

/** Wipe all progress (dev utility / „reset” button) — DB + mirror. */
export async function resetChallengeProgress(): Promise<void> {
  try {
    await deleteChallengeProgress();
  } catch {
    /* offline — the mirror below still resets */
  }
  saveChallengeState(emptyChallengeState());
}
