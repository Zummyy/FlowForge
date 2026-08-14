"use client";

import { useCallback, useRef, useState } from "react";
import { UndoHistory } from "./history";
import type { Clip, SavedClipState, TrimEdge, VocalTake } from "./types";

/**
 * Clip-timeline state management for the Waveform Editor.
 *
 * Every mutation is applied through a tiny eager-ref pattern:
 *  1. the next clips map is computed *pure* (no side effects inside React
 *     updaters, so StrictMode double-invocation is harmless),
 *  2. it is written to a ref AND to state in the same tick.
 *
 * This guarantees that consecutive operations (e.g. split → split → delete)
 * always read fresh state and never roll back — the two historical bugs of
 * this module.
 */

export const MIN_CLIP_SECONDS = 0.05; // smallest audible clip on the timeline
const MIN_TRIM_RANGE = 0.005; // smallest source fraction a split may carve out

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Pure gesture-dedup state machine for the Waveform Editor.
 *
 * A "gesture" is a run of continuous mutations (clip drag / edge trim)
 * between `begin()` and `end()`. Only the FIRST mutation of a gesture may
 * record a history snapshot; the rest are micro-movements of the same gesture,
 * so a single drag produces exactly ONE undo entry. `end()` re-arms the
 * tracker so the next discrete mutation (or gesture) snapshots again.
 */
export function createGestureTracker() {
  let dirty = false;
  return {
    /** Marks the start of a gesture — the next mutation will snapshot again. */
    begin(): void {
      dirty = false;
    },
    /** Marks the end of a gesture. */
    end(): void {
      dirty = false;
    },
    /**
     * Ask whether this mutation may snapshot. Returns the `label` to record
     * for the first mutation since begin()/end()/start, or `null` when the
     * snapshot was already taken for the current gesture (dedup).
     */
    takeSnapshotLabel(label: string): string | null {
      if (!dirty) {
        dirty = true;
        return label;
      }
      return null;
    },
  };
}

/** Build the initial full-length clip for a take (used by the first split). */
export function makeInitialClip(take: VocalTake): Clip {
  return {
    id: `${take.id}-clip-0`,
    label: take.label,
    takeId: take.id,
    trimStart: take.trimStart,
    trimEnd: take.trimEnd,
    offset: take.offset,
    duration: Math.max(MIN_CLIP_SECONDS, take.duration * (take.trimEnd - take.trimStart)),
    volume: take.volume,
    isMuted: take.isMuted,
  };
}

export interface SplitResult {
  clips: Clip[];
  selectedClipId: string;
}

