// FlowForge Rhyme Engine v8 — Polish rap rhyme detection
//
// What changed vs v7:
// • Multi-syllabic rhymes: lines are compared on a 2-syllable phonetic
//   window ("chunk") built from the last non-stop words, so structures like
//   "wychodzę na prostą" ↔ "codziennie tu rosną" are detected, not just the
//   final word.
// • Paroxytonic accent: the penultimate (stressed) vowel is weighed in the
//   classification, matching standard Polish stress patterns.
// • Phonetically correct normalization: ó → u, ł → w, ch → h, ż → rz,
//   soft consonants (ć ś ź ń dź) → hard, i as a palatalization marker
//   before vowels (ci/si/zi/ni/dzi/mi/… → c/s/z/n/dz/m/…), and
//   context-sensitive nasal vowels (ą → om/on, ę → em/en depending on the
//   following consonant).
// • Assonance/slant detection driven by positional vowel skeletons and
//   tail/edit similarity over the phonetic forms.
// • Word-level clustering (detectRhymeClusters): the whole text is scanned,
//   not just line endings — internal rhymes, multi-syllabic matches and
//   repeated words anywhere form shared-color clusters (editor + panel).
// • Expanded STOP_WORDS (conjunctions, pronouns, particles, prepositions)
//   so function words never dictate a rhyme group.
// • Performance: every word is analyzed once and memoized; the rhyme
//   dictionary is pre-analyzed and de-duplicated lazily.

// ─── TYPES ─────────────────────────────────────────────────────────────

export type RhymeType = "exact" | "assonance" | "slant";

export interface RhymeResult {
  word: string;
  type: RhymeType;
  similarity: number;
  ending: string;
}

// ─── PHONETIC ALPHABET ─────────────────────────────────────────────────
// After `toPhonetic` the string contains only: a e i o u y (vowels),
// b c d f g h j k l m n p r s t w z, and the digraphs cz sz rz dz.

/** Vowel letters that remain after phonetic normalization (ą/ę/ó expand). */
const PHONETIC_VOWELS: ReadonlySet<string> = new Set(["a", "e", "i", "o", "u", "y"]);

/** Vowel groups used for the rhyme skeleton (y ≈ i — they rhyme in rap). */
const VOWEL_GROUP: Record<string, string> = {
  a: "a", e: "e", i: "i", o: "o", u: "u", y: "i",
};

/** Vowels that can follow a palatalization marker "i" (i/y do not count). */
const SOFT_VOWELS: ReadonlySet<string> = new Set(["a", "e", "o", "u", "ą", "ę"]);

/** All vowel letters incl. pre-normalization forms. */
const ALL_VOWELS: ReadonlySet<string> = new Set(["a", "e", "i", "o", "u", "y", "ą", "ę", "ó"]);

/**
 * Labial consonants — a preceding nasal vowel becomes homorganic "m".
 * Before any other consonant (and word-finally) the nasal is "n".
 */
const LABIALS: ReadonlySet<string> = new Set(["b", "p", "f", "w"]);

// ─── STOP WORDS ────────────────────────────────────────────────────────
// Function words that never carry a rhyme. Conjunctions, pronouns,
// particles, prepositions and the copula — expanded vs v7 so that a rhyme
// group is driven by content words only.

const STOP_WORDS: ReadonlySet<string> = new Set([
  // Conjunctions (spójniki)
  "i", "a", "o", "oraz", "lub", "albo", "ani", "czy", "ni", "ale", "lecz",
  "jednak", "jednakże", "natomiast", "tymczasem", "więc", "zatem", "bo", "bowiem",
  "że", "iż", "aż", "żeby", "aby", "by", "gdyż", "ponieważ", "dlatego",
  "chociaż", "choć", "mimo", "aczkolwiek", "jeśli", "jeżeli", "gdyby", "gdy",
  "kiedy", "jak", "póki", "dopóki", "zanim", "nim", "jakby",
  // Pronouns (zaimki) — all cases
  "ja", "ty", "on", "ona", "ono", "oni", "one", "my", "wy",
  "mnie", "mi", "mną", "mój", "moja", "moje", "moi", "moim", "moją",
  "ciebie", "cię", "tobie", "tobą", "twój", "twoja", "twoje", "twoi", "twoim",
  "go", "mu", "jemu", "ją", "jej", "je", "ich", "im", "nią", "nimi",
  "nas", "nam", "nami", "nasz", "nasza", "nasze", "naszym",
  "was", "wam", "wami", "wasz", "wasza", "wasze", "waszym",
  "siebie", "sobie", "się", "swój", "swoja", "swoje", "swoi", "swoim",
  "kto", "co", "kogo", "czego", "komu", "czemu", "kim", "czym",
  "czyj", "czyja", "czyje", "który", "która", "które", "którego", "której",
  "któremu", "którym", "którą", "których", "którymi",
  "ten", "ta", "to", "te", "tego", "tej", "temu", "tym", "tą", "tę", "tych",
  "tamten", "tamta", "tamto", "tamte", "tamtego", "tamtej", "tamtym",
  "nic", "nikt", "niczego", "nikogo", "niczym", "nikim",
  "wszyscy", "wszystko", "wszystkie", "wszystkiego", "wszystkich", "wszystkim",
  "każdy", "każda", "każde", "każdego", "każdej", "każdemu", "każdym",
  "ktoś", "coś", "ktokolwiek", "cokolwiek",
  "jaki", "jaka", "jakie", "jakiego", "jakiej", "jakim",
  // Particles & function adverbs
  "nie", "tak", "tylko", "też", "także", "również", "nawet", "właśnie", "chyba",
  "zaledwie", "dopiero", "jedynie", "wyłącznie", "czyż", "niech", "no",
  "już", "znów", "znowu", "wciąż",
  // Only clearly meaning-less place adverbs are stopped — words like
  // "tam", "wszędzie", "dziś", "wczoraj" carry real rhyme value
  // ("tam" ↔ "gram", "wszędzie" ↔ "będzie") and stay rhyme-able.
  "stąd",
  // Prepositions (przyimki)
  "bez", "dla", "do", "ku", "między", "na", "nad", "o", "od", "po", "pod",
  "przed", "przy", "u", "w", "z", "za", "ze", "przez", "spod", "spośród",
  "ponad", "wobec", "wbrew", "wzdłuż", "oprócz", "poza", "według", "wśród",
  "przeciw", "przeciwko", "poprzez",
  // Copula / auxiliary verbs
  "jest", "są", "był", "była", "było", "były", "byłem", "byłam", "byłeś", "byłaś",
  "byli", "byliśmy", "byłyśmy", "będzie", "będą", "będę", "będziesz", "będziemy",
  "być", "będąc", "jestem", "jesteś", "jesteśmy", "jesteście",
]);

// ─── PHONETIC ENDING PATTERNS ──────────────────────────────────────────
// Keys are matched against the *phonetic* tail of a word (post-normalization).
// Several orthographic endings collapse onto one phonetic group.

const RHYME_PATTERNS: Record<string, string> = {
  // -ać → ac (pisać → pisac)
  "ac": "ac",
  // -eć / -ec → ec (myśleć → myslec, biec → biec)
  "ec": "ec",
  // -ić / -yć → ic (mówić → muwic, myć → myc)
  "ic": "ic",
  "yc": "ic",
  // past tense -ł (ł → w): pisał → pisaw, mył → myw, mówił → muwiw
  "aw": "aw", "awa": "aw", "awo": "aw", "awy": "aw",
  "iw": "iw", "iwa": "iw", "iwo": "iw", "iwy": "iw",
  "uw": "uw", "uwa": "uw", "uwo": "uw", "uwy": "uw",
  // nasal verb forms: wziąć → wzionc, idąc → idonc
  "onc": "ac", "enc": "ec",
  // -ość / -łość → osc (wolność → wolnosc, złość → zwosc)
  "osc": "osc",
  // -anie / -enie / -ienie → ane (pisanie → pisane, zrozumienie → zrozumiene)
  "ane": "ane", "ene": "ane",
  // diminutives -ek / -ak / -yk
  "ek": "ek", "ak": "ek", "yk": "ek",
  // -ka / -ki / -ku
  "ka": "ka", "ki": "ka", "ku": "ka",
  // adjectival -ny / -na / -ne
  "ny": "ny", "na": "na", "ne": "ne",
  // -ty / -ta / -te
  "ty": "ty", "ta": "ta", "te": "te",
  // -ła (ł → w): była → bywa
  "wa": "wa",
  // true -l- endings
  "la": "la", "le": "le", "li": "li", "lo": "lo", "lu": "lu",
  // -ca / -ce / -cy / -co
  "ca": "ca", "ce": "ce", "cy": "cy", "co": "co",
  // case endings: instrumental -ami, locative -ach (ch → h), dative -om
  "ami": "ami", "ah": "ah", "om": "om",
};

