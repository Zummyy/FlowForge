// Pure sorting logic for the /beats „Gotowe Numery” library.
// Extracted so it can be unit-tested without a component (see
// scripts/test-beat-sort.ts). Mirrors the Vault's track-sort pattern:
// a mode plus a per-mode direction, with deterministic tie-breaks.

export type BeatSortMode = "updated" | "title" | "artist" | "bpm";
export type SortDirection = "asc" | "desc";

/** Minimal structural shape a library row needs to be sortable. */
export interface SortableBeat {
  title: string;
  artist: string;
  bpm: number;
  /** ISO timestamp — missing on legacy localStorage rows; sorts last in "updated" desc. */
  createdAt?: string;
}

export const BEAT_SORT_MODES: ReadonlyArray<{ id: BeatSortMode; icon: string; label: string }> = [
  { id: "updated", icon: "🕒", label: "Data" },
  { id: "title", icon: "🔤", label: "Nazwa" },
  { id: "artist", icon: "🎤", label: "Artysta" },
  { id: "bpm", icon: "⏱️", label: "BPM" },
];

/** The direction each mode starts in (most useful view first). */
export const DEFAULT_BEAT_DIRECTION: Record<BeatSortMode, SortDirection> = {
  updated: "desc", // newest first
  title: "asc", // A–Z
  artist: "asc", // A–Z
  bpm: "asc", // slowest first
};

/**
 * Sorts a copy of the list (the input array is never mutated).
 * `direction` defaults to the mode's natural direction. Flipping the
 * direction mirrors the whole ordering, including the tie-breaks.
 */
export function sortBeats<T extends SortableBeat>(
  beats: readonly T[],
  mode: BeatSortMode,
  direction: SortDirection = DEFAULT_BEAT_DIRECTION[mode]
): T[] {
  const sorted = [...beats];
  // The comparators below are written in each mode's natural direction;
  // a factor of 1 keeps it, -1 mirrors the whole ordering (incl. tie-breaks).
  const factor = direction === DEFAULT_BEAT_DIRECTION[mode] ? 1 : -1;
  const cmpTitle = (a: T, b: T) => a.title.localeCompare(b.title, "pl");
  switch (mode) {
    case "title":
      // A–Z (desc: Z–A).
      return sorted.sort((a, b) => factor * cmpTitle(a, b));
    case "artist":
      // A–Z by artist (desc: Z–A); ties by title.
      return sorted.sort(
        (a, b) => factor * a.artist.localeCompare(b.artist, "pl") || cmpTitle(a, b)
      );
    case "bpm":
      // Slowest first (desc: fastest); ties by title.
      return sorted.sort((a, b) => factor * (a.bpm - b.bpm) || cmpTitle(a, b));
    case "updated":
    default:
      // Newest first (asc: oldest); rows without a date sort last in the
      // natural direction; ties by title.
      return sorted.sort((a, b) => {
        const byDate = factor * (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
        return byDate || cmpTitle(a, b);
      });
  }
}
