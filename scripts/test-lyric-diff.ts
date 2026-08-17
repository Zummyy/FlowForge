// Run with: npx tsx scripts/test-lyric-diff.ts
// Line-based diff used by the Vault „Porównaj wersje” view.
import { diffLines, diffStats } from "../src/lib/lyric-diff";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ FAIL: ${msg}`);
  }
}

// 1. Identical content — everything unchanged.
const same = diffLines(["a", "b", "c"], ["a", "b", "c"]);
assert(
  same.length === 3 && same.every((l) => l.type === "same"),
  "identical content → every line unchanged"
);
assert(diffStats(["a"], ["a"]).similarity === 100, "identical → 100% similarity");

// 2. Added / removed lines.
const added = diffLines(["a"], ["a", "b"]);
assert(added.map((l) => l.type).join(",") === "same,added", "appended line → same,added");
const removed = diffLines(["a", "b"], ["a"]);
assert(removed.map((l) => l.type).join(",") === "same,removed", "dropped line → same,removed");

// 3. A changed line reads as a removed + added pair (old first, new second).
const changed = diffLines(["wers 1"], ["wers 2"]);
assert(
  changed.length === 2 && changed[0].type === "removed" && changed[1].type === "added",
  "changed line → removed + added pair"
);

// 4. Empty sides.
assert(diffLines([], []).length === 0, "empty vs empty → no rows");
assert(diffLines([], ["x"]).map((l) => l.type).join(",") === "added", "empty old → everything added");
assert(diffLines(["x"], []).map((l) => l.type).join(",") === "removed", "empty new → everything removed");

// 5. Stats — counts + similarity = unchanged / max(sides).
const st = diffStats(["a", "b", "c"], ["a", "x", "c", "d"]);
assert(st.added === 2 && st.removed === 1 && st.unchanged === 2, "stats count added/removed/unchanged");
assert(st.similarity === 50, `similarity = 2 unchanged / max(3,4) = 50% (got ${st.similarity})`);

// 6. Interleaved change in the middle keeps the surrounding anchor lines.
const inter = diffLines(["a", "b", "c"], ["a", "B", "c"]);
assert(
  inter.map((l) => `${l.type}:${l.text}`).join("|") === "same:a|removed:b|added:B|same:c",
  `middle change → same a, removed b, added B, same c (got ${inter.map((l) => `${l.type}:${l.text}`).join("|")})`
);

// 7. Realistic lyric shape — a rewritten second verse keeps the first verse.
const oldLyric = ["Zwrotka 1", "linia A", "linia B", "Refren", "hałas"];
const newLyric = ["Zwrotka 1", "linia A", "linia B", "Refren", "świeży tekst"];
const real = diffLines(oldLyric, newLyric);
assert(
  real.filter((l) => l.type === "removed").map((l) => l.text).includes("hałas") &&
    real.filter((l) => l.type === "added").map((l) => l.text).includes("świeży tekst"),
  "realistic diff isolates the rewritten line"
);
const realStats = diffStats(oldLyric, newLyric);
assert(
  realStats.removed === 1 && realStats.added === 1 && realStats.unchanged === 4,
  "realistic diff stats: 1 removed, 1 added, 4 unchanged"
);

console.log(`\n${passed} assertions passed, ${failed} failed`);
if (failed > 0) process.exit(1);
