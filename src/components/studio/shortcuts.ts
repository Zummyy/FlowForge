// Pure keyboard-shortcut matching for the Studio page.
//
// Matching relies on `e.code` (the *physical* key) rather than `e.key` (the
// *produced character*), so shortcuts work on every keyboard layout and OS:
//   - On a QWERTY keyboard Ctrl+Z yields `e.key === "z"` and `e.code === "KeyZ"`.
//   - On AZERTY / Dvorak / colemak Ctrl+Z produces a different character
//     (`<` on AZERTY), so `e.key.toLowerCase() === "z"` silently fails —
//     but `e.code` is still `"KeyZ"` because it is the same physical key.
//   - On macOS, Cmd+Z is the platform convention for undo; we match it as the
//     Ctrl+Z equivalent there.
//
// The matcher is pure (no DOM access) so it can be unit-tested directly.

export type ShortcutAction =
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "saveSession" }
  | { kind: "togglePlay" }
  | { kind: "split"; takeId: string; markerPosition: number }
  | { kind: "deleteClip"; takeId: string; clipId: string }
  | { kind: "nudgeClip"; clipId: string; delta: number }
  | { kind: "nudgeTake"; takeId: string; delta: number }
  | { kind: "setClipVolume"; clipId: string; delta: number }
  | { kind: "setTakeVolume"; takeId: string; delta: number }
  | { kind: "none" };

/** Editing context required to resolve a keypress to a concrete action. */
export interface ShortcutContext {
  /** True when the fullscreen teleprompter is open — it owns the keyboard. */
  teleprompterOpen: boolean;
  /** True when the focused element is an input / textarea / select. */
  typing: boolean;
  /** Id of the selected take, or null. */
  selectedTakeId: string | null;
  /** Id of the selected clip, or null. */
  selectedClipId: string | null;
  /** True when the selected take has been split into clips (edited mode). */
  takeHasClips: boolean;
  /** Current amber marker position (split point), in seconds. */
  markerPosition: number;
}

/** Normalize an arbitrary KeyboardEvent-like object into the fields we use. */
export function normalizeKeyEvent(e: {
  key?: string;
  code?: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}): {
  code: string;
  key: string;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
} {
  return {
    code: e.code ?? "",
    key: e.key ?? "",
    alt: !!e.altKey,
    ctrl: !!e.ctrlKey,
    meta: !!e.metaKey,
    shift: !!e.shiftKey,
  };
}

/**
 * Resolve a normalized key event to a shortcut action. Returns `{ kind:
 * "none" }` when the keypress is not a recognized shortcut (or should be
 * ignored entirely — e.g. while typing, or when the teleprompter is open).
 */
export function matchShortcut(
  ev: ReturnType<typeof normalizeKeyEvent>,
  ctx: ShortcutContext
): ShortcutAction {
  // The fullscreen teleprompter owns the keyboard completely.
  if (ctx.teleprompterOpen) return { kind: "none" };

  // Ctrl+S → save the session (Cmd+S on macOS is the same platform convention;
  // matched on the physical `KeyS` so it works on every layout). This is the
  // "save my work" gesture, so unlike the editing shortcuts it is deliberately
  // NOT suppressed while a field is focused — the browser's Save Page dialog is
  // blocked with `preventDefault()` instead. Ctrl+Shift+S (browser Save As) is
  // left alone, and Ctrl/Cmd+S with Alt never binds.
  if ((ev.ctrl || ev.meta) && !ev.alt && !ev.shift && ev.code === "KeyS") {
    return { kind: "saveSession" };
  }

  // Don't hijack keys while the user is typing in a field (browser-native
  // undo/typing behaviour stays intact).
  if (ctx.typing) return { kind: "none" };

  // Ctrl+Shift+Z (or Cmd+Shift+Z on macOS) → redo. Checked BEFORE plain
  // Ctrl+Z so the Shift variant is never misread as undo.
  if ((ev.ctrl || ev.meta) && !ev.alt && ev.shift && ev.code === "KeyZ") {
    return { kind: "redo" };
  }
  // Ctrl+Y → redo (Windows/Linux convention). Not matched for Meta — on macOS
  // redo is Cmd+Shift+Z only.
  if (ev.ctrl && !ev.meta && !ev.alt && !ev.shift && ev.code === "KeyY") {
    return { kind: "redo" };
  }

  // Ctrl+Z → undo (Cmd+Z on macOS is the same platform convention; we match it
  // so undo works on both). Requires NO Shift — Shift goes to redo above.
  // `e.code === "KeyZ"` is layout-independent — the produced character
  // (`z`, `<`, `Ω`, …) is irrelevant. The caller MUST call `preventDefault()`
  // so the browser's native undo never fires instead, and any OS/browser side
  // effect of Ctrl+Z (field undo, page undo) is blocked.
  if ((ev.ctrl || ev.meta) && !ev.alt && !ev.shift && ev.code === "KeyZ") {
    return { kind: "undo" };
  }

  // Below: no shortcut is allowed to combine with Ctrl/Meta (those are
  // reserved for the browser/OS: Cmd+S, Cmd+Left, Ctrl+Arrow…).
  const ctrlOrMeta = ev.ctrl || ev.meta;

  // Space → play / pause the beat. `code === "Space"` also catches key repeats.
  if (!ev.alt && !ev.ctrl && !ev.meta && ev.code === "Space") {
    return { kind: "togglePlay" };
  }

  // S → split the selected take at the amber marker (same layout caveat as Z).
  if (!ev.alt && !ctrlOrMeta && ev.code === "KeyS" && ctx.selectedTakeId) {
    return { kind: "split", takeId: ctx.selectedTakeId, markerPosition: ctx.markerPosition };
  }

  // Delete / Backspace → remove the selected clip.
  if (
    !ev.alt &&
    !ctrlOrMeta &&
    (ev.key === "Delete" || ev.key === "Backspace") &&
    ctx.selectedTakeId &&
    ctx.selectedClipId
  ) {
    return { kind: "deleteClip", takeId: ctx.selectedTakeId, clipId: ctx.selectedClipId };
  }

  // ← / → → nudge the selected clip, or the whole take when it is unsplit
  // (Shift = 1 s, otherwise 0.1 s).
  if (!ev.alt && !ctrlOrMeta && (ev.code === "ArrowLeft" || ev.code === "ArrowRight") && ctx.selectedTakeId) {
    const step = ev.shift ? 1 : 0.1;
    const delta = ev.code === "ArrowRight" ? step : -step;
    if (ctx.selectedClipId) {
      return { kind: "nudgeClip", clipId: ctx.selectedClipId, delta };
    }
    if (!ctx.takeHasClips) {
      return { kind: "nudgeTake", takeId: ctx.selectedTakeId, delta };
    }
  }

  // ↑ / ↓ → volume of the selected clip or take (Shift = ±20 %, else ±5 %).
  if (!ev.alt && !ctrlOrMeta && (ev.code === "ArrowUp" || ev.code === "ArrowDown") && ctx.selectedTakeId) {
    const step = ev.shift ? 0.2 : 0.05;
    const delta = ev.code === "ArrowUp" ? step : -step;
    if (ctx.selectedClipId) {
      return { kind: "setClipVolume", clipId: ctx.selectedClipId, delta };
    }
    return { kind: "setTakeVolume", takeId: ctx.selectedTakeId, delta };
  }

  return { kind: "none" };
}
