"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import WaveformEditor from "@/components/studio/WaveformEditor";
import VaultTextPicker, { TeleprompterMode } from "@/components/studio/Teleprompter";
import { computePunchIn } from "@/components/studio/recording";
import { useClipTimeline } from "@/components/studio/useClipTimeline";
import { useDeferredUrlRevoke } from "@/components/studio/useDeferredUrlRevoke";
import { useEditorShortcuts } from "@/components/studio/useEditorShortcuts";
import { useToast, TOAST_ACTION_DURATION_MS } from "@/components/studio/useToast";
import { ToastView } from "@/components/studio/ToastView";
import { SaveProjectModal } from "@/components/studio/SaveProjectModal";
import { recordChallengeEvent } from "@/lib/challenges";
import type { ChallengeEvent } from "@/lib/challenges";
import { saveProject } from "@/actions/beats";
import { tryDbWrite } from "@/lib/db-sync";
import type { Clip, SavedProject, SessionData, TrimEdge, VaultVersion, VocalTake } from "@/components/studio/types";
import { useStudio, blobToDataURL, dataUrlToBlob } from "@/components/studio/StudioContext";
import type { PersistedStudioState, SerializedTake } from "@/components/studio/StudioContext";

interface RecordingState {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
}

/**
 * Full snapshot taken right before „Nowy Projekt” clears the session, so an
 * accidental clear can be undone (via the toast action or Ctrl+Z).
 */
interface ProjectUndoSnapshot {
  state: PersistedStudioState;
  markerPosition: number;
  zoom: number;
  selectedTakeId: string | null;
  selectedClipId: string | null;
}

const STORAGE_KEYS = {
  session: "flowforge-studio-session",
  versions: "flowforge-versions",
  library: "flowforge-beats",
} as const;

/** How long a replaced beat's object URL is kept before deferred revocation (ms). */
const BEAT_REVOKE_DELAY_MS = 3000;