// ─── CORE PIPELINE ─────────────────────────────────────────────────────

/** Keep Polish letters only, lowercase. */
function cleanWord(word: string): string {
  return word.toLowerCase().replace(/[^a-ząćęłńóśźż]/g, "");
}

function isStopWord(word: string): boolean {
  return STOP_WORDS.has(word.toLowerCase());
}

function isVowel(ch: string): boolean {
  return ALL_VOWELS.has(ch);
}

function isSoftVowel(ch: string): boolean {
  return SOFT_VOWELS.has(ch);
}

/**
 * Context-sensitive phonetic transcription.
 *
 *  • digraphs:  ch→h (both /x/), cz→cz, sz→sz, rz→rz (= ż), dz→dz, dż→dz
 *  • soft → hard: ć→c, ś→s, ź→z, ń→n, ż→rz, ł→w, ó→u
 *  • palatalization: consonant + i + vowel → consonant + vowel
 *    (ciemny→cemny, siedem→sedem, biuro→buro, dziś stays dzis…)
 *  • nasals: ą→om/on, ę→em/en before labials (b,p,f,w) → "m", else "n"
 */
function toPhonetic(cleaned: string): string {
  const out: string[] = [];
  const n = cleaned.length;
  let i = 0;
  while (i < n) {
    const c = cleaned[i];
    const next = i + 1 < n ? cleaned[i + 1] : "";
    const next2 = i + 2 < n ? cleaned[i + 2] : "";
    const next3 = i + 3 < n ? cleaned[i + 3] : "";

    // Two-letter digraphs
    if (c === "c" && next === "h") { out.push("h"); i += 2; continue; }  // ch → h
    if (c === "c" && next === "z") { out.push("cz"); i += 2; continue; }  // cz
    if (c === "s" && next === "z") { out.push("sz"); i += 2; continue; }  // sz
    if (c === "r" && next === "z") { out.push("rz"); i += 2; continue; }  // rz
    if (c === "d" && next === "z") {
      if (next2 === "i" && isSoftVowel(next3)) { out.push("dz"); i += 3; continue; } // dzi+V → dz
      if (next2 === "i") { out.push("dz", "i"); i += 3; continue; }                  // dzi+C → dzi
      out.push("dz"); i += 2; continue;                                             // dz
    }
    if (c === "d" && next === "ż") { out.push("dz"); i += 2; continue; }  // dż → dz

    // Soft consonants → hard equivalents
    if (c === "ć") { out.push("c"); i += 1; continue; }
    if (c === "ś") { out.push("s"); i += 1; continue; }
    if (c === "ź") { out.push("z"); i += 1; continue; }
    if (c === "ń") { out.push("n"); i += 1; continue; }
    if (c === "ż") { out.push("rz"); i += 1; continue; }
    if (c === "ł") { out.push("w"); i += 1; continue; }
    if (c === "ó") { out.push("u"); i += 1; continue; }

    // Palatalization: consonant + i + vowel → consonant + vowel (i silent)
    if (next === "i" && isSoftVowel(next2) && !isVowel(c) && c !== "j") {
      out.push(c);
      i += 2;
      continue;
    }

    // Nasal vowels — homorganic with the following consonant
    if (c === "ą" || c === "ę") {
      const labial = LABIALS.has(next);
      out.push(
        c === "ą"
          ? labial ? "om" : "on"
          : labial ? "em" : "en"
      );
      i += 1;
      continue;
    }

    out.push(c);
    i += 1;
  }
  return out.join("");
}

/** Vowel skeleton — the last `max` vowel groups in forward order. */
function vowelSkeleton(phonetic: string, max: number): string[] {
  const out: string[] = [];
  for (let i = phonetic.length - 1; i >= 0 && out.length < max; i--) {
    const ch = phonetic[i];
    if (PHONETIC_VOWELS.has(ch)) out.push(VOWEL_GROUP[ch] ?? ch);
  }
  out.reverse();
  return out;
}

/** Count syllables: each vowel is one nucleus, au/eu/ou count as one. */
function countSyllables(phonetic: string): number {
  let count = 0;
  for (let i = 0; i < phonetic.length; i++) {
    const c = phonetic[i];
    if (!PHONETIC_VOWELS.has(c)) continue;
    const next = phonetic[i + 1];
    if (next === "u" && (c === "a" || c === "e" || c === "o")) continue; // diphthong
    count++;
  }
  return count;
}

/** Split into syllable strings (diphthongs au/eu/ou stay together). */
function syllabify(phonetic: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < phonetic.length; i++) {
    const c = phonetic[i];
    cur += c;
    if (PHONETIC_VOWELS.has(c)) {
      const next = phonetic[i + 1];
      if (next === "u" && (c === "a" || c === "e" || c === "o")) continue; // wait for the u
      out.push(cur);
      cur = "";
    }
  }
  if (cur) {
    if (out.length > 0) out[out.length - 1] += cur;
    else out.push(cur);
  }
  return out;
}

/** The last `count` syllables of a phonetic string (or the whole string). */
function lastSyllables(phonetic: string, count: number): string {
  if (!phonetic) return "";
  const syllables = syllabify(phonetic);
  if (syllables.length <= count) return phonetic;
  return syllables.slice(-count).join("");
}

// ─── WORD ANALYSIS (memoized) ──────────────────────────────────────────

interface WordAnalysis {
  /** Full phonetic transcription. */
  phonetic: string;
  /** Last few phonetic chars used for tail/edit similarity. */
  ending: string;
  /** Rhyme pattern group, if the ending matches one. */
  endingGroup: string | null;
  /** Last up-to-3 vowel groups (forward order, from the end). */
  vowels: string[];
}

const ENDING_LEN = 6;
const EMPTY_ANALYSIS: WordAnalysis = Object.freeze({
  phonetic: "",
  ending: "",
  endingGroup: null,
  vowels: [],
});

const analysisCache = new Map<string, WordAnalysis>();

function findEndingGroup(phonetic: string): string | null {
  for (let len = Math.min(ENDING_LEN, phonetic.length); len >= 2; len--) {
    const group = RHYME_PATTERNS[phonetic.slice(-len)];
    if (group !== undefined) return group;
  }
  return null;
}

function analyzeWord(word: string): WordAnalysis {
  const cleaned = cleanWord(word);
  if (!cleaned) return EMPTY_ANALYSIS;
  const cached = analysisCache.get(cleaned);
  if (cached) return cached;
  const phonetic = toPhonetic(cleaned);
  const analysis: WordAnalysis = {
    phonetic,
    ending: phonetic.slice(-ENDING_LEN),
    endingGroup: findEndingGroup(phonetic),
    vowels: vowelSkeleton(phonetic, 3),
  };
  analysisCache.set(cleaned, analysis);
  return analysis;
}

// ─── SIMILARITY ────────────────────────────────────────────────────────

/** Count of matching characters from the end (stops at the first mismatch). */
function tailOverlap(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

/** Classic Levenshtein distance (strings are ≤ 8 chars — cheap). */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[n];
}

function editSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * Positional vowel comparison, paroxytonic-stress aware:
 * the last vowel anchors the rhyme, the penultimate one is the stressed
 * vowel of the rhyme window (for single-vowel words both coincide).
 */
function vowelPairScore(a: string[], b: string[]): { lastMatch: boolean; stressedMatch: boolean } {
  if (a.length === 0 || b.length === 0) return { lastMatch: false, stressedMatch: false };
  const lastA = a[a.length - 1];
  const lastB = b[b.length - 1];
  const stressedA = a.length >= 2 ? a[a.length - 2] : lastA;
  const stressedB = b.length >= 2 ? b[b.length - 2] : lastB;
  return { lastMatch: lastA === lastB, stressedMatch: stressedA === stressedB };
}

// ─── CLASSIFICATION ────────────────────────────────────────────────────

/**
 * Word-level classification on precomputed analyses.
 * Priority: identical phonetic/ending/pattern → exact; strong tail or edit
 * overlap → exact; shared stressed vowel → assonance; anything weaker → slant.
 */
