"use client";

// Global Studio session context.
//
// The Studio page unmounts when the user navigates to The Vault / Gotowe Numery
// etc., which used to wipe the uploaded beat, takes and timeline. This provider
// lives in the root layout (which never unmounts) and holds a serializable
// snapshot of the live session, backed by localStorage so it even survives full
// reloads. Audio is stored as data URLs (object URLs die with the page).

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createDebouncedPersister, PERSIST_DEBOUNCE_MS } from "./debounce";
import type { DebouncedPersister } from "./debounce";
import type { SavedClipState } from "./types";

/**
 * A take that survived navigation. Audio is referenced by server URL
 * (`audioUrl` — uploaded to /api/recordings, durable + cross-browser);
 * `dataUrl` is the legacy fallback for takes recorded before the upload API
 * existed (or uploaded while offline), embedded as base64.
 */
export interface SerializedTake {
  id: string;
  label: string;
  duration: number;
  offset: number;
  volume: number;
  isMuted: boolean;
  isSoloed: boolean;
  trimStart: number;
  trimEnd: number;
  /** Server URL of the uploaded recording — /api/recordings/<takeId>. */
  audioUrl?: string;
  /** Legacy embedded audio (pre-upload-API / offline fallback). */
  dataUrl?: string;
}

export interface SerializedClips {
  takeId: string;
  items: SavedClipState[];
}

export interface PersistedTeleprompter {
  text: string;
  sourceId: string | null;
  sourceLabel: string | null;
  speed: number;
}

export interface PersistedStudioState {
  /** The uploaded beat / instrumental (audio as a data URL). */
  beat: { name: string; dataUrl: string } | null;
  /** Beat/instrumental volume (0..1.5) — survives navigation like everything else. */
  beatVolume: number;
  takes: SerializedTake[];
  clips: SerializedClips[];
  teleprompter: PersistedTeleprompter;
  updatedAt: string;
}

export const EMPTY_STUDIO_STATE: PersistedStudioState = {
  beat: null,
  beatVolume: 0.7,
  takes: [],
  clips: [],
  teleprompter: { text: "", sourceId: null, sourceLabel: null, speed: 30 },
  updatedAt: new Date(0).toISOString(),
};

export const STUDIO_LIVE_STORAGE_KEY = "flowforge-studio-live";

export function loadPersistedStudioState(): PersistedStudioState {
  if (typeof window === "undefined") return EMPTY_STUDIO_STATE;
  try {
    const raw = window.localStorage.getItem(STUDIO_LIVE_STORAGE_KEY);
    if (!raw) return EMPTY_STUDIO_STATE;
    const p = JSON.parse(raw);
    return {
      beat:
        p.beat && typeof p.beat.dataUrl === "string"
          ? { name: typeof p.beat.name === "string" ? p.beat.name : "Bit", dataUrl: p.beat.dataUrl }
          : null,
      beatVolume: typeof p.beatVolume === "number" ? p.beatVolume : 0.7,
      takes: Array.isArray(p.takes)
        ? p.takes.filter(
            (t: unknown) =>
              !!t &&
              (typeof (t as SerializedTake).audioUrl === "string" ||
                typeof (t as SerializedTake).dataUrl === "string")
          )
        : [],
      clips: Array.isArray(p.clips) ? p.clips : [],
      teleprompter: { ...EMPTY_STUDIO_STATE.teleprompter, ...(p.teleprompter ?? {}) },
      updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : EMPTY_STUDIO_STATE.updatedAt,
    };
  } catch {
    return EMPTY_STUDIO_STATE;
  }
}

export interface StudioContextValue {
  /** The persisted snapshot — the source of truth across routes. */
  state: PersistedStudioState;
  setBeat: (name: string, dataUrl: string) => void;
  setBeatVolume: (volume: number) => void;
  setTakes: (takes: SerializedTake[]) => void;
  setClips: (clips: SerializedClips[]) => void;
  setTeleprompter: (text: string, sourceId: string | null, sourceLabel: string | null) => void;
  setTeleprompterSpeed: (speed: number) => void;
  /** Wipe the whole persisted project (beat, takes, clips, teleprompter). */
  clearProject: () => void;
}

const StudioContext = createContext<StudioContextValue | null>(null);

export function StudioProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PersistedStudioState>(loadPersistedStudioState);

  // Always-fresh mirror so the debounced writer persists the LATEST state.
  const stateRef = useRef(state);
  stateRef.current = state;

  // Debounced persistence — drag gestures / rapid edits batch into one write.
  const persisterRef = useRef<DebouncedPersister | null>(null);
  if (persisterRef.current === null) {
    persisterRef.current = createDebouncedPersister(
      (fn) => window.setTimeout(fn, PERSIST_DEBOUNCE_MS),
      (id) => window.clearTimeout(id),
      () => {
        try {
          window.localStorage.setItem(STUDIO_LIVE_STORAGE_KEY, JSON.stringify(stateRef.current));
          window.dispatchEvent(new CustomEvent("flowforge-studio-live-updated"));
        } catch {
          // Quota exceeded — keep the state in memory for the current session and
          // let pages surface a one-time warning (parity with the Beats page).
          window.dispatchEvent(new CustomEvent("flowforge-studio-persist-error"));
        }
      }
    );
  }
  const persister = persisterRef.current;

  // Every state change resets the debounce window (the persister owns its
  // timer). Unmount cancels any pending write; `pagehide` FLUSHES it instead,
  // so an edit made within the debounce window survives a tab close/reload.
  useEffect(() => {
    persister.schedule();
    const onPageHide = () => persister.flush();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      persister.cancel();
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [state, persister]);

  const setBeat = useCallback((name: string, dataUrl: string) => {
    setState((prev) => ({ ...prev, beat: { name, dataUrl }, updatedAt: new Date().toISOString() }));
  }, []);

  const setBeatVolume = useCallback((volume: number) => {
    setState((prev) => ({ ...prev, beatVolume: volume, updatedAt: new Date().toISOString() }));
  }, []);

  const setTakes = useCallback((takes: SerializedTake[]) => {
    setState((prev) => ({ ...prev, takes, updatedAt: new Date().toISOString() }));
  }, []);

  const setClips = useCallback((clips: SerializedClips[]) => {
    setState((prev) => ({ ...prev, clips, updatedAt: new Date().toISOString() }));
  }, []);

  const setTeleprompter = useCallback((text: string, sourceId: string | null, sourceLabel: string | null) => {
    setState((prev) => ({
      ...prev,
      teleprompter: { ...prev.teleprompter, text, sourceId, sourceLabel },
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const setTeleprompterSpeed = useCallback((speed: number) => {
    setState((prev) => ({
      ...prev,
      teleprompter: { ...prev.teleprompter, speed },
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const clearProject = useCallback(() => {
    setState(EMPTY_STUDIO_STATE);
  }, []);

  const value = useMemo(
    () => ({ state, setBeat, setBeatVolume, setTakes, setClips, setTeleprompter, setTeleprompterSpeed, clearProject }),
    [state, setBeat, setBeatVolume, setTakes, setClips, setTeleprompter, setTeleprompterSpeed, clearProject]
  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio(): StudioContextValue {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error("useStudio must be used within a StudioProvider");
  return ctx;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** File/Blob → persistable data URL. */
export async function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Data URL → Blob (used to rebuild a take's waveform data after navigation). */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}