/** Pure — split the clip containing `splitTimeSeconds` into two adjacent clips. */
export function computeSplit(
  clips: Clip[],
  take: VocalTake,
  splitTimeSeconds: number
): SplitResult | null {
  const arr = clips && clips.length > 0 ? clips : [makeInitialClip(take)];
  let idx = -1;
  for (let i = 0; i < arr.length; i++) {
    const c = arr[i];
    const end = c.offset + c.duration;
    if (splitTimeSeconds >= c.offset + MIN_CLIP_SECONDS && splitTimeSeconds <= end - MIN_CLIP_SECONDS) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return null;

  const clip = arr[idx];
  const fraction = clamp((splitTimeSeconds - clip.offset) / clip.duration, 0, 1);
  const splitTrim = clip.trimStart + fraction * (clip.trimEnd - clip.trimStart);
  if (splitTrim <= clip.trimStart + MIN_TRIM_RANGE || splitTrim >= clip.trimEnd - MIN_TRIM_RANGE) {
    return null;
  }

  const ts = Date.now();
  const durationA = clip.duration * fraction;
  const clipA: Clip = {
    ...clip,
    id: `${clip.takeId}-clip-${ts}-a`,
    label: `${clip.label} (A)`,
    trimEnd: splitTrim,
    duration: durationA,
  };
  const clipB: Clip = {
    ...clip,
    id: `${clip.takeId}-clip-${ts}-b`,
    label: `${clip.label} (B)`,
    trimStart: splitTrim,
    offset: clip.offset + durationA,
    duration: clip.duration - durationA,
  };
  const next = [...arr];
  next.splice(idx, 1, clipA, clipB);
  return { clips: next, selectedClipId: clipB.id };
}

export interface DeleteResult {
  clips: Clip[];
  selectedClipId: string | null;
}

/**
 * Pure — remove exactly one clip. All remaining offsets are preserved as-is.
 * An empty array (NOT a deleted entry) is the result of deleting the last clip,
 * so the take stays in "edited" mode and never reverts to the original take.
 */
export function computeDelete(clips: Clip[], clipId: string): DeleteResult | null {
  if (!clips || clips.length === 0) return null;
  const idx = clips.findIndex((c) => c.id === clipId);
  if (idx === -1) return null;
  const remaining = clips.filter((c) => c.id !== clipId);
  let selectedClipId: string | null = null;
  if (remaining.length > 0) {
    // Prefer the clip that slid into the deleted slot, else the one before it.
    selectedClipId = remaining[Math.min(idx, remaining.length - 1)].id;
  }
  return { clips: remaining, selectedClipId };
}

/** Pure — clamp a clip so it never overlaps neighbours nor leaves the timeline. */
export function computeMove(
  clips: Clip[],
  clipId: string,
  newOffset: number,
  totalDuration: number
): Clip[] | null {
  if (!clips || clips.length === 0) return null;
  const idx = clips.findIndex((c) => c.id === clipId);
  if (idx === -1) return null;
  const clip = clips[idx];

  let minStart = 0;
  let maxStart =
    totalDuration > clip.duration ? totalDuration - clip.duration : Number.MAX_SAFE_INTEGER;
  for (let i = 0; i < clips.length; i++) {
    if (i === idx) continue;
    const other = clips[i];
    if (other.offset + other.duration <= clip.offset + 1e-6) {
      // other ends at/before this clip starts → previous neighbour
      minStart = Math.max(minStart, other.offset + other.duration);
    } else if (other.offset >= clip.offset + clip.duration - 1e-6) {
      // other starts at/after this clip ends → next neighbour
      maxStart = Math.min(maxStart, other.offset - clip.duration);
    }
  }
  const clamped = Math.max(minStart, Math.min(newOffset, Math.max(minStart, maxStart)));
  const next = [...clips];
  next[idx] = { ...clip, offset: clamped };
  return next;
}

/**
 * Pure — trim one edge of a clip to `newEdgeTime` (timeline seconds).
 * Clamps against: minimum clip length, source audio bounds and neighbours.
 * The opposite edge's content position stays fixed (non-destructive trim).
 */
export function computeEdgeTrim(
  clips: Clip[],
  take: VocalTake,
  clipId: string,
  edge: TrimEdge,
  newEdgeTime: number,
  totalDuration: number
): Clip[] | null {
  if (!clips || clips.length === 0 || take.duration <= 0) return null;
  const idx = clips.findIndex((c) => c.id === clipId);
  if (idx === -1) return null;
  const clip = clips[idx];
  const D = take.duration;

  let minStart = 0;
  let maxEnd = totalDuration > 0 ? totalDuration : D;
  for (let i = 0; i < clips.length; i++) {
    if (i === idx) continue;
    const other = clips[i];
    if (other.offset + other.duration <= clip.offset + 1e-6) {
      minStart = Math.max(minStart, other.offset + other.duration);
    } else if (other.offset >= clip.offset + clip.duration - 1e-6) {
      maxEnd = Math.min(maxEnd, other.offset);
    }
  }

  const updated: Clip = { ...clip };
  if (edge === "end") {
    // Right edge: offset + left content stay fixed, duration changes.
    const minEnd = clip.offset + MIN_CLIP_SECONDS;
    const sourceMaxEnd = clip.offset + (1 - clip.trimStart) * D; // cannot exceed take end
    const R = Math.max(minEnd, Math.min(newEdgeTime, maxEnd, sourceMaxEnd));
    updated.duration = Math.max(MIN_CLIP_SECONDS, R - clip.offset);
    updated.trimEnd = clip.trimStart + updated.duration / D;
  } else {
    // Left edge: right content edge stays fixed, offset + duration change.
    const R = clip.offset + clip.duration;
    const maxStart = R - MIN_CLIP_SECONDS;
    const sourceMinStart = R - clip.trimEnd * D; // cannot extend before take start
    const L = Math.max(minStart, sourceMinStart, Math.min(newEdgeTime, maxStart));
    updated.offset = L;
    updated.duration = Math.max(MIN_CLIP_SECONDS, R - L);
    updated.trimStart = clip.trimEnd - updated.duration / D;
  }
  if (updated.duration < MIN_CLIP_SECONDS) return null;

  const next = [...clips];
  next[idx] = updated;
  return next;
}

export const MAX_HISTORY = 100;

/** Deep copy of the clips map (each clip cloned so snapshots are immutable). */
export function cloneClipsMap(map: Map<string, Clip[]>): Map<string, Clip[]> {
  const next = new Map<string, Clip[]>();
  for (const [key, arr] of map) next.set(key, arr.map((c) => ({ ...c })));
  return next;
}

export interface ClipTimelineApi {
  clips: Map<string, Clip[]>;
  /** Splits the take at `splitTimeSeconds`; returns the id of the right fragment (B), or null. */
  splitClip: (takeId: string, splitTimeSeconds: number) => string | null;
  /** Deletes a single clip; returns the id of the next selection, or null. */
  deleteClip: (takeId: string, clipId: string) => string | null;
  moveClip: (clipId: string, newOffset: number) => void;
  trimClipEdge: (clipId: string, edge: TrimEdge, newEdgeTime: number) => void;
  /** Adjusts a single clip's volume (0..1.5). */
  updateClipVolume: (clipId: string, volume: number) => void;
  /** Removes all clips of a take (used when the take itself is deleted). */
  resetTakeClips: (takeId: string) => void;
  /**
   * Restores the previous timeline state (Ctrl+Z). Returns the label of the
   * undone action, or null when the history stack is empty.
   */
  undo: () => string | null;
  /**
   * Re-applies the last undone action (Ctrl+Shift+Z / Ctrl+Y). Returns the
   * label of the redone action, or null when there is nothing to redo.
   */
  redo: () => string | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Marks the start of a drag/trim gesture — the first mutation snapshots once. */
  beginGesture: () => void;
  /** Marks the end of a drag/trim gesture. */
  endGesture: () => void;
  /**
   * Seed the timeline from persisted clips (rehydration after navigation).
   * Replaces the whole clip map and clears the undo/redo history.
   */
  restoreClips: (persisted: { takeId: string; items: SavedClipState[] }[]) => void;
  /**
   * Re-insert clips for a take that was restored (undo of a take deletion).
   * Merges into the map WITHOUT touching the undo/redo history.
   */
  restoreTakeClips: (takeId: string, items: Clip[]) => void;
}

export function useClipTimeline(takes: VocalTake[], totalDuration: number): ClipTimelineApi {
  const [clips, setClips] = useState<Map<string, Clip[]>>(new Map());
  const clipsRef = useRef<Map<string, Clip[]>>(new Map());

  // ── Undo / redo history ──
  const historyRef = useRef(new UndoHistory<Map<string, Clip[]>>(MAX_HISTORY));
  // Tracks whether the current drag/trim gesture already took its snapshot, so
  // continuous mousemove mutations don't flood the history stack.
  const gestureTrackerRef = useRef(createGestureTracker());
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const capture = useCallback((label: string) => {
    // A fresh mutation invalidates any redo history (the class does that in
    // `push`), and canRedo always flips off until the next undo.
    historyRef.current.push(cloneClipsMap(clipsRef.current), label);
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  /** Eager commit: compute pure result from the ref, then sync ref + state.
   *  Passing a `label` records an undo snapshot of the pre-mutation state. */
  const commit = useCallback(
    (updater: (prev: Map<string, Clip[]>) => Map<string, Clip[]>, label: string | null) => {
      if (label) capture(label);
      const next = updater(clipsRef.current);
      clipsRef.current = next;
      setClips(next);
    },
    [capture]
  );

  const splitClip = useCallback(
    (takeId: string, splitTimeSeconds: number): string | null => {
      const take = takes.find((t) => t.id === takeId);
      if (!take) return null;
      const current = clipsRef.current.get(takeId);
      const base = current && current.length > 0 ? current : [makeInitialClip(take)];
      const result = computeSplit(base, take, splitTimeSeconds);
      if (!result) return null;
      commit(
        (prev) => {
          const next = new Map(prev);
          next.set(takeId, result.clips);
          return next;
        },
        "Rozcięto fragment"
      );
      return result.selectedClipId;
    },
    [takes, commit]
  );

  const deleteClip = useCallback(
    (takeId: string, clipId: string): string | null => {
      const current = clipsRef.current.get(takeId);
      const result = current ? computeDelete(current, clipId) : null;
      if (!result) return null;
      commit(
        (prev) => {
          const next = new Map(prev);
          // Keep the key even when empty — the take stays in "edited" mode.
          next.set(takeId, result.clips);
          return next;
        },
        "Usunięto fragment"
      );
      return result.selectedClipId;
    },
    [commit]
  );

  const moveClip = useCallback(
    (clipId: string, newOffset: number) => {
      for (const [takeId, arr] of clipsRef.current.entries()) {
        const idx = arr.findIndex((c) => c.id === clipId);
        if (idx === -1) continue;
        const updated = computeMove(arr, clipId, newOffset, totalDuration);
        if (!updated) return;
        // No real change (already clamped to this position) → skip entirely.
        if (Math.abs(updated[idx].offset - arr[idx].offset) < 1e-9) return;
        // Snapshot only the FIRST mutation of a drag gesture.
        const snapshotLabel = gestureTrackerRef.current.takeSnapshotLabel("Przesunięto fragment");
        commit(
          (prev) => {
            const next = new Map(prev);
            next.set(takeId, updated);
            return next;
          },
          snapshotLabel
        );
        return;
      }
    },
    [totalDuration, commit]
  );

  const trimClipEdge = useCallback(
    (clipId: string, edge: TrimEdge, newEdgeTime: number) => {
      for (const [takeId, arr] of clipsRef.current.entries()) {
        if (!arr.some((c) => c.id === clipId)) continue;
        const take = takes.find((t) => t.id === takeId);
        if (!take) return;
        const updated = computeEdgeTrim(arr, take, clipId, edge, newEdgeTime, totalDuration);
        if (!updated) return;
        const idx = updated.findIndex((c) => c.id === clipId);
        const prevClip = arr.find((c) => c.id === clipId);
        const changed =
          !!prevClip &&
          idx !== -1 &&
          (Math.abs(updated[idx].offset - prevClip.offset) > 1e-9 ||
            Math.abs(updated[idx].duration - prevClip.duration) > 1e-9);
        if (!changed) return;
        // Snapshot only the FIRST mutation of a trim gesture.
        const snapshotLabel = gestureTrackerRef.current.takeSnapshotLabel("Przycięto fragment");
        commit(
          (prev) => {
            const next = new Map(prev);
            next.set(takeId, updated);
            return next;
          },
          snapshotLabel
        );
        return;
      }
    },
    [takes, totalDuration, commit]
  );

  const updateClipVolume = useCallback(
    (clipId: string, volume: number) => {
      for (const [takeId, arr] of clipsRef.current.entries()) {
        const idx = arr.findIndex((c) => c.id === clipId);
        if (idx === -1) continue;
        const v = clamp(volume, 0, 1.5);
        if (Math.abs(v - arr[idx].volume) < 1e-9) return; // no real change
        const updated = [...arr];
        updated[idx] = { ...arr[idx], volume: v };
        commit(
          (prev) => {
            const next = new Map(prev);
            next.set(takeId, updated);
            return next;
          },
          "Zmieniono głośność fragmentu"
        );
        return;
      }
    },
    [commit]
  );

  const resetTakeClips = useCallback(
    (takeId: string) => {
      commit(
        (prev) => {
          if (!prev.has(takeId)) return prev;
          const next = new Map(prev);
          next.delete(takeId);
          return next;
        },
        null
      );
    },
    [commit]
  );

  const undo = useCallback((): string | null => {
    const entry = historyRef.current.pop();
    if (!entry) return null;
    // Mirror: the state we are leaving goes onto the redo stack, so redo can
    // re-apply it with the same action label.
    historyRef.current.pushRedo(cloneClipsMap(clipsRef.current), entry.label);
    clipsRef.current = entry.state;
    setClips(entry.state);
    setCanUndo(historyRef.current.size > 0);
    setCanRedo(true);
    return entry.label;
  }, []);

  const redo = useCallback((): string | null => {
    const entry = historyRef.current.popRedo();
    if (!entry) return null;
    // Mirror back: the state we are leaving goes onto the undo stack, so
    // Ctrl+Z after a redo returns to the pre-redo state. `invalidateRedo` =
    // false keeps the remaining redo entries intact (a redo is not a new edit).
    historyRef.current.push(cloneClipsMap(clipsRef.current), entry.label, false);
    clipsRef.current = entry.state;
    setClips(entry.state);
    setCanUndo(true);
    setCanRedo(historyRef.current.redoSize > 0);
    return entry.label;
  }, []);

  const beginGesture = useCallback(() => {
    gestureTrackerRef.current.begin();
  }, []);

  const endGesture = useCallback(() => {
    gestureTrackerRef.current.end();
  }, []);

  const restoreTakeClips = useCallback((takeId: string, items: Clip[]) => {
    if (!items || items.length === 0) return;
    const next = new Map(clipsRef.current);
    next.set(takeId, items);
    clipsRef.current = next;
    setClips(next);
  }, []);

  const restoreClips = useCallback((persisted: { takeId: string; items: SavedClipState[] }[]) => {
    const next = new Map<string, Clip[]>();
    (persisted || []).forEach((group) => {
      if (!group || !Array.isArray(group.items) || group.items.length === 0) return;
      next.set(
        group.takeId,
        group.items.map((it) => ({
          id: it.id,
          label: it.label,
          takeId: group.takeId,
          trimStart: it.trimStart,
          trimEnd: it.trimEnd,
          offset: it.offset,
          duration: it.duration,
          volume: it.volume,
          isMuted: it.isMuted,
        }))
      );
    });
    clipsRef.current = next;
    setClips(next);
    historyRef.current.clear();
    setCanUndo(false);
    setCanRedo(false);
  }, []);

  return {
    clips,
    splitClip,
    deleteClip,
    moveClip,
    trimClipEdge,
    updateClipVolume,
    resetTakeClips,
    undo,
    redo,
    canUndo,
    canRedo,
    beginGesture,
    endGesture,
    restoreClips,
    restoreTakeClips,
  };
}