function classifyAnalyses(a: WordAnalysis, b: WordAnalysis): RhymeType | null {
  if (!a.phonetic || !b.phonetic) return null;
  if (a.phonetic === b.phonetic) return "exact";
  if (a.ending === b.ending) return "exact";
  if (a.endingGroup !== null && a.endingGroup === b.endingGroup) return "exact";

  const tail = tailOverlap(a.ending, b.ending);
  const editSim = editSimilarity(a.ending, b.ending);
  const { lastMatch, stressedMatch } = vowelPairScore(a.vowels, b.vowels);

  if (lastMatch && tail >= 3) return "exact";
  // Strong partial overlap ("las" ↔ "pas", "droga" ↔ "noga") → exact.
  if (lastMatch && tail >= 2 && editSim >= 0.55) return "exact";
  if (lastMatch && editSim >= 0.8) return "exact";

  if (lastMatch && stressedMatch) return "assonance";
  if (lastMatch && tail >= 2) return "assonance";
  if (lastMatch && editSim >= 0.5) return "assonance";
  if (stressedMatch && tail >= 2) return "assonance";
  // Feminine near-rhymes ("ulice" ↔ "milicji", "betonie" ↔ "strony"): the
  // stressed vowel matches and the consonant skeleton is nearly identical,
  // but the final vowel differs — a classic Polish rap assonance that a
  // strict last-vowel rule would demote to an ungrouped slant.
  if (stressedMatch && editSim >= 0.5) return "assonance";

  if (lastMatch) return "slant";
  if (tail >= 2) return "slant";
  if (editSim >= 0.4) return "slant";
  return null;
}

function classifyWords(wordA: string, wordB: string): RhymeType | null {
  return classifyAnalyses(analyzeWord(wordA), analyzeWord(wordB));
}

/** Multi-syllabic chunk classification (last 2 syllables of a phrase). */
function classifyChunks(chunkA: string, chunkB: string): RhymeType | null {
  if (!chunkA || !chunkB) return null;
  if (chunkA === chunkB) return "exact";

  const tail = tailOverlap(chunkA, chunkB);
  const editSim = editSimilarity(chunkA, chunkB);
  const { lastMatch, stressedMatch } = vowelPairScore(
    vowelSkeleton(chunkA, 3),
    vowelSkeleton(chunkB, 3)
  );

  if (lastMatch && tail >= 3) return "exact";
  if (lastMatch && tail >= 2 && editSim >= 0.55) return "exact";
  if (lastMatch && editSim >= 0.75) return "exact";

  if (lastMatch && stressedMatch) return "assonance";
  if (lastMatch && tail >= 2) return "assonance";
  if (lastMatch && editSim >= 0.5) return "assonance";
  // Same feminine near-rhyme rule as the word classifier (see above).
  if (stressedMatch && editSim >= 0.5) return "assonance";

  if (lastMatch) return "slant";
  if (tail >= 2) return "slant";
  return null;
}

/** Public word-level classifier (backwards-compatible with v7). */
export function classifyRhyme(word1: string, word2: string): RhymeType | null {
  return classifyWords(word1, word2);
}

const TYPE_RANK: Record<RhymeType, number> = { exact: 3, assonance: 2, slant: 1 };

function strongerType(a: RhymeType | null, b: RhymeType | null): RhymeType | null {
  if (a === b) return a;
  if (a === null) return b;
  if (b === null) return a;
  return TYPE_RANK[a] > TYPE_RANK[b] ? a : b;
}

// ─── MULTI-SYLLABIC CHUNK BUILDING ─────────────────────────────────────

/** How many syllables of the line ending form the rhyme window. */
const CHUNK_SYLLABLES = 2;

/**
 * Builds the rhyme chunk: the last `CHUNK_SYLLABLES` syllables of phonetic
 * material taken from the end of the (already meaningful) words.
 */
function buildChunk(words: string[]): string {
  if (words.length === 0) return "";
  let combined = "";
  for (let i = words.length - 1; i >= 0; i--) {
    // Reuse the memoized analysis (the chunk words are already cleaned).
    combined = analyzeWord(words[i]).phonetic + combined;
    if (countSyllables(combined) >= CHUNK_SYLLABLES) break;
  }
  return lastSyllables(combined, CHUNK_SYLLABLES);
}

interface LineData {
  index: number;
  /** Cleaned last meaningful (non-stop) word — the rhyme anchor. */
  lastWord: string;
  /** Token index of `lastWord` within the trimmed line split — lets the UI
   *  highlight the exact word that anchors the rhyme. */
  lastWordIdx: number;
  chunk: string;
  isValid: boolean;
}

function classifyLinePair(a: LineData, b: LineData): RhymeType | null {
  const wordType = classifyWords(a.lastWord, b.lastWord);
  const chunkType = classifyChunks(a.chunk, b.chunk);
  const type = strongerType(wordType, chunkType);
  // A lone shared final vowel (slant) is too weak to merge whole lines into
  // a group — only real assonances and exact rhymes form colored groups.
  return type === "slant" ? null : type;
}

// ─── COMPREHENSIVE POLISH RHYME DICTIONARY (1000+ WORDS) ─────────────