export default function StudioPage() {
  // ── Transport ──
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [recording, setRecording] = useState<RecordingState>({
    isRecording: false,
    isPaused: false,
    duration: 0,
  });
  const [micError, setMicError] = useState<string | null>(null);
  // Punch-in: timeline position (seconds) where the current recording started.
  const [recordStartTime, setRecordStartTime] = useState(0);
  const timeUpdateRef = useRef<number | null>(null);
  const recordingInterval = useRef<number | null>(null);

  // ── Beat ──
  const [beatName, setBeatName] = useState("");
  const [beatVolume, setBeatVolume] = useState(0.7);
  const beatAudioRef = useRef<HTMLAudioElement | null>(null);

  // ── Vocal takes ──
  const [takes, setTakes] = useState<VocalTake[]>([]);
  const [playingTakeId, setPlayingTakeId] = useState<string | null>(null);
  const takeAudioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const takeGainRefs = useRef<Map<string, GainNode>>(new Map());
  const takeSourceRefs = useRef<Map<string, MediaElementAudioSourceNode>>(new Map());
  const takeTriggeredRef = useRef<Set<string>>(new Set());
  const takeAudioCtxRef = useRef<AudioContext | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const levelAnimRef = useRef<number | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const recordingDurationRef = useRef(0);
  const soloGainRef = useRef<GainNode | null>(null);
  const soloSourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  // ── Waveform editor ──
  const [selectedTakeId, setSelectedTakeId] = useState<string | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [markerPosition, setMarkerPosition] = useState(0);
  const [waveformDataCache, setWaveformDataCache] = useState<Map<string, Float32Array>>(new Map());
  const {
    clips, splitClip, deleteClip, moveClip, trimClipEdge, updateClipVolume, resetTakeClips,
    undo, redo, canUndo, canRedo, beginGesture, endGesture, restoreClips, restoreTakeClips,
  } = useClipTimeline(takes, totalDuration);

  // ── Teleprompter ──
  const [showTeleprompter, setShowTeleprompter] = useState(false);
  const [teleprompterText, setTeleprompterText] = useState("");
  const [teleprompterSpeed, setTeleprompterSpeed] = useState(30);
  const [teleprompterSource, setTeleprompterSource] = useState<{ id: string; label: string } | null>(null);

  const [saveSuccess, setSaveSuccess] = useState(false);
  // „Zapisz Projekt” confirmation modal — asks for a custom track name.
  const [showSaveModal, setShowSaveModal] = useState(false);

  // ── Toast notifications (undo / save feedback) ──
  const { toast, showToast } = useToast();

  // ── Wyzwania (challenges) — fire events + toast newly completed challenges ──
  // Declared early: recording / beat-upload handlers (defined above the rest)
  // also fire challenge events.
  const fireChallengeEvent = useCallback(
    async (event: ChallengeEvent) => {
      const newly = await recordChallengeEvent(event);
      if (newly.length > 0) {
        showToast(`🏆 Wyzwanie ukończone: ${newly.map((c) => `${c.title} (+${c.points} pkt)`).join(" • ")}`);
      }
    },
    [showToast]
  );

  // ── Global persistence ──
  // The Studio page unmounts on navigation; the StudioProvider (root layout)
  // + localStorage keep the beat, takes, clips and teleprompter alive, and
  // this page rehydrates from it on mount.
  const {
    state: persistedState,
    setBeat: persistBeat,
    setBeatVolume: persistBeatVolume,
    setTakes: persistTakes,
    setClips: persistClips,
    setTeleprompter: persistTeleprompter,
    setTeleprompterSpeed: persistTeleprompterSpeed,
    clearProject,
  } = useStudio();
  // State flag (not just a ref) — the sync effects below must stay silent
  // until the mount rehydration has restored the persisted state, otherwise
  // the very first effects pass would overwrite it with the empty initial state.
  const [hydrated, setHydrated] = useState(false);
  const hydratedRef = useRef(false);
  /** Live mirror of `takes` so async persistence can re-serialize the latest list. */
  const takesRef = useRef<VocalTake[]>([]);
  takesRef.current = takes;
  /** takeId → persistable data URL (blob URLs die on reload). */
  const takeDataUrls = useRef<Map<string, string>>(new Map());
  /**
   * Count of in-flight blob→dataURL conversions. While > 0 the takes sync
   * effect stays silent — the conversion completion re-pushes the full list,
   * so a freshly recorded take can never be dropped from a stale snapshot.
   */
  const pendingTakeConversions = useRef(0);
  /** Snapshot of the session before the last „Nowy Projekt” clear (or null). */
  const projectUndoRef = useRef<ProjectUndoSnapshot | null>(null);
  /** Everything needed to bring back a take deleted by mistake. */
  const takeUndoRef = useRef<{
    take: VocalTake;
    clips: Clip[];
    index: number;
    wasSelected: boolean;
  } | null>(null);
  /**
   * Deferred object-URL revocation, shared by replaced beats (short delay)
   * and deleted takes (undo-window delay, cancellable on „Cofnij”).
   */
  const { revokeAfter, cancelRevoke } = useDeferredUrlRevoke();

  /**
   * Deferred-revoke an old beat's object URL once the replacement is stable
   * (upload-over, „Nowy Projekt”, state restore). Data URLs — used for
   * rehydrated beats — are skipped by the hook: revoking them is a no-op anyway.
   */
  const scheduleBeatUrlRevoke = useCallback(
    (audio: HTMLAudioElement | null) => {
      if (!audio) return;
      revokeAfter(audio.src || audio.currentSrc, BEAT_REVOKE_DELAY_MS);
    },
    [revokeAfter]
  );

  /** Serialize takes for persistence/undo snapshots (skips audio-less entries). */
  const serializeTakesForPersistence = useCallback((list: VocalTake[]): SerializedTake[] => {
    return list
      .map((t): SerializedTake => ({
        id: t.id,
        label: t.label,
        duration: t.duration,
        offset: t.offset,
        volume: t.volume,
        isMuted: t.isMuted,
        isSoloed: t.isSoloed,
        trimStart: t.trimStart,
        trimEnd: t.trimEnd,
        dataUrl: takeDataUrls.current.get(t.id) ?? "",
      }))
      .filter((t) => t.dataUrl.length > 0);
  }, []);

  /** Serialize the current takes (from the ref) and push them to the context. */
  const pushTakesSnapshot = useCallback(() => {
    persistTakes(serializeTakesForPersistence(takesRef.current));
  }, [persistTakes, serializeTakesForPersistence]);

  /**
   * Rebuild the editor from a persisted snapshot. Shared by the mount
   * rehydration AND the „Cofnij” action after „Nowy Projekt” — the two paths
   * must restore the exact same things.
   */
  const restoreFromState = useCallback(
    (s: PersistedStudioState) => {
      // 1. Beat — rebuild the audio element from the persisted data URL.
      if (s.beat && s.beat.dataUrl) {
        scheduleBeatUrlRevoke(beatAudioRef.current);
        if (beatAudioRef.current) beatAudioRef.current.pause();
        const audio = new Audio(s.beat.dataUrl);
        audio.loop = true;
        audio.volume = s.beatVolume ?? 0.7;
        beatAudioRef.current = audio;
        setBeatName(s.beat.name);
        audio.addEventListener("loadedmetadata", () => {
          if (audio.duration && isFinite(audio.duration)) setTotalDuration(Math.floor(audio.duration));
        });
        // Re-persist so the context (and its localStorage copy) matches again.
        persistBeat(s.beat.name, s.beat.dataUrl);
      } else {
        beatAudioRef.current = null;
        setBeatName("");
      }
      setBeatVolume(s.beatVolume ?? 0.7);

      // 2. Takes + 3. clips — rebuild the timeline arrangement.
      if (s.takes && s.takes.length > 0) {
        takeDataUrls.current = new Map(s.takes.map((t) => [t.id, t.dataUrl]));
        const restored: VocalTake[] = s.takes.map((t) => ({
          id: t.id,
          label: t.label,
          duration: t.duration,
          offset: t.offset,
          volume: t.volume,
          isMuted: t.isMuted,
          isSoloed: t.isSoloed,
          trimStart: t.trimStart,
          trimEnd: t.trimEnd,
          // Data URLs are valid <audio> src — no object URL needed.
          url: t.dataUrl,
        }));
        setTakes(restored);
        // Rebuild Blobs asynchronously so waveform decoding still works.
        s.takes.forEach((st) => {
          dataUrlToBlob(st.dataUrl)
            .then((blob) => {
              setTakes((prev) => prev.map((p) => (p.id === st.id ? { ...p, blob } : p)));
            })
            .catch(() => {});
        });
        if (s.clips && s.clips.length > 0) restoreClips(s.clips);
      } else {
        setTakes([]);
        restoreClips([]);
      }

      // 4. Teleprompter — text, source and speed.
      const tp = s.teleprompter;
      if (tp && tp.text) {
        setTeleprompterText(tp.text);
        if (tp.sourceId) setTeleprompterSource({ id: tp.sourceId, label: tp.sourceLabel ?? "" });
        setTeleprompterSpeed(tp.speed || 30);
      } else {
        setTeleprompterText("");
        setTeleprompterSource(null);
        setTeleprompterSpeed(30);
      }
    },
    [persistBeat, persistBeatVolume, restoreClips, scheduleBeatUrlRevoke]
  );

  // Restore a project cleared via „Nowy Projekt” (toast action or Ctrl+Z).
  const handleUndoNewProject = useCallback(() => {
    const snapshot = projectUndoRef.current;
    if (!snapshot) return;
    projectUndoRef.current = null;
    restoreFromState(snapshot.state);
    setMarkerPosition(snapshot.markerPosition);
    setZoom(snapshot.zoom);
    setSelectedTakeId(snapshot.selectedTakeId);
    setSelectedClipId(snapshot.selectedClipId);
    showToast("↩️ Przywrócono projekt");
  }, [restoreFromState, showToast]);

  // ── Rehydrate on mount: rebuild the beat, takes, clips and teleprompter ──
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    restoreFromState(persistedState);
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Push live edits up to the global context (persisted by the provider) ──
  useEffect(() => {
    if (!hydrated) return;
    if (pendingTakeConversions.current > 0) return; // onstop re-pushes when ready
    pushTakesSnapshot();
  }, [takes, hydrated, pushTakesSnapshot]);

  useEffect(() => {
    if (!hydrated) return;
    persistBeatVolume(beatVolume);
  }, [beatVolume, hydrated, persistBeatVolume]);

  // One-time warning when the localStorage quota blocks full persistence.
  useEffect(() => {
    const onPersistError = () => {
      showToast("⚠️ Projekt za duży, aby zapisać go na stałe w przeglądarce — działa tylko w tej sesji");
    };
    window.addEventListener("flowforge-studio-persist-error", onPersistError);
    return () => window.removeEventListener("flowforge-studio-persist-error", onPersistError);
  }, [showToast]);

  useEffect(() => {
    if (!hydrated) return;
    persistClips(
      Array.from(clips.entries()).map(([takeId, items]) => ({
        takeId,
        items: items.map((c) => ({
          id: c.id,
          label: c.label,
          trimStart: c.trimStart,
          trimEnd: c.trimEnd,
          offset: c.offset,
          duration: c.duration,
          volume: c.volume,
          isMuted: c.isMuted,
        })),
      }))
    );
  }, [clips, hydrated, persistClips]);

  useEffect(() => {
    if (!hydrated) return;
    persistTeleprompter(teleprompterText, teleprompterSource?.id ?? null, teleprompterSource?.label ?? null);
  }, [teleprompterText, teleprompterSource, hydrated, persistTeleprompter]);

  useEffect(() => {
    if (!hydrated) return;
    persistTeleprompterSpeed(teleprompterSpeed);
  }, [teleprompterSpeed, hydrated, persistTeleprompterSpeed]);

  // Restore teleprompter state from a saved session
  useEffect(() => {
    // The live global context wins — only fall back to a saved project's
    // teleprompter state when there is no live session to restore.
    if (persistedState.teleprompter.text) return;
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.session);
      if (!saved) return;
      const data = JSON.parse(saved);
      if (data.teleprompterText) {
        setTeleprompterText(data.teleprompterText);
        const versions: VaultVersion[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.versions) || "[]");
        const match = versions.find((v) => v.content === data.teleprompterText);
        if (match) setTeleprompterSource({ id: match.id, label: match.label });
      }
      if (data.teleprompterSpeed) setTeleprompterSpeed(data.teleprompterSpeed);
    } catch {
      /* ignore */
    }
  }, []);

  // Sync currentTime with the beat audio element
  useEffect(() => {
    if (isSeeking) return;
    const syncTime = () => {
      if (beatAudioRef.current && isPlaying) {
        setCurrentTime(Math.floor(beatAudioRef.current.currentTime));
      }
    };
    timeUpdateRef.current = window.setInterval(syncTime, 250);
    return () => {
      if (timeUpdateRef.current) clearInterval(timeUpdateRef.current);
    };
  }, [isPlaying, isSeeking]);

  // Recording duration ticker
  useEffect(() => {
    if (recording.isRecording && !recording.isPaused) {
      recordingDurationRef.current = 0;
      recordingInterval.current = window.setInterval(() => {
        recordingDurationRef.current += 1;
        setRecording((r) => ({ ...r, duration: recordingDurationRef.current }));
      }, 1000);
    } else if (recordingInterval.current) {
      clearInterval(recordingInterval.current);
    }
    return () => {
      if (recordingInterval.current) clearInterval(recordingInterval.current);
    };
  }, [recording.isRecording, recording.isPaused]);

  // Unmount cleanup
  useEffect(() => {
    return () => {
      if (levelAnimRef.current) cancelAnimationFrame(levelAnimRef.current);
      if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      if (audioContextRef.current) audioContextRef.current.close();
      if (soloSourceRef.current) {
        try { soloSourceRef.current.disconnect(); } catch { /* ignore */ }
      }
      if (soloGainRef.current) {
        try { soloGainRef.current.disconnect(); } catch { /* ignore */ }
      }
      if (takeAudioCtxRef.current && takeAudioCtxRef.current.state !== "closed") {
        takeAudioCtxRef.current.close();
      }
      if (beatAudioRef.current) {
        beatAudioRef.current.pause();
        beatAudioRef.current.src = "";
      }
      // (the toast's auto-dismiss timer is cleaned up by useToast)
    };
  }, []);

  const formatTime = useCallback((seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }, []);

  // ── Level meter ──
  const startLevelMeter = useCallback(() => {
    if (levelAnimRef.current) {
      cancelAnimationFrame(levelAnimRef.current);
      levelAnimRef.current = null;
    }
    const updateLevel = () => {
      if (analyserRef.current && analyserRef.current.context.state === "running") {
        try {
          const data = new Uint8Array(analyserRef.current.fftSize);
          analyserRef.current.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const val = (data[i] - 128) / 128;
            sum += val * val;
          }
          const rms = Math.sqrt(sum / data.length);
          setInputLevel(Math.min(1, rms * 4));
        } catch {
          /* analyser may be disconnected */
        }
      }
      levelAnimRef.current = requestAnimationFrame(updateLevel);
    };
    updateLevel();
  }, []);

  const stopLevelMeter = useCallback(() => {
    if (levelAnimRef.current) {
      cancelAnimationFrame(levelAnimRef.current);
      levelAnimRef.current = null;
    }
    setInputLevel(0);
  }, []);

  // ── Beat upload ──
  const handleBeatUpload = useCallback(
    (file: File) => {
      // Deferred-revoke the previous beat's object URL before replacing it.
      scheduleBeatUrlRevoke(beatAudioRef.current);
      if (beatAudioRef.current) {
        beatAudioRef.current.pause();
        beatAudioRef.current.src = "";
      }
      const url = URL.createObjectURL(file);
      const audio = new Audio(url);
      audio.loop = true;
      audio.volume = beatVolume;
      beatAudioRef.current = audio;
      const name = file.name.replace(/\.[^/.]+$/, "");
      setBeatName(name);
      // Persist a durable copy — object URLs die with the page, data URLs
      // survive navigation and full reloads.
      blobToDataURL(file)
        .then((dataUrl) => persistBeat(name, dataUrl))
        .catch(() => {});
      fireChallengeEvent({ type: "increment", stat: "beats" });
    },
    [beatVolume, fireChallengeEvent, persistBeat, scheduleBeatUrlRevoke]
  );

  // Beat metadata → total duration
  useEffect(() => {
    const audio = beatAudioRef.current;
    if (!audio) return;
    const onLoaded = () => {
      if (audio.duration && isFinite(audio.duration)) setTotalDuration(Math.floor(audio.duration));
    };
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      takeAudioRefs.current.forEach((a) => {
        a.pause();
        a.currentTime = 0;
      });
      takeTriggeredRef.current.clear();
    };
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("ended", onEnded);
    // A data-URL source can fire `loadedmetadata` BEFORE this effect runs
    // (restore-from-storage / re-upload paths), so also handle the case where
    // metadata is already available — otherwise totalDuration stays 0 and the
    // timeline marker / split math silently break.
    if (audio.readyState >= 1) onLoaded();
    return () => {
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("ended", onEnded);
    };
  }, [beatName]);

  const playBeat = useCallback(
    (startFrom?: number) => {
      const audio = beatAudioRef.current;
      if (!audio) return;
      audio.volume = beatVolume;
      if (startFrom !== undefined) audio.currentTime = startFrom;
      setCurrentTime(Math.floor(audio.currentTime));
      const promise = audio.play();
      if (promise !== undefined) {
        promise
          .then(() => {
            if (audio.duration && isFinite(audio.duration)) setTotalDuration(Math.floor(audio.duration));
          })
          .catch(() => setIsPlaying(false));
      }
    },
    [beatVolume]
  );

  const stopBeat = useCallback(() => {
    const audio = beatAudioRef.current;
    if (!audio) return;
    audio.pause();
    setCurrentTime(Math.floor(audio.currentTime));
  }, []);

  const resetBeat = useCallback(() => {
    const audio = beatAudioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setCurrentTime(0);
  }, []);

  // ── Nowy Projekt — wipe the working session (local + persisted) ──
  const handleNewProject = useCallback(() => {
    if (
      !window.confirm(
        "Rozpocząć nowy projekt? Obecny bit, ścieżki wokalne, fragmenty i tekst zostaną usunięte z sesji."
      )
    ) {
      return;
    }
    // Keep a full snapshot so an accidental clear can be undone (toast „Cofnij”
    // button or Ctrl+Z while no new work has begun).
    projectUndoRef.current = {
      state: {
        beat: persistedState.beat,
        beatVolume: persistedState.beatVolume,
        takes: serializeTakesForPersistence(takesRef.current),
        clips: Array.from(clips.entries()).map(([takeId, items]) => ({
          takeId,
          items: items.map((c) => ({
            id: c.id,
            label: c.label,
            trimStart: c.trimStart,
            trimEnd: c.trimEnd,
            offset: c.offset,
            duration: c.duration,
            volume: c.volume,
            isMuted: c.isMuted,
          })),
        })),
        teleprompter: {
          text: teleprompterText,
          sourceId: teleprompterSource?.id ?? null,
          sourceLabel: teleprompterSource?.label ?? null,
          speed: teleprompterSpeed,
        },
        updatedAt: new Date().toISOString(),
      },
      markerPosition,
      zoom,
      selectedTakeId,
      selectedClipId,
    };
    // Stop + release all audio (deferred-revoke the beat's object URL).
    scheduleBeatUrlRevoke(beatAudioRef.current);
    beatAudioRef.current?.pause();
    beatAudioRef.current = null;
    takeAudioRefs.current.forEach((a) => a.pause());
    takeAudioRefs.current.clear();
    takeGainRefs.current.clear();
    takeSourceRefs.current.clear();
    takeTriggeredRef.current.clear();
    takesRef.current.forEach((t) => {
      if (t.url && t.url.startsWith("blob:")) URL.revokeObjectURL(t.url);
    });
    takeDataUrls.current.clear();

    // Reset every piece of local editor state.
    setBeatName("");
    setBeatVolume(0.7);
    setTotalDuration(0);
    setCurrentTime(0);
    setIsPlaying(false);
    setTakes([]);
    restoreClips([]);
    setSelectedTakeId(null);
    setSelectedClipId(null);
    setTeleprompterText("");
    setTeleprompterSource(null);
    setTeleprompterSpeed(30);
    setShowTeleprompter(false);
    setMarkerPosition(0);
    setZoom(1);
    setWaveformDataCache(new Map());
    setSaveSuccess(false);

    // Clear the persisted session (context → localStorage) and the saved-session
    // fallback so nothing leaks back in on the next mount.
    clearProject();
    localStorage.removeItem(STORAGE_KEYS.session);
    showToast("🗑️ Nowy projekt — sesja wyczyszczona", "info", {
      label: "↩️ Cofnij",
      onClick: () => handleUndoNewProject(),
    });
  }, [
    persistedState,
    serializeTakesForPersistence,
    clips,
    teleprompterText,
    teleprompterSource,
    teleprompterSpeed,
    markerPosition,
    zoom,
    selectedTakeId,
    selectedClipId,
    restoreClips,
    clearProject,
    showToast,
    handleUndoNewProject,
    scheduleBeatUrlRevoke,
  ]);

  const togglePlay = useCallback(() => {
    if (recording.isRecording) return;
    if (isPlaying) {
      stopBeat();
      setIsPlaying(false);
      return;
    }
    const audio = beatAudioRef.current;
    if (!audio) return;
    const atEnd = audio.duration && audio.currentTime >= audio.duration - 0.1;
    playBeat(atEnd ? 0 : undefined);
    setIsPlaying(true);
  }, [isPlaying, recording.isRecording, playBeat, stopBeat]);

  // ── Recording ──
  const [micSource, setMicSource] = useState("builtin");
  const [inputLevel, setInputLevel] = useState(0);

  const startRecording = useCallback(async () => {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: micSource === "usb" ? { deviceId: "default" } : true,
      });
      mediaStreamRef.current = stream;

      const ctx = new AudioContext();
      if (ctx.state === "suspended") await ctx.resume();
      audioContextRef.current = ctx;

      const micSourceNode = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.4;
      micSourceNode.connect(analyser);
      analyserRef.current = analyser;

      // ── Punch-in position: record from the current playhead, not from 0:00 ──
      // Prefer the exact (float) position of the beat element, fall back to the
      // displayed playhead when no beat is loaded. Clamp to the beat length so
      // the beat can actually start playing at that timestamp.
      const beatAudio = beatAudioRef.current;
      const punchIn = computePunchIn({
        audioCurrentTime: beatAudio ? beatAudio.currentTime : undefined,
        fallbackTime: currentTime,
        audioDuration: beatAudio && beatAudio.duration ? beatAudio.duration : undefined,
        totalDuration,
      });
      setRecordStartTime(punchIn);

      // Seek the instrumental to the punch-in point so the beat is heard from
      // the exact spot where recording begins (no-op if already playing there).
      playBeat(punchIn);

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/ogg";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType.split(";")[0] });
        const url = URL.createObjectURL(blob);
        const dur = recordingDurationRef.current;
        const id = Date.now().toString();
        setTakes((prev) => [
          {
            id,
            label: `Take ${prev.length + 1}`,
            duration: dur,
            // Timeline offset = exact playhead position where recording began.
            offset: punchIn,
            volume: 1,
            isMuted: false,
            isSoloed: false,
            trimStart: 0,
            trimEnd: 1,
            blob,
            url,
          },
          ...prev,
        ]);
        // Persist a durable copy (data URL) so the take survives navigation.
        pendingTakeConversions.current += 1;
        blobToDataURL(blob)
          .then((dataUrl) => {
            takeDataUrls.current.set(id, dataUrl);
            pendingTakeConversions.current -= 1;
            pushTakesSnapshot();
          })
          .catch(() => {
            pendingTakeConversions.current -= 1;
            pushTakesSnapshot();
          });
        fireChallengeEvent({ type: "increment", stat: "takes" });
      };
      recorder.start(1000);
      mediaRecorderRef.current = recorder;

      recordingDurationRef.current = 0;
      setRecording({ isRecording: true, isPaused: false, duration: 0 });
      setIsPlaying(true);
      startLevelMeter();
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Brak dostępu do mikrofonu. Sprawdź uprawnienia przeglądarki."
          : err instanceof DOMException && err.name === "NotFoundError"
            ? "Nie znaleziono urządzenia mikrofonowego."
            : `Błąd mikrofonu: ${err instanceof Error ? err.message : "nieznany"}`;
      setMicError(msg);
    }
  }, [micSource, startLevelMeter, playBeat, currentTime, totalDuration, pushTakesSnapshot]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    resetBeat();
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    stopLevelMeter();
    setRecording({ isRecording: false, isPaused: false, duration: recordingDurationRef.current });
    setIsPlaying(false);
    setCurrentTime(0);
  }, [stopLevelMeter, resetBeat]);

  // ── Take helpers ──
  const getTakeAudioContext = useCallback(() => {
    if (!takeAudioCtxRef.current || takeAudioCtxRef.current.state === "closed") {
      takeAudioCtxRef.current = new AudioContext();
    }
    if (takeAudioCtxRef.current.state === "suspended") {
      takeAudioCtxRef.current.resume();
    }
    return takeAudioCtxRef.current;
  }, []);

  const playTake = useCallback(
    (take: VocalTake) => {
      if (isPlaying || take.isMuted) return;
      if (playingTakeId === take.id) {
        if (currentAudioRef.current) {
          currentAudioRef.current.pause();
          currentAudioRef.current.currentTime = 0;
          currentAudioRef.current = null;
        }
        if (soloSourceRef.current) { try { soloSourceRef.current.disconnect(); } catch { /* ignore */ } soloSourceRef.current = null; }
        if (soloGainRef.current) { try { soloGainRef.current.disconnect(); } catch { /* ignore */ } soloGainRef.current = null; }
        setPlayingTakeId(null);
        return;
      }
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current.currentTime = 0;
        currentAudioRef.current = null;
      }
      if (soloSourceRef.current) { try { soloSourceRef.current.disconnect(); } catch { /* ignore */ } soloSourceRef.current = null; }
      if (soloGainRef.current) { try { soloGainRef.current.disconnect(); } catch { /* ignore */ } soloGainRef.current = null; }
      if (!take.url) return;

      const audio = new Audio(take.url);
      audio.loop = false;
      currentAudioRef.current = audio;
      setPlayingTakeId(take.id);
      try {
        const ctx = getTakeAudioContext();
        const source = ctx.createMediaElementSource(audio);
        const gain = ctx.createGain();
        gain.gain.value = take.volume;
        source.connect(gain);
        gain.connect(ctx.destination);
        soloSourceRef.current = source;
        soloGainRef.current = gain;
        audio.volume = 1;
      } catch {
        audio.volume = Math.min(take.volume, 1);
      }
      const promise = audio.play();
      if (promise) promise.catch(() => {
        setPlayingTakeId(null);
        currentAudioRef.current = null;
      });
      audio.onended = () => {
        setPlayingTakeId(null);
        currentAudioRef.current = null;
        if (soloSourceRef.current) { try { soloSourceRef.current.disconnect(); } catch { /* ignore */ } soloSourceRef.current = null; }
        if (soloGainRef.current) { try { soloGainRef.current.disconnect(); } catch { /* ignore */ } soloGainRef.current = null; }
      };
    },
    [playingTakeId, isPlaying, getTakeAudioContext]
  );

  const connectTakeToGain = useCallback(
    (id: string, audio: HTMLAudioElement, volume: number) => {
      const ctx = getTakeAudioContext();
      if (!takeSourceRefs.current.has(id)) {
        const source = ctx.createMediaElementSource(audio);
        const gain = ctx.createGain();
        gain.gain.value = volume;
        source.connect(gain);
        gain.connect(ctx.destination);
        takeSourceRefs.current.set(id, source);
        takeGainRefs.current.set(id, gain);
        audio.volume = 1;
      } else {
        const gain = takeGainRefs.current.get(id);
        if (gain) gain.gain.setValueAtTime(volume, gain.context.currentTime);
      }
    },
    [getTakeAudioContext]
  );

  const toggleTakeMute = useCallback((id: string) => {
    setTakes((prev) => {
      const updated = prev.map((t) => (t.id === id ? { ...t, isMuted: !t.isMuted } : t));
      const anySoloed = updated.some((t) => t.isSoloed);
      const toggled = updated.find((t) => t.id === id);
      const gain = toggled ? takeGainRefs.current.get(id) : undefined;
      if (gain && toggled) {
        const t = gain.context.currentTime;
        if (toggled.isMuted) gain.gain.setValueAtTime(0, t);
        else if (anySoloed) gain.gain.setValueAtTime(toggled.isSoloed ? toggled.volume : 0, t);
        else gain.gain.setValueAtTime(toggled.volume, t);
      }
      return updated;
    });
  }, []);

  const toggleTakeSolo = useCallback((id: string) => {
    setTakes((prev) => {
      const updated = prev.map((t) => (t.id === id ? { ...t, isSoloed: !t.isSoloed } : t));
      const anySoloed = updated.some((t) => t.isSoloed);
      for (const t of updated) {
        const gain = takeGainRefs.current.get(t.id);
        if (!gain) continue;
        const now = gain.context.currentTime;
        if (anySoloed) gain.gain.setValueAtTime(t.isSoloed && !t.isMuted ? t.volume : 0, now);
        else gain.gain.setValueAtTime(t.isMuted ? 0 : t.volume, now);
      }
      return updated;
    });
  }, []);

  const updateTakeVolume = useCallback(
    (id: string, volume: number) => {
      setTakes((prev) => {
        const updated = prev.map((t) => (t.id === id ? { ...t, volume } : t));
        const anySoloed = updated.some((t) => t.isSoloed);
        const take = updated.find((t) => t.id === id);
        const gain = takeGainRefs.current.get(id);
        if (gain && take) {
          const t = gain.context.currentTime;
          if (take.isMuted) gain.gain.setValueAtTime(0, t);
          else if (anySoloed) gain.gain.setValueAtTime(take.isSoloed ? volume : 0, t);
          else gain.gain.setValueAtTime(volume, t);
        }
        return updated;
      });
      if (playingTakeId === id && soloGainRef.current) {
        soloGainRef.current.gain.setValueAtTime(volume, soloGainRef.current.context.currentTime);
      }
    },
    [playingTakeId]
  );

  const updateTakeOffset = useCallback((id: string, offset: number) => {
    setTakes((prev) => prev.map((t) => (t.id === id ? { ...t, offset: Math.max(0, offset) } : t)));
  }, []);

  const updateTakeTrim = useCallback((id: string, trimStart: number, trimEnd: number) => {
    setTakes((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              trimStart: Math.max(0, Math.min(trimStart, 0.99)),
              trimEnd: Math.max(trimStart + 0.01, Math.min(trimEnd, 1)),
            }
          : t
      )
    );
  }, []);

  // Bring back a take deleted by mistake (toast „Cofnij”).
  const handleUndoDeleteTake = useCallback(() => {
    const snapshot = takeUndoRef.current;
    if (!snapshot) return;
    takeUndoRef.current = null;
    const { take, clips: takeClips, index, wasSelected } = snapshot;
    // The take is back — cancel its scheduled object-URL revocation.
    cancelRevoke(take.url);
    // Re-insert at the original position in the takes list.
    setTakes((prev) => {
      const next = [...prev];
      next.splice(Math.min(index, next.length), 0, take);
      return next;
    });
    restoreTakeClips(take.id, takeClips);
    if (wasSelected) {
      setSelectedTakeId(take.id);
      setSelectedClipId(null);
    }
    showToast(`↩️ Przywrócono take: ${take.label}`);
  }, [restoreTakeClips, showToast, cancelRevoke]);

  const deleteTake = useCallback(
    (id: string) => {
      // Capture everything needed to undo before removing anything. The audio
      // URL is deliberately NOT revoked — the take stays playable until the
      // 8 s undo window passes (object URLs die with the page anyway).
      const take = takesRef.current.find((t) => t.id === id);
      if (!take) return;
      takeUndoRef.current = {
        take,
        clips: clips.get(id) ?? [],
        index: takesRef.current.findIndex((t) => t.id === id),
        wasSelected: selectedTakeId === id,
      };

      const audio = takeAudioRefs.current.get(id);
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
        takeAudioRefs.current.delete(id);
      }
      const source = takeSourceRefs.current.get(id);
      if (source) { try { source.disconnect(); } catch { /* ignore */ } }
      takeSourceRefs.current.delete(id);
      takeGainRefs.current.delete(id);
      takeTriggeredRef.current.delete(id);
      setTakes((prev) => prev.filter((t) => t.id !== id));
      resetTakeClips(id);
      if (selectedTakeId === id) {
        setSelectedTakeId(null);
        setSelectedClipId(null);
      }
      showToast(`🗑️ Usunięto take: ${take.label}`, "info", {
        label: "↩️ Cofnij",
        onClick: () => handleUndoDeleteTake(),
      });
      // The URL is deliberately kept alive during the undo window; revoke it
      // once that window passes (and drop the stale undo snapshot).
      revokeAfter(take.url, TOAST_ACTION_DURATION_MS + 500, (url) => {
        if (takeUndoRef.current?.take.url === url) takeUndoRef.current = null;
      });
    },
    [resetTakeClips, selectedTakeId, clips, showToast, handleUndoDeleteTake, revokeAfter]
  );

  const exportTake = useCallback((take: VocalTake) => {
    if (!take.url) return;
    const ext = take.blob?.type.includes("ogg") ? "ogg" : "webm";
    const base = take.label.replace(/[^a-z0-9-_]+/gi, "_").toLowerCase() || "take";
    const a = document.createElement("a");
    a.href = take.url;
    a.download = `${base}.${ext}`;
    a.click();
  }, []);

  // ── Multi-track playback scheduling ──
  useEffect(() => {
    if (!isPlaying || recording.isRecording) return;
    takeTriggeredRef.current.clear();
    const interval = setInterval(() => {
      const beat = beatAudioRef.current;
      if (!beat) return;
      const now = beat.currentTime;
      const anySoloed = takes.some((t) => t.isSoloed);
      for (const take of takes) {
        if (takeTriggeredRef.current.has(take.id)) continue;
        if (!take.url) continue;
        if (!(now >= take.offset && take.offset <= beat.duration)) continue;
        takeTriggeredRef.current.add(take.id);
        let audio = takeAudioRefs.current.get(take.id);
        if (!audio) {
          audio = new Audio(take.url);
          audio.loop = false;
          takeAudioRefs.current.set(take.id, audio);
        }
        if (!takeSourceRefs.current.has(take.id)) {
          connectTakeToGain(take.id, audio, take.volume);
        }
        const gain = takeGainRefs.current.get(take.id);
        if (gain) {
          const now2 = gain.context.currentTime;
          if (take.isMuted) gain.gain.setValueAtTime(0, now2);
          else if (anySoloed) gain.gain.setValueAtTime(take.isSoloed ? take.volume : 0, now2);
          else gain.gain.setValueAtTime(take.volume, now2);
        }
        audio.currentTime = Math.max(0, now - take.offset);
        audio.play().catch(() => {});
      }
    }, 100);
    return () => clearInterval(interval);
  }, [isPlaying, recording.isRecording, takes, connectTakeToGain]);

  // Stop all take audio when playback stops
  useEffect(() => {
    if (!isPlaying && !recording.isRecording) {
      takeAudioRefs.current.forEach((audio) => {
        audio.pause();
        audio.currentTime = 0;
      });
      takeTriggeredRef.current.clear();
    }
  }, [isPlaying, recording.isRecording]);

  // ── Waveform decoding ──
  const decodeWaveform = useCallback(
    async (take: VocalTake) => {
      if (!take.blob || waveformDataCache.has(take.id)) return;
      try {
        const ctx = getTakeAudioContext();
        const arrayBuffer = await take.blob.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        const rawData = audioBuffer.getChannelData(0);
        const samples = 2000;
        const blockSize = Math.floor(rawData.length / samples);
        const downsampled = new Float32Array(samples);
        for (let i = 0; i < samples; i++) {
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(rawData[i * blockSize + j]);
          }
          downsampled[i] = sum / blockSize;
        }
        setWaveformDataCache((prev) => {
          const next = new Map(prev);
          next.set(take.id, downsampled);
          return next;
        });
      } catch {
        /* ignore decode errors */
      }
    },
    [getTakeAudioContext, waveformDataCache]
  );

  useEffect(() => {
    takes.forEach((take) => {
      if (take.blob && !waveformDataCache.has(take.id)) decodeWaveform(take);
    });
  }, [takes, decodeWaveform, waveformDataCache]);

  // ── Session save / export ──
  // Default card title: prefer the Vault lyrics label (strip the date suffix),
  // fall back to the beat name.
  const deriveProjectTitle = useCallback(() => {
    return (
      teleprompterSource?.label.replace(/\s*-\s*\d{1,2}\.\d{1,2}\.\d{4}.*$/, "").trim() ||
      beatName ||
      "Numer bez tytułu"
    );
  }, [teleprompterSource, beatName]);

  // "Zapisz" packages the ENTIRE project state — beat settings, the lyrics
  // picked from The Vault, every track (take) with volume/mute/solo/trims, and
  // the full clip timeline — and pushes it into the shared „Gotowe Numery”
  // library (localStorage `flowforge-beats`), so it immediately shows up there.
  const saveSession = useCallback(
    (titleOverride?: string) => {
      const savedAt = new Date().toISOString();
      const rawTitle = titleOverride?.trim() || deriveProjectTitle();
      const maxTakeEnd = takes.reduce((max, t) => Math.max(max, t.offset + t.duration), 0);
      const durationSecs = totalDuration > 0 ? totalDuration : maxTakeEnd;

      const project: SavedProject = {
      kind: "project",
      id: `proj-${Date.now()}`,
      title: rawTitle,
      artist: "Studio",
      genre: beatName ? "Z bitem" : "A cappella",
      duration: formatTime(durationSecs),
      beatName,
      beatVolume,
      teleprompterText,
      teleprompterSpeed,
      takes: takes.map((t) => ({
        id: t.id,
        label: t.label,
        duration: t.duration,
        offset: t.offset,
        volume: t.volume,
        isMuted: t.isMuted,
        isSoloed: t.isSoloed,
        trimStart: t.trimStart,
        trimEnd: t.trimEnd,
      })),
      clips: Array.from(clips.entries()).map(([takeId, arr]) => ({
        takeId,
        items: arr.map((c) => ({
          id: c.id,
          label: c.label,
          trimStart: c.trimStart,
          trimEnd: c.trimEnd,
          offset: c.offset,
          duration: c.duration,
          volume: c.volume,
          isMuted: c.isMuted,
        })),
      })),
      savedAt,
    };

    // 1) The lightweight restore source for the Studio page itself.
    const sessionData: SessionData = {
      beatName,
      beatVolume,
      teleprompterText,
      teleprompterSpeed,
      takes: takes.map((t) => ({ label: t.label, duration: t.duration })),
      savedAt,
    };

    try {
      localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(sessionData));
      // 2) The library store — prepend so the saved project appears first.
      const library = JSON.parse(localStorage.getItem(STORAGE_KEYS.library) || "[]");
      const next = Array.isArray(library) ? [project, ...library] : [project];
      localStorage.setItem(STORAGE_KEYS.library, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent("flowforge-library-updated"));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch {
      /* ignore quota errors — the session restore copy is best-effort */
    }
    // 3) DB-primary: persist the project so the library survives across
    // browsers. The localStorage mirror above keeps the offline fallback;
    // this write is fire-and-forget (local SQLite — fast).
    tryDbWrite(() => saveProject(project));
    },
    [beatName, beatVolume, teleprompterText, teleprompterSpeed, takes, clips, totalDuration, formatTime, deriveProjectTitle]
  );

  const exportSession = useCallback(() => {
    const sessionData = {
      beatName,
      beatVolume,
      teleprompterText,
      teleprompterSpeed,
      takes: takes.map((t) => ({ label: t.label, duration: t.duration })),
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(sessionData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flowforge-session-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`📤 Wyeksportowano sesję (${a.download})`);
  }, [beatName, beatVolume, teleprompterText, teleprompterSpeed, takes, showToast]);

  // ── Editor handlers (selection-safe split / delete) ──
  const handleSelectTake = useCallback((id: string | null) => {
    setSelectedTakeId(id);
    setSelectedClipId(null);
  }, []);

  const handleSplit = useCallback(
    (takeId: string, position: number) => {
      const nextClipId = splitClip(takeId, position);
      if (nextClipId) {
        setSelectedClipId(nextClipId);
        fireChallengeEvent({ type: "increment", stat: "splits" });
      }
    },
    [splitClip, fireChallengeEvent]
  );

  const handleDeleteClip = useCallback(
    (takeId: string, clipId: string) => {
      const nextClipId = deleteClip(takeId, clipId);
      setSelectedClipId(nextClipId);
    },
    [deleteClip]
  );

  // Moving the amber marker on the timeline also moves the playhead while the
  // transport is stopped — so the marker doubles as the punch-in point.
  const handleMarkerChange = useCallback(
    (t: number) => {
      setMarkerPosition(t);
      if (!isPlaying && !recording.isRecording) {
        if (beatAudioRef.current) beatAudioRef.current.currentTime = t;
        setCurrentTime(Math.floor(t));
      }
    },
    [isPlaying, recording.isRecording]
  );

  // ── Undo (Ctrl+Z) / Redo (Ctrl+Shift+Z, Ctrl+Y) ──
  const handleUndo = useCallback(() => {
    const label = undo();
    if (label) {
      showToast(`↩️ Cofnięto: ${label}`);
      return;
    }
    // No clip edit to undo — fall back to restoring a project cleared via
    // „Nowy Projekt”, but only while no new work has begun after the clear
    // (a fresh beat, take, clip or lyrics would be clobbered otherwise).
    if (
      projectUndoRef.current &&
      takesRef.current.length === 0 &&
      clips.size === 0 &&
      !beatName &&
      !teleprompterText
    ) {
      handleUndoNewProject();
      return;
    }
    showToast("Brak akcji do cofnięcia", "info");
  }, [undo, showToast, handleUndoNewProject, clips, beatName, teleprompterText]);

  const handleRedo = useCallback(() => {
    const label = redo();
    if (label) {
      showToast(`↪️ Ponowiono: ${label}`);
    } else {
      showToast("Brak akcji do ponowienia", "info");
    }
  }, [redo, showToast]);

  // Volume changes (keyboard + slider) count toward „Złoty Środek”.
  const handleClipVolume = useCallback(
    (clipId: string, volume: number) => {
      updateClipVolume(clipId, volume);
      fireChallengeEvent({ type: "increment", stat: "volumeChanges" });
    },
    [updateClipVolume, fireChallengeEvent]
  );
  const handleTakeVolume = useCallback(
    (takeId: string, volume: number) => {
      updateTakeVolume(takeId, volume);
      fireChallengeEvent({ type: "increment", stat: "volumeChanges" });
    },
    [updateTakeVolume, fireChallengeEvent]
  );

  // Edge trim fires once per drag gesture („Minimalista”).
  const trimGestureFiredRef = useRef(false);
  const handleTrimClipEdge = useCallback(
    (clipId: string, edge: TrimEdge, edgeTime: number) => {
      trimClipEdge(clipId, edge, edgeTime);
      if (!trimGestureFiredRef.current) {
        trimGestureFiredRef.current = true;
        fireChallengeEvent({ type: "increment", stat: "trims" });
      }
    },
    [trimClipEdge, fireChallengeEvent]
  );
  const handleGestureStart = useCallback(() => {
    beginGesture();
    trimGestureFiredRef.current = false;
  }, [beginGesture]);

  // Opening the teleprompter (with Vault text) → „Teleprompter Pro”.
  const openTeleprompter = useCallback(() => {
    setShowTeleprompter(true);
    fireChallengeEvent({ type: "increment", stat: "teleprompterOpens" });
  }, [fireChallengeEvent]);

  // ── Save project (button + Ctrl+S) — confirmation modal asks for a name ──
  const openSaveModal = useCallback(() => setShowSaveModal(true), []);

  const handleSaveSession = useCallback(() => {
    openSaveModal();
  }, [openSaveModal]);

  const confirmSaveProject = useCallback(
    (name: string) => {
      saveSession(name);
      setShowSaveModal(false);
      showToast(`💾 Zapisano projekt: ${name}`);
      fireChallengeEvent({ type: "increment", stat: "projectsSaved" });
    },
    [saveSession, showToast, fireChallengeEvent]
  );

  // ── Editor keyboard shortcuts ──
  // The capture-phase keydown listener, the "typing in a field" guard and the
  // action dispatch live in the reusable `useEditorShortcuts` hook (key
  // matching via the pure `matchShortcut` helper). Ctrl+Z / Ctrl+S work on
  // every keyboard layout, and every recognized shortcut calls
  // `preventDefault()` to block browser/OS side effects.
  useEditorShortcuts(
    {
      teleprompterOpen: showTeleprompter,
      selectedTakeId,
      selectedClipId,
      markerPosition,
      clips,
      takes,
    },
    {
      onUndo: handleUndo,
      onRedo: handleRedo,
      onSaveSession: handleSaveSession,
      onTogglePlay: togglePlay,
      onSplit: handleSplit,
      onDeleteClip: handleDeleteClip,
      onMoveClip: moveClip,
      onUpdateTakeOffset: updateTakeOffset,
      onUpdateClipVolume: handleClipVolume,
      onUpdateTakeVolume: handleTakeVolume,
    }
  );

  // Drop the clip selection if the selected clip no longer exists (e.g. after undo).
  useEffect(() => {
    if (!selectedClipId) return;
    const exists = [...clips.entries()].some(([, arr]) => arr.some((c) => c.id === selectedClipId));
    if (!exists) setSelectedClipId(null);
  }, [clips, selectedClipId]);

  // ── Level meter LED segments ──
  const levelSegments = 20;
  const activeSegments = Math.round(inputLevel * levelSegments);

  if (showTeleprompter) {
    return (
      <TeleprompterMode
        text={teleprompterText}
        speed={teleprompterSpeed}
        sourceLabel={teleprompterSource?.label}
        onClose={() => setShowTeleprompter(false)}
      />
    );
  }

  return (
    <AppShell>
      {/* Toast notification — shared component driven by the useToast hook */}
      <ToastView toast={toast} />

      {/* „Zapisz Projekt” — confirmation modal asking for a custom track name */}
      <SaveProjectModal
        open={showSaveModal}
        initialName={deriveProjectTitle()}
        summary={{
          takes: takes.length,
          clips: [...clips.values()].reduce((n, arr) => n + arr.length, 0),
          hasLyrics: teleprompterText.trim().length > 0,
          hasBeat: beatName.length > 0,
        }}
        onCancel={() => setShowSaveModal(false)}
        onConfirm={confirmSaveProject}
      />
      <div className="space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center">
              <span className="text-lg">🎛️</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Studio</h1>
              <p className="text-sm text-zinc-400">Multi-Track Player & Session Recorder</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
            onClick={openTeleprompter}
            disabled={!teleprompterText.trim()}
              className="px-4 py-2 rounded-xl bg-purple-500/10 text-purple-400 text-sm font-medium hover:bg-purple-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              📺 Teleprompter
            </button>
            <button
              onClick={openSaveModal}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                saveSuccess
                  ? "bg-green-500/20 text-green-400 border border-green-500/40"
                  : "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"
              }`}
            >
              {saveSuccess ? "✓ Zapisano!" : "💾 Zapisz Projekt"}
            </button>
            <button
              onClick={exportSession}
              className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-400 text-sm font-medium hover:bg-zinc-700 hover:text-white transition-colors"
            >
              📤 Eksportuj
            </button>
            <button
              onClick={handleNewProject}
              className="px-4 py-2 rounded-xl bg-red-500/10 text-red-400 text-sm font-medium hover:bg-red-500/20 hover:text-red-300 transition-colors"
              title="Wyczyść sesję i zacznij od nowa"
            >
              🗑️ Nowy Projekt
            </button>
          </div>
        </div>

        {/* Transport Controls */}
        <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/50 p-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <button
                onClick={togglePlay}
                disabled={!beatName && !isPlaying}
                className={`w-14 h-14 rounded-full flex items-center justify-center text-xl transition-all ${
                  isPlaying
                    ? "bg-amber-500 text-zinc-900 shadow-lg shadow-amber-500/30"
                    : "bg-zinc-800 text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
                }`}
                title={isPlaying ? "Pauza" : "Odtwórz"}
              >
                {isPlaying ? "⏸" : "▶"}
              </button>
              <button
                onClick={() => { stopBeat(); setIsPlaying(false); }}
                className="w-10 h-10 rounded-full bg-zinc-800 text-white flex items-center justify-center hover:bg-zinc-700 transition-colors"
                title="Zatrzymaj (zachowaj pozycję)"
              >
                ⏹
              </button>
              <button
                onClick={() => { resetBeat(); setIsPlaying(false); }}
                className="w-10 h-10 rounded-full bg-zinc-800 text-zinc-500 flex items-center justify-center hover:bg-zinc-700 hover:text-white transition-colors text-xs"
                title="Resetuj do 0:00"
              >
                ⏮
              </button>
              <button
                onClick={recording.isRecording ? stopRecording : startRecording}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                  recording.isRecording
                    ? "bg-red-500 text-white animate-pulse shadow-lg shadow-red-500/30"
                    : "bg-zinc-800 text-red-400 hover:bg-zinc-700"
                }`}
                title={
                  recording.isRecording
                    ? "Zatrzymaj nagrywanie"
                    : `Nagraj take (od pozycji playhead: ${formatTime(recordStartTime)})`
                }
              >
                ⏺
              </button>
            </div>

            <div className="text-center">
              <p className="text-3xl font-mono font-bold text-white">{formatTime(currentTime)}</p>
              <p className="text-xs text-zinc-500">{formatTime(totalDuration)}</p>
            </div>

            {recording.isRecording && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-sm text-red-400 font-medium">
                  REC {formatTime(recording.duration)} @ {formatTime(recordStartTime)}
                </span>
              </div>
            )}

            <div className="w-full lg:w-auto lg:flex-1 lg:max-w-md">
              <input
                type="range"
                min="0"
                max={totalDuration || 1}
                step="1"
                value={isSeeking ? undefined : currentTime}
                onMouseDown={() => setIsSeeking(true)}
                onTouchStart={() => setIsSeeking(true)}
                onMouseUp={(e) => {
                  const val = parseInt((e.target as HTMLInputElement).value);
                  setCurrentTime(val);
                  if (beatAudioRef.current) beatAudioRef.current.currentTime = val;
                  setIsSeeking(false);
                }}
                onTouchEnd={(e) => {
                  const val = parseInt((e.target as HTMLInputElement).value);
                  setCurrentTime(val);
                  if (beatAudioRef.current) beatAudioRef.current.currentTime = val;
                  setIsSeeking(false);
                }}
                onChange={(e) => setCurrentTime(parseInt(e.target.value))}
                className="w-full h-2 accent-amber-500 cursor-pointer rounded-lg appearance-none bg-zinc-800 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-amber-500 [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-amber-500/30 [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:active:cursor-grabbing"
              />
            </div>
          </div>
        </div>

        {/* Quick Vocal Capture */}
        <div
          className={`rounded-2xl bg-zinc-900/50 border p-6 transition-all ${
            recording.isRecording ? "border-red-500/50 shadow-lg shadow-red-500/10" : "border-zinc-800/50"
          }`}
        >
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <span>🎙️</span> Szybki Rejestrator Wokalu (Scratch Pad)
                {recording.isRecording && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-medium animate-pulse">
                    NAGRYWANIE...
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-zinc-500 mt-1">
                ⏺ Punch-in: nagranie zacznie się od pozycji playhead — przesuń suwak postępu lub
                kliknij żółty znacznik na linii czasu, aby ustawić punkt startowy.
              </p>
            </div>
          </div>

          {/* Beat Upload */}
          <div className="mb-5 p-4 rounded-xl bg-zinc-800/30 border border-zinc-700/50">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs text-zinc-500 uppercase tracking-wider font-medium flex items-center gap-2">
                <span>🎵</span> Bit / Instrumental
              </h3>
              {beatName && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-medium">
                  {beatName}
                </span>
              )}
            </div>
            <div className="flex items-center gap-4">
              <label className="flex-shrink-0">
                <span className="px-4 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs font-medium hover:bg-zinc-700 hover:text-white transition-colors cursor-pointer inline-flex items-center gap-2">
                  📂 Wgraj Bit
                  <input
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleBeatUpload(file);
                    }}
                  />
                </span>
              </label>
              {beatName && (
                <div className="flex items-center gap-3 flex-1">
                  <span className="text-[10px] text-zinc-500 w-6">🔊</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={beatVolume}
                    onChange={(e) => setBeatVolume(parseFloat(e.target.value))}
                    className="flex-1 accent-amber-500 h-1"
                  />
                  <span className="text-[10px] text-zinc-500 w-8 text-right font-mono">
                    {Math.round(beatVolume * 100)}%
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Input selection */}
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-2 block">
                Źródło mikrofonu
              </label>
              <div className="flex rounded-lg bg-zinc-800 border border-zinc-700 overflow-hidden">
                <button
                  onClick={() => setMicSource("builtin")}
                  className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                    micSource === "builtin" ? "bg-amber-500/20 text-amber-400" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  🔊 Wbudowany
                </button>
                <button
                  onClick={() => setMicSource("usb")}
                  className={`flex-1 px-3 py-2 text-xs font-medium transition-colors border-l border-zinc-700 ${
                    micSource === "usb" ? "bg-amber-500/20 text-amber-400" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  🎤 USB
                </button>
              </div>
            </div>

            {/* Level meter */}
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-2 block">
                Poziom wejścia
              </label>
              <div className="flex items-center gap-1 h-8">
                {Array.from({ length: levelSegments }).map((_, i) => {
                  const isRed = i >= levelSegments * 0.8;
                  const isYellow = i >= levelSegments * 0.6;
                  const isActive = i < activeSegments;
                  return (
                    <div
                      key={i}
                      className={`flex-1 h-full rounded-sm transition-all duration-75 ${
                        isActive
                          ? isRed
                            ? "bg-red-500 shadow-sm shadow-red-500/50"
                            : isYellow
                              ? "bg-amber-400 shadow-sm shadow-amber-400/50"
                              : "bg-emerald-500 shadow-sm shadow-emerald-500/50"
                          : "bg-zinc-800"
                      }`}
                    />
                  );
                })}
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[9px] text-zinc-600">-∞</span>
                <span className="text-[9px] text-zinc-600">0 dB</span>
              </div>
            </div>

            {/* Duration */}
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-2 block">
                Czas trwania
              </label>
              <div className={`text-4xl font-mono font-bold text-center py-1 ${recording.isRecording ? "text-red-400" : "text-zinc-300"}`}>
                {formatTime(recording.isRecording ? recording.duration : 0)}
              </div>
            </div>
          </div>

          {/* Mic error */}
          {micError && (
            <div className="mt-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3">
              <span className="text-lg">⚠️</span>
              <div className="flex-1">
                <p className="text-sm text-red-400 font-medium">{micError}</p>
              </div>
              <button onClick={() => setMicError(null)} className="text-zinc-500 hover:text-white text-xs">
                ✕
              </button>
            </div>
          )}

          {/* Take list */}
          <div className="mt-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs text-zinc-500 uppercase tracking-wider font-medium">
                Ostatnie take&apos;y ({takes.length})
              </h3>
            </div>

            {takes.length === 0 ? (
              <div className="text-center py-8 rounded-xl bg-zinc-800/30 border border-dashed border-zinc-700">
                <span className="text-2xl block mb-2">🎙️</span>
                <p className="text-xs text-zinc-500">Kliknij ⏺ aby nagrać pierwszy take</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {takes.map((take) => (
                  <div
                    key={take.id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-zinc-800/40 border border-zinc-700/50 hover:bg-zinc-800/60 transition-colors group"
                  >
                    <button
                      onClick={() => playTake(take)}
                      disabled={take.isMuted}
                      className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-colors ${
                        take.isMuted
                          ? "bg-zinc-800/50 text-zinc-600 cursor-not-allowed"
                          : playingTakeId === take.id
                            ? "bg-amber-500 text-zinc-900"
                            : "bg-zinc-700/50 text-zinc-400 hover:text-white"
                      }`}
                      title={take.isMuted ? "Take wyciszony" : "Odsłuchaj"}
                    >
                      {playingTakeId === take.id ? "⏸" : "▶"}
                    </button>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => toggleTakeMute(take.id)}
                        className={`w-6 h-6 rounded text-[9px] font-bold transition-colors ${
                          take.isMuted
                            ? "bg-red-500/30 text-red-400 border border-red-500/40"
                            : "bg-zinc-700/50 text-zinc-500 hover:text-zinc-300 border border-transparent"
                        }`}
                        title={take.isMuted ? "Odcisz" : "Wycisz"}
                      >
                        M
                      </button>
                      <button
                        onClick={() => toggleTakeSolo(take.id)}
                        className={`w-6 h-6 rounded text-[9px] font-bold transition-colors ${
                          take.isSoloed
                            ? "bg-amber-500/30 text-amber-400 border border-amber-500/40"
                            : "bg-zinc-700/50 text-zinc-500 hover:text-zinc-300 border border-transparent"
                        }`}
                        title={take.isSoloed ? "Wyłącz solo" : "Solo"}
                      >
                        S
                      </button>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${take.isMuted ? "text-zinc-500 line-through" : "text-white"}`}>
                        {take.label}
                      </p>
                      <p className="text-[10px] text-zinc-500">
                        {formatTime(take.duration)}
                        {take.isSoloed ? " • solo" : ""}
                        {clips.has(take.id) ? " • edytowany" : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] text-zinc-600">Start:</span>
                        <input
                          type="number"
                          min="0"
                          max={totalDuration}
                          step="1"
                          value={take.offset}
                          onChange={(e) => updateTakeOffset(take.id, parseInt(e.target.value) || 0)}
                          className="w-12 px-1.5 py-0.5 rounded bg-zinc-700/50 border border-zinc-600/50 text-[10px] text-zinc-300 font-mono text-center focus:outline-none focus:border-amber-500/50"
                        />
                        <span className="text-[9px] text-zinc-600">s</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] text-zinc-600">🔊</span>
                        <input
                          type="range"
                          min="0"
                          max="1.5"
                          step="0.05"
                          value={take.volume}
                          onChange={(e) => handleTakeVolume(take.id, parseFloat(e.target.value))}
                          className="w-16 accent-amber-500 h-1"
                        />
                        <span className="text-[9px] text-zinc-500 w-7 text-right font-mono">
                          {Math.round(take.volume * 100)}%
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => exportTake(take)}
                      className="px-2.5 py-1 rounded-lg bg-zinc-700/50 text-[10px] text-zinc-400 hover:text-amber-400 hover:bg-amber-500/10 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      Eksportuj
                    </button>
                    <button
                      onClick={() => deleteTake(take.id)}
                      className="w-7 h-7 rounded-lg bg-zinc-700/50 text-[10px] text-zinc-400 hover:text-red-400 hover:bg-red-500/10 flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100"
                      title="Usuń take"
                    >
                      🗑️
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Waveform Editor */}
        {takes.length > 0 && (
          <WaveformEditor
            takes={takes}
            clips={clips}
            waveformDataCache={waveformDataCache}
            totalDuration={totalDuration}
            // Geometry falls back to the longest take end until the beat
            // audio's metadata loads (data-URL beats may not decode without
            // user interaction) — otherwise the ruler marker never moves.
            timelineDuration={totalDuration > 0 ? totalDuration : takes.reduce((max, t) => Math.max(max, t.offset + t.duration), 0)}
            zoom={zoom}
            onZoomChange={setZoom}
            selectedTakeId={selectedTakeId}
            onSelectTake={handleSelectTake}
            selectedClipId={selectedClipId}
            onSelectClip={setSelectedClipId}
            onUpdateTakeOffset={updateTakeOffset}
            onUpdateTakeTrim={updateTakeTrim}
            onSplit={handleSplit}
            onDeleteClip={handleDeleteClip}
            onMoveClip={moveClip}
            onTrimClipEdge={handleTrimClipEdge}
            canUndo={canUndo}
            onUndo={handleUndo}
            canRedo={canRedo}
            onRedo={handleRedo}
            onGestureStart={handleGestureStart}
            onGestureEnd={endGesture}
            formatTime={formatTime}
            currentTime={currentTime}
            markerPosition={markerPosition}
            onMarkerChange={handleMarkerChange}
          />
        )}

        {/* Teleprompter Setup — pick text saved in The Vault */}
        <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/50 p-6">
          <h2 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
            <span>📺</span> Teleprompter Setup
          </h2>
          <p className="text-xs text-zinc-500 mb-4">
            Wybierz tekst zapisany w The Vault — zostanie płynnie przewinięty w teleprompterze.
          </p>
          <div className="space-y-4">
            <VaultTextPicker
              selectedId={teleprompterSource?.id ?? null}
              onSelect={(id, content, label) => {
                setTeleprompterText(content);
                setTeleprompterSource({ id, label });
              }}
            />

            {/* Loaded text preview */}
            {teleprompterText.trim() ? (
              <div className="rounded-xl bg-zinc-800/30 border border-zinc-700/30 p-4">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <p className="text-xs text-zinc-400 font-medium truncate">
                    Załadowany tekst
                    {teleprompterSource ? (
                      <>
                        {" "}
                        — <span className="text-amber-500">{teleprompterSource.label}</span>
                      </>
                    ) : null}
                  </p>
                  <button
                    onClick={() => {
                      setTeleprompterText("");
                      setTeleprompterSource(null);
                    }}
                    className="shrink-0 px-2.5 py-1 rounded-lg bg-zinc-800 text-[10px] text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    🗑️ Wyczyść
                  </button>
                </div>
                <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs font-mono text-zinc-300 leading-relaxed">
                  {teleprompterText}
                </pre>
                <p className="text-[10px] text-zinc-500 mt-2">
                  {teleprompterText.split("\n").filter((l) => l.trim()).length} wersów •{" "}
                  {teleprompterText.split(/\s+/).filter(Boolean).length} słów
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-700 p-4 text-center">
                <p className="text-xs text-zinc-500">
                  Nie wybrano tekstu — wybierz wersję z The Vault powyżej.
                </p>
              </div>
            )}

            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400">Prędkość:</span>
                <input
                  type="range"
                  min="10"
                  max="60"
                  value={teleprompterSpeed}
                  onChange={(e) => setTeleprompterSpeed(parseInt(e.target.value))}
                  className="w-32 accent-amber-500"
                />
                <span className="text-xs text-zinc-500 font-mono">{teleprompterSpeed}px/s</span>
              </div>
              <button
                onClick={openTeleprompter}
                disabled={!teleprompterText.trim()}
                className="px-4 py-2 rounded-xl bg-purple-500/10 text-purple-400 text-sm font-medium hover:bg-purple-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Otwórz Teleprompter →
              </button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
