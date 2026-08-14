/* eslint-disable no-console */
// Unit tests for the pure track-sort helper.
// Run: npx tsx scripts/test-track-sort.ts
import { sortTracks, SORT_MODES, DEFAULT_DIRECTION } from "../src/lib/track-sort";

type Track = {
  id: string;
  title: string;
  wordCount: number;
  syllableCount: number;
  lineCount: number;
  versionCount: number;
  updatedAt: string;
};

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

const t = (partial: Partial<Track> & { id: string; title: string }): Track => ({
  wordCount: 0,
  syllableCount: 0,
  lineCount: 0,
  versionCount: 0,
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...partial,
});

const A = t({ id: "a", title: "Alfa", wordCount: 20, syllableCount: 60, lineCount: 8, updatedAt: "2026-08-01T00:00:00.000Z" });
const B = t({ id: "b", title: "Beta", wordCount: 50, syllableCount: 90, lineCount: 12, updatedAt: "2026-08-10T00:00:00.000Z" });
const C = t({ id: "c", title: "Ćma", wordCount: 30, syllableCount: 45, lineCount: 9, updatedAt: "2026-08-05T00:00:00.000Z" });

const ids = (list: Track[]) => list.map((x) => x.id).join(",");

console.log("🕒 updated — newest first (default)");
assert(ids(sortTracks([A, C, B], "updated")) === "b,c,a", "newest first");
assert(ids(sortTracks([B, A, C], "updated")) === "b,c,a", "stable across input order");

console.log("🔤 title — Polish-aware A–Z");
assert(ids(sortTracks([C, A, B], "title")) === "a,b,c", "Alfa < Beta < Ćma");

console.log("💬 words — most words first");
assert(ids(sortTracks([A, C, B], "words")) === "b,c,a", "Beta(50) > Ćma(30) > Alfa(20)");

console.log("🔢 syllables — most syllables first");
assert(ids(sortTracks([C, B, A], "syllables")) === "b,a,c", "Beta(90) > Alfa(60) > Ćma(45)");

console.log("⚖️ tie-breaks");
const tieWords = t({ id: "tw", title: "Równe słowa", wordCount: 20, lineCount: 5, updatedAt: "2026-08-02T00:00:00.000Z" });
const tieWords2 = t({ id: "tw2", title: "Równe słowa 2", wordCount: 20, lineCount: 9, updatedAt: "2026-08-02T00:00:00.000Z" });
assert(ids(sortTracks([tieWords, tieWords2], "words")) === "tw2,tw", "equal words → more lines first");
const tieSyll = t({ id: "ts", title: "Syl", syllableCount: 60, wordCount: 10, updatedAt: "2026-08-02T00:00:00.000Z" });
const tieSyll2 = t({ id: "ts2", title: "Syl 2", syllableCount: 60, wordCount: 40, updatedAt: "2026-08-02T00:00:00.000Z" });
assert(ids(sortTracks([tieSyll, tieSyll2], "syllables")) === "ts2,ts", "equal syllables → more words first");

console.log("🧪 input never mutated");
const input = [A, C, B];
sortTracks(input, "words");
assert(input.map((x) => x.id).join(",") === "a,c,b", "original array order untouched");

console.log("📋 SORT_MODES covers all four modes");
assert(SORT_MODES.map((m) => m.id).join(",") === "updated,title,words,syllables", "exactly the four modes");

console.log("⬆️⬇️ directions");
assert(ids(sortTracks([A, C, B], "updated", "asc")) === "a,c,b", "updated asc → oldest first");
assert(ids(sortTracks([C, A, B], "title", "desc")) === "c,b,a", "title desc → Z–A (Ćma, Beta, Alfa)");
assert(ids(sortTracks([A, C, B], "words", "asc")) === "a,c,b", "words asc → fewest words first (flips desc)");
assert(ids(sortTracks([C, B, A], "syllables", "asc")) === "c,a,b", "syllables asc → fewest syllables first");

console.log("🔁 direction defaults + tie-break mirror");
assert(DEFAULT_DIRECTION.updated === "desc" && DEFAULT_DIRECTION.title === "asc" && DEFAULT_DIRECTION.words === "desc" && DEFAULT_DIRECTION.syllables === "desc", "natural directions per mode");
assert(ids(sortTracks([A, C, B], "words")) === ids(sortTracks([A, C, B], "words", "desc")), "two-arg call === explicit desc for words");
const tieAsc = t({ id: "ta", title: "Równe", wordCount: 20, lineCount: 5, updatedAt: "2026-08-02T00:00:00.000Z" });
const tieAsc2 = t({ id: "ta2", title: "Równe 2", wordCount: 20, lineCount: 9, updatedAt: "2026-08-02T00:00:00.000Z" });
assert(ids(sortTracks([tieAsc, tieAsc2], "words", "asc")) === "ta,ta2", "words asc ties → fewer lines first (mirror)");

console.log(failures === 0 ? "\nAll track-sort tests passed ✔" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
