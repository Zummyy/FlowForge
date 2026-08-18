"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { ConfirmDialog } from "@/components/studio/ConfirmDialog";
import { useToast } from "@/components/studio/useToast";
import { ToastView } from "@/components/studio/ToastView";
import type { SavedProject, SavedTakeState } from "@/components/studio/types";
import { recordChallengeEvent } from "@/lib/challenges";
import { loadCache, saveCache, tryDbWrite } from "@/lib/db-sync";
import {
  BEAT_SORT_MODES,
  DEFAULT_BEAT_DIRECTION,
  sortBeats,
  type BeatSortMode,
  type SortDirection,
} from "@/lib/beat-sort";
import {
  createBeat,
  deleteBeat,
  updateBeat,
  getBeats,
  getProjects,
  saveProject,
  deleteProject,
  recordBeatPlayed,
} from "@/actions/beats";

interface Beat {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  key: string;
  genre: string;
  tags: string[];
  hasStems: boolean;
  duration: string;
  isPlaying: boolean;
  /** "beat" = uploaded audio file, "project" = saved from the Studio. */
  kind?: "beat" | "project";
  /** Full saved-project payload (present when `kind === "project"`). */
  project?: SavedProject;
  /** Flat shape: the library stores the project's takes directly on the item. */
  takes?: SavedTakeState[];
  /**
   * Data URL of the uploaded audio file. Unlike object URLs (which die with
   * the page session) data URLs can be persisted to localStorage, so the
   * library survives reloads. Projects from the Studio have no audio here.
   */
  url?: string;
  /** ISO timestamp — when the beat/project was created (drives „Data” sort). */
  createdAt?: string;
  /** DB id when this beat is backed by the Prisma backend. */
  dbId?: string;
  /**
   * Stem mixer channels — path per track (drums/bass/melody/vocals) when
   * the beat was uploaded with `isStems` + `stemsData`. Present only on
   * DB-backed beats with stems.
   */
  stems?: Record<string, string>;
}

const KEY_POOL = ["Am", "Cm", "Em", "Fm", "Gm", "Dm", "Amaj", "Emaj"];
const STORAGE_KEY = "flowforge-beats";

/** Stem mixer channels (keys match Beat.stemsData). */
const STEM_CHANNELS: { id: string; label: string; icon: string }[] = [
  { id: "drums", label: "Drums", icon: "🥁" },
  { id: "bass", label: "Bass", icon: "🎸" },
  { id: "melody", label: "Melody", icon: "🎹" },
  { id: "vocals", label: "Wokal", icon: "🎤" },
];

/** "1:23" → 83 seconds; anything unparseable → undefined. */
function parseDuration(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = s.match(/^(\d+):(\d{1,2})$/);
  if (!m) return undefined;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds)) return "…";
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

type DbBeat = Awaited<ReturnType<typeof getBeats>>[number];
type DbProject = Awaited<ReturnType<typeof getProjects>>[number];

/** Map a DB SavedProject row (payload + stable ids) to the page's Beat shape. */
function toProjectBeat(p: DbProject): Beat {
  return {
    id: p.id,
    dbId: p.dbId,
    title: p.title,
    artist: p.artist || "Studio",
    bpm: 0,
    key: "",
    genre: p.genre || "Z bitem",
    tags: [],
    hasStems: false,
    duration: p.duration,
    isPlaying: false,
    kind: "project",
    project: p,
    takes: p.takes,
    createdAt: p.createdAt,
  };
}

/** Map a DB beat row to the page's Beat shape. */
function toBeat(b: DbBeat): Beat {
  let tags: string[] = [];
  try {
    tags = b.tags ? b.tags.split(",").filter(Boolean) : [];
  } catch {
    tags = [];
  }
  return {
    id: b.id,
    dbId: b.id,
    title: b.title,
    artist: b.artist || "Wgrany bit",
    bpm: b.bpm,
    key: b.key || "",
    genre: b.genre || "Demo",
    tags,
    hasStems: b.isStems,
    duration: fmtDuration(b.duration),
    isPlaying: false,
    url: b.filePath || undefined,
    stems: parseStemsData(b.stemsData),
    createdAt: b.createdAt.toISOString(),
  };
}

/**
 * Deterministic equalizer-bar heights for a beat card — FNV-1a hash of the
 * beat id → 20 stable heights (20–100%). Replaced the old `Math.random()`
 * which recomputed on EVERY render, so the bars jumped around whenever any
 * state changed (play toggle, stem mute, …). Same beat id ⇒ same bars.
 */
function barHeights(seed: string, count = 20): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    h ^= h << 13;
    h >>>= 0;
    h ^= h >> 17;
    h ^= h << 5;
    h >>>= 0;
    out.push(20 + (h >>> 8) % 81);
  }
  return out;
}