const POLISH_RHYME_DICTIONARY: string[] = [
  // ═══ VERBS - INFINITIVE (-ać) ════════════════════════════════════════
  "pisać", "czytać", "śpiewać", "tańczyć", "grać", "stać",
  "biegać", "skakać", "latać", "pływać", "jeść", "pić",
  "spać", "wstawać", "kłaść", "kupować", "sprzedawać", "dawać",
  "brać", "trzymać", "puścić", "zostać", "wrócić", "odejść",
  "iść", "jechać", "wołać", "gadać", "rozmawiać", "myśleć",
  "wiedzieć", "znać", "rozumieć", "pamiętać", "zapominać", "pomagać",
  "ratować", "niszczyć", "budować", "płonąć", "rosną", "świecić", "grzmieć",
  "szeptać", "milczeć", "trwać", "leżeć", "siedzieć", "czekać",
  "szukać", "znajdować", "gubić", "tracić", "zdobywać", "osiągać",
  "walczyć", "przegrywać", "wygrywać", "żegnać", "witać", "odchodzić",
  "przychodzić", "uciekać", "gonić", "doganiać", "kochać", "nienawidzić",
  "marzyć", "umierać", "rodzić", "działać", "żyć", "być",
  "widzieć", "czuć", "krzyczeć", "słyszeć", "dotykać", "smakować",
  "wąchać", "patrzeć", "spoglądać", "zerkać", "kłamać", "kradać",
  "kopać", "rzucać", "łapać", "ciąć", "bić", "kroić",

  // ═══ VERBS - PAST TENSE ══════════════════════════════════════════════
  "pisałem", "pisałaś", "czytałem", "śpiewałem", "tańczyłem", "grałem",
  "stałem", "biegałem", "skakałem", "latałem", "pływałem", "jadem",
  "piłem", "spałem", "wstawałem", "kłaść", "kupowałem", "sprzedawałem",
  "dawałem", "brałem", "trzymałem", "puściłem", "zostałem", "wróciłem",
  "szedłem", "jechałem", "wołałem", "gadałem", "rozmawiałem", "myślałem",
  "wiedziałem", "znałem", "rozumiałem", "pamiętałem", "zapominałem", "pomagałem",
  "ratowałem", "niszczyłem", "budowałem", "płonąłem", "świeciłem", "grzmiałem",
  "szeptałem", "milczałem", "trwałem", "leżałem", "siedziałem", "czekałem",
  "szukałem", "znajdowałem", "gubiłem", "traciłem", "zdobywałem", "osiągałem",
  "walczyłem", "przegrywałem", "wygrywałem", "żegnałem", "witałem", "odchodziłem",
  "przychodziłem", "uciekałem", "goniłem", "doganiałem", "kochałem", "nienawidziłem",
  "marzyłem", "umierałem", "rodziłem", "działałem", "żyłem", "byłem",

  // ═══ VERBS - FUTURE TENSE ════════════════════════════════════════════
  "będę pisać", "będę czytać", "będę śpiewać", "będę tańczyć", "będę grać",
  "będę biegać", "będę skakać", "będę latać", "będę pływać", "będę jeść",
  "będę pić", "będę spać", "będę wstawać", "będę kupować", "będę sprzedawać",
  "będę dawać", "będę brać", "będę trzymać", "będę wracać", "będę odchodzić",
  "będę szukać", "będę znajdować", "będę gubić", "będę tracić", "będę zdobywać",
  "będę walczyć", "będę przegrywać", "będę wygrywać", "będę kochać", "będę marzyć",

  // ═══ NOUNS - EMOTIONS ════════════════════════════════════════════════
  "życie", "śmierć", "radość", "smutek", "gniew", "strach",
  "miłość", "złość", "nienawiść", "nadzieja", "rozpacz", "wolność", "prawda",
  "szczęście", "spokój", "cisza", "tęsknota", "żal", "wstyd",
  "duma", "emocja", "uczucie", "pragnienie", "zazdrość", "samotność",
  "przyjaźń", "wrogość", "zaufanie", "zdrada", "poczucie", "życie",
  "nieszczęście", "niepokój", "hałas", "żałość", "obojętność",
  "pożądanie", "wstręt", "obrzydzenie", "zniechęcenie", "znudzenie",

  // ═══ NOUNS - ABSTRACT ════════════════════════════════════════════════
  "czas", "przestrzeń", "wymiar", "sen", "pamięć", "wiedza",
  "siła", "słabość", "moc", "potęga", "władza", "odwaga",
  "kłamstwo", "niewola", "sprawiedliwość", "cel", "droga", "ścieżka",
  "kierunek", "początek", "koniec", "horyzont", "przeszłość", "przyszłość",
  "teraźniejszość", "wieczność", "chwila", "los", "przeznaczenie", "karma",
  "szansa", "okazja", "moment", "historia", "prawda", "mądrość",
  "głupota", "światopogląd", "filozofia", "ideologia", "wiara", "niewiara",
  "nadzieja", "rozpacz", "strach", "odwaga", "siła", "słabość",

  // ═══ NOUNS - CONCRETE ════════════════════════════════════════════════
  "ulica", "trasa", "szlak", "miasto", "noc", "dzień",
  "rano", "wieczór", "północ", "świt", "dom", "mieszkanie",
  "pokój", "okno", "drzwi", "ściana", "samochód", "autobus",
  "pociąg", "telefon", "komputer", "radio", "głośnik", "mikrofon",
  "plac", "rynek", "park", "las", "pole", "góra",
  "dolina", "rzeka", "jezioro", "morze", "ocean", "niebo",
  "ziemia", "woda", "ogień", "powietrze", "deszcz", "śnieg",
  "wiatr", "burza", "chmura", "słońce", "księżyc", "gwiazda",

  // ═══ MUSIC TERMS ═════════════════════════════════════════════════════
  "bit", "rytm", "melodia", "harmonia", "dźwięk", "flow",
  "beat", "refren", "zwrotka", "wers", "sylaba", "rap",
  "hip-hop", "muzyka", "utwór", "piosenka", "koncert", "festiwal",
  "scena", "gitara", "perkusja", "bas", "klawiatura", "studio",
  "nagrywanie", "miksowanie", "mastering", "produkcja", "tekst", "słowa",
  "wokal", "chór", "solo", "improwizacja", "freestyle", "battle",
  "cypher", "underground", "mainstream", "klasyk", "legenda", "hit",
  "singiel", "album", "mixtape", "EP", "LP", "track",

  // ═══ BODY/SOUL ════════════════════════════════════════════════════════
  "serce", "dusza", "umysł", "ciało", "duch", "myśl",
  "dłoń", "palec", "oko", "ucho", "nos", "usta",
  "twarz", "głowa", "ramię", "noga", "stopa", "kolano",
  "krew", "kość", "skóra", "włosy", "tętno", "oddech",
  "wzrok", "słuch", "dotyk", "smak", "energia", "dreszcz",
  "żyła", "tętnica", "nerw", "mięsień", "szkielet", "kręgosłup",
  "żołądek", "wątroba", "nerka", "płuca", "mózg", "śledziona",

  // ═══ NATURE ══════════════════════════════════════════════════════════
  "ogień", "woda", "ziemia", "niebo", "wiatr", "deszcz",
  "słońce", "księżyc", "gwiazda", "chmura", "burza",
  "śnieg", "lód", "para", "mgła", "dym", "popiół",
  "drzewo", "kwiat", "trawa", "krzak", "korzeń", "liść",
  "ptak", "ryba", "zwierzę", "skała", "piasek", "kamień",
  "las", "łąka", "pole", "góra", "dolina", "przełom",
  "wodospad", "jezioro", "rzeka", "strumień", "źródło", "bagno",
  "błoto", "żwir", "glina", "tlen", "azot", "węgiel",

  // ═══ RAP VOCABULARY ══════════════════════════════════════════════════
  "blok", "osiedle", "dzielnica", "kraj", "walka", "zwycięstwo",
  "porażka", "klęska", "sukces", "marzenie", "niewola",
  "potęga", "odwaga", "strach", "radość", "smutek",
  "nienawiść", "przyjaźń", "wrogość", "zaufanie", "zdrada",
  "ulica", "asfalt", "beton", "klatka", "korytarz", "windy",
  "blokowisko", "wieżowiec", "parter", "piętro", "dach", "piwnica",
  "podwórko", "podwórka", "brama", "furtka", "ogrodzenie", "mur",

  // ═══ ADJECTIVES - OPISOWE ════════════════════════════════════════════
  "wielki", "mały", "długi", "krótki", "szeroki", "wąski",
  "wysoki", "niski", "szybki", "wolny", "ciężki", "lekki",
  "głośny", "cichy", "ciemny", "jasny", "mocny", "słaby",
  "twardy", "miękki", "gorący", "zimny", "świeży", "stary",
  "nowy", "młody", "dobry", "zły", "ładny", "brzydki",
  "piękny", "szpetny", "czysty", "brudny", "bogaty", "biedny",
  "silny", "slaby", "odważny", "tchórzliwy", "mądry", "głupi",
  "mądry", "bystry", "wolny", "zajęty", "pusty", "pełny",
  "pewny", "niepewny", "spokojny", "nerwowy", "radosny", "smutny",

  // ═══ ADJECTIVES - PRZYMIOTNIKI ═══════════════════════════════════════
  "twarde", "mocne", "pewne", "drobne", "piękne",
  "silne", "słabe", "dobre", "nowe", "stare",
  "młode", "duże", "małe", "wysokie", "niskie",
  "szybkie", "wolne", "ciężkie", "lekkie", "głośne",
  "ciche", "ciemne", "jasne", "gorące", "zimne",
  "świeże", "ładne", "brzydkie", "czyste", "brudne",

  // ═══ WORDS WITH -NĘ ENDING ════════════════════════════════════════════
  "zasnę", "opadnę", "zamknę", "otworzę", "zaczekam",
  "odejdę", "wrócę", "zacznę", "skończę", "zmienię",
  "zrobię", "dam", "wezmę", "powiem", "pomyślę",
  "usłyszę", "zobaczę", "poczuję", "dotknę", "pocałuję",
  "przytulę", "obejmę", "ściskam", "trzymam", "puścisz",

  // ═══ WORDS WITH -Ć ENDING ════════════════════════════════════════════
  "pisać", "czytać", "śpiewać", "tańczyć", "grać",
  "mówić", "gadać", "rozmawiać", "krzyczeć", "milczeć",
  "myśleć", "wiedzieć", "znać", "rozumieć", "pamiętać",
  "zapominać", "pomagać", "ratować", "niszczyć", "budować",
  "kochać", "nienawidzić", "marzyć", "umierać", "rodzić",

  // ═══ WORDS WITH -EĆ ENDING ════════════════════════════════════════════
  "widzieć", "czuć", "słyszeć", "dotykać", "smakować",
  "wąchać", "patrzeć", "spoglądać", "zerkać", "leżeć",
  "siedzieć", "czekać", "szukać", "znajdować", "gubić",
  "tracić", "zdobywać", "osiągać", "walczyć", "przegrywać",
  "wygrywać", "żegnać", "witać", "odchodzić", "przychodzić",
  "uciekać", "gonić", "doganiać", "płonąć", "świecić",
  "grzmieć", "szeptać", "milczeć", "trwać",

  // ═══ WORDS WITH -IĆ ENDING ════════════════════════════════════════════
  "żyć", "być", "stać", "iść", "jechać",
  "wrócić", "odejść",

  // ═══ EMOTIONAL VERBS ══════════════════════════════════════════════════
  "kocham", "nienawidzę", "tęsknię", "cierpię", "walczę",
  "wygrywam", "przegrywam", "płaczę", "marzę", "wierzę",
  "ufam", "czekam", "szukam", "znajduję", "gubię",
  "tracę", "zdobywam", "osiągam", "żegnam", "witam",
  "odchodzę", "przychodzę", "uciekam", "gonię", "doganiam",
  "krzyczę", "milczę", "szeptam", "myślę", "wierzę",

  // ═══ COMMON WORDS ═════════════════════════════════════════════════════
  "tak", "nie", "może", "pewnie", "raczej",
  "zawsze", "nigdy", "czasem", "często", "rzadko",
  "blisko", "daleko", "wysoko", "nisko", "szybko",
  "cicho", "głośno", "spokojnie", "nerwowo",
  "dobrze", "źle", "pięknie", "brzydko", "mocno",
  "słabo", "szybko", "wolno", "daleko", "blisko",

  // ═══ TIME WORDS ═══════════════════════════════════════════════════════
  "późno", "wczoraj", "dzisiaj", "jutro", "zawsze",
  "nigdy", "czasem", "często", "rzadko", "zwykle",
  "teraz", "zaraz", "potem", "przedtem", "wtedy",
  "wcześniej", "później", "rano", "wieczorem", "nocą",

  // ═══ PLACE WORDS ══════════════════════════════════════════════════════
  "tutaj", "tam", "wszędzie", "nigdzie", "kiedyś",
  "kiedy", "gdzie", "skąd", "dokąd", "dlaczego",
  "jak", "ile", "kto", "co", "jaki",

  // ═══ NATURE WORDS ═════════════════════════════════════════════════════
  "deszcz", "śnieg", "wiatr", "burza", "mgła",
  "ogień", "woda", "ziemia", "niebo", "słońce",
  "księżyc", "gwiazda", "chmura", "tęcza", "błyskawica",
  "piorun", "grad", "lód", "para", "dym",

  // ═══ BODY WORDS ═══════════════════════════════════════════════════════
  "serce", "dusza", "umysł", "ciało", "duch",
  "myśl", "dłoń", "palec", "oko", "ucho",
  "nos", "usta", "twarz", "głowa", "ramię",
  "noga", "stopa", "kolano", "krew", "kość",
  "skóra", "włosy", "tętno", "oddech", "wzrok",

  // ═══ MORE VERBS ═══════════════════════════════════════════════════════
  "jechać", "iść", "biec", "skakać", "latać",
  "pływać", " nurkować", "wspinać się", "schodzić", "wchodzić",
  "wychodzić", "wracać", "odchodzić", "zbliżać się", "oddalać się",
  "śmiać się", "płakać", "krzyczeć", "szeptać", "milczeć",
  "myśleć", "czuć", "wiedzieć", "znać", "rozumieć",
  "pamiętać", "zapominać", "uczyć się", "nauczyć się", "zapamiętać",

  // ═══ MORE NOUNS ═══════════════════════════════════════════════════════
  "dom", "mieszkanie", "pokój", "kuchnia", "łazienka",
  "okno", "drzwi", "ściana", "podłoga", "sufit",
  "schody", "balkon", "ogród", "podwórko", "ulica",
  "droga", "ścieżka", "trasa", "autostrada", "most",
  "tunel", "przejście", "skrzyżowanie", "rondo", "parking",

  // ═══ MORE ADJECTIVES ══════════════════════════════════════════════════
  "czerwony", "niebieski", "zielony", "żółty", "biały",
  "czarny", "szary", "brązowy", "różowy", "fioletowy",
  "pomarańczowy", "złoty", "srebrny", "miedziany", "żelazny",
  "drewniany", "szklany", "metalowy", "plastikowy", "papierowy",
  "bawełniany", "wełniany", "skórzany", "kamienny", "piaskowy",

  // ═══ MORE TIME WORDS ══════════════════════════════════════════════════
  "sekunda", "minuta", "godzina", "dzień", "tydzień",
  "miesiąc", "rok", "dekada", "wiek", "epoka",
  "przeszłość", "teraźniejszość", "przyszłość", "wieczność", "moment",
  "chwila", "pora", "czas", "okres", "sezon",

  // ═══ MORE EMOTION WORDS ═══════════════════════════════════════════════
  "miłość", "nienawiść", "radość", "smutek", "strach",
  "odwaga", "nadzieja", "rozpacz", "spokój", "niepokój",
  "cisza", "hałas", "tęsknota", "żal", "wstyd",
  "duma", "poczucie", "pragnienie", "pożądanie", "zazdrość",
  "samotność", "przyjaźń", "wrogość", "zaufanie", "zdrada",

  // ═══ MORE MUSIC WORDS ═════════════════════════════════════════════════
  "gitara", "perkusja", "bas", "klawiatura", "saksofon",
  "trąbka", "flet", "skrzypce", "wiolonczela", "harfa",
  "akordeon", "harmonijka", "bongosy", "conga", "djembé",
  "gramofon", "wzmacniacz", "mikser", "konsola", "słuchawki",

  // ═══ MORE RAP SLANG ══════════════════════════════════════════════════
  "freestyle", "battle", "cypher", "diss", "track",
  "beat", "flow", "rhyme", "bars", "lyrics",
  "verse", "chorus", "hook", "bridge", "outro",
  "intro", "sample", "loop", "drop", "bass",
  "treble", "mix", "master", "record", "release",

  // ═══ MORE COMMON WORDS ════════════════════════════════════════════════
  "człowiek", "kobieta", "mężczyzna", "dziecko", "dzieci",
  "rodzina", "matka", "ojciec", "brat", "siostra",
  "syn", "córka", "mąż", "żona", "kochanek",
  "kochanka", "przyjaciel", "wrog", "sąsiad", "kolega",
  "nauczyciel", "uczeń", "lekarz", "pielęgniarka", "policjant",

  // ═══ MORE PLACE WORDS ═════════════════════════════════════════════════
  "szkoła", "uniwersytet", "szpital", "kościół", "sklep",
  "restauracja", "kawiarnia", "bar", "pub", "klub",
  "kino", "teatr", "muzeum", "biblioteka", "poczta",
  "bank", "urząd", "fabryka", "biuro", "magazyn",

  // ═══ MORE FOOD WORDS ══════════════════════════════════════════════════
  "chleb", "masło", "ser", "mleko", "jajko",
  "mięso", "ryba", "warzywa", "owoc", "jabłko",
  "gruszka", "śliwka", "wiśnia", "truskawka", "malina",
  "banan", "pomarańcza", "cytryna", "winogrono", "arbuz",

  // ═══ MORE ANIMAL WORDS ════════════════════════════════════════════════
  "pies", "kot", "koń", "krowa", "świnia",
  "kura", "kaczka", "gęś", "gołąb", "orzeł",
  "sokół", "wilk", "lis", "niedźwiedź", "żubr",
  "sarna", "jeleń", "zając", "wiewiórka", "mysz",

  // ═══ MORE WEATHER WORDS ═══════════════════════════════════════════════
  "pogoda", "chmura", "deszcz", "śnieg", "wiatr",
  "burza", "piorun", "błyskawica", "grad", "tęcza",
  "mgła", "rosa", "szron", "lód", "para",
  "słońce", "księżyc", "gwiazda", "niebo", "horyzont",

  // ═══ MORE COLOR WORDS ═════════════════════════════════════════════════
  "czerwony", "niebieski", "zielony", "żółty", "biały",
  "czarny", "szary", "brązowy", "różowy", "fioletowy",
  "pomarańczowy", "złoty", "srebrny", "miedziany", "kremowy",

  // ═══ MORE EMOTION WORDS ═══════════════════════════════════════════════
  "szczęście", "nieszczęście", "sukces", "porażka", "zwycięstwo",
  "klęska", "walka", "bój", "bitwa", "wojna",
  "pokój", "rozejm", "zawieszenie broni", "sojusz", "przymierze",

  // ═══ MORE ABSTRACT WORDS ══════════════════════════════════════════════
  "prawda", "kłamstwo", "wiara", "niewiara", "nadzieja",
  "rozpacz", "strach", "odwaga", "siła", "słabość",
  "moc", "potęga", "władza", "autorytet", "wpływ",
  "znaczenie", "wartość", "zasada", "prawo", "obowiązek",

  // ═══ MORE CONCRETE WORDS ══════════════════════════════════════════════
  "stół", "krzesło", "łóżko", "szafa", "komoda",
  "lampa", "lustro", "obraz", "dywan", "firanka",
  "poduszka", "koc", "kołdra", "prześcieradło", "ręcznik",
  "szklanka", "talerz", "widelec", "nóż", "łyżka",

  // ═══ MORE BODY WORDS ══════════════════════════════════════════════════
  "serce", "płuca", "wątroba", "nerki", "żołądek",
  "mózg", "kręgosłup", "żebra", "miednica", "biodro",
  "ramię", "łokieć", "nadgarstek", "dłoń", "palce",
  "kolano", "łydka", "stopa", "pięta", "podeszwa",

  // ═══ MORE NATURE WORDS ════════════════════════════════════════════════
  "drzewo", "krzak", "trawa", "kwiat", "liść",
  "korzeń", "gałąź", "pień", "kora", "sok",
  "owoc", "nasiono", "pyłek", "pszczoła", "motyl",
  "chrząszcz", "mucha", "komar", "pająk", "robak",

  // ═══ RAP SLANG - KASA & HUSTLE ════════════════════════════════════════
  "kasa", "kaska", "szmal", "hajs", "forsa", "gotówka",
  "stówa", "stówka", "dycha", "bańka", "złotówka", "banknot",
  "dług", "podatek", "fiskus", "łapówka", "przekręt", "kombinacja",
  "biznes", "interes", "hazard", "wygrana", "przegrana", "fortuna",
  "majątek", "robota", "zarobek", "haracz",

  // ═══ RAP SLANG - TOWAR (DRUGS) ════════════════════════════════════════
  "towar", "zioło", "ziele", "gandzia", "blant", "skręt",
  "joint", "maria", "działka", "gram", "kreska", "proch",
  "koka", "meta", "piguła", "dopalacze", "narkotyk", "nałóg",
  "odlot", "odjazd",

  // ═══ RAP SLANG - ULICA & GANG ═════════════════════════════════════════
  "gang", "mafia", "klan", "ekipa", "paczka", "szajka",
  "wataha", "banda", "kompan", "teren", "rewir", "dzielnia",
  "kwadrat", "pustostan", "melina", "nora", "dziupla", "legowisko",
  "zaułek", "uliczka", "chodnik", "krawężnik", "ławka", "przystanek",
  "peron", "dworzec", "róg", "bazar", "targ", "monopol",
  "budka", "sklepik",

  // ═══ RAP SLANG - FURY (CARS) ══════════════════════════════════════════
  "fura", "bryka", "wózek", "gruchot", "beemka", "mers",
  "benzyna", "paliwo", "silnik", "opona", "felga", "maska",
  "zderzak", "wydech", "garaż", "kierownica", "koła", "gaz",
  "hamulec", "kluczyk", "zapłon", "bagażnik", "lusterko", "szyba",
  "tablica", "mandat", "pirat", "pościg", "ucieczka", "skrzynia",
  "sprzęgło",

  // ═══ RAP SLANG - LUDZIE (PEOPLE) ══════════════════════════════════════
  "ziom", "ziomek", "ziomalka", "brachol", "stary", "stara",
  "koleś", "gość", "typ", "laska", "laseczka", "panienka",
  "alfons", "gangster", "celebryta", "snob", "burak", "prostak",
  "frajer", "cwaniak", "spryciarz", "kombinator", "oszust", "złodziej",
  "kieszonkowiec", "włamywacz", "bandyta", "rozbójnik", "morderca", "zabójca",
  "kat", "glina", "gliniarz", "strażnik", "ochroniarz", "bramkarz",
  "wariat", "świr", "psychol", "dziwak", "kłamca", "kapuś",
  "konfident", "donosiciel",

  // ═══ RAP SLANG - MELANŻ & WÓDA ════════════════════════════════════════
  "impreza", "melanż", "balanga", "zabawa", "dyskoteka", "knajpa",
  "wóda", "wódka", "gorzała", "setka", "małpka", "kieliszek",
  "kielich", "szot", "browar", "browarek", "piwo", "kac",
  "kacenjamer", "pijak", "pijany", "imprezowicz", "barman", "parkiet",
  "tłum", "stolik",

  // ═══ RAP SLANG - PRZEMOC & WPADKA ═════════════════════════════════════
  "bójka", "bijatyka", "rozróba", "rozpierducha", "awantura", "draka",
  "jatka", "rzeź", "masakra", "rzeźnia", "strzelanina", "kula",
  "broń", "spluwa", "giwera", "gnata", "peem", "ostrze",
  "brzytwa", "kastet", "pała", "kij", "łom", "cegła",
  "butelka", "łomot", "lanie", "manto", "wpierdol", "baty",
  "cios", "uderzenie", "kopniak", "policzek", "siniak", "blizna",
  "rana", "złamanie",

  // ═══ RAP SLANG - SĄD & KICI ═══════════════════════════════════════════
  "wpadka", "pudło", "pierdel", "kić", "kryminał", "więzienie",
  "odsiadka", "wyrok", "kraty", "kajdany", "areszt", "prokurator",
  "sąd", "sędzia", "adwokat", "prawnik", "sprawa", "dowód",
  "zeznanie", "świadek", "recydywa",

  // ═══ RAP SLANG - FEJM & SCENA ═════════════════════════════════════════
  "fejm", "fame", "rozgłos", "popularność", "internet", "sieć",
  "wiral", "zasięgi", "lajki", "hejt", "hejter", "troll",
  "komentarz", "post", "vlog", "blog", "obserwator", "kariera",
  "kontrakt", "wytwórnia", "label", "płyta", "numer", "kawałek",
  "przebój", "podziemie", "ikona", "kultura", "szacunek", "respekt",
  "lojalność", "wierność",

  // ═══ RAP SLANG - LUZ & STAN ═══════════════════════════════════════════
  "luz", "chill", "relaks", "fokus", "vibe", "klimat",
  "aura", "wkurw", "nerwy", "presja", "stres", "ciśnienie",
  "napięcie", "depresja", "paranoja", "szał", "amok", "kosmos",
  "petarda", "bomba", "syf", "bajzel", "burdel", "chaos",
  "porządek", "rozum", "łeb", "czaszka", "bebechy", "flaki",
  "klata", "piersi", "plecy", "kark", "gardło", "szyja",
  "bark", "pięść", "graba", "łapa", "kostka", "obcas",
  "trampki", "glany", "adidasy", "dres", "bluza", "kaptur",
  "czapka", "kurtka", "płaszcz", "spodnie", "kieszeń", "pasek",
  "zegarek", "łańcuch", "złoto", "diament", "błyskotki", "tatuaż",

  // ═══ NOUN INFLECTIONS - DOPEŁNIACZ (-a/-u/-i) ════════════════════════
  "nocy", "drogi", "miłości", "wolności", "radości", "nienawiści",
  "śmierci", "duszy", "głowy", "ręki", "nogi", "ulicy",
  "ciszy", "tęsknoty", "prawdy", "nadziei", "szansy", "gwiazdy",
  "wody", "ziemi", "kasy", "szmalu", "hajsu", "towaru",
  "czasu", "dnia", "snu", "świata", "nieba", "słońca",
  "księżyca", "wiatru", "deszczu", "śniegu", "ognia", "mroku",
  "głosu", "rytmu", "dźwięku", "kroku", "ruchu", "celu",
  "domu", "miasta", "pieniędzy", "serca", "mózgu", "betonu",
  "asfaltu", "blasku",

  // ═══ NOUN INFLECTIONS - NARZĘDNIK (-em/-ą/-ami) ══════════════════════
  "sercem", "duchem", "głową", "nogą", "ręką", "drogą",
  "słowem", "głosem", "rytmem", "stylem", "krokiem", "pomysłem",
  "spojrzeniem", "myślami", "słowami", "prawem", "światłem", "cieniem",
  "mrokiem", "biciem", "flowem", "bitem", "problemem", "luzem",
  "szacunkiem", "respektem", "płomieniem", "ogniem",

  // ═══ NOUN INFLECTIONS - MIEJSCOWNIK (-e/-u/-i) ═══════════════════════
  "drodze", "sercu", "głowie", "ręce", "nodze", "ulicy",
  "duszy", "ciszy", "mroku", "śnie", "świecie", "niebie",
  "miłości", "wolności", "prawdzie", "strachu", "bloku", "osiedlu",
  "dzielni", "dachu", "piwnicy", "klatce", "klubie", "scenie",
  "trasie", "studiu", "mieście", "dnie", "polu", "lesie",
  "górze", "dolinie", "morzu", "słońcu",

  // ═══ NOUN INFLECTIONS - BIERNIK (-ę) ═════════════════════════════════
  "drogę", "miłość", "wolność", "prawdę", "ciszę", "głowę",
  "rękę", "nogę", "duszę", "ulicę", "szansę", "nadzieję",
  "tęsknotę", "ziemię", "wodę", "kasę", "klatkę", "piwnicę",
  "scenę", "trasę", "krew",

  // ═══ VERB FORMS - 1. OS. LICZBY POJEDYNCZEJ ═════════════════════════
  "chodzę", "wchodzę", "wychodzę", "widzę", "słyszę", "czuję",
  "wiem", "robię", "daję", "biorę", "zabijam", "zostaję",
  "wracam", "pracuję", "mieszkam", "śpię", "jadę", "idę",
  "lecę", "płynę", "biegnę", "stoję", "siedzę", "leżę",
  "pamiętam", "zapominam", "rozumiem", "wybieram", "kupuję", "sprzedaję",
  "piszę", "czytam", "śpiewam", "tańczę", "gram", "śnię",
  "kłamię", "kradnę", "szepczę", "zerkam", "patrzę", "słucham",

  // ═══ VERB FORMS - 3. OS. LICZBY POJEDYNCZEJ ═════════════════════════
  "chodzi", "widzi", "słyszy", "czuje", "mówi", "robi",
  "daje", "bierze", "zabija", "zostaje", "wraca", "pracuje",
  "mieszka", "śpi", "jedzie", "idzie", "leci", "płynie",
  "biegnie", "stoi", "siedzi", "leży", "pamięta", "rozumie",
  "wybiera", "kupuje", "sprzedaje", "pisze", "czyta", "śpiewa",
  "tańczy", "gra", "śni", "kłamie", "kradnie", "szepcze",
  "świeci", "pada", "wieje", "mija", "rośnie", "znika",

  // ═══ VERB FORMS - TRYBU ROZKAZUJĄCY ═════════════════════════════════
  "chodź", "idź", "biegnij", "leć", "płyń", "zostań",
  "wróć", "wracaj", "słuchaj", "patrz", "czekaj", "przestań",
  "daj", "bierz", "mów", "śpiewaj", "tańcz", "kup",
  "pamiętaj", "rozumiej", "kochaj", "czuj", "śnij", "walcz",
  "wygrywaj", "płacz", "krzycz", "milcz", "szeptaj", "myśl",
  "miej", "bądź", "uważaj", "zobacz", "spójrz", "poczekaj",
  "posłuchaj", "zadzwoń", "napisz",

  // ═══ VERB FORMS - CZAS PRZESZŁY (m/f) ════════════════════════════════
  "chodził", "chodziła", "mówił", "mówiła", "robił", "robiła",
  "dawał", "dawała", "brał", "brała", "szedł", "szła",
  "biegł", "biegła", "leciał", "leciała", "płynął", "płynęła",
  "stał", "stała", "siedział", "siedziała", "leżał", "leżała",
  "kochał", "kochała", "płakał", "płakała", "krzyczał", "krzyczała",
  "milczał", "milczała", "myślał", "myślała", "wiedział", "wiedziała",
  "szukał", "szukała", "grał", "grała", "śpiewał", "śpiewała",
  "tańczył", "tańczyła", "umarł", "umarła", "zginął", "zginęła",
  "zniknął", "zniknęła", "wrócił", "wróciła", "wpadł", "wpadła",
  "uciekł", "uciekła", "zabił", "zabiła", "otworzył", "otworzyła",
  "zamknął", "zamknęła", "przegrał", "przegrała", "wygrał", "wygrała",

  // ═══ ADJECTIVE INFLECTIONS (feminine/neuter/instrumental) ════════════
  "wolna", "wolne", "wolni", "wolnym", "wolną",
  "mocna", "mocne", "mocni", "mocnym", "mocną",
  "silna", "silne", "silni", "silnym", "silną",
  "ciemna", "ciemne", "ciemnym", "ciemną",
  "jasna", "jasne", "jasnym", "jasną",
  "nowa", "nowe", "nowi", "nowym", "nową",
  "stara", "stare", "starzy", "starym", "starą",
  "młoda", "młode", "młodzi", "młodym", "młodą",
  "dobra", "dobre", "dobrzy", "dobrym", "dobrą",
  "zła", "złe", "złym", "złą",
  "piękna", "piękne", "piękni", "pięknym", "piękną",
  "czarna", "czarne", "czarnym", "czarną",
  "biała", "białe", "białym", "białą",
  "wysoka", "wysokie", "wysokim", "wysoką",
  "niska", "niskie", "niskim", "niską",
  "wielka", "wielkie", "wielkim", "wielką",
  "mała", "małe", "małym", "małą",
  "słaba", "słabe", "słabym", "słabą",
  "ważna", "ważne", "ważnym", "ważną",
  "pewna", "pewne", "pewnym", "pewną",
  "prosta", "proste", "prostym", "prostą",
  "trudna", "trudne", "trudnym", "trudną",
  "pusta", "puste", "pustym", "pustą",
  "pełna", "pełne", "pełnym", "pełną",
  "prawdziwa", "prawdziwe", "prawdziwym", "prawdziwą",
  "zimna", "zimne", "zimnym", "zimną",
  "gorąca", "gorące", "gorącym", "gorącą",
  "żywa", "żywe", "żywym", "żywą",
  "szybka", "szybkie", "szybkim", "szybką",
  "spokojna", "spokojne", "spokojnym", "spokojną",
  "samotna", "samotne", "samotnym", "samotną",
  "wściekła", "wściekłe", "wściekłym", "wściekłą",

  // ═══ ADVERBS & COMPARATIVES ══════════════════════════════════════════
  "głośniej", "ciszej", "szybciej", "wolniej", "wyżej", "niżej",
  "bliżej", "dalej", "mocniej", "słabiej", "jaśniej", "ciemniej",
  "lepiej", "gorzej", "częściej", "rzadziej", "inaczej", "prędko",
  "nagle", "śmiało",
];

