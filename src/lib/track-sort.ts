// Pure sorting logic for the Vault „Utwory” track list.
// Extracted so it can be unit-tested without a component (see
// scripts/test-track-sort.ts).

export type TrackSortMode = "updated" | "title" | "words" | "syllables";
export type SortDirection = "asc" | "desc";

/** Minimal structural shape a track list row needs to be sortable. */
export interface SortableTrack {
  title: string;
  wordCount: number;
  syllableCount: number;
  lineCount: number;
  updatedAt: string; // ISO
}

export const SORT_MODES: ReadonlyArray<{ id: TrackSortMode; icon: string; label: string }> = [
  { id: "updated", icon: "🕒", label: "Data" },
  { id: "title", icon: "🔤", label: "Nazwa" },
  { id: "words", icon: "💬", label: "Słowa" },
  { id: "syllables", icon: "🔢", label: "Sylaby" },
];

/** The direction each mode starts in (most useful view first). */
export const DEFAULT_DIRECTION: Record<TrackSortMode, SortDirection> = {
  updated: "desc", // newest first
  title: "asc", // A–Z
  words: "desc", // most words first
  syllables: "desc", // most syllables first
};

/**
 * Sorts a copy of the list (the input array is never mutated).
 * `direction` defaults to the mode's natural direction, so existing
 * two-argument callers keep their behavior. Flipping the direction mirrors
 * the whole ordering, including the tie-breaks.
 */
export function sortTracks<T extends SortableTrack>(
  tracks: readonly T[],
  mode: TrackSortMode,
  direction: SortDirection = DEFAULT_DIRECTION[mode]
): T[] {
  const sorted = [...tracks];
  // The comparators below are written in each mode's natural direction;
  // a factor of 1 keeps it, -1 mirrors the whole ordering (incl. tie-breaks).
  const factor = direction === DEFAULT_DIRECTION[mode] ? 1 : -1;
  const cmpTitle = (a: T, b: T) => a.title.localeCompare(b.title, "pl");
  switch (mode) {
    case "title":
      // A–Z (desc: Z–A).
      return sorted.sort((a, b) => factor * cmpTitle(a, b));
    case "words":
      // Most words first (asc: fewest); ties by line count, then title.
      return sorted.sort(
        (a, b) =>
          factor * (b.wordCount - a.wordCount || b.lineCount - a.lineCount) || cmpTitle(a, b)
      );
    case "syllables":
      // Most syllables first (asc: fewest); ties by word count, then title.
      return sorted.sort(
        (a, b) =>
          factor * (b.syllableCount - a.syllableCount || b.wordCount - a.wordCount) ||
          cmpTitle(a, b)
      );
    case "updated":
    default:
      // Newest first (asc: oldest); ties by title.
      return sorted.sort((a, b) => {
        const byDate = factor * b.updatedAt.localeCompare(a.updatedAt);
        return byDate || cmpTitle(a, b);
      });
  }
}