/** Parse the Beat.stemsData JSON ({drums, bass, melody, vocals} → paths). */
function parseStemsData(raw: string | null | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const stems: Record<string, string> = {};
      for (const [name, p] of Object.entries(parsed)) {
        if (typeof p === "string" && p) stems[name] = p;
      }
      return Object.keys(stems).length > 0 ? stems : undefined;
    }
  } catch {
    /* malformed stemsData — treat as no stems */
  }
  return undefined;
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function BeatsPage() {
  const [beats, setBeats] = useState<Beat[]>([]);
  const [beatsLoaded, setBeatsLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Debounced search: the input updates on every keystroke, but filtering a
  // large library (cards carry data-URL audio in state) only runs 150 ms
  // after the user stops typing.
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 150);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Cards matching the search box („Szukaj numerów...”) — title + artist,
  // case-insensitive. Previously the query was never applied to the render.
  // The remembered sort (mode + per-mode direction) is applied AFTER the
  // filter, so searching and sorting compose.
  const [beatSortMode, setBeatSortMode] = useState<BeatSortMode>("updated");
  const [beatSortDirs, setBeatSortDirs] =
    useState<Record<BeatSortMode, SortDirection>>({ ...DEFAULT_BEAT_DIRECTION });
  const [beatSortLoaded, setBeatSortLoaded] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("flowforge-beat-sort");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object") {
          const m = parsed.mode;
          if (m === "title" || m === "artist" || m === "bpm") setBeatSortMode(m);
          if (parsed.directions && typeof parsed.directions === "object") {
            const next = { ...DEFAULT_BEAT_DIRECTION };
            for (const k of ["updated", "title", "artist", "bpm"] as const) {
              const d = parsed.directions[k];
              if (d === "asc" || d === "desc") next[k] = d;
            }
            setBeatSortDirs(next);
          }
        }
      }
    } catch { /* ignore */ }
    // Always mark the mirror as loaded — even when nothing was saved yet —
    // otherwise the persist effect below would never write on a fresh profile
    // (the early return used to skip this line entirely).
    setBeatSortLoaded(true);
  }, []);
  useEffect(() => {
    if (!beatSortLoaded) return;
    try {
      localStorage.setItem(
        "flowforge-beat-sort",
        JSON.stringify({ mode: beatSortMode, directions: beatSortDirs })
      );
    } catch { /* ignore */ }
  }, [beatSortMode, beatSortDirs, beatSortLoaded]);

  const visibleBeats = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    const filtered = q
      ? beats.filter(
          (b) =>
            b.title.toLowerCase().includes(q) || b.artist.toLowerCase().includes(q)
        )
      : beats;
    return sortBeats(filtered, beatSortMode, beatSortDirs[beatSortMode]);
  }, [beats, debouncedQuery, beatSortMode, beatSortDirs]);

  // Delete confirmation — one click on 🗑️ used to destroy a beat/project
  // (and, for projects, prune its recordings' rows + files) instantly.
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    title: string;
    kind?: "beat" | "project";
  } | null>(null);

  // ── Edit modal state (DB-backed beat cards only) ──
  const [editBeat, setEditBeat] = useState<Beat | null>(null);
  const [editForm, setEditForm] = useState({ title: "", artist: "", bpm: 90, key: "" });
  const [savingEdit, setSavingEdit] = useState(false);
  const playAudioRef = useRef<HTMLAudioElement | null>(null);
  const quotaWarnedRef = useRef(false);

  // Shared toast notifications (upload / delete / persist feedback).
  const { toast, showToast } = useToast();

  // ── Load the library: DB-primary (beats + Studio projects), with a ──
  // ── one-time import of legacy localStorage entries so nothing is lost. ──
  // Reloads when the Studio dispatches „flowforge-library-updated”.
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let dbBeats: Beat[] = [];
      let dbProjects: Beat[] = [];
      // Client ids (proj-…) already persisted in the DB — used to dedupe
      // legacy localStorage mirrors of the same project on later loads.
      let dbSourceIds = new Set<string>();
      let dbOk = false;
      try {
        const [beats, projects] = await Promise.all([getBeats(), getProjects()]);
        dbBeats = beats.map(toBeat);
        dbProjects = projects.map(toProjectBeat);
        dbSourceIds = new Set(projects.map((p) => p.sourceId).filter(Boolean));
        dbOk = true;
      } catch {
        /* DB unavailable */
      }

      const local = loadCache<Beat[]>(STORAGE_KEY, []);

      if (!dbOk) {
        // Server down → keep the cache as-is (offline mode).
        if (!cancelled) {
          setBeats(local.map((b) => ({ ...b, isPlaying: false })));
          setBeatsLoaded(true);
        }
        return;
      }

      // Beats uploaded before the backend was wired up (no dbId) → migrate now.
      // Fingerprint dedup: if a local beat matches an existing DB row by
      // title|artist|duration (e.g. a crash or second tab already imported it),
      // adopt that row's id instead of creating a duplicate.
      const fpToDbId = new Map(
        dbBeats.map((b) => [`${b.title}|${b.artist}|${b.duration}`, b.id])
      );
      const toImport: Beat[] = [];
      const adopted: Beat[] = [];
      for (const b of local) {
        if (b.kind === "project" || b.dbId) continue;
        const fp = `${b.title}|${b.artist}|${b.duration}`;
        const existingId = fpToDbId.get(fp);
        if (existingId) adopted.push({ ...b, id: existingId, dbId: existingId });
        else toImport.push(b);
      }
      const importOutcomes = await Promise.all(
        toImport.map(async (b): Promise<Beat> => {
          try {
            const row = await createBeat({
              title: b.title,
              artist: b.artist,
              bpm: b.bpm,
              key: b.key,
              genre: b.genre,
              tags: b.tags,
              duration: parseDuration(b.duration),
              filePath: b.url,
            });
            return { ...b, id: row.id, dbId: row.id };
          } catch {
            // Keep the entry local; the next load will retry the import.
            return b;
          }
        })
      );

      // Studio projects from before the DB era (kind "project", no dbId) →
      // import into the DB too, so the library is DB-primary everywhere.
      // Entries whose proj-… id already exists in the DB (a save that ran
      // while the mirror wasn't updated with dbId) are skipped — the DB row
      // renders via `dbProjects`, and the stale mirror entry is pruned by
      // the persist effect below.
      const legacyProjects = local.filter(
        (b) => b.kind === "project" && !b.dbId && !dbSourceIds.has(b.id)
      );
      const importedProjects = await Promise.all(
        legacyProjects.map(async (b): Promise<Beat> => {
          try {
            const { isPlaying: _p1, dbId: _p2, url: _p3, hasStems: _p4, project: _p5, ...payload } = b;
            // The legacy library item carries the full SavedProject payload
            // (kind, id, title, beat/teleprompter/takes/clips) alongside the
            // card display fields — the runtime shape matches SavedProject.
            const row = await saveProject(payload as unknown as SavedProject);
            return { ...b, id: row.id, dbId: row.id, project: row, takes: row.takes };
          } catch {
            // Keep the entry local; the next load will retry the import.
            return b;
          }
        })
      );

      if (!cancelled) {
        setBeats(
          [...dbBeats, ...dbProjects, ...adopted, ...importOutcomes, ...importedProjects].map((b) => ({
            ...b,
            isPlaying: false,
          }))
        );
        setBeatsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Live refresh: the Studio dispatches this after every save.
  useEffect(() => {
    const onLib = () => setReloadKey((k) => k + 1);
    window.addEventListener("flowforge-library-updated", onLib);
    return () => window.removeEventListener("flowforge-library-updated", onLib);
  }, []);

  // ── Persist the library whenever it changes (after the initial load) ──
  useEffect(() => {
    if (!beatsLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(beats));
    } catch {
      // Almost always a QuotaExceededError — the file is too big for
      // localStorage. The library still works for this session; warn once.
      if (!quotaWarnedRef.current) {
        quotaWarnedRef.current = true;
        showToast("⚠️ Plik za duży, aby zapisać bit na stałe w przeglądarce", "info");
      }
    }
  }, [beats, beatsLoaded, showToast]);

  // Stem mixer state: per-beat sets of muted/soloed channels + live audio
  // elements (one per channel, kept in sync by playing them all at once).
  const [mutedStems, setMutedStems] = useState<Record<string, string[]>>({});
  const [soloStems, setSoloStems] = useState<Record<string, string[]>>({});
  const stemAudiosRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  // Stem mix export: record the current mute/solo mix to a single file via
  // MediaRecorder (Web Audio graph → destination stream). No dependencies.
  const [recordingBeat, setRecordingBeat] = useState<string | null>(null);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordContextRef = useRef<AudioContext | null>(null);
  const recordAudiosRef = useRef<HTMLAudioElement[]>([]);
  const recordTimerRef = useRef<number | null>(null);

  /**
   * Effective mute for one channel: explicitly muted, or — when any channel
   * is soloed for that beat — every channel that isn't the soloed one.
   */
  const isChannelMuted = (beatId: string, channel: string) => {
    const muted = mutedStems[beatId] ?? [];
    const solo = soloStems[beatId] ?? [];
    return muted.includes(channel) || (solo.length > 0 && !solo.includes(channel));
  };

  /** Pause every audio element (single player + all stem channels). */
  const stopAllAudio = useCallback(() => {
    if (playAudioRef.current) {
      playAudioRef.current.pause();
      playAudioRef.current = null;
    }
    for (const audio of stemAudiosRef.current.values()) audio.pause();
    stemAudiosRef.current.clear();
    setBeats((prev) => prev.map((b) => ({ ...b, isPlaying: false })));
  }, [setBeats]);

  const togglePlay = (id: string) => {
    const target = beats.find((b) => b.id === id);
    if (!target?.url) return; // projects have no audio embedded in the library
    const willPlay = target ? !target.isPlaying : false;
    stopAllAudio();
    if (!willPlay) return;
    setBeats((prev) => prev.map((b) => ({ ...b, isPlaying: b.id === id })));
    const audio = playAudioRef.current ?? new Audio();
    audio.src = target.url;
    audio.play().catch(() => {});
    playAudioRef.current = audio;
    // Real usage history — bumps the dashboard „Ostatnio Użyte” widget.
    tryDbWrite(() => recordBeatPlayed(id));
  };

  /** Start/stop the stem mixer: all channels play in sync, muted ones at 0. */
  const toggleStemPlay = (beat: Beat) => {
    if (!beat.stems) return;
    const willPlay = !beat.isPlaying;
    stopAllAudio();
    if (!willPlay) return;
    for (const [channel, src] of Object.entries(beat.stems)) {
      const audio = new Audio(src);
      audio.loop = true;
      audio.volume = isChannelMuted(beat.id, channel) ? 0 : 1;
      audio.play().catch(() => {});
      stemAudiosRef.current.set(`${beat.id}|${channel}`, audio);
    }
    setBeats((prev) => prev.map((b) => ({ ...b, isPlaying: b.id === beat.id })));
    // Real usage history — bumps the dashboard „Ostatnio Użyte” widget.
    tryDbWrite(() => recordBeatPlayed(beat.id));
  };

  /** Mute/unmute one channel of a playing (or stopped) stem mixer. */
  const toggleStemMute = (beatId: string, channel: string) => {
    setMutedStems((prev) => {
      const muted = prev[beatId] ?? [];
      const next = muted.includes(channel)
        ? muted.filter((c) => c !== channel)
        : [...muted, channel];
      return { ...prev, [beatId]: next };
    });
  };

  /**
   * Solo one channel: silence every other channel. Clicking an already
   * soloed channel (or „Wyłącz solo”) disengages solo mode — the other
   * channels return to their explicit mute state.
   */
  const toggleStemSolo = (beatId: string, channel: string) => {
    setSoloStems((prev) => {
      const solo = prev[beatId] ?? [];
      const next = solo.includes(channel) ? [] : [channel];
      return { ...prev, [beatId]: next };
    });
  };

  /** Disengage solo mode entirely for a beat. */
  const clearStemSolo = (beatId: string) => {
    setSoloStems((prev) => {
      if (!(prev[beatId] ?? []).length) return prev;
      const next = { ...prev };
      delete next[beatId];
      return next;
    });
  };

  // Keep live channel volumes in sync with the mute/solo state — runs after
  // any toggle, so the mixer reacts while a beat is playing.
  useEffect(() => {
    for (const [key, audio] of stemAudiosRef.current) {
      const sep = key.indexOf("|");
      const beatId = key.slice(0, sep);
      const channel = key.slice(sep + 1);
      audio.volume = isChannelMuted(beatId, channel) ? 0 : 1;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recreated every render
  }, [mutedStems, soloStems]);

  /** File name for a recorded mix, e.g. „Miejski Rytm” → miks-miejski-rytm.webm. */
  const slugify = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "mix";

  /** Stop the current recording: download the mix, release audio + context. */
  const stopMixRecording = useCallback(() => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    recorderRef.current?.stop(); // onstop flushes chunks → download + cleanup
    recorderRef.current = null;
    recordAudiosRef.current = [];
    setRecordingBeat(null);
    setRecordSeconds(0);
  }, []);

  /**
   * Record the current mute/solo mix of a stems beat to a single file. All
   * four channels play through the Web Audio graph (started while suspended,
   * then resumed — they hit the destination on the same sample); the gain per
   * channel reflects the mixer state at start. Auto-caps at 30 s.
   */
  const startMixRecording = (beat: Beat) => {
    if (!beat.stems || recordingBeat) return;
    stopAllAudio(); // keep the preview out of the recorded mix
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) {
      showToast("⚠️ Twoja przeglądarka nie wspiera nagrywania miksu", "info");
      return;
    }
    const ctx = new Ctx();
    const dest = ctx.createMediaStreamDestination();
    const audios: HTMLAudioElement[] = [];
    for (const [channel, src] of Object.entries(beat.stems)) {
      const audio = new Audio(src);
      audio.loop = true;
      const srcNode = ctx.createMediaElementSource(audio);
      const gain = ctx.createGain();
      gain.gain.value = isChannelMuted(beat.id, channel) ? 0 : 1;
      srcNode.connect(gain);
      gain.connect(dest);
      audios.push(audio);
    }
    void ctx.suspend();
    audios.forEach((a) => void a.play().catch(() => {}));
    const mime =
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "";
    const recorder = mime
      ? new MediaRecorder(dest.stream, { mimeType: mime })
      : new MediaRecorder(dest.stream);
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `miks-${slugify(beat.title)}.webm`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      audios.forEach((a) => {
        a.pause();
        a.src = "";
      });
      void ctx.close();
    };
    recorder.start();
    recorderRef.current = recorder;
    recordContextRef.current = ctx;
    recordAudiosRef.current = audios;
    setRecordingBeat(beat.id);
    setRecordSeconds(0);
    void ctx.resume();
    recordTimerRef.current = window.setInterval(() => {
      setRecordSeconds((s) => s + 1);
    }, 1000);
  };

  // Hard cap: a mix recording never runs longer than 30 s.
  useEffect(() => {
    if (recordSeconds >= 30 && recordingBeat) stopMixRecording();
  }, [recordSeconds, recordingBeat, stopMixRecording]);

  // Never leave a recording (or its audio graph) running on unmount.
  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      recorderRef.current?.stop();
      recordAudiosRef.current.forEach((a) => {
        a.pause();
        a.src = "";
      });
      void recordContextRef.current?.close();
    };
  }, []);

  // Pause everything on unmount so audio never outlives the page.
  useEffect(() => stopAllAudio, [stopAllAudio]);

  // ── Upload ──
  // „Dodaj Numer” opens a modal with two modes: a single beat file, or a
  // 4-channel stem pack (drums/bass/melody/vocals) that feeds the mixer.
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadMode, setUploadMode] = useState<"beat" | "stems">("beat");
  const [singleFile, setSingleFile] = useState<File | null>(null);
  const [stemFiles, setStemFiles] = useState<Record<string, File | null>>({
    drums: null,
    bass: null,
    melody: null,
    vocals: null,
  });

  const closeUpload = useCallback(() => {
    setUploadOpen(false);
    setUploadMode("beat"); // reopening starts on the single-beat tab
    setSingleFile(null);
    setStemFiles({ drums: null, bass: null, melody: null, vocals: null });
  }, []);

  /**
   * Persist one uploaded entry — a single beat (file → data URL → filePath)
   * or a stem pack (each channel → data URL → stemsData + isStems). DB-first
   * for a stable id; falls back to a temp id when the backend is down. The
   * same object is pushed to the library state so the card renders instantly.
   */
  const uploadBeat = useCallback(
    async (opts: {
      title: string;
      artist: string;
      genre: string;
      /** Single beat: read as a data URL and stored in filePath. */
      file?: File;
      /** Stem pack: each channel file → data URL in stemsData. */
      stems?: Record<string, File>;
    }) => {
      try {
        let dataUrl: string | undefined;
        let stemsData: Record<string, string> | undefined;
        if (opts.file) dataUrl = await readFileAsDataURL(opts.file);
        if (opts.stems) {
          stemsData = {};
          for (const [ch, f] of Object.entries(opts.stems)) {
            stemsData[ch] = await readFileAsDataURL(f);
          }
          dataUrl = stemsData.drums; // duration probe source
        }
        const bpm = 70 + Math.floor(Math.random() * 70);
        const key = KEY_POOL[Math.floor(Math.random() * KEY_POOL.length)];

        let beatId = Date.now().toString();
        let dbId: string | undefined;
        const ok = await tryDbWrite(async () => {
          const row = await createBeat({
            title: opts.title,
            artist: opts.artist,
            bpm,
            key,
            genre: opts.genre,
            tags: [],
            filePath: opts.file ? dataUrl : undefined,
            isStems: !!opts.stems,
            stemsData,
          });
          beatId = row.id;
          dbId = row.id;
        });
        if (!ok) showToast("⚠️ Baza danych niedostępna — zapisano lokalnie", "info");

        // Read the real duration from the audio metadata (async, best-effort).
        if (dataUrl) {
          const audio = new Audio(dataUrl);
          audio.addEventListener(
            "loadedmetadata",
            () => {
              if (isFinite(audio.duration)) {
                const mins = Math.floor(audio.duration / 60);
                const secs = Math.floor(audio.duration % 60);
                const duration = `${mins}:${String(secs).padStart(2, "0")}`;
                setBeats((prev) => prev.map((b) => (b.id === beatId ? { ...b, duration } : b)));
              }
            },
            { once: true }
          );
        }

        setBeats((prev) => [
          {
            id: beatId,
            dbId,
            title: opts.title,
            artist: opts.artist,
            bpm,
            key,
            genre: opts.genre,
            tags: [],
            hasStems: !!opts.stems,
            duration: "…",
            isPlaying: false,
            url: opts.file ? dataUrl : undefined,
            stems: stemsData,
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ]);
        showToast(opts.stems ? `🎛️ Wgrano stemy: ${opts.title}` : `🎵 Wgrano bit: ${opts.title}`);
        // Wyzwania — beat uploads count toward „Bit i Słowo”.
        const newly = await recordChallengeEvent({ type: "increment", stat: "beats" });
        if (newly.length > 0) {
          showToast(`🏆 Wyzwanie ukończone: ${newly.map((c) => `${c.title} (+${c.points} pkt)`).join(" • ")}`);
        }
      } catch {
        showToast("⚠️ Nie udało się odczytać pliku", "info");
      }
    },
    [showToast]
  );

  const submitSingleBeat = useCallback(() => {
    if (!singleFile) {
      showToast("⚠️ Wybierz plik audio", "info");
      return;
    }
    const title = singleFile.name.replace(/\.[^/.]+$/, "");
    uploadBeat({ title, artist: "Wgrany bit", genre: "Demo", file: singleFile });
    closeUpload();
  }, [singleFile, uploadBeat, closeUpload, showToast]);

  const submitStems = useCallback(() => {
    const missing = STEM_CHANNELS.map((c) => c.id).filter((id) => !stemFiles[id]);
    if (missing.length > 0) {
      showToast(`⚠️ Brakuje ścieżek: ${missing.join(", ")}`, "info");
      return;
    }
    const files: Record<string, File> = {};
    for (const id of STEM_CHANNELS.map((c) => c.id)) files[id] = stemFiles[id]!;
    // „miejski-rytm-drums.wav” → „miejski-rytm (Stemy)” — strip the channel suffix.
    const base = files.drums.name.replace(/\.[^/.]+$/, "").replace(/[-_](?:drums|bass|melody|vocals)$/i, "");
    uploadBeat({ title: `${base} (Stemy)`, artist: "Wgrane stemy", genre: "Stemy", stems: files });
    closeUpload();
  }, [stemFiles, uploadBeat, closeUpload, showToast]);

  // ── Delete ──
  const handleDelete = useCallback(
    (id: string, title: string) => {
      const target = beats.find((b) => b.id === id);
      if (target?.isPlaying) {
        if (playAudioRef.current) playAudioRef.current.pause();
        for (const audio of stemAudiosRef.current.values()) audio.pause();
        stemAudiosRef.current.clear();
      }
      setBeats((prev) => prev.filter((b) => b.id !== id));
      const dbId = target?.dbId;
      if (dbId) {
        if (target.kind === "project") tryDbWrite(() => deleteProject(dbId));
        else tryDbWrite(() => deleteBeat(dbId));
      }
      showToast(`🗑️ Usunięto ${target?.kind === "project" ? "projekt" : "bit"}: ${title}`, "info");
    },
    [beats, showToast]
  );

  // ── Edit a beat card (title / artist / BPM / key) ──
  const openEdit = useCallback((beat: Beat) => {
    setEditForm({ title: beat.title, artist: beat.artist, bpm: beat.bpm, key: beat.key });
    setEditBeat(beat);
  }, []);

  const closeEdit = useCallback(() => {
    if (savingEdit) return; // no closing mid-save
    setEditBeat(null);
  }, [savingEdit]);

  const saveEdit = useCallback(async () => {
    if (!editBeat || !editBeat.dbId || editBeat.kind === "project") return;
    const title = editForm.title.trim();
    if (!title) {
      showToast("⚠️ Tytuł nie może być pusty", "info");
      return;
    }
    const bpm = Math.max(40, Math.min(240, Math.round(Number(editForm.bpm) || editBeat.bpm)));
    const artist = editForm.artist.trim() || null;
    const key = editForm.key.trim() || null;
    setSavingEdit(true);
    try {
      await updateBeat(editBeat.dbId, { title, artist, bpm, key });
      setBeats((prev) =>
        prev.map((b) => (b.id === editBeat.id ? { ...b, title, artist: artist || "Wgrany bit", bpm, key: key || "" } : b))
      );
      setEditBeat(null);
      showToast(`✏️ Zaktualizowano: ${title}`, "success");
    } catch {
      showToast("⚠️ Nie udało się zapisać zmian", "info");
    } finally {
      setSavingEdit(false);
    }
  }, [editBeat, editForm, showToast]);

  const openFilePicker = useCallback(() => setUploadOpen(true), []);

  return (
    <AppShell>
      {/* Toast notification — shared component driven by the useToast hook */}
      <ToastView toast={toast} />
      <div className="space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
              <span className="text-lg">🎵</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Gotowe Numery</h1>
              <p className="text-sm text-zinc-400">{beats.length} numerów w kolekcji</p>
            </div>
          </div>
          <button
            onClick={openFilePicker}
            className="px-4 py-2 rounded-xl bg-blue-500/10 text-blue-400 text-sm font-medium hover:bg-blue-500/20 transition-colors"
          >
            + Dodaj Numer
          </button>
        </div>

        {/* Search + sort */}
        <div className="flex flex-col gap-3">
          <div className="flex-1 relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">🔍</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Szukaj numerów..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-zinc-900/50 border border-zinc-800/50 text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/30"
            />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Sortowanie numerów">
            {BEAT_SORT_MODES.map((m) => (
              <button
                key={m.id}
                data-sort-mode={m.id}
                onClick={() => setBeatSortMode(m.id)}
                aria-pressed={beatSortMode === m.id}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  beatSortMode === m.id
                    ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                    : "bg-zinc-900/50 text-zinc-500 border border-zinc-800/50 hover:text-zinc-300"
                }`}
              >
                {m.icon} {m.label}
              </button>
            ))}
            <button
              data-sort-dir
              onClick={() =>
                setBeatSortDirs((prev) => ({
                  ...prev,
                  [beatSortMode]: prev[beatSortMode] === "asc" ? "desc" : "asc",
                }))
              }
              title={`Kierunek: ${beatSortDirs[beatSortMode] === "asc" ? "rosnąco (↑)" : "malejąco (↓)"}`}
              className="ml-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-900/50 text-zinc-400 border border-zinc-800/50 hover:border-amber-500/30 hover:text-amber-400 transition-colors"
            >
              {beatSortDirs[beatSortMode] === "asc" ? "↑ Rosnąco" : "↓ Malejąco"}
            </button>
          </div>
        </div>

        {/* Empty State */}
        {beats.length === 0 ? (
          <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/50 p-16 text-center">
            <span className="text-5xl block mb-4">🎵</span>
            <h3 className="text-xl font-bold text-white mb-2">Brak gotowych numerów</h3>
            <p className="text-sm text-zinc-400 max-w-md mx-auto mb-6">
              Zapisz projekt w Studio albo dodaj plik audio, aby pojawił się tutaj.
            </p>
            <button
              onClick={openFilePicker}
              className="px-5 py-2.5 rounded-xl bg-blue-500/10 text-blue-400 text-sm font-semibold hover:bg-blue-500/20 transition-colors"
            >
              + Dodaj Pierwszy Numer
            </button>
          </div>
        ) : visibleBeats.length === 0 ? (
          <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/50 p-16 text-center">
            <span className="text-3xl block mb-3">🔍</span>
            <h3 className="text-xl font-bold text-white mb-2">Brak wyników</h3>
            <p className="text-sm text-zinc-400 max-w-md mx-auto">
              Nic nie pasuje do „{searchQuery}” — spróbuj innej frazy.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleBeats.map((beat) => {
              const bars = barHeights(beat.id);
              return (
              <div key={beat.id} data-beat-card={beat.id} className="rounded-2xl bg-zinc-900/50 border border-zinc-800/50 overflow-hidden card-hover">
                <div className="h-32 bg-gradient-to-br from-zinc-800 to-zinc-900 flex items-center justify-center">
                  <div className="flex items-end gap-1 h-16">
                    {bars.map((h, i) => (
                      <div key={i} className={`w-1.5 rounded-full ${beat.isPlaying ? "bg-amber-500" : "bg-zinc-600"}`}
                        style={{ height: `${h}%` }} />
                    ))}
                  </div>
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-white truncate">{beat.title}</h3>
                      <p className="text-xs text-zinc-500">{beat.artist}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {beat.kind === "project" ? (
                        <span className="px-2 py-1 rounded-full bg-red-500/10 border border-red-500/30 text-[9px] font-medium text-red-400" title="Projekt zapisany ze Studio">
                          🎛️ Studio
                        </span>
                      ) : (
                        <button onClick={() => (beat.hasStems && beat.stems ? toggleStemPlay(beat) : togglePlay(beat.id))}
                          disabled={recordingBeat === beat.id}
                          className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                            beat.isPlaying ? "bg-amber-500 text-zinc-900" : "bg-zinc-800 text-white hover:bg-zinc-700"
                          } ${recordingBeat === beat.id ? "opacity-40 pointer-events-none" : ""}`}>
                          {beat.isPlaying ? "⏸" : "▶"}
                        </button>
                      )}
                      {beat.dbId && beat.kind !== "project" && (
                        <button
                          data-edit-beat={beat.id}
                          onClick={() => openEdit(beat)}
                          className="w-8 h-8 rounded-full bg-zinc-800 text-zinc-500 hover:bg-amber-500/10 hover:text-amber-400 flex items-center justify-center text-sm transition-colors"
                          title="Edytuj bit"
                        >
                          ✏️
                        </button>
                      )}
                      <button
                        onClick={() =>
                          setDeleteTarget({
                            id: beat.id,
                            title: beat.title,
                            kind: beat.kind === "project" ? "project" : "beat",
                          })
                        }
                        className="w-8 h-8 rounded-full bg-zinc-800 text-zinc-500 hover:bg-red-500/10 hover:text-red-400 flex items-center justify-center text-sm transition-colors"
                        title="Usuń bit"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-zinc-400 mb-3">
                    {beat.kind === "project" ? (
                      <>
                        {/* The library stores the project flat (takes on the
                            item itself) — tolerate both shapes. */}
                        <span className="font-mono text-amber-500">{(beat.takes ?? beat.project?.takes ?? []).length} take&apos;y</span>
                        <span>{beat.genre}</span>
                        <span>{beat.duration}</span>
                      </>
                    ) : (
                      <>
                        <span className="font-mono text-amber-500">{beat.bpm} BPM</span>
                        <span>{beat.key}</span>
                        <span>{beat.duration}</span>
                        {beat.hasStems && (
                          <span className="text-cyan-400 font-medium" title="Mikser stemów — odtwarzaj z wyciszaniem ścieżek">
                            🎛️ Stemy
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  {/* Stem mixer — per-channel mute/solo while the beat plays. */}
                  {beat.hasStems && beat.stems && (
                    <div className="mt-3 space-y-1.5" data-stem-mixer={`${beat.id}`}>
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] uppercase tracking-wider text-zinc-600">Mikser stemów</p>
                        {(soloStems[beat.id] ?? []).length > 0 && (
                          <button
                            data-stem-solo-clear
                            onClick={() => clearStemSolo(beat.id)}
                            className="text-[10px] text-amber-400 hover:text-amber-300 transition-colors"
                            title="Wyłącz solo — przywróć wszystkie ścieżki"
                          >
                            ✕ Wyłącz solo
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {STEM_CHANNELS.map((ch) => {
                          const isMuted = isChannelMuted(beat.id, ch.id);
                          const isSoloed = (soloStems[beat.id] ?? []).includes(ch.id);
                          return (
                            <div key={ch.id} className="flex items-center gap-1">
                              <button
                                data-stem-channel={ch.id}
                                onClick={() => toggleStemMute(beat.id, ch.id)}
                                disabled={recordingBeat === beat.id}
                                className={`flex flex-1 items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                                  isMuted
                                    ? "bg-zinc-800/60 text-zinc-500"
                                    : "bg-zinc-800/40 text-zinc-300 hover:bg-zinc-700/50"
                                } ${recordingBeat === beat.id ? "opacity-40 pointer-events-none" : ""}`}
                                title={isMuted ? `Wyciszono ${ch.label} — kliknij, aby włączyć` : `Wycisz ${ch.label}`}
                              >
                                <span>{ch.icon}</span>
                                <span className={isMuted ? "line-through" : ""}>{ch.label}</span>
                                <span className="ml-auto">{isMuted ? "🔇" : "🔊"}</span>
                              </button>
                              <button
                                data-stem-solo={ch.id}
                                data-stem-solo-active={isSoloed ? "true" : undefined}
                                onClick={() => toggleStemSolo(beat.id, ch.id)}
                                disabled={recordingBeat === beat.id}
                                className={`w-8 h-8 shrink-0 rounded-lg text-xs font-bold transition-colors ${
                                  isSoloed
                                    ? "bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40"
                                    : "bg-zinc-800/40 text-zinc-500 hover:bg-zinc-700/60 hover:text-zinc-300"
                                } ${recordingBeat === beat.id ? "opacity-40 pointer-events-none" : ""}`}
                                title={isSoloed ? `Solo: ${ch.label} — kliknij, aby wyłączyć` : `Solo ${ch.label} — wycisz pozostałe`}
                              >
                                S
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      {/* Export the current mute/solo mix to one file. */}
                      {recordingBeat === beat.id ? (
                        <button
                          data-stem-record-stop
                          onClick={stopMixRecording}
                          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-red-500/15 text-red-400 text-xs font-medium hover:bg-red-500/25 transition-colors"
                          title="Zatrzymaj nagrywanie i pobierz miks"
                        >
                          ⏹ Zatrzymaj i pobierz
                          <span data-stem-record-timer className="font-mono">{recordSeconds}s</span>
                        </button>
                      ) : (
                        <button
                          data-stem-record
                          onClick={() => startMixRecording(beat)}
                          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 text-amber-400 text-xs font-medium hover:bg-amber-500/20 transition-colors"
                          title="Nagraj miks przy aktualnych ustawieniach wyciszenia/solo"
                        >
                          🎙️ Nagraj miks
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Upload modal: single beat or 4-channel stem pack ── */}
      {uploadOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={closeUpload}
          data-upload-modal
        >
          <div
            className="w-full max-w-md rounded-2xl bg-zinc-900 border border-zinc-800/50 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">Dodaj Numer</h3>
              <button
                onClick={closeUpload}
                className="w-8 h-8 rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 flex items-center justify-center transition-colors"
                title="Zamknij"
              >
                ✕
              </button>
            </div>

            {/* Mode tabs */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              <button
                data-upload-mode="beat"
                onClick={() => setUploadMode("beat")}
                className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                  uploadMode === "beat"
                    ? "bg-amber-500/15 text-amber-400"
                    : "bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                🎵 Bit (jeden plik)
              </button>
              <button
                data-upload-mode="stems"
                onClick={() => setUploadMode("stems")}
                className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                  uploadMode === "stems"
                    ? "bg-amber-500/15 text-amber-400"
                    : "bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                🎛️ Stemy (4 ścieżki)
              </button>
            </div>

            {uploadMode === "beat" ? (
              <div className="space-y-3">
                <label className="block">
                  <span className="text-xs text-zinc-400 mb-1 block">Plik audio</span>
                  <input
                    type="file"
                    accept="audio/*"
                    data-beat-upload
                    onChange={(e) => setSingleFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-xs text-zinc-400 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-zinc-800 file:text-zinc-300 file:text-xs file:font-medium hover:file:bg-zinc-700"
                  />
                  <span className="text-[10px] text-zinc-500 mt-1 block truncate">
                    {singleFile ? singleFile.name : "Wybierz plik..."}
                  </span>
                </label>
                <button
                  onClick={submitSingleBeat}
                  data-submit-upload="beat"
                  className="w-full px-4 py-2.5 rounded-xl bg-blue-500/10 text-blue-400 text-sm font-semibold hover:bg-blue-500/20 transition-colors"
                >
                  Wgraj bit
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {STEM_CHANNELS.map((ch) => (
                  <label key={ch.id} className="block">
                    <span className="text-xs text-zinc-400 mb-1 block">
                      {ch.icon} {ch.label}
                    </span>
                    <input
                      type="file"
                      accept="audio/*"
                      data-stem-upload={ch.id}
                      onChange={(e) =>
                        setStemFiles((prev) => ({ ...prev, [ch.id]: e.target.files?.[0] ?? null }))
                      }
                      className="block w-full text-xs text-zinc-400 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-zinc-800 file:text-zinc-300 file:text-xs file:font-medium hover:file:bg-zinc-700"
                    />
                    <span className="text-[10px] text-zinc-500 mt-1 block truncate">
                      {stemFiles[ch.id] ? stemFiles[ch.id]!.name : "Wybierz plik..."}
                    </span>
                  </label>
                ))}
                <button
                  onClick={submitStems}
                  data-submit-upload="stems"
                  className="w-full px-4 py-2.5 rounded-xl bg-blue-500/10 text-blue-400 text-sm font-semibold hover:bg-blue-500/20 transition-colors"
                >
                  Wgraj stemy
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Edit modal: title / artist / BPM / key of a DB-backed beat ── */}
      {editBeat && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={closeEdit}
          data-edit-modal
        >
          <div
            className="w-full max-w-md rounded-2xl bg-zinc-900 border border-zinc-800/50 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">✏️ Edytuj Numer</h3>
              <button
                onClick={closeEdit}
                disabled={savingEdit}
                className="w-8 h-8 rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 flex items-center justify-center transition-colors disabled:opacity-40"
                title="Zamknij"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="text-xs text-zinc-400 mb-1 block">Tytuł</span>
                <input
                  type="text"
                  data-edit-field="title"
                  value={editForm.title}
                  onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Nazwa numeru"
                  className="w-full px-3 py-2.5 rounded-xl bg-zinc-800/50 border border-zinc-700/40 text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/30"
                />
              </label>
              <label className="block">
                <span className="text-xs text-zinc-400 mb-1 block">Artysta</span>
                <input
                  type="text"
                  data-edit-field="artist"
                  value={editForm.artist}
                  onChange={(e) => setEditForm((f) => ({ ...f, artist: e.target.value }))}
                  placeholder="Nazwa artysty"
                  className="w-full px-3 py-2.5 rounded-xl bg-zinc-800/50 border border-zinc-700/40 text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/30"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-zinc-400 mb-1 block">BPM</span>
                  <input
                    type="number"
                    data-edit-field="bpm"
                    value={editForm.bpm}
                    onChange={(e) => setEditForm((f) => ({ ...f, bpm: Number(e.target.value) }))}
                    min={40}
                    max={240}
                    className="w-full px-3 py-2.5 rounded-xl bg-zinc-800/50 border border-zinc-700/40 text-white text-sm focus:outline-none focus:border-amber-500/30"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-zinc-400 mb-1 block">Klucz</span>
                  <select
                    data-edit-field="key"
                    value={editForm.key}
                    onChange={(e) => setEditForm((f) => ({ ...f, key: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl bg-zinc-800/50 border border-zinc-700/40 text-white text-sm focus:outline-none focus:border-amber-500/30"
                  >
                    <option value="">—</option>
                    {KEY_POOL.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <button
                onClick={saveEdit}
                disabled={savingEdit}
                data-edit-save
                className="w-full px-4 py-2.5 rounded-xl bg-amber-500/15 text-amber-400 text-sm font-semibold hover:bg-amber-500/25 transition-colors disabled:opacity-50"
              >
                {savingEdit ? "Zapisywanie…" : "💾 Zapisz zmiany"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation — beats and Studio projects alike. Projects
          also prune their takes' recordings (rows + files), so the dialog
          spells that out. */}
      <ConfirmDialog
        open={!!deleteTarget}
        title={deleteTarget?.kind === "project" ? "Usuń projekt?" : "Usuń numer?"}
        description={
          deleteTarget
            ? `„${deleteTarget.title}” zostanie usunięty na stałe.${
                deleteTarget.kind === "project"
                  ? " Nagrania take'ów (pliki .webm i wiersze w bazie) również zostaną skasowane."
                  : ""
              }`
            : undefined
        }
        confirmLabel="Usuń"
        tone="danger"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) handleDelete(deleteTarget.id, deleteTarget.title);
          setDeleteTarget(null);
        }}
      />
    </AppShell>
  );
}
