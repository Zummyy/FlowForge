// FlowForge Syllable Counter - Polish Language Support
// Counts syllables by analyzing vowel clusters in Polish words

// Deliberately NOT global: `RegExp.test()` with the `g` flag advances
// `lastIndex`, so repeated calls alternate between true/false and every
// other vowel would be skipped (e.g. "pies" → 1 instead of 2 syllables).
const POLISH_VOWELS = /[aeiouyąęó]/i;

// Vowels that can absorb a palatalization marker (everything except i/y).
const SOFT_VOWELS = /[aeouąęó]/i;

// Polish dipthongs and special cases
const DIPHTHONGS = ["au", "eu", "ou"];

function isVowel(ch: string): boolean {
  return POLISH_VOWELS.test(ch);
}

/**
 * Count syllables in a single word (Polish)
 * Polish syllable rules:
 * - Each vowel (a, e, i, o, u, y, ą, ę, ó) typically = 1 syllable
 * - Dipthongs (au, eu, ou) = 1 syllable
 * - "ie" at end = 1 syllable
 * - "i" before a vowel palatalizes the preceding consonant and does not
 *   form its own syllable (miasto → mias-to, piosenka → pio-sen-ka)
 */
function countWordSyllables(word: string): number {
  const cleaned = word.toLowerCase().replace(/[^a-ząćęłńóśźż]/g, "");
  if (cleaned.length === 0) return 0;

  // Handle special cases
  if (cleaned.length <= 2) return 1;

  let count = 0;
  let i = 0;

  while (i < cleaned.length) {
    const char = cleaned[i];
    const nextChar = cleaned[i + 1] || "";

    // Check for dipthongs
    if (DIPHTHONGS.includes(char + nextChar)) {
      count++;
      i += 2;
      continue;
    }

    // Check for "ie" at end (1 syllable)
    if (char === "i" && nextChar === "e" && i + 2 === cleaned.length) {
      count++;
      i += 2;
      continue;
    }

    // Palatalization: "i" before a vowel after a consonant is a softening
    // marker, not a syllable nucleus (miasto = mias-to, ciemność = ciem-ność).
    // An initial "i" (idea) or one following a vowel (naiwny) stays a vowel.
    if (
      char === "i" &&
      SOFT_VOWELS.test(nextChar) &&
      i > 0 &&
      !isVowel(cleaned[i - 1])
    ) {
      i++;
      continue;
    }

    // Check for vowel
    if (isVowel(char)) {
      count++;
    }

    i++;
  }

  // Minimum 1 syllable for non-empty words
  return Math.max(count, 1);
}

/**
 * Count syllables in a line of text
 */
export function countLineSyllables(line: string): number {
  const words = line.trim().split(/\s+/);
  return words.reduce((sum, word) => sum + countWordSyllables(word), 0);
}

/**
 * Count syllables per word in a line
 */
export function countWordSyllablesInLine(line: string): Array<{ word: string; syllables: number }> {
  const words = line.trim().split(/\s+/);
  return words.map((word) => ({
    word,
    syllables: countWordSyllables(word),
  }));
}

/**
 * Analyze entire lyrics text
 */
export function analyzeLyrics(text: string): {
  totalSyllables: number;
  lineCount: number;
  verseCount: number;
  wordCount: number;
  avgSyllablesPerLine: number;
  avgSyllablesPerWord: number;
  lines: Array<{
    text: string;
    syllables: number;
    words: Array<{ word: string; syllables: number }>;
  }>;
} {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const verses = text.split(/\n\s*\n/).filter((v) => v.trim().length > 0);

  let totalSyllables = 0;
  let totalWords = 0;

  const analyzedLines = lines.map((line) => {
    const words = countWordSyllablesInLine(line);
    const lineSyllables = words.reduce((sum, w) => sum + w.syllables, 0);
    totalSyllables += lineSyllables;
    totalWords += words.length;
    return {
      text: line,
      syllables: lineSyllables,
      words,
    };
  });

  return {
    totalSyllables,
    lineCount: lines.length,
    verseCount: verses.length,
    wordCount: totalWords,
    avgSyllablesPerLine: lines.length > 0 ? Math.round(totalSyllables / lines.length * 10) / 10 : 0,
    avgSyllablesPerWord: totalWords > 0 ? Math.round(totalSyllables / totalWords * 10) / 10 : 0,
    lines: analyzedLines,
  };
}