// ─── FIND RHYMES ──────────────────────────────────────────────────────
// The dictionary is pre-analyzed and de-duplicated lazily, once per session.

let dictionaryCache: ReadonlyArray<readonly [string, WordAnalysis]> | null = null;

function getDictionaryAnalyses(): ReadonlyArray<readonly [string, WordAnalysis]> {
  if (dictionaryCache) return dictionaryCache;
  const seen = new Set<string>();
  const entries: Array<readonly [string, WordAnalysis]> = [];
  for (const raw of POLISH_RHYME_DICTIONARY) {
    const cleaned = cleanWord(raw);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    entries.push([raw.trim(), analyzeWord(cleaned)] as const);
  }
  dictionaryCache = entries;
  return dictionaryCache;
}

/**
 * Granular 0..1 closeness for ranking rhymes *within* a type — tail overlap,
 * edit similarity and vowel agreement. Unlike TYPE_SCORE (constant per type),
 * this lets the closest rhymes surface first instead of dictionary order.
 *
 * NOTE: the score is only comparable between candidates of the same RhymeType
 * (a weak exact rhyme can score lower than a strong assonance). Callers
 * should use `type` for cross-type ordering and this only as a tiebreaker.
 */
function rhymeSimilarity(a: WordAnalysis, b: WordAnalysis): number {
  const tail = tailOverlap(a.ending, b.ending);
  const editSim = editSimilarity(a.ending, b.ending);
  const { lastMatch, stressedMatch } = vowelPairScore(a.vowels, b.vowels);
  const tailScore = tail / ENDING_LEN;
  return (
    tailScore * 0.45 +
    editSim * 0.35 +
    (lastMatch ? 0.1 : 0) +
    (stressedMatch ? 0.1 : 0)
  );
}
export function findRhymes(word: string): RhymeResult[] {
  const cleaned = cleanWord(word);
  if (!cleaned || isStopWord(cleaned)) return [];
  const wordAnalysis = analyzeWord(cleaned);
  if (!wordAnalysis.phonetic) return [];
  const wordChunk = lastSyllables(wordAnalysis.phonetic, CHUNK_SYLLABLES);

  const results: RhymeResult[] = [];
  for (const [candidate, analysis] of getDictionaryAnalyses()) {
    if (isStopWord(candidate) || analysis.phonetic === wordAnalysis.phonetic) continue;

    const type = strongerType(
      classifyAnalyses(wordAnalysis, analysis),
      classifyChunks(wordChunk, lastSyllables(analysis.phonetic, CHUNK_SYLLABLES))
    );
    if (!type) continue;

    results.push({
      word: candidate,
      type,
      similarity: rhymeSimilarity(wordAnalysis, analysis),
      ending: analysis.endingGroup ?? analysis.ending,
    });
  }

  results.sort((a, b) =>
    a.type !== b.type ? TYPE_RANK[b.type] - TYPE_RANK[a.type] : b.similarity - a.similarity
  );
  return results.slice(0, 15);
}

