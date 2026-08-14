// Pure helpers for the Studio recorder (punch-in / position-based recording).

/**
 * Compute the timeline position (seconds) at which recording should start.
 *
 * - Prefers the exact float position of the beat element (`audioCurrentTime`)
 *   so punch-in mid-playback is sample-accurate; falls back to the displayed
 *   playhead (`fallbackTime`) when no beat is loaded.
 * - Clamps to just before the beat ends so the beat can actually play from the
 *   chosen timestamp.
 */
export function computePunchIn(opts: {
  /** Exact beat element position (seconds), if a beat is loaded. */
  audioCurrentTime?: number;
  /** Displayed playhead position (seconds) — used when no beat is loaded. */
  fallbackTime: number;
  /** Beat duration (seconds), if known. */
  audioDuration?: number;
  /** Loaded beat length from transport state (seconds). */
  totalDuration: number;
}): number {
  const { audioCurrentTime, fallbackTime, audioDuration, totalDuration } = opts;
  const raw =
    audioCurrentTime !== undefined && isFinite(audioCurrentTime) ? audioCurrentTime : fallbackTime;
  const maxStart =
    audioDuration !== undefined && isFinite(audioDuration)
      ? Math.max(0, audioDuration - 0.05)
      : totalDuration > 0
        ? totalDuration
        : Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.min(raw, maxStart));
}
