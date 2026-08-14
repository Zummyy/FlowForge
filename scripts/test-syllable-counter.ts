/* eslint-disable no-console */
// Unit tests for the Polish syllable counter.
// Run: npx tsx scripts/test-syllable-counter.ts
import {
  countLineSyllables,
  countWordSyllablesInLine,
  analyzeLyrics,
} from "../src/lib/syllable-counter";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

console.log("🔤 single words — exact counts");
const expected: Array<[string, number]> = [
  ["pies", 1],       // pʲɛs — palatalized „ie” is one vowel sound
  ["kot", 1],
  ["mama", 2],
  ["ulica", 3],
  ["serce", 2],
  ["muzyka", 3],
  ["ciemność", 2],   // ciem-ność (palatalized i)
  ["miasto", 2],     // mias-to (palatalized i)
  ["piosenka", 3],   // pio-sen-ka
  ["historia", 3],   // his-to-ria
  ["radio", 2],      // ra-dio
  ["studio", 2],     // stu-dio
  ["piękny", 2],     // pięk-ny
  ["dzień", 1],
  ["tęsknota", 3],
  ["horyzont", 3],
  ["wolność", 2],
  ["auto", 2],       // au-to (diphthong)
  ["nauka", 2],      // na-u-ka — naive diphthong handling, documented
  ["idea", 3],       // i-de-a (regression: stateful regex skipped the last vowel → 2)
  ["teatr", 2],      // te-atr (regression: skipped adjacent vowel → 1)
  ["naiwny", 3],     // na-iw-ny (regression: skipped adjacent vowel → 2)
  ["mgła", 1],
];
for (const [word, syllables] of expected) {
  assert(
    countLineSyllables(word) === syllables,
    `„${word}” → ${syllables} sylab (got ${countLineSyllables(word)})`
  );
}

console.log("🔤 vowel-heavy words stay consistent (no alternation drift)");
const vowelHeavy = ["europejski", "uwielbiam", "zrozumienie", "przeciwności", "bezwzględnie", "przyszłość"];
for (const word of vowelHeavy) {
  const first = countLineSyllables(word);
  const second = countLineSyllables(word);
  assert(first === second && first > 0, `„${word}” deterministic (${first})`);
}

console.log("📏 lines");
assert(countLineSyllables("  ") === 0, "blank line → 0");
assert(countLineSyllables("pies i kot") === 3, "„pies i kot” → 3 (2 + 1)");
assert(countLineSyllables("KOT") === 1, "case-insensitive (KOT → 1)");

console.log("🧩 countWordSyllablesInLine");
const words = countWordSyllablesInLine("miasto serce");
assert(words.length === 2, "two words returned");
assert(words[0].syllables === 2 && words[1].syllables === 2, "per-word counts (miasto=2, serce=2)");

console.log("🧪 regression: adjacent-vowel undercount (stateful /g regex)");
assert(countLineSyllables("idea") === 3, "idea → 3 (was 2 with the /g regex)");
assert(countLineSyllables("teatr") === 2, "teatr → 2 (was 1 with the /g regex)");
assert(countLineSyllables("naiwny") === 3, "naiwny → 3 (was 2 with the /g regex)");

console.log("📊 analyzeLyrics");
const analysis = analyzeLyrics("miasto serce\n\npies i kot");
assert(analysis.lineCount === 2, "2 non-empty lines");
assert(analysis.verseCount === 2, "2 verses (blank-line separated)");
assert(analysis.wordCount === 5, "5 words (miasto serce pies i kot)");
assert(analysis.totalSyllables === 2 + 2 + 1 + 1 + 1, "total syllables summed correctly (miasto=2, serce=2, pies=1, i=1, kot=1)");
assert(analysis.lines[0].syllables === 4, "first line → 4 syllables");

console.log(failures === 0 ? "\nAll syllable-counter tests passed ✔" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