// ─── DETECT RHYME GROUPS ──────────────────────────────────────────────

const RHYME_COLORS = [
  "#f59e0b", "#10b981", "#f43f5e", "#06b6d4", "#8b5cf6",
  "#f97316", "#ec4899", "#14b8a6", "#3b82f6", "#84cc16",
  "#e879f9", "#22d3ee",
];

/** Tokenize every line into its rhyme-relevant data (shared by the group and type detectors). */
function buildLineData(lines: string[]): LineData[] {
  const lineData: LineData[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      lineData.push({ index: i, lastWord: "", lastWordIdx: -1, chunk: "", isValid: false });
      continue;
    }
    const tokens = trimmed.split(/\s+/);
    const meaningful: string[] = [];
    let lastMeaningfulIdx = -1;
    tokens.forEach((token, idx) => {
      const cleaned = cleanWord(token);
      if (cleaned && !isStopWord(cleaned)) {
        meaningful.push(cleaned);
        lastMeaningfulIdx = idx;
      }
    });
    if (meaningful.length === 0) {
      // Nothing but stop words — fall back to the raw last word.
      const fallback = cleanWord(tokens[tokens.length - 1] || "");
      lineData.push({
        index: i,
        lastWord: fallback,
        lastWordIdx: fallback ? tokens.length - 1 : -1,
        chunk: buildChunk(fallback ? [fallback] : []),
        isValid: !!fallback,
      });
      continue;
    }
    lineData.push({
      index: i,
      lastWord: meaningful[meaningful.length - 1],
      lastWordIdx: lastMeaningfulIdx,
      chunk: buildChunk(meaningful),
      isValid: true,
    });
  }
  return lineData;
}

