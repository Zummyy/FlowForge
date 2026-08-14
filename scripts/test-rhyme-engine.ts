// FlowForge Rhyme Engine v8 — regression & validation suite.
// Run with: npx tsx scripts/test-rhyme-engine.ts
// Exits non-zero on the first failed assertion.

import {
  classifyRhyme,
  detectRhymeGroups,
  detectLineRhymeTypes,
  findRhymes,
  type RhymeType,
} from "../src/lib/rhyme-engine";

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

function expectType(actual: RhymeType | null, expected: RhymeType | null, msg: string): void {
  assert(actual === expected, `${msg} (got ${actual ?? "null"}, expected ${expected ?? "null"})`);
}

// ─── 1. Phonetic normalization spot checks (through classification) ────

console.log("\n1. Phonetic rules (ó→u, ł→w, ch→h, nasals, palatalization)");

// ó = /u/: góra ~ kura is a perfect rhyme, góra ~ pora is only assonance.
expectType(classifyRhyme("góra", "kura"), "exact", 'ó→u: "góra" ↔ "kura" is exact');
expectType(classifyRhyme("góra", "pora"), "assonance", '"góra" ↔ "pora" stays assonance only');

// ł = /w/: mały ~ prawy rhyme on -awy.
expectType(classifyRhyme("mały", "prawy"), "exact", 'ł→w: "mały" ↔ "prawy" is exact');
expectType(classifyRhyme("głowa", "nowa"), "exact", '"głowa" ↔ "nowa" is exact');

// ch = /x/: duch ~ mucha rhyme.
assert(classifyRhyme("duch", "mucha") !== null, '"duch" ↔ "mucha" rhyme (ch→h)');

// Nasal vowels: final ą → on; before labial ę → em.
expectType(classifyRhyme("prostą", "rosną"), "exact", 'nasals: "prostą" ↔ "rosną" rhyme (ą→on)');
assert(classifyRhyme("wstęp", "szept") !== null, '"wstęp" ↔ "szept" rhyme (ę→em before p)');

// Palatalization: ciemny ~ ciemny… but also lini-a; soft/hard rhyme.
expectType(classifyRhyme("ludzie", "łodzie"), "exact", 'palatalization: "ludzie" ↔ "łodzie" is exact');
expectType(classifyRhyme("świat", "kwiat"), "exact", '"świat" ↔ "kwiat" is exact');

// ─── 2. Assonances & slants ────────────────────────────────────────────

console.log("\n2. Assonance / slant classification");

expectType(classifyRhyme("wolność", "złość"), "exact", '"wolność" ↔ "złość" (ość→osc) is exact');
expectType(classifyRhyme("miłość", "złość"), "exact", '"miłość" ↔ "złość" is exact');
expectType(classifyRhyme("noc", "rok"), "assonance", '"noc" ↔ "rok" is assonance (shared [o])');
expectType(classifyRhyme("kot", "dom"), "assonance", '"kot" ↔ "dom" is assonance (shared stressed [o])');
expectType(classifyRhyme("droga", "noga"), "exact", '"droga" ↔ "noga" is exact');
expectType(classifyRhyme("las", "pas"), "exact", '"las" ↔ "pas" is exact');
expectType(classifyRhyme("kot", "bot"), "exact", '"kot" ↔ "bot" is exact');
expectType(classifyRhyme("szybko", "nisko"), "assonance", '"szybko" ↔ "nisko" rhymes (assonance — [pkɔ]/[skɔ])');
expectType(classifyRhyme("deszcz", "jeszcze"), "assonance", '"deszcz" ↔ "jeszcze" rhymes (assonance)');

// Non-rhymes stay null.
expectType(classifyRhyme("samochód", "mikrofon"), null, '"samochód" ↔ "mikrofon" do not rhyme');
expectType(classifyRhyme("księżyc", "młot"), null, '"księżyc" ↔ "młot" do not rhyme');
expectType(classifyRhyme("", ""), null, "empty words → null");

// ─── 3. Multi-syllabic detection across whole lines ────────────────────

console.log("\n3. Multi-syllabic line detection (detectRhymeGroups)");

