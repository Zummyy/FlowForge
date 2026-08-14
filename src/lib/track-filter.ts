// Pure filtering logic for the Vault „Utwory” track list.
// Extracted so it can be unit-tested without a component (see
// scripts/test-track-filter.ts).

/**
 * Case- and diacritic-insensitive lowercase form, so „utwór” matches a
 * search for „utwor” and „ALFA” matches „alfa”. Most Polish diacritics
 * decompose via NFD, but „ł” is a stroke (no combining mark) — hence the
 * explicit transliteration map.
 */
// Uppercase „Ł” is already lowercased by the time the map is applied.
const TRANSLITERATIONS: Record<string, string> = {
  "ł": "l",
};

export function normalizeTrackText(s: string): string {
  let out = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  for (const [from, to] of Object.entries(TRANSLITERATIONS)) {
    out = out.replaceAll(from, to);
  }
  return out;
}

/** Structural shape a list row needs to be searchable. */
export interface SearchableTrack {
  title: string;
  /** Recent version labels — also searched (optional, backwards-compatible). */
  versionLabels?: readonly string[];
}

/**
 * Filters a copy of the list by title or version label (the input array is
 * never mutated). A blank/whitespace query returns the whole list unchanged.
 */
export function filterTracks<T extends SearchableTrack>(
  tracks: readonly T[],
  query: string
): T[] {
  const q = normalizeTrackText(query.trim());
  if (!q) return [...tracks];
  return tracks.filter((t) => {
    if (normalizeTrackText(t.title).includes(q)) return true;
    return (t.versionLabels ?? []).some((l) => normalizeTrackText(l).includes(q));
  });
}