/**
 * The rhyme anchor word per raw line (cleaned form + token index within the
 * trimmed line). Only lines with a real anchor are returned; the caller
 * intersects this with the group map to highlight exactly the words that
 * carry each rhyme. Indexes match `line.trim().split(/\s+/)` — the same
 * tokenization the group detector uses.
 */
export function detectRhymeWords(lines: string[]): Map<number, { word: string; index: number }> {
  const map = new Map<number, { word: string; index: number }>();
  for (const ld of buildLineData(lines)) {
    if (ld.isValid && ld.lastWord && ld.lastWordIdx >= 0) {
      map.set(ld.index, { word: ld.lastWord, index: ld.lastWordIdx });
    }
  }
  return map;
}

// ─── WORD-LEVEL RHYME CLUSTERS ────────────────────────────────────────

/** One highlighted word — a member of a rhyme cluster. */
export interface RhymeHit {
  /** Raw token exactly as it appears in the line (punctuation included). */
  raw: string;
  /** Token index within `line.trim().split(/\s+/)` (same walk the UI uses). */
  index: number;
  /** Cleaned (lowercased, de-accented) word form. */
  word: string;
  /** Cluster color — every member of the cluster shares it. */
  color: string;
  /** Strongest rhyme type vs the cluster anchor. */
  type: RhymeType;
}