const userExample = [
  "Wychodzę na prostą",      // 0
  "Codziennie tu rosną",     // 1 → 2-syllable chunk matches line 0
  "To jest pierwsza linia",  // 2
  "A to jest druga linia",   // 3
  "Czas leci szybko",        // 4
  "A ja stoję nisko",        // 5
];
const groups = detectRhymeGroups(userExample);
assert(groups.size === 6, "every line belongs to a group");
assert(
  groups.get(0) !== undefined && groups.get(0) === groups.get(1),
  '"wychodzę na prostą" ↔ "codziennie tu rosną" share a group'
);
assert(
  groups.get(2) !== undefined && groups.get(2) === groups.get(3),
  '"linia" lines share a group'
);
assert(
  groups.get(4) !== undefined && groups.get(4) === groups.get(5),
  '"szybko" ↔ "nisko" lines share a group'
);
assert(
  groups.get(0) !== groups.get(2) && groups.get(0) !== groups.get(4) && groups.get(2) !== groups.get(4),
  "the three rhyme groups are distinct"
);

// Inflected forms rhyme across cases (instrumental -ą).
const inflectedLines = ["Idę nocą", "Wracam drogą"];
const inflectedGroups = detectRhymeGroups(inflectedLines);
assert(
  inflectedGroups.get(0) !== undefined && inflectedGroups.get(0) === inflectedGroups.get(1),
  'instrumental inflections "nocą" ↔ "drogą" share a group'
);

// Stop words never anchor a group: both lines end on a function word.
const stopWordLines = ["Wchodzę na", "Wychodzę stąd"];
const stopGroups = detectRhymeGroups(stopWordLines);
assert(
  stopGroups.get(0) !== undefined && stopGroups.get(0) === stopGroups.get(1),
  '"Wchodzę na" ↔ "Wychodzę stąd" rhyme via content words, not "na"'
);

// ─── 3b. Per-line rhyme types (marker coloring) ────────────────────────

console.log("\n3b. Per-line rhyme types (detectLineRhymeTypes)");

const lineTypes = detectLineRhymeTypes(userExample);
// Every pair in the example rhymes (0-1, 2-3, 4-5) and all 6 lines are typed.
assert(lineTypes.size === 6, "all 6 rhyming lines carry a type");
assert(
  lineTypes.get(0) !== undefined && lineTypes.get(0) === lineTypes.get(1),
  'lines 0-1 both carry the same rhyme type (wielosylabowe exact)'
);
assert(
  lineTypes.get(2) !== undefined && lineTypes.get(2) === lineTypes.get(3),
  '"linia" lines carry the same rhyme type'
);
assert(
  lineTypes.get(4) !== undefined && lineTypes.get(4) === lineTypes.get(5),
  '"szybko" ↔ "nisko" lines share a rhyme type'
);
// Type map keys must match the group map keys exactly (same grouping).
const groupKeys = new Set(detectRhymeGroups(userExample).keys());
const typeKeys = new Set(lineTypes.keys());
assert(
  groupKeys.size === typeKeys.size &&
    [...groupKeys].every((k) => typeKeys.has(k)),
  "detectLineRhymeTypes keys match detectRhymeGroups keys"
);
// Non-rhyming input → empty maps.
const noRhymes = ["Prowadzę samochód", "Śpiewam w mikrofon"];
assert(
  detectLineRhymeTypes(noRhymes).size === 0 &&
    detectLineRhymeTypes([]).size === 0,
  "non-rhyming and empty input produce an empty type map"
);
// Empty lines are skipped (never typed).
const withBlank = ["Wychodzę na prostą", "", "Codziennie tu rosną"];
assert(
  detectLineRhymeTypes(withBlank).size === 2 &&
    detectLineRhymeTypes(withBlank).get(1) === undefined,
  "blank lines are skipped by the type detector"
);

// ─── 4. findRhymes ─────────────────────────────────────────────────────

console.log("\n4. findRhymes (dictionary, dedup, filtering, ordering)");

