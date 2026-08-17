// ─── Line-based diff for lyric versions ────────────────────────────────
// A dependency-free LCS diff over whole lines — exactly what the Vault needs
// to show what changed between two saved versions (verses are line-oriented).
// No external lib: the DP table is O(n·m), trivial for lyric-sized inputs.

export type DiffLineType = "same" | "added" | "removed";

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

/**
 * Diff two line arrays into an ordered list of unchanged / added / removed
 * lines. The result preserves order: removals come from the old side, adds
 * from the new side, unchanged lines anchor the common skeleton.
 */
export function diffLines(oldLines: string[], newLines: string[]): DiffLine[] {
  const a = oldLines;
  const b = newLines;
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((text) => ({ type: "added", text }));
  if (m === 0) return a.map((text) => ({ type: "removed", text }));

  // LCS length table — dp[i][j] = LCS of a[i..] and b[j..].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      // Tie-break toward removals so a changed line reads "old, then new".
      out.push({ type: "removed", text: a[i] });
      i++;
    } else {
      out.push({ type: "added", text: b[j] });
      j++;
    }
  }
  while (i < n) {
    out.push({ type: "removed", text: a[i] });
    i++;
  }
  while (j < m) {
    out.push({ type: "added", text: b[j] });
    j++;
  }
  return out;
}

export interface DiffStats {
  added: number;
  removed: number;
  unchanged: number;
  /** 0..100 — unchanged lines over the longer of the two sides. */
  similarity: number;
}

/** Count added/removed/unchanged lines and the overall similarity. */
export function diffStats(oldLines: string[], newLines: string[]): DiffStats {
  const diff = diffLines(oldLines, newLines);
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const line of diff) {
    if (line.type === "added") added++;
    else if (line.type === "removed") removed++;
    else unchanged++;
  }
  const total = Math.max(oldLines.length, newLines.length);
  const similarity = total > 0 ? Math.round((unchanged / total) * 100) : 100;
  return { added, removed, unchanged, similarity };
}