export interface RhymeClusters {
  /** lineIdx → hits (rhyming words) in token order. */
  hits: Map<number, RhymeHit[]>;
  /** lineIdx → first cluster's color (drives line-level UI: markers, flow meter). */
  lineColors: Map<number, string>;
  /** lineIdx → first cluster's rhyme type (exact/assonance). */
  lineTypes: Map<number, RhymeType>;
  /** Cluster colors in discovery order (for the legend). */
  colors: string[];
}

/**
 * Full-text rhyme clustering. Scans EVERY content word (stop words and
 * punctuation excluded), not just line endings, and groups exact/assonance
 * matches into clusters via anchor pairing in document order — the same
 * strategy as the line-level detector but word-granular, so internal rhymes
 * („Płomień …” ↔ „Promień …” mid-line), multi-syllabic matches and repeated
 * words anywhere in the text are all captured. Each cluster gets one color;
 * matching words share it everywhere (editor mirror, „Analiza Wersów” panel).
 */
export function detectRhymeClusters(lines: string[]): RhymeClusters {
  interface Word {
    line: number;
    index: number;
    raw: string;
    cleaned: string;
    analysis: WordAnalysis;
  }

  const words: Word[] = [];
  for (let li = 0; li < lines.length; li++) {
    const trimmed = lines[li].trim();
    if (!trimmed) continue;
    const tokens = trimmed.split(/\s+/);
    tokens.forEach((raw, ti) => {
      const cleaned = cleanWord(raw);
      if (!cleaned || isStopWord(cleaned)) return;
      words.push({ line: li, index: ti, raw, cleaned, analysis: analyzeWord(cleaned) });
    });
  }

  // Anchor pairing: every unassigned word seeds a cluster; later unassigned
  // words that rhyme with the anchor (exact/assonance — slants are too weak
  // to merge) join it. O(n²) on content words — cheap because analyses are
  // memoized and strings are short.
  const clusters: Word[][] = [];
  const assigned = new Set<number>();
  for (let i = 0; i < words.length; i++) {
    if (assigned.has(i)) continue;
    const cluster = [words[i]];
    assigned.add(i);
    for (let j = i + 1; j < words.length; j++) {
      if (assigned.has(j)) continue;
      const type = classifyAnalyses(words[i].analysis, words[j].analysis);
      if (type !== null && type !== "slant") {
        cluster.push(words[j]);
        assigned.add(j);
      }
    }
    if (cluster.length >= 2) clusters.push(cluster);
  }

  const hits = new Map<number, RhymeHit[]>();
  const lineColors = new Map<number, string>();
  const lineTypes = new Map<number, RhymeType>();
  const colors: string[] = [];

  clusters.forEach((cluster, ci) => {
    const color = RHYME_COLORS[ci % RHYME_COLORS.length];
    colors.push(color);
    const anchor = cluster[0];
    // The anchor never classifies against itself — its type is measured
    // against its first partner (which joined, so it cannot be null).
    const anchorType = classifyAnalyses(anchor.analysis, cluster[1].analysis) ?? "assonance";
    cluster.forEach((w, wi) => {
      const type = wi === 0 ? anchorType : classifyAnalyses(anchor.analysis, w.analysis) ?? "assonance";
      const list = hits.get(w.line) ?? [];
      list.push({ raw: w.raw, index: w.index, word: w.cleaned, color, type });
      hits.set(w.line, list);
      if (!lineColors.has(w.line)) lineColors.set(w.line, color);
      if (!lineTypes.has(w.line)) lineTypes.set(w.line, type);
    });
  });

  for (const list of hits.values()) list.sort((a, b) => a.index - b.index);
  return { hits, lineColors, lineTypes, colors };
}

/** Cluster valid lines into rhyme groups (transitive anchor pairing). */
function findRhymeGroups(lineData: LineData[]): number[][] {
  const groups: number[][] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < lineData.length; i++) {
    const a = lineData[i];
    if (!a.isValid || !a.lastWord || assigned.has(i)) continue;
    const group = [i];
    assigned.add(i);
    for (let j = i + 1; j < lineData.length; j++) {
      const b = lineData[j];
      if (!b.isValid || !b.lastWord || assigned.has(j)) continue;
      if (classifyLinePair(a, b) !== null) {
        group.push(j);
        assigned.add(j);
      }
    }
    if (group.length >= 2) groups.push(group);
  }
  return groups;
}

/** Rhyming lines grouped by a shared color (one color per rhyme group). */
export function detectRhymeGroups(lines: string[]): Map<number, string> {
  const groupMap = new Map<number, string>();
  findRhymeGroups(buildLineData(lines)).forEach((group, colorIdx) => {
    const color = RHYME_COLORS[colorIdx % RHYME_COLORS.length];
    for (const lineIdx of group) groupMap.set(lineIdx, color);
  });
  return groupMap;
}

/**
 * Per-line rhyme *type* (exact | assonance | slant) for each grouped line,
 * measured against its group's anchor line. Slant pairs are never grouped
 * (they are too weak to merge whole lines), so only exact/assonance appear.
 */
export function detectLineRhymeTypes(lines: string[]): Map<number, RhymeType> {
  const lineData = buildLineData(lines);
  const typeMap = new Map<number, RhymeType>();
  for (const group of findRhymeGroups(lineData)) {
    const anchorIdx = group[0];
    const anchor = lineData[anchorIdx];
    // Tag every non-anchor member with its type vs. the anchor, then give
    // the anchor the type of its first partner (never pair a line with
    // itself — that would always read as a bogus "exact").
    for (const lineIdx of group) {
      if (lineIdx === anchorIdx) continue;
      const type = classifyLinePair(anchor, lineData[lineIdx]);
      if (type) typeMap.set(lineIdx, type);
    }
    const firstPartner = group.find((i) => i !== anchorIdx);
    if (firstPartner !== undefined) {
      const type = typeMap.get(firstPartner);
      if (type) typeMap.set(anchorIdx, type);
    }
  }
  return typeMap;
}
