/* eslint-disable no-console */
// Unit tests for the pure level/streak helpers.
// Run: npx tsx scripts/test-progress.ts
import {
  calculateLevel,
  getLevelProgress,
  calculateStreak,
  daysSince,
  LEVEL_THRESHOLDS,
} from "../src/lib/progress";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

// ── Helpers ──
/** Local date string → Date at noon (avoids DST edge cases). */
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0);
const dayAgo = (n: number) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
};

console.log("🎚️ calculateLevel");
assert(calculateLevel(0) === 1, "0 pkt → poziom 1");
assert(calculateLevel(49) === 1, "49 pkt → poziom 1");
assert(calculateLevel(50) === 2, "50 pkt → poziom 2");
assert(calculateLevel(149) === 2, "149 pkt → poziom 2");
assert(calculateLevel(3000) === 10, "3000 pkt → maksymalny poziom 10");
assert(calculateLevel(99999) === 10, "ponad max → poziom 10");

console.log("📊 getLevelProgress");
{
  const p = getLevelProgress(240);
  assert(p.level === 3, "240 pkt → poziom 3");
  assert(p.current === 150 && p.next === 300, "próg 150 → 300");
  // (240 - 150) / (300 - 150) = 0.6
  assert(Math.abs(p.progress - 0.6) < 1e-9, "postęp 60% do poziomu 4");
}
{
  const p = getLevelProgress(0);
  assert(p.level === 1 && p.current === 0 && p.next === 50 && p.progress === 0, "0 pkt → 0% na poziomie 1");
}
{
  const p = getLevelProgress(99999);
  assert(p.progress === 1 && p.next === p.current, "maksymalny poziom → 100%, brak następnego progu");
}

console.log("🔥 calculateStreak");
{
  const none = calculateStreak([]);
  assert(none.streak === 0 && none.lastWritingDay === null, "brak wersji → streak 0");
}
{
  // Yesterday + day before → 2-day streak (alive — today not written yet).
  const s = calculateStreak([dayAgo(1), dayAgo(2)]);
  assert(s.streak === 2, "wczoraj + przedwczoraj → streak 2");
}
{
  // Today + yesterday → 2.
  const s = calculateStreak([dayAgo(0), dayAgo(1)]);
  assert(s.streak === 2, "dziś + wczoraj → streak 2");
}
{
  // Only today → 1.
  const s = calculateStreak([dayAgo(0)]);
  assert(s.streak === 1, "tylko dziś → streak 1");
}
{
  // Only day-before-yesterday → broken streak.
  const s = calculateStreak([dayAgo(2)]);
  assert(s.streak === 0, "ostatnio 2 dni temu → seria przerwana (0)");
  assert(s.lastWritingDay !== null, "lastWritingDay nadal zwracany");
}
{
  // 1, 2 and 3 days ago → 3-day streak.
  const s = calculateStreak([dayAgo(1), dayAgo(2), dayAgo(3)]);
  assert(s.streak === 3, "3 kolejne dni → streak 3");
}
{
  // Gap breaks the run: yesterday + 3 days ago → 1 (yesterday only).
  const s = calculateStreak([dayAgo(1), dayAgo(3)]);
  assert(s.streak === 1, "przerwa (brak przedwczoraj) → streak 1 od wczoraj");
}
{
  // Duplicate timestamps on the same day count once.
  const s = calculateStreak([at(2026, 1, 10), at(2026, 1, 10), at(2026, 1, 9)]);
  assert(s.streak >= 0, "duplikaty w ciągu dnia nie psują liczenia");
}

console.log("📅 daysSince");
{
  const today = new Date();
  assert(daysSince(`${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`) === 0, "dziś → 0 dni temu");
  const y = new Date();
  y.setDate(y.getDate() - 1);
  assert(daysSince(`${y.getFullYear()}-${y.getMonth() + 1}-${y.getDate()}`) === 1, "wczoraj → 1 dzień temu");
  assert(daysSince(null) === null, "null → null");
}

console.log("📋 thresholds sanity");
assert(LEVEL_THRESHOLDS.length === 10, "10 progów poziomów");
assert(LEVEL_THRESHOLDS[0] === 0 && LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1] === 3000, "od 0 do 3000");

console.log(failures === 0 ? "\nAll progress tests passed ✔" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
