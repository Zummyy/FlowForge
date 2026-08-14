/* eslint-disable no-console */
// Unit tests for the pure challenge logic (applyChallengeEvent and friends).
// Run: npx tsx scripts/test-challenges.ts
import {
  applyChallengeEvent,
  emptyChallengeState,
  evaluateNewlyCompleted,
  getCompletedCount,
  getTotalScore,
  parseChallengeState,
  CHALLENGES,
  MAX_SCORE,
} from "../src/lib/challenges";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

const state = () => emptyChallengeState();

console.log("📈 applyChallengeEvent — increment");
{
  const { state: next, newly } = applyChallengeEvent(state(), { type: "increment", stat: "takes" });
  assert(next.stats.takes === 1, "increment bumps the stat");
  assert(newly.length === 1 && newly[0].id === "szybki-start", "„Szybki Start” completes at 1 take");
  assert(next.completed["szybki-start"] !== undefined, "completion timestamp recorded");
}

console.log("🔁 idempotence — repeating an event never re-awards");
{
  let s = state();
  ({ state: s } = applyChallengeEvent(s, { type: "increment", stat: "takes" }));
  const { state: s2, newly } = applyChallengeEvent(s, { type: "increment", stat: "takes" });
  assert(newly.length === 0, "second take awards nothing new");
  assert(s2.stats.takes === 2, "stat still accumulates");
  assert(getTotalScore(s2) === 50, "score counts the completed challenge once");
}

console.log("📜 setLyricsLines — current value, not cumulative (max)");
{
  const { state: s1 } = applyChallengeEvent(state(), { type: "setLyricsLines", lines: 10 });
  const { state: s2 } = applyChallengeEvent(s1, { type: "setLyricsLines", lines: 5 });
  assert(s2.stats.lyricsLines === 10, "lower line count never lowers the stat");
  assert(s2.completed["mistrz-rymu"] !== undefined, "8 lines complete „Mistrz Rymu”");
}

console.log("🎯 compound requirement — „Bit i Słowo” needs a take too");
{
  const { newly: n1 } = applyChallengeEvent(state(), { type: "increment", stat: "beats" });
  assert(!n1.some((c) => c.id === "bit-i-slowo"), "beat alone does not complete „Bit i Słowo”");
  let s = state();
  ({ state: s } = applyChallengeEvent(s, { type: "increment", stat: "beats" }));
  const { newly: n2 } = applyChallengeEvent(s, { type: "increment", stat: "takes" });
  assert(n2.some((c) => c.id === "bit-i-slowo"), "beat + take completes „Bit i Słowo”");
}

console.log("🧮 evaluateNewlyCompleted / counts");
{
  const s = emptyChallengeState();
  s.stats.takes = 3;
  const newly = evaluateNewlyCompleted(s);
  assert(
    newly.length === 2 && newly.some((c) => c.id === "szybki-start") && newly.some((c) => c.id === "dzwiek-z-pamieci"),
    "3 takes → „Szybki Start” + „Dźwięk z Pamięci”"
  );
  s.completed["dzwiek-z-pamieci"] = new Date().toISOString();
  s.completed["szybki-start"] = new Date().toISOString();
  assert(evaluateNewlyCompleted(s).length === 0, "already-completed challenges are excluded");
  assert(getCompletedCount(s) === 2, "completed count");
  assert(getTotalScore(s) === 250, "score = 50 (Szybki Start) + 200 (Dźwięk z Pamięci)");
}

console.log("🛡️ parseChallengeState — tolerant of garbage / old saves");
{
  const parsed = parseChallengeState({
    completed: { "szybki-start": "2026-01-01T00:00:00.000Z" },
    stats: { takes: 5 },
    updatedAt: "2026-01-02T00:00:00.000Z",
  });
  assert(parsed.stats.takes === 5, "known stat preserved");
  assert(parsed.stats.splits === 0, "missing stats default to 0");
  assert(parsed.completed["szybki-start"] === "2026-01-01T00:00:00.000Z", "completed preserved");
  const garbage = parseChallengeState(null);
  assert(garbage.stats.takes === 0 && Object.keys(garbage.completed).length === 0, "null → empty state");
  const partial = parseChallengeState({ stats: "nope" });
  assert(partial.stats.takes === 0, "malformed stats ignored");
}

console.log("📋 definitions sanity");
{
  assert(CHALLENGES.length === 10, "exactly 10 challenges");
  assert(new Set(CHALLENGES.map((c) => c.id)).size === CHALLENGES.length, "unique ids");
  assert(MAX_SCORE === CHALLENGES.reduce((s, c) => s + c.points, 0), "MAX_SCORE matches");
}

console.log(failures === 0 ? "\nAll challenge tests passed ✔" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