const nocRhymes = findRhymes("noc");
assert(nocRhymes.length > 0, "findRhymes('noc') returns suggestions");
assert(
  nocRhymes.some((r) => r.word === "moc" && r.type === "exact"),
  'findRhymes("noc") includes "moc" as exact'
);
assert(nocRhymes[0].type === "exact", "best suggestion for 'noc' is an exact rhyme");
assert(
  nocRhymes.filter((r) => r.type === "assonance").length > 0,
  "findRhymes('noc') includes assonances (e.g. 'rok', 'dom')"
);
assert(
  new Set(nocRhymes.map((r) => r.word)).size === nocRhymes.length,
  "findRhymes returns no duplicate words (dictionary de-duplicated)"
);
{
  const order = nocRhymes.map((r) => r.type);
  const ranks = { exact: 3, assonance: 2, slant: 1 } as const;
  const sorted = order.every((t, i) => i === 0 || ranks[order[i - 1]] >= ranks[t]);
  assert(sorted, "findRhymes results are ordered exact → assonance → slant");
}

const goraRhymes = findRhymes("góra");
assert(
  goraRhymes.some((r) => r.word === "kura" && r.type === "exact"),
  'findRhymes("góra") includes "kura" as exact (ó→u)'
);

const wolnoscRhymes = findRhymes("wolność");
assert(
  wolnoscRhymes.some((r) => r.word === "złość" && r.type === "exact"),
  'findRhymes("wolność") includes "złość" as exact'
);

const prostaRhymes = findRhymes("prostą");
assert(
  prostaRhymes.some((r) => r.word === "rosną" && r.type === "exact"),
  'findRhymes("prostą") includes "rosną" as exact (multi-syllabic, nasal vowels)'
);

// Dictionary growth: slang + inflected forms.
assert(findRhymes("kasa").length > 0, "findRhymes('kasa') suggests slang rhymes");
assert(findRhymes("hajs").length > 0, "findRhymes('hajs') suggests rhymes (slang money vocab)");
assert(
  findRhymes("chodzę").some((r) => r.word === "widzę" && r.type === "exact"),
  'findRhymes("chodzę") includes "widzę" as exact (1st-person verb forms)'
);
assert(
  classifyRhyme("dzielnia", "dzielnica") !== null,
  '"dzielnia" ↔ "dzielnica" is a recognized rhyme pairing (slang ↔ base word)'
);
assert(
  !prostaRhymes.some((r) => r.word === "prostą"),
  "findRhymes never returns the query word itself"
);
assert(findRhymes("nocy").length > 0, "findRhymes('nocy') works on inflected forms");
assert(
  findRhymes("wolna").some((r) => r.word === "mocna"),
  'findRhymes("wolna") includes "mocna" (adjective inflections)'
);

assert(findRhymes("tak").length === 0, "findRhymes('tak') is empty (stop word)");
assert(findRhymes("się").length === 0, "findRhymes('się') is empty (stop word)");
assert(findRhymes("tam").length > 0, "findRhymes('tam') still suggests rhymes (e.g. 'sam')");
assert(findRhymes("").length === 0, "findRhymes('') is empty");
assert(findRhymes("!!!").length === 0, "findRhymes('!!!') is empty");
assert(findRhymes("NOC").some((r) => r.word === "moc"), "findRhymes is case-insensitive");

// ─── 5. Performance sanity ─────────────────────────────────────────────

console.log("\n5. Performance");

const bigLyric = Array.from({ length: 40 }, (_, i) => {
  const endings = ["nocą", "mroku", "linia", "szybko", "nisko", "prostą", "rosną", "drogi"];
  return `Wiersz numer ${i} idzie przez ${endings[i % endings.length]}`;
});

let t = performance.now();
const bigGroups = detectRhymeGroups(bigLyric);
const groupMs = performance.now() - t;
assert(groupMs < 2000, `detectRhymeGroups on 40 lines took ${groupMs.toFixed(1)}ms`);
assert(bigGroups.size > 0, "40-line lyric produced rhyme groups");

t = performance.now();
const many = findRhymes("miłość");
const findMs = performance.now() - t;
assert(findMs < 1000, `findRhymes took ${findMs.toFixed(1)}ms`);
assert(many.length > 0, "findRhymes('miłość') returns suggestions");

// ─── Result ────────────────────────────────────────────────────────────

console.log(failures === 0 ? "\n✅ All rhyme-engine checks passed." : `\n❌ ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
