// ─── Shared types for the Studio module ────────────────────────────────────────

/** A recorded vocal take. `trimStart`/`trimEnd` are normalized 0..1 source ranges. */
export interface VocalTake {
  id: string;
  label: string;
  /** Full source duration in seconds. */
  duration: number;
  /** Timeline position in seconds (from the start of the beat). */
  offset: number;
  /** 0 .. 1.5 (up to 150%). */
  volume: number;
  isMuted: boolean;
  isSoloed: boolean;
  /** Normalized source start (0..1). */
  trimStart: number;
  /** Normalized source end (0..1). */
  trimEnd: number;
  blob?: Blob;
  url?: string;
}

/**
 * A timeline clip — a contiguous slice of a take laid out on the beat timeline.
 * `offset` is the timeline position, `duration` the audible length
 * (`=== (trimEnd - trimStart) * take.duration`).
 */
export interface Clip {
  id: string;
  label: string;
  /** Parent take id. */
  takeId: string;
  /** Normalized source start (0..1). */
  trimStart: number;
  /** Normalized source end (0..1). */
  trimEnd: number;
  /** Timeline seconds where the clip starts. */
  offset: number;
  /** Timeline seconds (audible length). */
  duration: number;
  volume: number;
  isMuted: boolean;
}

export type TrimEdge = "start" | "end";

// ─── Saved project (Studio → „Gotowe Numery” library) ──────────────────────

/** Serializable snapshot of a take (no Blob/object URL — those die with the session). */
export interface SavedTakeState {
  id: string;
  label: string;
  duration: number;
  offset: number;
  volume: number;
  isMuted: boolean;
  isSoloed: boolean;
  trimStart: number;
  trimEnd: number;
  /** Server URL of the uploaded recording — /api/recordings/<takeId>. */
  audioUrl?: string;
}

/** Serializable snapshot of one timeline clip. */
export interface SavedClipState {
  id: string;
  label: string;
  trimStart: number;
  trimEnd: number;
  offset: number;
  duration: number;
  volume: number;
  isMuted: boolean;
}

/**
 * A project saved from the Studio — the FULL editable state: beat settings,
 * the teleprompter lyrics picked from The Vault, every track (take) with its
 * volume/mute/solo/trim/offset, and the complete clip timeline arrangement.
 * Stored in the shared „Gotowe Numery” library (localStorage `flowforge-beats`).
 */
export interface SavedProject {
  kind: "project";
  id: string;
  /** Card title — derived from the Vault lyrics label or the beat name. */
  title: string;
  artist: string;
  genre: string;
  /** Human-readable duration shown on the library card. */
  duration: string;
  beatName: string;
  beatVolume: number;
  /** Selected lyrics loaded from The Vault into the teleprompter. */
  teleprompterText: string;
  teleprompterSpeed: number;
  /** Every track with its full state. */
  takes: SavedTakeState[];
  /** The complete clip timeline, per take. */
  clips: { takeId: string; items: SavedClipState[] }[];
  savedAt: string;
}

// ─── The Vault text source (persisted to localStorage by The Vault page) ──────

export interface VaultVersion {
  id: string;
  content: string;
  label: string;
  timestamp?: string;
}

export interface VaultTextItem {
  id: string;
  label: string;
  content: string;
  meta: string;
  isDraft?: boolean;
}

// ─── Session persistence ───────────────────────────────────────────────────────

export interface SessionData {
  beatName: string;
  beatVolume: number;
  teleprompterText: string;
  teleprompterSpeed: number;
  takes: { label: string; duration: number }[];
  savedAt: string;
}
