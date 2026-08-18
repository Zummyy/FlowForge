/* eslint-disable no-console */
// Unit tests for the pure /beats library sort helper.
// Run: npx tsx scripts/test-beat-sort.ts
import { sortBeats, BEAT_SORT_MODES, DEFAULT_BEAT_DIRECTION } from "../src/lib/beat-sort";

type Beat = {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  createdAt?: string;
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

const b = (partial: Partial<Beat> & { id: string; title: string }): Beat => ({
  artist: "Artysta",
  bpm: 90,
  createdAt: "2026-08-01T00:00:00.000Z",
  ...partial,
});

// Mirrors the seeded /beats library: Miejski Rytm(92) / Nocny Drive(128) / Stary Blok(85).
const MIEJSKI = b({ id: "m", title: "Miejski Rytm", artist: "FlowForge", bpm: 92, createdAt: "2026-08-01T00:00:00.000Z" });
const NOCNY = b({ id: "n", title: "Nocny Drive", artist: "Zummyy", bpm: 128, createdAt: "2026-08-02T00:00:00.000Z" });
const STARY = b({ id: "s", title: "Stary Blok", artist: "FlowForge", bpm: 85, createdAt: "2026-08-03T00:00:00.000Z" });

const ids = (list: Beat[]) => list.map((x) => x.id).join(",");

console.log("🕒 updated — newest first (default)");
assert(ids(sortBeats([MIEJSKI, STARY, NOCNY], "updated")) === "s,n,m", "newest first (Stary > Nocny > Miejski)");
assert(ids(sortBeats([NOCNY, MIEJSKI, STARY], "updated")) === "s,n,m", "stable across input order");
assert(ids(sortBeats([MIEJSKI, STARY, NOCNY], "updated", "asc")) === "m,n,s", "asc mirrors to oldest first");
const noDate = b({ id: "x", title: "Stary lokalny", createdAt: undefined });
assert(
  ids(sortBeats([NOCNY, noDate, MIEJSKI], "updated")) === "n,m,x",
  "missing createdAt sorts last in the natural direction"
);

console.log("🔤 title — Polish-aware A–Z");
assert(ids(sortBeats([STARY, MIEJSKI, NOCNY], "title")) === "m,n,s", "Miejski < Nocny < Stary");
assert(ids(sortBeats([STARY, MIEJSKI, NOCNY], "title", "desc")) === "s,n,m", "desc mirrors to Z–A");

console.log("🎤 artist — A–Z with title tie-break");
const tie1 = b({ id: "t1", title: "Alfa", artist: "Zummyy" });
const tie2 = b({ id: "t2", title: "Beta", artist: "Zummyy" });
assert(ids(sortBeats([tie2, tie1], "artist")) === "t1,t2", "same artist → title A–Z");
assert(ids(sortBeats([MIEJSKI, NOCNY], "artist")) === "m,n", "FlowForge < Zummyy");

console.log("⏱️ bpm — slowest first (default), fastest first (desc)");
assert(ids(sortBeats([NOCNY, MIEJSKI, STARY], "bpm")) === "s,m,n", "85 < 92 < 128");
assert(ids(sortBeats([NOCNY, MIEJSKI, STARY], "bpm", "desc")) === "n,m,s", "desc mirrors to fastest first");

console.log("📋 modes & defaults");
assert(BEAT_SORT_MODES.map((m) => m.id).join(",") === "updated,title,artist,bpm", "mode list is complete");
assert(DEFAULT_BEAT_DIRECTION.updated === "desc", "updated defaults to desc");
assert(DEFAULT_BEAT_DIRECTION.title === "asc" && DEFAULT_BEAT_DIRECTION.artist === "asc", "title/artist default to asc");
assert(DEFAULT_BEAT_DIRECTION.bpm === "asc", "bpm defaults to asc");

console.log("🧊 immutability");
const input = [STARY, MIEJSKI, NOCNY];
const snapshot = [...input];
sortBeats(input, "title");
assert(ids(input) === ids(snapshot), "input array is never mutated");

console.log(failures === 0 ? "\nAll beat-sort tests passed" : `\n${failures} beat-sort test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
