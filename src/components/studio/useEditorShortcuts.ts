"use client";

// Reusable keyboard-shortcut hook for the Studio Waveform Editor.
//
// Owns the single `keydown` listener (attached in the CAPTURE phase so it sees
// the event before any widget or browser handler could swallow it) and the
// `activeElement` "am I typing?" guard. Key matching itself lives in the pure
// `matchShortcut` helper (layout-independent `e.code` matching), and the
// resulting actions are dispatched to the callbacks supplied by the caller.
// Every recognized shortcut calls `preventDefault()` — most importantly the
// undo branch, so the browser's native Ctrl+Z never competes with the
// editor's history stack.

import { useEffect } from "react";
import { matchShortcut, normalizeKeyEvent } from "./shortcuts";
import { clamp } from "./useClipTimeline";
import type { Clip, VocalTake } from "./types";

/** Current editing context — state the shortcut resolution depends on. */
export interface EditorShortcutContext {
  /** True while the fullscreen teleprompter is open (it owns the keyboard). */
  teleprompterOpen: boolean;
  selectedTakeId: string | null;
  selectedClipId: string | null;
  /** Amber marker position (split point), in seconds. */
  markerPosition: number;
  /** The live clips map (used to look up clip offsets/volumes by id). */
  clips: Map<string, Clip[]>;
  /** The live takes array (used to look up take offsets/volumes by id). */
  takes: VocalTake[];
}

/** Callbacks invoked for each resolved shortcut. */
export interface EditorShortcutHandlers {
  /** Ctrl+Z — undo the last timeline action. */
  onUndo: () => void;
  /** Ctrl+Shift+Z / Ctrl+Y — re-apply the last undone action. */
  onRedo: () => void;
  /** Ctrl+S — save the session (page shows the toast/feedback itself). */
  onSaveSession: () => void;
  /** Space — play / pause the beat. */
  onTogglePlay: () => void;
  /** S — split the selected take at the amber marker. */
  onSplit: (takeId: string, position: number) => void;
  /** Delete / Backspace — remove the selected clip. */
  onDeleteClip: (takeId: string, clipId: string) => void;
  /** ←/→ — nudge a clip (delta already applied to its current offset). */
  onMoveClip: (clipId: string, newOffset: number) => void;
  /** ←/→ — nudge an unsplit take. */
  onUpdateTakeOffset: (takeId: string, offset: number) => void;
  /** ↑/↓ — adjust a clip's volume (delta already applied). */
  onUpdateClipVolume: (clipId: string, volume: number) => void;
  /** ↑/↓ — adjust a take's volume (delta already applied and clamped). */
  onUpdateTakeVolume: (takeId: string, volume: number) => void;
}

export function useEditorShortcuts(
  ctx: EditorShortcutContext,
  handlers: EditorShortcutHandlers
): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Never hijack keys while the user is typing in a field (browser-native
      // undo/typing behaviour stays intact) — except Ctrl+S, which is allowed
      // through even while typing by the matcher itself.
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName?.toUpperCase() ?? "";
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!el?.isContentEditable;

      const action = matchShortcut(normalizeKeyEvent(e), {
        teleprompterOpen: ctx.teleprompterOpen,
        typing,
        selectedTakeId: ctx.selectedTakeId,
        selectedClipId: ctx.selectedClipId,
        takeHasClips: !!ctx.selectedTakeId && ctx.clips.has(ctx.selectedTakeId),
        markerPosition: ctx.markerPosition,
      });

      switch (action.kind) {
        case "undo": {
          e.preventDefault();
          handlers.onUndo();
          break;
        }
        case "redo": {
          e.preventDefault();
          handlers.onRedo();
          break;
        }
        case "saveSession": {
          e.preventDefault();
          handlers.onSaveSession();
          break;
        }
        case "togglePlay": {
          e.preventDefault();
          handlers.onTogglePlay();
          break;
        }
        case "split": {
          e.preventDefault();
          handlers.onSplit(action.takeId, action.markerPosition);
          break;
        }
        case "deleteClip": {
          e.preventDefault();
          handlers.onDeleteClip(action.takeId, action.clipId);
          break;
        }
        case "nudgeClip": {
          e.preventDefault();
          const clip = [...ctx.clips.values()].flat().find((c) => c.id === action.clipId);
          if (clip) handlers.onMoveClip(clip.id, clip.offset + action.delta);
          break;
        }
        case "nudgeTake": {
          e.preventDefault();
          const take = ctx.takes.find((t) => t.id === action.takeId);
          if (take) handlers.onUpdateTakeOffset(action.takeId, Math.max(0, take.offset + action.delta));
          break;
        }
        case "setClipVolume": {
          e.preventDefault();
          const clip = [...ctx.clips.values()].flat().find((c) => c.id === action.clipId);
          if (clip) handlers.onUpdateClipVolume(clip.id, clip.volume + action.delta);
          break;
        }
        case "setTakeVolume": {
          e.preventDefault();
          const take = ctx.takes.find((t) => t.id === action.takeId);
          if (take) handlers.onUpdateTakeVolume(action.takeId, clamp(take.volume + action.delta, 0, 1.5));
          break;
        }
        case "none":
          break;
      }
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // Handlers are destructured into individual deps so an inline object
    // literal of stable callbacks doesn't re-subscribe on every render.
  }, [
    ctx.teleprompterOpen,
    ctx.selectedTakeId,
    ctx.selectedClipId,
    ctx.markerPosition,
    ctx.clips,
    ctx.takes,
    handlers.onUndo,
    handlers.onRedo,
    handlers.onSaveSession,
    handlers.onTogglePlay,
    handlers.onSplit,
    handlers.onDeleteClip,
    handlers.onMoveClip,
    handlers.onUpdateTakeOffset,
    handlers.onUpdateClipVolume,
    handlers.onUpdateTakeVolume,
  ]);
}
