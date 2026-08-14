// Pure, injectable debounced-persister core used by the Studio context.
//
// The StudioProvider persists its snapshot to localStorage, but only after the
// user goes quiet for a moment — rapid edits (drag gestures, volume flicks,
// typing) must batch into ONE write instead of hammering storage. This factory
// owns exactly that rule: every `schedule()` (one per state change) resets the
// debounce window; the injected `write()` runs once the window elapses.
//
// Timers are injected (`setTimer`/`clearTimer`) so tests can drive time with a
// manual clock (see scripts/test-clip-timeline.ts) and `write` is injected so
// callers can capture the latest state from a ref.

/** How long the provider waits after the last change before writing (ms). */
export const PERSIST_DEBOUNCE_MS = 400;

export interface DebouncedPersister {
  /** Called on every state change — resets the debounce window. */
  schedule: () => void;
  /** Write immediately and cancel the pending timer (no double-write). */
  flush: () => void;
  /** Cancel a pending write without writing (safe no-op if none). */
  cancel: () => void;
}

export function createDebouncedPersister(
  setTimer: (fn: () => void) => number,
  clearTimer: (id: number) => void,
  write: () => void
): DebouncedPersister {
  /** Pending write timer id, or null when idle. */
  let timer: number | null = null;

  return {
    schedule() {
      if (timer !== null) clearTimer(timer);
      timer = setTimer(() => {
        timer = null;
        write();
      });
    },
    flush() {
      if (timer === null) return;
      clearTimer(timer);
      timer = null;
      write();
    },
    cancel() {
      if (timer === null) return;
      clearTimer(timer);
      timer = null;
    },
  };
}
