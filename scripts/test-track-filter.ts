/* eslint-disable no-console */
// Unit tests for the pure track-filter helper.
// Run: npx tsx scripts/test-track-filter.ts
import { filterTracks, normalizeTrackText } from "../src/lib/track-filter";

type Track = { id: string; title: string; versionLabels?: string[] };

const tracks: Track[] = [
  { id: "a", title: "Utwór A" },
  { id: "b", title: "Zespół Noc" },
  { id: "c", title: "Alfa Omega" },
];

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

const ids = (list: Track[]) => list.map((x) => x.id).join(",");

console.log("🔍 diacritics");
assert(ids(filterTracks(tracks, "utwor")) === "a", "„utwor” matches „Utwór” (ó→o)");
assert(ids(filterTracks(tracks, "zespol")) === "b", "„zespol” matches „Zespół” (ł→l)");
assert(ids(filterTracks(tracks, "Utwór")) === "a", "exact diacritics also match");

console.log("🔠 case-insensitivity");
assert(ids(filterTracks(tracks, "ALFA")) === "c", "uppercase query matches lowercase title");
assert(ids(filterTracks(tracks, "alfa omega")) === "c", "full title matches");

console.log("📏 substring + trim");
assert(ids(filterTracks(tracks, "  noc ")) === "b", "whitespace is trimmed around the query");
assert(ids(filterTracks(tracks, "om")) === "c", "substring in the middle matches");

console.log("🏷️ version labels");
const labeled: Track[] = [
  { id: "a", title: "Utwór A", versionLabels: ["Wersja Złota", "Wersja 2"] },
  { id: "b", title: "Utwór B", versionLabels: ["Finalna wersja"] },
  { id: "c", title: "Utwór C" },
];
assert(ids(filterTracks(labeled, "zlota")) === "a", "label „Wersja Złota” matches „zlota” (diacritics)");
assert(ids(filterTracks(labeled, "finalna")) === "b", "label „Finalna wersja” matches „finalna”");
assert(ids(filterTracks(labeled, "wersja")) === "a,b", "label match works alongside the title path");
assert(ids(filterTracks(labeled, "utwor")) === "a,b,c", "title-only search still matches tracks without labels");
assert(ids(filterTracks(labeled, "nic")) === "", "no label or title match → excluded");

console.log("🧹 empty & no-match");
assert(ids(filterTracks(tracks, "")) === "a,b,c", "empty query returns the whole list in order");
assert(ids(filterTracks(tracks, "   ")) === "a,b,c", "whitespace-only query returns the whole list");
assert(ids(filterTracks(tracks, "nie istnieje")) === "", "no match returns an empty list");

console.log("🧪 input never mutated");
filterTracks(tracks, "utwor");
assert(tracks.map((x) => x.id).join(",") === "a,b,c", "original array untouched");

console.log("🔤 normalizeTrackText");
assert(normalizeTrackText("Zespół Ćma") === "zespol cma", "strips all combining marks");

console.log(failures === 0 ? "\nAll track-filter tests passed ✔" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
