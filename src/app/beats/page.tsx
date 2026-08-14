"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { useToast } from "@/components/studio/useToast";
import { ToastView } from "@/components/studio/ToastView";
import type { SavedProject, SavedTakeState } from "@/components/studio/types";
import { recordChallengeEvent } from "@/lib/challenges";
import { loadCache, saveCache, tryDbWrite } from "@/lib/db-sync";
import { createBeat, deleteBeat, getBeats, getProjects, saveProject, deleteProject } from "@/actions/beats";

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
  /** DB id when this beat is backed by the Prisma backend. */
  dbId?: string;
}

const KEY_POOL = ["Am", "Cm", "Em", "Fm", "Gm", "Dm", "Amaj", "Emaj"];
const STORAGE_KEY = "flowforge-beats";

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
  };
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
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const togglePlay = (id: string) => {
    const target = beats.find((b) => b.id === id);
    if (!target?.url) return; // projects have no audio embedded in the library
    const willPlay = target ? !target.isPlaying : false;
    setBeats((prev) => prev.map((b) => ({ ...b, isPlaying: b.id === id ? willPlay : false })));
    if (willPlay) {
      if (playAudioRef.current) playAudioRef.current.pause();
      if (target?.url) {
        const audio = playAudioRef.current ?? new Audio();
        audio.src = target.url;
        audio.play().catch(() => {});
        playAudioRef.current = audio;
      }
    } else if (playAudioRef.current) {
      playAudioRef.current.pause();
    }
  };

  // ── Upload ──
  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const title = file.name.replace(/\.[^/.]+$/, "");
      try {
        const dataUrl = await readFileAsDataURL(file);

        // Persist to the DB first (local SQLite — fast), so the beat gets a
        // stable id; fall back to a temp id when the backend is unavailable.
        let beatId = Date.now().toString();
        let dbId: string | undefined;
        const ok = await tryDbWrite(async () => {
          const row = await createBeat({
            title,
            artist: "Wgrany bit",
            bpm: 70 + Math.floor(Math.random() * 70),
            key: KEY_POOL[Math.floor(Math.random() * KEY_POOL.length)],
            genre: "Demo",
            tags: [],
            filePath: dataUrl,
          });
          beatId = row.id;
          dbId = row.id;
        });
        if (!ok) showToast("⚠️ Baza danych niedostępna — bit zapisany lokalnie", "info");

        // Read the real duration from the audio metadata (async).
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

        setBeats((prev) => [
          {
            id: beatId,
            dbId,
            title,
            artist: "Wgrany bit",
            bpm: 70 + Math.floor(Math.random() * 70),
            key: KEY_POOL[Math.floor(Math.random() * KEY_POOL.length)],
            genre: "Demo",
            tags: [],
            hasStems: false,
            duration: "…",
            isPlaying: false,
            url: dataUrl,
          },
          ...prev,
        ]);
        showToast(`🎵 Wgrano bit: ${title}`);
        // Wyzwania — beat uploads count toward „Bit i Słowo”.
        const newly = await recordChallengeEvent({ type: "increment", stat: "beats" });
        if (newly.length > 0) {
          showToast(`🏆 Wyzwanie ukończone: ${newly.map((c) => `${c.title} (+${c.points} pkt)`).join(" • ")}`);
        }
      } catch {
        showToast("⚠️ Nie udało się odczytać pliku", "info");
      }
      // Allow re-selecting the same file.
      e.target.value = "";
    },
    [showToast]
  );

  // ── Delete ──
  const handleDelete = useCallback(
    (id: string, title: string) => {
      const target = beats.find((b) => b.id === id);
      if (target?.isPlaying && playAudioRef.current) playAudioRef.current.pause();
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

  const openFilePicker = useCallback(() => fileInputRef.current?.click(), []);

  return (
    <AppShell>
      {/* Toast notification — shared component driven by the useToast hook */}
      <ToastView toast={toast} />
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={handleFileUpload}
      />
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

        {/* Search */}
        <div className="flex flex-col sm:flex-row gap-3">
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
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {beats.map((beat) => (
              <div key={beat.id} className="rounded-2xl bg-zinc-900/50 border border-zinc-800/50 overflow-hidden card-hover">
                <div className="h-32 bg-gradient-to-br from-zinc-800 to-zinc-900 flex items-center justify-center">
                  <div className="flex items-end gap-1 h-16">
                    {Array.from({ length: 20 }).map((_, i) => (
                      <div key={i} className={`w-1.5 rounded-full ${beat.isPlaying ? "bg-amber-500" : "bg-zinc-600"}`}
                        style={{ height: `${Math.random() * 100}%` }} />
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
                        <button onClick={() => togglePlay(beat.id)}
                          className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                            beat.isPlaying ? "bg-amber-500 text-zinc-900" : "bg-zinc-800 text-white hover:bg-zinc-700"
                          }`}>
                          {beat.isPlaying ? "⏸" : "▶"}
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(beat.id, beat.title)}
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
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
