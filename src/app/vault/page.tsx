"use client";

import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect, type ReactNode, type RefObject, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";

// useLayoutEffect is a no-op on the server — this avoids the SSR hydration
// warning while keeping synchronous, pre-paint measurement in the browser.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;
import AppShell from "@/components/layout/AppShell";
import { useToast } from "@/components/studio/useToast";
import { ToastView } from "@/components/studio/ToastView";
import { ConfirmDialog } from "@/components/studio/ConfirmDialog";
import { findRhymes, detectRhymeClusters, RhymeHit, RhymeResult, RhymeType } from "@/lib/rhyme-engine";
import { diffLines, diffStats } from "@/lib/lyric-diff";
import { recordChallengeEvent } from "@/lib/challenges";
import { countLineSyllables, countWordSyllablesInLine, analyzeLyrics } from "@/lib/syllable-counter";
import { loadCache, saveCache, tryDbWrite } from "@/lib/db-sync";
import { MAX_ACTIVE_VERSIONS_PER_LYRIC } from "@/lib/lyric-versions";
import { sortTracks, SORT_MODES, TrackSortMode, SortDirection, DEFAULT_DIRECTION } from "@/lib/track-sort";
import { filterTracks } from "@/lib/track-filter";
import {
  createLyric,
  updateLyric,
  saveLyricVersion,
  getAllLyrics,
  getLyric,
  deleteLyric,
  deleteLyricVersion,
  archiveLyricVersion,
  restoreLyricVersion,
  purgeArchivedLyricVersions,
  publishLyric,
  unpublishLyric,
} from "@/actions/lyrics";
import { exportLyricAsText, exportLyricAsPdf, getExportHistory, clearExportHistory } from "@/actions/export";
import { getMoodboard, saveMoodboard, type MoodboardData } from "@/actions/moodboard";
import { getReleasePlan, saveReleasePlan, type ReleasePlanData } from "@/actions/release-plan";

type ExportLogRow = Awaited<ReturnType<typeof getExportHistory>>[number];

/**
 * Offline fallback: mirrors the server-side export format so the user can
 * still download their text when the DB is unavailable.
 */
function buildExportText(opts: {
  title: string;
  content: string;
  lineCount: number;
  verseCount: number;
  syllableCount: number;
  wordCount: number;
}): string {
  return [
    "═══════════════════════════════════════",
    `  ${opts.title}`,
    "  Wygenerowano przez FlowForge",
    `  Data: ${new Date().toLocaleDateString("pl-PL")}`,
    "═══════════════════════════════════════",
    "",
    opts.content,
    "",
    "═══════════════════════════════════════",
    "  Statystyki:",
    `  • Linii: ${opts.lineCount}`,
    `  • Zwrotek: ${opts.verseCount}`,
    `  • Sylab: ${opts.syllableCount}`,
    `  • Słów: ${opts.wordCount}`,
    "  • BPM: nie ustawiono",
    "═══════════════════════════════════════",
  ].join("\n");
}

// ─── DB-backed sync keys ────────────────────────────────────────────────
const TITLE_KEY = "flowforge-title";
const CONTENT_KEY = "flowforge-content";
const VERSIONS_KEY = "flowforge-versions";
/** Id of the track to reopen on the next visit. */
const CURRENT_KEY = "flowforge-current-lyric-id";
/** Remembered „Utwory” list sort order. */
const SORT_KEY = "flowforge-vault-sort";

// ─── Track list types ───────────────────────────────────────────────────
type DbLyricRow = Awaited<ReturnType<typeof getAllLyrics>>[number];

interface TrackSummary {
  id: string;
  title: string;
  lineCount: number;
  wordCount: number;
  syllableCount: number;
  versionCount: number;
  /** Recent version labels (last 5) — searchable alongside the title. */
  versionLabels: string[];
  updatedAt: string; // ISO
  /** "draft" | "published" | "archived" — drives the 📢 badge + toggle. */
  status: string;
  isPublic: boolean;
}

function toTrackSummary(t: DbLyricRow): TrackSummary {
  return {
    id: t.id,
    title: t.title,
    lineCount: t.lineCount ?? 0,
    wordCount: t.wordCount ?? 0,
    syllableCount: t.syllableCount ?? 0,
    versionCount: t._count?.versions ?? 0,
    versionLabels: (t.versions ?? [])
      .map((v) => v.label)
      .filter((l): l is string => !!l),
    updatedAt: new Date(t.updatedAt).toISOString(),
    status: t.status,
    isPublic: t.isPublic,
  };
}

// ─── Types ────────────────────────────────────────────────────────────
interface LyricVersion {
  id: string;
  content: string;
  label: string;
  timestamp: string;
  /** Set when this version is backed by a Prisma LyricVersion row. */
  dbId?: string;
  /** True when the version sits in the archive (over the active cap or
   *  manually archived). Archived versions can be restored or purged. */
  archived?: boolean;
}

// Dostępne sekcje The Vault — zakładka „Narzędzia” została usunięta,
// pozostały tylko edytor i lista wersji.
type VaultTab = "editor" | "versions";

const VAULT_TABS: ReadonlyArray<{ id: VaultTab; icon: string; label: string }> = [
  { id: "editor", icon: "📝", label: "Edytor" },
  { id: "versions", icon: "📚", label: "Wersje" },
];

// ─── WRITER'S BLOCK DATA ──────────────────────────────────────────────
// Categorized „Iskra” database — five creative prompt types, each with its
// own pool. Sparks are drawn context-aware: when a „Klimat” (mood combo) is
// active, the generator prefers sparks whose text matches those moods and
// can synthesize fresh prompts from KLIMAT_TEMPLATES + the mood's keywords.

type SparkCategory =
  | "punchline"
  | "theme"
  | "wordplay"
  | "opening"
  | "imagery";

interface SparkCategoryData {
  id: SparkCategory;
  label: string;
  sparks: string[];
}

const SPARK_CATEGORIES: SparkCategoryData[] = [
  {
    id: "punchline",
    label: "💥 Ustawki puenty",
    sparks: [
      "Ludzie mówią, że mam za dużo dumy…",
      "Siedzę z myślami jak z kumplami…",
      "Każdy ma swój limit, ja…",
      "Zanim powiesz, że się nie da…",
      "Oni liczą na moją porażkę…",
      "Słowa mają moc, ale cisza…",
      "Wszyscy chcą być na topie, a ja…",
      "Nie jestem idealny, ale…",
      "Mówili, że nic ze mnie nie będzie…",
      "Życie rozdaje karty, a ja…",
      "Mój największy wróg patrzy w lustro…",
      "Trzy rano, miasto śpi, a ja…",
      "Nie chwalę się, tylko mówię jak jest…",
      "Każdy krok to zakład, stawiam wszystko…",
    ],
  },
  {
    id: "theme",
    label: "🧠 Koncepcje tematyczne",
    sparks: [
      "Utwór o tym, że czas leczy, ale blizny zostają",
      "Koncepcja: rozmowa z młodszym sobą",
      "Tekst o przyjaźni, która przetrwała blokowisko",
      "Historia od zera do czegoś, bez sprzedawania duszy",
      "Temat: dziedzictwo — co zostawiamy po sobie",
      "Kawałek o mieście, które śpi, kiedy my czuwamy",
      "Refleksja nad ceną sławy i pustymi lajkami",
      "Droga z podwórka na scenę — i z powrotem do korzeni",
      "Utwór o matce, która wierzyła, kiedy inni zwątpili",
      "Koncepcja: ostatni dzień wolności, zanim wszystko się zmieni",
      "Tekst o tym, że prawda boli, ale kłamstwo zabija",
      "Temat: młodość, która nie miała planu B",
      "Kawałek o nerwach, które trzymasz w ryzach",
      "Historia o tym, jak marzenia kosztują więcej niż pieniądze",
    ],
  },
  {
    id: "wordplay",
    label: "🔤 Zabawy słowne",
    sparks: [
      "Użyj słowa „beton” w trzech różnych znaczeniach",
      "Zbuduj wers, w którym „noc” i „moc” rymują się dwa razy",
      "Napisz puentę z „góra/dół” jako metaforą losu",
      "Jedno słowo, które zmienia sens całej zwrotki",
      "Kalambur: „gram” jako gra i granie",
      "Zamknij ostatni wers homonimem",
      "Zamień popularne powiedzenie na wers o rapie",
      "Wiersz, w którym każda linia kończy się inną formą tego samego słowa",
      "Zbuduj metaforę: serce jako stary sprzęt",
      "Słowo „echo” jako temat przewodni — rozwiń je w refrenie",
      "Gra słów: „flow” jako nurt rzeki i flow rapera",
      "Znajdź rym do „ulica”, którego nikt nie użył",
    ],
  },
  {
    id: "opening",
    label: "🚪 Linie otwierające",
    sparks: [
      "Budzę się z wierszem na ustach…",
      "Miasto wstaje, a ja kończę…",
      "Siedzę na klatce i patrzę na horyzont…",
      "Mikrofon zimny jak poranek…",
      "Zanim cokolwiek powiem, słuchaj…",
      "To nie jest kolejna opowieść o biedzie…",
      "Zaczynam tam, gdzie inni kończą…",
      "Mam w głowie hałas, który układa się w rymy…",
      "Pierwszy wers ma być jak cios…",
      "Nocą słychać tylko bicie serca i metronom…",
      "Nie piszę o sobie, piszę o nas…",
      "Otwieram zeszyt, a z niego wychodzi świat…",
      "Zanim wejdziesz w ten kawałek, sprawdź z kim gadasz…",
      "Każdy wielki tekst zaczyna się od cichego pomysłu…",
    ],
  },
  {
    id: "imagery",
    label: "🌌 Abstrakcyjne obrazy",
    sparks: [
      "Deszcz na szybie rysuje mapę moich myśli",
      "Betony wschodzą jak drzewa, a my między nimi korzeniami",
      "Dym z komina wije się jak melodia bez słów",
      "Cienie latarni tańczą na ścianie bloku",
      "Miasto oddycha rytmem, którego nikt nie notuje",
      "Śnieg na osiedlu przykrywa ślady, ale nie pamięć",
      "Winda jedzie w górę, a marzenia w dół",
      "Latarnia gasi blask, kiedy słońce wstaje z betonu",
      "Asfalt pęka, a pod nim bije źródło",
      "Gwiazdy nad blokowiskiem są jak słowa, których nikt nie zapisał",
      "Mgła nad rzeką chowa mosty, ale nie pytania",
      "Kruki na dachu liczą nasze wersy",
      "Klatka schodowa pachnie gotowaniem i marzeniami",
      "Prąd w bloku trzaska jak werbel na próbie",
    ],
  },
];

// Context-aware templates: when a „Klimat” is active the generator can
// synthesize a fresh, tailored prompt by filling {word} with a keyword drawn
// from the selected moods' pools (e.g. „Mrok” → ciemność/cienie/noc/…).
const KLIMAT_TEMPLATES = [
  "Czuję {word} w każdym oddechu — zapisuję to",
  "Niosę {word} jak bliznę, której nie wstydzę się pokazać",
  "Mówią, że {word} to przeszłość, a ja w niej dopiero zaczynam",
  "W tym {word} jest prawda, której nie sprzedam",
  "Każdy wers to {word}, które dźwigam na plecach",
  "Kiedy świat gada, ja wsłuchuję się w {word}",
  "{word} prowadzi mnie przez ten kawałek",
  "Nie uciekam od {word} — ono jest częścią mnie",
  "Z {word} na ustach buduję to, czego nie zburzą",
  "W {word} widzę lustro, w którym poznaję siebie",
];

const MOOD_KEYWORDS = {
  "🌑 Mrok": ["ciemność", "cienie", "noc", "tajemnica", "mgła", "mrok", "pustka", "samotność"],
  "⚡ Energia": ["ogień", "dynamika", "bunt", "siła", "moc", "energia", "prędkość", "burza"],
  "🔮 Refleksja": ["czas", "pamięć", "przeszłość", "wspomnienia", "nostalgia", "przemijanie", "mądrość"],
  "🔥 Agresja": ["walka", "bunt", "wściekłość", "furia", "napaść", "konflikt", "wojna", "opór"],
  "💔 Smutek": ["żal", "strata", "tęsknota", "rozstanie", "łzy", "ból", "cierpienie", "żałoba"],
  "✨ Nadzieja": ["świt", "światło", "nowy początek", "wiara", "marzenie", "cel", "droga", "nadzieja"],
  "🌃 Ulice": ["blokowisko", "asfalt", "latarnie", "beton", "bramy", "osiedle", "miasto", "dzielnica"],
  "🎤 Muzyka": ["beat", "flow", "rytm", "melodia", "wiersz", "zwrotka", "refren", "studio"],
};

// ─── Main Vault Page ──────────────────────────────────────────────────
export default function VaultPage() {
  const [content, setContent] = useState("");
  const [contentLoaded, setContentLoaded] = useState(false);
  const [title, setTitle] = useState("Bez tytułu");
  const [titleLoaded, setTitleLoaded] = useState(false);
  const [versions, setVersions] = useState<LyricVersion[]>([]);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Shared toast notifications (save / delete feedback) — useToast + ToastView.
  const { toast, showToast } = useToast();

  const [rhymeAnalysisActive, setRhymeAnalysisActive] = useState(false);
  const [metronomeActive, setMetronomeActive] = useState(false);
  const [writerBlockActive, setWriterBlockActive] = useState(false);
  const [moodboardActive, setMoodboardActive] = useState(false);
  const [flowMeterActive, setFlowMeterActive] = useState(false);
  const [releasePlannerActive, setReleasePlannerActive] = useState(false);
  const [toolsLoaded, setToolsLoaded] = useState(false);

  // Load tool states from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("flowforge-vault-tools");
      if (saved) {
        const data = JSON.parse(saved);
        if (data.rhymeAnalysisActive) setRhymeAnalysisActive(data.rhymeAnalysisActive);
        if (data.metronomeActive) setMetronomeActive(data.metronomeActive);
        if (data.writerBlockActive) setWriterBlockActive(data.writerBlockActive);
        if (data.moodboardActive) setMoodboardActive(data.moodboardActive);
        if (data.flowMeterActive) setFlowMeterActive(data.flowMeterActive);
        if (data.releasePlannerActive) setReleasePlannerActive(data.releasePlannerActive);
      }
    } catch { /* ignore */ }
    setToolsLoaded(true);
  }, []);

  // Save tool states to localStorage when changed (only after initial load)
  useEffect(() => {
    if (!toolsLoaded) return;
    try {
      localStorage.setItem("flowforge-vault-tools", JSON.stringify({
        rhymeAnalysisActive, metronomeActive, writerBlockActive,
        moodboardActive, flowMeterActive, releasePlannerActive,
      }));
    } catch { /* ignore */ }
  }, [rhymeAnalysisActive, metronomeActive, writerBlockActive, moodboardActive, flowMeterActive, releasePlannerActive, toolsLoaded]);

  const [activeTab, setActiveTab] = useState<VaultTab>("editor");
  const [selectedWord, setSelectedWord] = useState("");
  const [rhymes, setRhymes] = useState<RhymeResult[]>([]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Editor undo/redo history ──
  // The textarea is CONTROLLED (React state), so the browser's native undo
  // cannot track changes — and programmatic insertions („Iskra”, mood words,
  // rhyme suggestions) never reach the native stack at all. The editor owns
  // its history: every programmatic insertion is one transaction, typing
  // bursts merge into a single step, and Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z are
  // bound here (preventDefault stops the native stack from fighting us).
  const contentRef = useRef(content);
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const lastEditRef = useRef<{ time: number; kind: "typing" | "programmatic" } | null>(null);
  const MAX_HISTORY_ENTRIES = 100;

  // Keep the ref in sync with every content write (incl. external ones like
  // track switches that bypass updateContent).
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  // Drop the whole history — used when the document is replaced wholesale
  // (track switch, version restore, clear). Undo must never reach into a
  // different track's text.
  const resetHistory = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    lastEditRef.current = null;
  }, []);

  const recordHistory = useCallback((prev: string, kind: "typing" | "programmatic") => {
    const now = Date.now();
    const last = lastEditRef.current;
    // A typing burst (keystrokes within 800 ms) is ONE undo step — like real
    // editors. Every programmatic insertion is always its own transaction.
    const merge = kind === "typing" && last !== null && last.kind === "typing" && now - last.time < 800;
    if (!merge) {
      undoStackRef.current.push(prev);
      if (undoStackRef.current.length > MAX_HISTORY_ENTRIES) {
        undoStackRef.current.shift();
      }
    }
    redoStackRef.current = [];
    lastEditRef.current = { time: now, kind };
  }, []);

  const updateContent = useCallback((next: string, kind: "typing" | "programmatic") => {
    const prev = contentRef.current;
    if (prev === next) return;
    recordHistory(prev, kind);
    contentRef.current = next;
    setContent(next);
  }, [recordHistory]);

  const undo = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (prev === undefined) return;
    redoStackRef.current.push(contentRef.current);
    contentRef.current = prev;
    lastEditRef.current = null;
    setContent(prev);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(prev.length, prev.length);
      }
    });
  }, []);

  const redo = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (next === undefined) return;
    undoStackRef.current.push(contentRef.current);
    contentRef.current = next;
    lastEditRef.current = null;
    setContent(next);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(next.length, next.length);
      }
    });
  }, []);

  // Ctrl/Cmd+Z → undo, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y → redo. preventDefault
  // guarantees the native browser stack can't intercept or double-handle.
  const handleEditorKeyDown = useCallback((e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (key === "y") {
      e.preventDefault();
      redo();
    }
  }, [undo, redo]);

  const toggleRhymeAnalysis = useCallback(() => {
    setRhymeAnalysisActive((prev) => !prev);
  }, []);

  const analysis = useMemo(() => analyzeLyrics(content), [content]);

  // Logical lines — source of truth for the measurement mirror and markers.
  const editorLines = useMemo(() => content.split("\n"), [content]);

  // Word-level rhyme clusters: every content word in the whole text is
  // scanned (not just line endings), so internal rhymes, multi-syllabic
  // matches and repeated words anywhere form shared-color clusters. The
  // editor highlights every matching word; the „Analiza Wersów” panel shows
  // one dot per cluster present on the line.
  const rhymeClusters = useMemo(() => {
    if (!rhymeAnalysisActive || !content.trim()) return null;
    return detectRhymeClusters(editorLines);
  }, [rhymeAnalysisActive, content, editorLines]);

  // Line → first cluster color (markers, flow meter, legend fallback).
  const rhymeGroups = useMemo(() => rhymeClusters?.lineColors ?? new Map<number, string>(), [rhymeClusters]);
  const rhymeHits = useMemo(() => rhymeClusters?.hits ?? new Map<number, RhymeHit[]>(), [rhymeClusters]);
  const rhymeGroupCount = useMemo(() => rhymeClusters?.colors.length ?? 0, [rhymeClusters]);

  // Raw line index → analyzed entry. `analyzeLyrics` drops blank lines, so
  // its array indexes do NOT match the raw split used by `rhymeGroups` / the
  // editor overlay — mapping through this keeps the „Analiza Wersów” color
  // dots in exact 1:1 sync with the editor highlights even when the text has
  // blank lines between stanzas.
  const panelLines = useMemo(() => {
    const byRaw = new Map<number, (typeof analysis.lines)[number]>();
    let analyzedIdx = 0;
    for (let rawIdx = 0; rawIdx < editorLines.length; rawIdx++) {
      if (editorLines[rawIdx].trim().length === 0) continue;
      if (analyzedIdx < analysis.lines.length) {
        byRaw.set(rawIdx, analysis.lines[analyzedIdx]);
      }
      analyzedIdx++;
    }
    return byRaw;
  }, [editorLines, analysis]);

  useEffect(() => {
    if (selectedWord) setRhymes(findRhymes(selectedWord));
  }, [selectedWord]);

  const handleMouseUp = useCallback(() => {
    setTimeout(() => {
      if (!textareaRef.current) return;
      const { selectionStart, selectionEnd } = textareaRef.current;
      if (selectionStart !== selectionEnd) {
        const text = content.substring(selectionStart, selectionEnd).trim();
        if (text && !text.includes(" ")) setSelectedWord(text);
      }
    }, 10);
  }, [content]);

  // ── Load title from localStorage on mount ──
  useEffect(() => {
    try {
      const savedTitle = localStorage.getItem(TITLE_KEY);
      if (savedTitle) setTitle(savedTitle);
    } catch { /* ignore */ }
    setTitleLoaded(true);
  }, []);

  // ── Save title to localStorage when changed (only after initial load) ──
  useEffect(() => {
    if (!titleLoaded) return;
    try {
      localStorage.setItem(TITLE_KEY, title);
    } catch { /* ignore */ }
  }, [title, titleLoaded]);

  // ── Load content from localStorage on mount ──
  useEffect(() => {
    try {
      const savedContent = localStorage.getItem(CONTENT_KEY);
      if (savedContent) {
        setContent(savedContent);
        resetHistory();
      }
    } catch { /* ignore */ }
    setContentLoaded(true);
  }, []);

  // ── Save content to localStorage when changed (only after initial load) ──
  useEffect(() => {
    if (!contentLoaded) return;
    try {
      localStorage.setItem(CONTENT_KEY, content);
    } catch { /* ignore */ }
  }, [content, contentLoaded]);

  // ── Wyzwania — feed the current line count (Mistrz Rymu / Maraton Wersów) ──
  // Debounced so typing doesn't hammer localStorage on every keystroke.
  useEffect(() => {
    if (!contentLoaded) return;
    const t = window.setTimeout(async () => {
      const lines = content.split("\n").filter((l) => l.trim()).length;
      const newly = await recordChallengeEvent({ type: "setLyricsLines", lines });
      if (newly.length > 0) {
        showToast(`🏆 Wyzwanie ukończone: ${newly.map((c) => `${c.title} (+${c.points} pkt)`).join(" • ")}`);
      }
    }, 800);
    return () => window.clearTimeout(t);
  }, [content, contentLoaded, showToast]);

  // ── Load versions from localStorage on mount ──
  const [versionsLoaded, setVersionsLoaded] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VERSIONS_KEY);
      if (saved) setVersions(JSON.parse(saved));
    } catch { /* ignore */ }
    setVersionsLoaded(true);
  }, []);

  // ── DB-backed current track + one-time sync (DB-primary, localStorage cache) ──
  const [lyricId, setLyricId] = useState<string | null>(null);
  const [tracks, setTracks] = useState<TrackSummary[]>([]);

  // Archived tracks (Lyric.status = "archived") — hidden from the main
  // „Utwory” list; the „📦 Archiwum” section shows them with restore /
  // permanent-delete actions.
  const [archivedTracks, setArchivedTracks] = useState<TrackSummary[]>([]);
  const [showArchive, setShowArchive] = useState(false);

  // Remembered sort order for the „Utwory” list (persisted across visits).
  // Direction is remembered per mode, so switching modes never surprises.
  const [sortMode, setSortMode] = useState<TrackSortMode>("updated");
  const [sortDirections, setSortDirections] =
    useState<Record<TrackSortMode, SortDirection>>({ ...DEFAULT_DIRECTION });
  const [sortLoaded, setSortLoaded] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SORT_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === "object") {
        const m = parsed.mode;
        if (m === "title" || m === "words" || m === "syllables") setSortMode(m);
        if (parsed.directions && typeof parsed.directions === "object") {
          const next = { ...DEFAULT_DIRECTION };
          for (const k of ["updated", "title", "words", "syllables"] as const) {
            const d = parsed.directions[k];
            if (d === "asc" || d === "desc") next[k] = d;
          }
          setSortDirections(next);
        }
      } else if (saved === "title" || saved === "words" || saved === "syllables") {
        // Legacy bare-string value (saved before the direction existed).
        setSortMode(saved);
      }
    } catch { /* ignore */ }
    setSortLoaded(true);
  }, []);
  useEffect(() => {
    if (!sortLoaded) return;
    try {
      localStorage.setItem(
        SORT_KEY,
        JSON.stringify({ mode: sortMode, directions: sortDirections })
      );
    } catch { /* ignore */ }
  }, [sortMode, sortDirections, sortLoaded]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await getAllLyrics({ limit: 100, excludeArchived: true });
        if (cancelled) return;
        setTracks(all.map(toTrackSummary));
        // Archived tracks fill the „📦 Archiwum” section (parallel fetch).
        getAllLyrics({ status: "archived", limit: 100 })
          .then((rows) => {
            if (!cancelled) setArchivedTracks(rows.map(toTrackSummary));
          })
          .catch(() => {});
        const localVersions = loadCache<LyricVersion[]>(VERSIONS_KEY, []);

        // Open the track that was open last time (or the most recently edited).
        // A deep link (?track=<id> — e.g. from the dashboard's „Ostatnio
        // Edytowane”) wins over the remembered track; unknown ids fall back
        // to the normal behavior instead of breaking the load.
        const deepLinkId = new URLSearchParams(window.location.search).get("track");
        const savedCurrentId = loadCache<string>(CURRENT_KEY, "");
        const current =
          (deepLinkId ? all.find((l) => l.id === deepLinkId) : undefined) ??
          (savedCurrentId ? all.find((l) => l.id === savedCurrentId) : undefined) ??
          all[0] ??
          null;

        if (!current) {
          // DB empty → one-time import of the current localStorage document.
          const localContent = loadCache<string>(CONTENT_KEY, "");
          const localTitle = loadCache<string>(TITLE_KEY, "");
          if (!localContent.trim() && !localTitle.trim()) return; // nothing to import
          const analysis = analyzeLyrics(localContent);
          const lyric = await createLyric({
            title: localTitle.trim() || "Bez tytułu",
            content: localContent,
            lineCount: analysis.lineCount,
            verseCount: analysis.verseCount,
            syllableCount: analysis.totalSyllables,
            wordCount: analysis.wordCount,
          });
          if (cancelled) return;
          setLyricId(lyric.id);
          setTitle(localTitle);
          setContent(localContent);
          resetHistory();
          // Mirror existing saved versions into the backend.
          const imported = await Promise.all(
            localVersions.map((v) =>
              saveLyricVersion({ lyricId: lyric.id, content: v.content, label: v.label })
            )
          );
          if (!cancelled) {
            setVersions(
              imported.map((row, i) => ({
                id: row.id,
                dbId: row.id,
                content: localVersions[i].content,
                label: localVersions[i].label,
                timestamp: new Date(row.createdAt).toISOString(),
              }))
            );            setTracks([
              {
                id: lyric.id,
                title: lyric.title,
                lineCount: lyric.lineCount ?? 0,
                wordCount: lyric.wordCount ?? 0,
                syllableCount: lyric.syllableCount ?? 0,
                versionCount: imported.length,
                versionLabels: localVersions.map((v) => v.label).filter((l): l is string => !!l),
                status: lyric.status,
                isPublic: lyric.isPublic,
                updatedAt: new Date(lyric.updatedAt).toISOString(),
              },
            ]);
            saveCache(CURRENT_KEY, lyric.id);
          }
          return;
        }

        // DB has the track to open — but a non-empty localStorage copy that
        // differs is newer (offline edits since the last DB sync), so it wins
        // and is pushed back up instead of being clobbered.
        const full = await getLyric(current.id);
        if (!full) return;
        if (cancelled) return;
        setLyricId(full.id);
        saveCache(CURRENT_KEY, full.id);
        const localContent = loadCache<string>(CONTENT_KEY, "");
        const localTitle = loadCache<string>(TITLE_KEY, "");
        const localIsNewer = !!localContent.trim() && localContent !== full.content;
        if (localIsNewer) {
          setTitle(localTitle.trim() || full.title);
          setContent(localContent);
          resetHistory();
          const analysis = analyzeLyrics(localContent);
          tryDbWrite(() =>
            updateLyric(full.id, {
              title: localTitle.trim() || full.title,
              content: localContent,
              lineCount: analysis.lineCount,
              verseCount: analysis.verseCount,
              syllableCount: analysis.totalSyllables,
              wordCount: analysis.wordCount,
            })
          );
        } else if (full.content) {
          setTitle(full.title);
          setContent(full.content);
          resetHistory();
        }
        const dbVersions: LyricVersion[] = (full.versions ?? []).map((v) => ({
          id: v.id,
          dbId: v.id,
          content: v.content,
          label: v.label || "Wersja robocza",
          timestamp: new Date(v.createdAt).toISOString(),
          archived: !!v.archivedAt,
        }));
        // Import local versions that never reached the backend (offline saves).
        const dbLabels = new Set(dbVersions.map((v) => v.label));
        const orphaned = localVersions.filter((v) => !dbLabels.has(v.label));
        const imported = await Promise.all(
          orphaned.map((v) => saveLyricVersion({ lyricId: full.id, content: v.content, label: v.label }))
        );
        if (!cancelled) {
          const merged = [
            ...dbVersions,
            ...imported.map((row, i) => ({
              id: row.id,
              dbId: row.id,
              content: orphaned[i].content,
              label: orphaned[i].label,
              timestamp: new Date(row.createdAt).toISOString(),
            })),
          ].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
          setVersions(merged);
        }
      } catch {
        /* DB unavailable — the localStorage loaders above already ran */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Save versions to localStorage when changed and notify Dashboard ──
  useEffect(() => {
    if (!versionsLoaded) return;
    try {
      localStorage.setItem("flowforge-versions", JSON.stringify(versions));
      window.dispatchEvent(new CustomEvent("flowforge-versions-updated"));
    } catch { /* ignore */ }
  }, [versions, versionsLoaded]);

  // Re-fetch the current track's versions from the DB. Used after a save so
  // the server-side cap enforcement (oldest version archived past the limit)
  // shows up, and after restore swaps at the cap.
  const refreshVersions = useCallback(async (targetId: string) => {
    const full = await getLyric(targetId).catch(() => null);
    if (!full) return;
    setVersions(
      (full.versions ?? [])
        .map((v): LyricVersion => ({
          id: v.id,
          dbId: v.id,
          content: v.content,
          label: v.label || "Wersja robocza",
          timestamp: new Date(v.createdAt).toISOString(),
          archived: !!v.archivedAt,
        }))
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    );
  }, []);

  const deleteVersion = useCallback(
    (id: string) => {
      const target = versions.find((v) => v.id === id);
      setVersions((prev) => prev.filter((v) => v.id !== id));
      const dbId = target?.dbId;
      if (dbId) tryDbWrite(() => deleteLyricVersion(dbId));
      showToast("🗑️ Usunięto wersję", "info");
    },
    [versions, showToast]
  );

  // ── Version archive (limit + manual archive / restore / purge) ────────
  // The server caps ACTIVE versions per track at MAX_ACTIVE_VERSIONS_PER_LYRIC
  // (oldest auto-archived on save). These handlers drive the „Archiwum”
  // section of the versions panel. Each is optimistic, then reconciles with
  // the DB via refreshVersions — guarded by lyricIdRef so a mid-flight track
  // switch can't clobber the new track's list.
  const archiveVersion = useCallback(
    (id: string) => {
      const target = versions.find((v) => v.id === id);
      const targetLyric = lyricIdRef.current;
      setVersions((prev) => prev.map((v) => (v.id === id ? { ...v, archived: true } : v)));
      const dbId = target?.dbId;
      if (dbId && targetLyric) {
        tryDbWrite(async () => {
          await archiveLyricVersion(dbId);
          if (lyricIdRef.current === targetLyric) await refreshVersions(targetLyric);
        });
      }
      showToast("📦 Przeniesiono do archiwum", "info");
    },
    [versions, refreshVersions, showToast]
  );

  const restoreArchivedVersion = useCallback(
    (v: LyricVersion) => {
      const targetLyric = lyricIdRef.current;
      // Optimistic flip; at the cap the server swaps the oldest active into
      // the archive to make room — the refresh reconciles the real state.
      setVersions((prev) => prev.map((x) => (x.id === v.id ? { ...x, archived: false } : x)));
      const dbId = v.dbId;
      if (dbId && targetLyric) {
        tryDbWrite(async () => {
          await restoreLyricVersion(dbId);
          if (lyricIdRef.current === targetLyric) await refreshVersions(targetLyric);
        });
      }
      showToast("↩️ Przywrócono z archiwum", "info");
    },
    [refreshVersions, showToast]
  );

  const purgeArchived = useCallback(() => {
    const targetLyric = lyricIdRef.current;
    setVersions((prev) => prev.filter((v) => !v.archived));
    if (targetLyric) {
      tryDbWrite(async () => {
        await purgeArchivedLyricVersions(targetLyric);
        if (lyricIdRef.current === targetLyric) await refreshVersions(targetLyric);
      });
    }
    showToast("🧹 Archiwum wyczyszczone", "info");
  }, [refreshVersions, showToast]);

  // Shared by the versions tab and the „Utwory” tooltip: applies a version's
  // content to the editor and keeps the DB row in sync (when a target exists).
  const applyVersionContent = useCallback((targetId: string | null, content: string) => {
    setContent(content);
    resetHistory();
    if (targetId) {
      const analysis = analyzeLyrics(content);
      tryDbWrite(() =>
        updateLyric(targetId, {
          content,
          lineCount: analysis.lineCount,
          verseCount: analysis.verseCount,
          syllableCount: analysis.totalSyllables,
          wordCount: analysis.wordCount,
        })
      );
    }
  }, []);

  const restoreVersion = useCallback(
    (v: LyricVersion) => {
      applyVersionContent(lyricId, v.content);
    },
    [lyricId, applyVersionContent]
  );

  // Reload the track list („Utwory”) from the backend — active tracks only;
  // archived ones live in the separate archive section below.
  const refreshTracks = useCallback(() => {
    getAllLyrics({ limit: 100, excludeArchived: true })
      .then((rows) => setTracks(rows.map(toTrackSummary)))
      .catch(() => {});
  }, []);

  const loadArchivedTracks = useCallback(() => {
    getAllLyrics({ status: "archived", limit: 100 })
      .then((rows) => setArchivedTracks(rows.map(toTrackSummary)))
      .catch(() => {});
  }, []);

  // Display order — the sort toggle never mutates the raw `tracks` state.
  const sortedTracks = useMemo(
    () => sortTracks(tracks, sortMode, sortDirections[sortMode]),
    [tracks, sortMode, sortDirections]
  );

  // Live title search on top of the sorted order (transient — not persisted).
  const [trackQuery, setTrackQuery] = useState("");
  const visibleTracks = useMemo(
    () => filterTracks(sortedTracks, trackQuery),
    [sortedTracks, trackQuery]
  );

  // Floating „version labels” tooltip — fixed so it escapes the scroll
  // container's overflow clipping (no ancestor has a transform/filter that
  // would turn it into a containing block). Rendered inside the hovered row
  // so it stays interactive (clicking a label restores that version).
  const [versionTooltip, setVersionTooltip] = useState<{
    left: number;
    top: number;
    trackId: string;
    labels: string[];
  } | null>(null);

  // If the hovered row leaves the visible set (deleted, or filtered out by
  // the search), its onMouseLeave never fires — clear the tooltip eagerly.
  useEffect(() => {
    setVersionTooltip(null);
  }, [visibleTracks]);

  // Ensure the current title/content is persisted in the DB; returns the
  // lyric id (creating the row on first save). Shared by save + export.
  const persistLyric = useCallback(async (): Promise<string | null> => {
    const versionTitle = title.trim() || "Bez tytułu";
    const analysis = analyzeLyrics(content);
    if (lyricId) {
      await updateLyric(lyricId, {
        title: versionTitle,
        content,
        lineCount: analysis.lineCount,
        verseCount: analysis.verseCount,
        syllableCount: analysis.totalSyllables,
        wordCount: analysis.wordCount,
      });
      return lyricId;
    }
    const created = await createLyric({
      title: versionTitle,
      content,
      lineCount: analysis.lineCount,
      verseCount: analysis.verseCount,
      syllableCount: analysis.totalSyllables,
      wordCount: analysis.wordCount,
    });
    setLyricId(created.id);
    saveCache(CURRENT_KEY, created.id);
    return created.id;
  }, [content, title, lyricId]);

  // Persist the outgoing track's unsaved edits before switching (or create a
  // track from a fresh unsaved document). Shared by loadTrack + switchTrack.
  const persistOutgoingIfNeeded = useCallback(async (): Promise<void> => {
    const hasUnsaved =
      !!content.trim() || (!!title.trim() && title.trim() !== "Bez tytułu");
    if (lyricId || hasUnsaved) {
      try {
        await persistLyric();
      } catch {
        /* offline — keep the local copy */
      }
    }
  }, [content, title, lyricId, persistLyric]);

  const saveVersion = useCallback(async () => {
    if (!content.trim()) return;
    const versionTitle = title.trim() || "Bez tytułu";
    const label = `${versionTitle} - ${new Date().toLocaleString("pl-PL")}`;
    const tempId = `v${Date.now()}`;
    // Optimistic local add (the mirror keeps the Studio teleprompter in sync).
    setVersions((prev) => [{
      id: tempId, content,
      label,
      timestamp: new Date().toISOString(),
    }, ...prev]);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
    showToast("💾 Zapisano wersję w The Vault");

    // Persist to the backend; swap the temp id for the real DB id on success.
    let savedId: string | null = null;
    const ok = await tryDbWrite(async () => {
      const id = await persistLyric();
      if (!id) throw new Error("lyric not persisted");
      savedId = id;
      const row = await saveLyricVersion({ lyricId: id, content, label });
      setVersions((prev) =>
        prev.map((v) => (v.id === tempId ? { ...v, id: row.id, dbId: row.id } : v))
      );
    });
    if (ok) {
      // Re-fetch so the server-side cap enforcement (oldest version archived
      // past the limit) is reflected in the panel.
      if (savedId) await refreshVersions(savedId);
      refreshTracks();
    } else {
      showToast("⚠️ Baza danych niedostępna — wersja zapisana lokalnie", "info");
    }
  }, [content, title, persistLyric, refreshVersions, refreshTracks, showToast]);

  // ── Track („Utwory”) management ──────────────────────────────────────────
  const loadTrack = useCallback(
    async (targetId: string, opts?: { skipPersist?: boolean }): Promise<boolean> => {
      const full = await getLyric(targetId).catch(() => null);
      if (!full) {
        showToast("⚠️ Nie udało się otworzyć utworu (baza danych niedostępna)", "info");
        return false;
      }
      // Preserve unsaved edits of the outgoing track before switching.
      if (!opts?.skipPersist) await persistOutgoingIfNeeded();
      setLyricId(full.id);
      setTitle(full.title);
      setContent(full.content);
      resetHistory();
      setVersions(
        (full.versions ?? [])
          .map((v): LyricVersion => ({
            id: v.id,
            dbId: v.id,
            content: v.content,
            label: v.label || "Wersja robocza",
            timestamp: new Date(v.createdAt).toISOString(),
            archived: !!v.archivedAt,
          }))
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      );
      saveCache(CURRENT_KEY, full.id);
      showToast(`🎼 Otworzono: ${full.title}`);
      return true;
    },
    [persistOutgoingIfNeeded, showToast]
  );

  /** Switch to another track, or `null` for a fresh (unsaved) document. */
  const switchTrack = useCallback(
    async (targetId: string | null) => {
      if (targetId === lyricId) return;
      if (!targetId) {
        await persistOutgoingIfNeeded();
        setLyricId(null);
        setTitle("Bez tytułu");
        setContent("");
        resetHistory();
        setVersions([]);
        saveCache(CURRENT_KEY, "");
        showToast("✍️ Nowy utwór — zacznij pisać");
        refreshTracks();
        return;
      }
      await loadTrack(targetId);
      refreshTracks();
    },
    [lyricId, persistOutgoingIfNeeded, loadTrack, refreshTracks, showToast]
  );

  // Track deletion — styled ConfirmDialog instead of window.confirm.
  const [deleteTarget, setDeleteTarget] = useState<TrackSummary | null>(null);

  const confirmDeleteTrack = useCallback(async () => {
    if (!deleteTarget) return;
    const { id, title: trackTitle } = deleteTarget;
    const ok = await tryDbWrite(() => deleteLyric(id));
    if (!ok) {
      showToast("⚠️ Nie udało się usunąć utworu (baza danych niedostępna)", "info");
      setDeleteTarget(null);
      return;
    }
    if (id === lyricId) {
      // Use the display order so the editor opens the track shown right
      // below the deleted row (respects the active sort toggle).
      const rest = sortedTracks.filter((t) => t.id !== id);
      const clearEditor = () => {
        setLyricId(null);
        setTitle("Bez tytułu");
        setContent("");
        resetHistory();
        setVersions([]);
        saveCache(CURRENT_KEY, "");
      };
      if (rest.length > 0) {
        const opened = await loadTrack(rest[0].id, { skipPersist: true });
        // If opening the next track fails, don't leave the editor pointing
        // at the just-deleted row — fall back to a fresh document.
        if (!opened) clearEditor();
      } else {
        clearEditor();
      }
    }
    refreshTracks();
    loadArchivedTracks();
    setDeleteTarget(null);
    setDeletePermanent(false);
    showToast(`🗑️ Usunięto utwór: ${trackTitle}`, "info");
  }, [deleteTarget, lyricId, sortedTracks, loadTrack, refreshTracks, loadArchivedTracks, showToast]);

  // True when the delete confirmation was triggered from the archive (the
  // „Usuń na stałe” variant — the row is already hidden from the working list).
  const [deletePermanent, setDeletePermanent] = useState(false);

  // ── Publish / unpublish (status="published" + isPublic + /feed?shared=) ──
  const togglePublish = useCallback(
    async (t: TrackSummary) => {
      try {
        if (t.status === "published") {
          await unpublishLyric(t.id);
          showToast(`↩️ Cofnięto publikację: ${t.title}`, "info");
        } else {
          await publishLyric(t.id);
          showToast(`📢 Opublikowano: ${t.title} — /feed?shared=${t.id}`, "info");
        }
      } catch {
        showToast("⚠️ Nie udało się zaktualizować publikacji", "info");
        return;
      }
      refreshTracks();
    },
    [refreshTracks, showToast]
  );

  // ── Track archive (Lyric.status = "archived") ─────────────────────────
  const archiveTrack = useCallback(
    async (t: TrackSummary) => {
      // Optimistic: move the row into the archive section immediately.
      setTracks((prev) => prev.filter((x) => x.id !== t.id));
      setArchivedTracks((prev) => [t, ...prev]);
      const ok = await tryDbWrite(() => updateLyric(t.id, { status: "archived" }));
      if (!ok) {
        setTracks((prev) => [t, ...prev]);
        setArchivedTracks((prev) => prev.filter((x) => x.id !== t.id));
        showToast("⚠️ Nie udało się zarchiwizować utworu (baza danych niedostępna)", "info");
        return;
      }
      if (t.id === lyricId) {
        // Open the track shown right below the archived row (respects the
        // active sort), same as deletion — fall back to a fresh document.
        const rest = sortedTracks.filter((x) => x.id !== t.id);
        const clearEditor = () => {
          setLyricId(null);
          setTitle("Bez tytułu");
          setContent("");
          setVersions([]);
          saveCache(CURRENT_KEY, "");
        };
        if (rest.length > 0) {
          const opened = await loadTrack(rest[0].id, { skipPersist: true });
          if (!opened) clearEditor();
        } else {
          clearEditor();
        }
      }
      showToast(`📦 Zarchiwizowano utwór: ${t.title}`, "info");
    },
    [lyricId, sortedTracks, loadTrack, showToast]
  );

  const restoreTrack = useCallback(
    async (t: TrackSummary) => {
      // Optimistic: move the row back into the working list.
      setArchivedTracks((prev) => prev.filter((x) => x.id !== t.id));
      setTracks((prev) => [t, ...prev]);
      const ok = await tryDbWrite(() => updateLyric(t.id, { status: "draft" }));
      if (!ok) {
        setArchivedTracks((prev) => [t, ...prev]);
        setTracks((prev) => prev.filter((x) => x.id !== t.id));
        showToast("⚠️ Nie udało się przywrócić utworu (baza danych niedostępna)", "info");
        return;
      }
      showToast(`↩️ Przywrócono utwór: ${t.title}`);
    },
    [showToast]
  );

  // Clicking a label in the „Utwory” tooltip restores that version in the
  // editor, switching to the track first if needed. Inlined instead of
  // reusing restoreVersion because that callback's `lyricId` closure would
  // be stale after the awaited loadTrack; lyricIdRef stays live, and the
  // DB row updated is the tooltip's trackId explicitly.
  const restoreVersionFromTooltip = useCallback(
    async (trackId: string, label: string) => {
      setVersionTooltip(null);
      const full = await getLyric(trackId).catch(() => null);
      if (!full) {
        showToast("⚠️ Nie udało się wczytać wersji (baza danych niedostępna)", "info");
        return;
      }
      const v = (full.versions ?? []).find((x) => x.label === label);
      if (!v) {
        showToast("⚠️ Nie znaleziono wersji (lista mogła się zmienić)", "info");
        return;
      }
      // Bring the editor to that track (persisting outgoing edits first).
      if (trackId !== lyricIdRef.current) {
        const opened = await loadTrack(trackId);
        if (!opened) return;
      }
      applyVersionContent(trackId, v.content);
      showToast(`↩️ Przywrócono wersję: ${label}`);
    },
    [loadTrack, applyVersionContent, showToast]
  );

  // ── Inline track rename (Utwory) ────────────────────────────────────────
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  // Live mirror so a commit fired by blur can't target a track the user
  // already left (e.g. Esc pressed first).
  const renamingIdRef = useRef<string | null>(null);
  renamingIdRef.current = renamingId;

  const startRename = useCallback((t: TrackSummary) => {
    setRenamingId(t.id);
    setRenameValue(t.title);
    // Focus + select the current name so the user can type over it.
    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, []);

  const commitRename = useCallback(async () => {
    const id = renamingIdRef.current;
    renamingIdRef.current = null; // Guard: a blur after Enter/Esc in the same tick must no-op.
    if (!id) return;
    const old = tracks.find((t) => t.id === id);
    const newTitle = renameValue.trim();
    setRenamingId(null);
    if (!old || !newTitle || newTitle === old.title) return;
    // Optimistic update; revert if the backend is unavailable.
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, title: newTitle } : t)));
    if (id === lyricId) setTitle(newTitle);
    const ok = await tryDbWrite(() => updateLyric(id, { title: newTitle }));
    if (!ok) {
      setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, title: old.title } : t)));
      if (id === lyricId) setTitle(old.title);
      showToast("⚠️ Nie udało się zmienić nazwy (baza danych niedostępna)", "info");
      return;
    }
    showToast(`✏️ Zmieniono nazwę na: „${newTitle}”`);
  }, [tracks, renameValue, lyricId, showToast]);

  // ── Export (DB-backed via exportLyricAsText, with an offline fallback) ──
  const [exportHistory, setExportHistory] = useState<ExportLogRow[]>([]);

  const refreshExportHistory = useCallback(() => {
    const targetId = lyricId;
    if (!targetId) {
      setExportHistory([]);
      return;
    }
    // Guard against a stale list landing after lyricId changed mid-flight.
    getExportHistory(targetId)
      .then((rows) => {
        if (lyricIdRef.current === targetId) setExportHistory(rows);
      })
      .catch(() => {});
  }, [lyricId]);

  // Live mirror of the current lyric id, used to drop stale history fetches.
  const lyricIdRef = useRef<string | null>(null);
  lyricIdRef.current = lyricId;

  // Load the export history once the lyric id resolves (mount sync / first save).
  useEffect(() => {
    refreshExportHistory();
  }, [refreshExportHistory]);

  // ── Print / PDF export: portaled „karta tekstu” + window.print() ──
  const [printData, setPrintData] = useState<{
    title: string;
    date: string;
    content: string;
    lineCount: number;
    verseCount: number;
    syllableCount: number;
    wordCount: number;
    bpm: number | null;
  } | null>(null);

  const clearHistory = useCallback(async () => {
    if (!lyricId) return;
    try {
      await clearExportHistory(lyricId);
      setExportHistory([]);
      showToast("🧹 Historia eksportów wyczyszczona", "info");
    } catch {
      showToast("⚠️ Nie udało się wyczyścić historii", "info");
    }
  }, [lyricId, showToast]);

  const handleExportPdf = useCallback(async () => {
    if (!content.trim()) {
      showToast("✍️ Najpierw napisz tekst do wyeksportowania", "info");
      return;
    }
    const versionTitle = title.trim() || "Bez tytułu";
    try {
      // Make sure the DB row reflects the current content, then pull the
      // printable data (this also records the ExportLog „pdf” entry).
      const id = await persistLyric();
      if (!id) throw new Error("no lyric in DB");
      const pdf = await exportLyricAsPdf(id);
      setPrintData({
        title: pdf.title,
        date: pdf.date,
        content: pdf.content,
        lineCount: pdf.lineCount,
        verseCount: pdf.verseCount,
        syllableCount: pdf.syllableCount,
        wordCount: pdf.wordCount,
        bpm: pdf.bpm,
      });
    } catch {
      // DB unavailable — render the print view from the local copy.
      const analysis = analyzeLyrics(content);
      setPrintData({
        title: versionTitle,
        date: new Date().toLocaleDateString("pl-PL"),
        content,
        lineCount: analysis.lineCount,
        verseCount: analysis.verseCount,
        syllableCount: analysis.totalSyllables,
        wordCount: analysis.wordCount,
        bpm: null,
      });
    }
    // Let the portal render, then open the browser print dialog („Zapisz
    // jako PDF” is the default target in most browsers).
    requestAnimationFrame(() => {
      setTimeout(() => window.print(), 60);
    });
    showToast("🖨️ Otwieram widok wydruku — wybierz „Zapisz jako PDF”", "info");
    refreshExportHistory();
  }, [content, title, persistLyric, showToast, refreshExportHistory]);

  const handleExport = useCallback(async () => {
    if (!content.trim()) {
      showToast("✍️ Najpierw napisz tekst do wyeksportowania", "info");
      return;
    }
    const versionTitle = title.trim() || "Bez tytułu";
    const safeName = (versionTitle.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 60) || "utwor");
    const download = (text: string) => {
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeName}.txt`;
      // Appending to the DOM makes the click work across all browsers
      // (detached anchors can silently fail in Firefox).
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    try {
      // Make sure the DB row reflects the current content, then export server-side
      // (this also records the ExportLog entry shown in the history panel).
      const id = await persistLyric();
      if (!id) throw new Error("no lyric in DB");
      const text = await exportLyricAsText(id);
      download(text);
      showToast("📤 Wyeksportowano tekst");
      refreshExportHistory();
    } catch {
      // DB unavailable — still let the user export the current content.
      const analysis = analyzeLyrics(content);
      download(
        buildExportText({
          title: versionTitle,
          content,
          lineCount: analysis.lineCount,
          verseCount: analysis.verseCount,
          syllableCount: analysis.totalSyllables,
          wordCount: analysis.wordCount,
        })
      );
      showToast("📤 Wyeksportowano lokalnie (baza danych niedostępna)", "info");
    }
  }, [content, title, persistLyric, showToast, refreshExportHistory]);

  const insertText = useCallback((text: string) => {
    if (!textareaRef.current) return;
    const ta = textareaRef.current;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    // Programmatic insertion = an INDEPENDENT history transaction, so a
    // single Ctrl+Z right after „Losuj Iskrę” removes exactly this text.
    const current = contentRef.current;
    updateContent(current.substring(0, start) + text + current.substring(end), "programmatic");
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const newPos = start + text.length;
        textareaRef.current.setSelectionRange(newPos, newPos);
      }
    });
  }, [updateContent]);

  return (
    <AppShell>
      {/* Toast notification — shared component driven by the useToast hook */}
      <ToastView toast={toast} />
      {/* Print view for the PDF export — portaled to <body> so @media print
          can hide everything else and leave exactly this „karta tekstu”. */}
      {printData &&
        createPortal(
          <div id="print-area">
            <div className="print-card">
              <div className="print-meta">
                <span>FlowForge</span>
                <span>{printData.date}</span>
              </div>
              <h1>{printData.title}</h1>
              <div className="print-stats">
                <span>Linie: {printData.lineCount}</span>
                <span>Zwrotki: {printData.verseCount}</span>
                <span>Sylaby: {printData.syllableCount}</span>
                <span>Słowa: {printData.wordCount}</span>
                {printData.bpm != null && <span>BPM: {printData.bpm}</span>}
              </div>
              <pre>{printData.content}</pre>
              <div className="print-footer">Wygenerowano przez FlowForge</div>
            </div>
          </div>,
          document.body
        )}
      {/* Track deletion confirmation — styled modal (matches the Studio). */}
      <ConfirmDialog
        open={!!deleteTarget}
        title={deletePermanent ? "Usuń na stałe" : "Usuń utwór"}
        description={
          deleteTarget
            ? deletePermanent
              ? `Utwór „${deleteTarget.title}” jest w archiwum. Usunięcie go na stałe skasuje także wszystkie wersje — tej operacji nie można cofnąć.`
              : `Czy na pewno usunąć „${deleteTarget.title}” wraz z wersjami? Tej operacji nie można cofnąć.`
            : undefined
        }
        confirmLabel={deletePermanent ? "Usuń na stałe" : "Usuń"}
        tone="danger"
        onCancel={() => {
          setDeleteTarget(null);
          setDeletePermanent(false);
        }}
        onConfirm={confirmDeleteTrack}
      />
      <div className="space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center">
              <span className="text-lg">📝</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">The Vault</h1>
              <p className="text-sm text-zinc-400">Notatnik Rymów • Twój kreatywny warsztat</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleExport} title="Wyeksportuj tekst do pliku .txt"
              className="px-4 py-2 rounded-xl text-sm font-medium transition-all bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white">
              📤 Eksportuj TXT
            </button>
            <button onClick={handleExportPdf} title="Wyeksportuj tekst jako PDF (widok wydruku)"
              className="px-4 py-2 rounded-xl text-sm font-medium transition-all bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white">
              📄 Eksportuj PDF
            </button>
            <button onClick={saveVersion}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${saveSuccess ? "bg-green-500/20 text-green-400 border border-green-500/40" : "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"}`}>
              {saveSuccess ? "✓ Zapisano!" : "💾 Zapisz Wersję"}
            </button>
          </div>
        </div>

        {/* Title */}
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nazwa utworu..."
          className="w-full px-4 py-3 rounded-xl bg-zinc-900 border border-zinc-800 text-white text-lg font-semibold placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all" />

        {/* Tabs — tylko Edytor + Wersje (bez zakładki „Narzędzia”) */}
        <div role="tablist" aria-label="Sekcje The Vault" className="flex gap-1 p-1 rounded-xl bg-zinc-900 border border-zinc-800">
          {VAULT_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`vault-tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-controls={`vault-panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === tab.id ? "bg-amber-500/15 text-amber-500" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "editor" && (
          <div role="tabpanel" id="vault-panel-editor" aria-labelledby="vault-tab-editor" className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 space-y-4">
              {/* Quick Toggles - at the top, always visible */}
              <div className="sticky top-0 z-10 bg-zinc-950/80 backdrop-blur-sm p-2 rounded-xl border border-zinc-800 flex items-center gap-2">
                <button type="button" onClick={toggleRhymeAnalysis}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${rhymeAnalysisActive ? "bg-amber-500/20 text-amber-400 border border-amber-500/40" : "bg-zinc-800 text-zinc-400 border border-transparent hover:text-zinc-200 hover:bg-zinc-700"}`}>
                  🎨 Analiza Rymów {rhymeAnalysisActive ? "✓" : ""}
                </button>
                <button type="button" onClick={() => setMetronomeActive((p) => !p)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${metronomeActive ? "bg-amber-500/20 text-amber-400 border border-amber-500/40" : "bg-zinc-800 text-zinc-400 border border-transparent hover:text-zinc-200 hover:bg-zinc-700"}`}>
                  🥁 Metronom {metronomeActive ? "✓" : ""}
                </button>
                <button type="button" onClick={() => setWriterBlockActive((p) => !p)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${writerBlockActive ? "bg-amber-500/20 text-amber-400 border border-amber-500/40" : "bg-zinc-800 text-zinc-400 border border-transparent hover:text-zinc-200 hover:bg-zinc-700"}`}>
                  💡 Blokada Twórcza {writerBlockActive ? "✓" : ""}
                </button>
                <button type="button" onClick={() => setMoodboardActive((p) => !p)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${moodboardActive ? "bg-amber-500/20 text-amber-400 border border-amber-500/40" : "bg-zinc-800 text-zinc-400 border border-transparent hover:text-zinc-200 hover:bg-zinc-700"}`}>
                  🖼️ Moodboard {moodboardActive ? "✓" : ""}
                </button>
                <button type="button" onClick={() => setFlowMeterActive((p) => !p)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${flowMeterActive ? "bg-amber-500/20 text-amber-400 border border-amber-500/40" : "bg-zinc-800 text-zinc-400 border border-transparent hover:text-zinc-200 hover:bg-zinc-700"}`}>
                  📊 Flow Meter {flowMeterActive ? "✓" : ""}
                </button>
                <button type="button" onClick={() => setReleasePlannerActive((p) => !p)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${releasePlannerActive ? "bg-amber-500/20 text-amber-400 border border-amber-500/40" : "bg-zinc-800 text-zinc-400 border border-transparent hover:text-zinc-200 hover:bg-zinc-700"}`}>
                  📅 Release Plan {releasePlannerActive ? "✓" : ""}
                </button>
              </div>

              {/* Tool Panels */}
              {metronomeActive && <MetronomePanel />}
              {writerBlockActive && <WriterBlockPanel content={content} onInsert={insertText} />}
              {moodboardActive && <MoodboardPanel />}
              {flowMeterActive && <FlowMeterPanel content={content} rhymeGroups={rhymeAnalysisActive ? rhymeGroups : undefined} />}
              {releasePlannerActive && <ReleasePlannerPanel />}

              {/* EDITOR WITH RHYME MARKERS */}
              <div className="rounded-xl bg-zinc-900 border border-zinc-800 overflow-hidden">
                {rhymeAnalysisActive ? (
                  <RhymeMarkersOverlay
                    lines={editorLines}
                    groups={rhymeGroups}
                    hits={rhymeHits}
                    textareaRef={textareaRef}
                  >
                    <textarea
                      ref={textareaRef}
                      value={content}
                      onChange={(e) => updateContent(e.target.value, "typing")}
                      onKeyDown={handleEditorKeyDown}
                      onMouseUp={handleMouseUp}
                      spellCheck={false}
                      placeholder={"Zacznij pisać swój tekst tutaj...\n\nKażda linia to nowy wers.\nPuste linie oddzielają zwrotki."}
                      className="w-full h-[400px] lg:h-[500px] block font-mono text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:outline-none resize-none p-4 bg-transparent"
                    />
                  </RhymeMarkersOverlay>
                ) : (
                  <textarea
                    ref={textareaRef}
                    value={content}
                    onChange={(e) => updateContent(e.target.value, "typing")}
                    onKeyDown={handleEditorKeyDown}
                    onMouseUp={handleMouseUp}
                    spellCheck={false}
                    placeholder={"Zacznij pisać swój tekst tutaj...\n\nKażda linia to nowy wers.\nPuste linie oddzielają zwrotki."}
                    className="w-full h-[400px] lg:h-[500px] block font-mono text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:outline-none resize-none p-4 bg-transparent"
                  />
                )}
              </div>

              {/* Stats */}
              <div className="flex items-center gap-4 text-xs text-zinc-500 flex-wrap">
                <span>📝 {analysis.lineCount} wersów</span>
                <span>📖 {analysis.verseCount} zwrotek</span>
                <span>🔤 {analysis.totalSyllables} sylab</span>
                <span>💬 {content.split(/\s+/).filter(Boolean).length} słów</span>
                {rhymeAnalysisActive && rhymeGroupCount > 0 && (
                  <span className="text-amber-500 font-medium">🎨 {rhymeGroupCount} grup rymów</span>
                )}
              </div>
            </div>

            {/* Side Panel */}
            <div className="space-y-4">
              {/* Utwory — track list backed by getAllLyrics */}
              <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <span>🎼</span> Utwory
                  </h3>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setShowArchive((s) => !s)}
                      className={`px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                        showArchive
                          ? "bg-zinc-700/60 text-amber-400 border border-amber-500/30"
                          : "bg-zinc-800/60 text-zinc-400 border border-transparent hover:text-amber-400 hover:bg-zinc-800"
                      }`}
                      title="Zarchiwizowane utwory — ukryte z listy roboczej"
                    >
                      📦 Archiwum ({archivedTracks.length})
                    </button>
                    <button
                      onClick={() => switchTrack(null)}
                      className="px-2 py-1 rounded-lg bg-amber-500/10 text-amber-500 text-[10px] font-medium hover:bg-amber-500/20 transition-colors"
                      title="Rozpocznij nowy, niezapisany utwór"
                    >
                      ＋ Nowy
                    </button>
                  </div>
                </div>
                {showArchive ? (
                  <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                    {archivedTracks.length > 0 ? (
                      archivedTracks.map((t) => (
                        <div
                          key={t.id}
                          className="group flex items-center gap-2 px-2.5 py-2 rounded-lg bg-zinc-800/30 border border-zinc-700/30"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-zinc-400 truncate flex items-center gap-1.5">
                              <span className="text-zinc-600">📦</span>
                              {t.title}
                            </p>
                            <p className="text-[10px] text-zinc-600 truncate">
                              {t.lineCount} wersów • {t.wordCount} słów • {t.syllableCount} sylab • {t.versionCount} wersji
                            </p>
                          </div>
                          <button
                            onClick={() => restoreTrack(t)}
                            className="w-6 h-6 rounded-lg text-zinc-500 text-xs flex items-center justify-center hover:text-emerald-400 transition-colors shrink-0"
                            title="Przywróć utwór"
                          >
                            ↩️
                          </button>
                          <button
                            onClick={() => {
                              setDeleteTarget(t);
                              setDeletePermanent(true);
                            }}
                            className="w-6 h-6 rounded-lg text-zinc-600 text-xs flex items-center justify-center hover:text-red-400 transition-colors shrink-0"
                            title="Usuń na stałe"
                          >
                            🗑️
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-zinc-600 text-center py-3">
                        Archiwum jest puste — zarchiwizowane utwory pojawią się tutaj
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                {/* Search — quick find across titles (diacritic-insensitive) */}
                <div className="relative mb-2">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-zinc-500 pointer-events-none">
                    🔍
                  </span>
                  <input
                    type="text"
                    aria-label="Szukaj utworu"
                    value={trackQuery}
                    onChange={(e) => setTrackQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setTrackQuery("");
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    placeholder="Szukaj utworu..."
                    className="w-full pl-7 pr-7 py-1.5 rounded-lg bg-zinc-800/60 border border-zinc-700/60 text-[11px] text-white placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500/50 transition-all"
                  />
                  {trackQuery && (
                    <button
                      onClick={() => setTrackQuery("")}
                      title="Wyczyść wyszukiwanie"
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full text-[9px] text-zinc-500 hover:text-white hover:bg-zinc-700 flex items-center justify-center transition-colors"
                    >
                      ✕
                    </button>
                  )}
                </div>
                {/* Sort toggle — mode + per-mode direction, remembered via localStorage */}
                <div className="flex items-center gap-1 mb-3 flex-wrap">
                  {SORT_MODES.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setSortMode(m.id)}
                      title={`Sortuj wg: ${m.label}`}
                      className={`px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                        sortMode === m.id
                          ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                          : "bg-zinc-800/60 text-zinc-500 border border-transparent hover:text-zinc-300 hover:bg-zinc-800"
                      }`}
                    >
                      {m.icon} {m.label}
                    </button>
                  ))}
                  <button
                    onClick={() =>
                      setSortDirections((prev) => ({
                        ...prev,
                        [sortMode]: prev[sortMode] === "asc" ? "desc" : "asc",
                      }))
                    }
                    title={`Kierunek: ${sortDirections[sortMode] === "asc" ? "rosnąco (↑)" : "malejąco (↓)"}`}
                    className="px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ml-auto bg-zinc-800/60 text-zinc-400 border border-transparent hover:text-amber-400 hover:bg-zinc-800"
                  >
                    {sortDirections[sortMode] === "asc" ? "↑ Rosnąco" : "↓ Malejąco"}
                  </button>
                </div>
                {trackQuery.trim() && visibleTracks.length === 0 ? (
                  <p className="text-xs text-zinc-600 text-center py-3">
                    Brak wyników dla „{trackQuery.trim()}”
                  </p>
                ) : visibleTracks.length > 0 ? (
                  <div
                    className="space-y-1 max-h-64 overflow-y-auto pr-1"
                    onScroll={() => setVersionTooltip(null)}
                  >
                    {visibleTracks.map((t) => {
                      const isCurrent = t.id === lyricId;
                      const showLabels = t.versionLabels.length > 0;
                      // The version whose saved content matches what the editor
                      // currently shows — highlighted in the tooltip so the user
                      // can see where they are before clicking (only meaningful
                      // for the track that is open right now).
                      const currentVersionLabel =
                        t.id === lyricId
                          ? versions.find((v) => v.content === content)?.label ?? null
                          : null;
                      return (
                        <div
                          key={t.id}
                          onMouseEnter={(e) => {
                            if (!showLabels) return;
                            const rect = e.currentTarget.getBoundingClientRect();
                            setVersionTooltip({
                              left: Math.min(Math.max(8, rect.left), window.innerWidth - 280),
                              top: Math.max(10, rect.top - 6),
                              trackId: t.id,
                              labels: t.versionLabels,
                            });
                          }}
                          onMouseLeave={() => setVersionTooltip(null)}
                          className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg transition-colors ${
                            isCurrent
                              ? "bg-amber-500/10 border border-amber-500/20"
                              : "bg-zinc-800/50 hover:bg-zinc-800 border border-transparent"
                          }`}
                        >
                          {renamingId === t.id ? (
                            <input
                              ref={renameInputRef}
                              type="text"
                              value={renameValue}
                              maxLength={60}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitRename();
                                else if (e.key === "Escape") setRenamingId(null);
                              }}
                              onBlur={commitRename}
                              placeholder="Nazwa utworu..."
                              className="flex-1 min-w-0 px-2 py-1 rounded-lg bg-zinc-800 border border-amber-500/40 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                            />
                          ) : (
                            <>
                              <button
                                onClick={() => switchTrack(t.id)}
                                disabled={isCurrent}
                                className={`flex-1 min-w-0 text-left ${isCurrent ? "cursor-default" : "cursor-pointer"}`}
                              >
                                <p className="text-xs font-medium text-white truncate flex items-center gap-1.5">
                                  {isCurrent && <span className="text-amber-400">●</span>}
                                  {t.title}
                                  {t.status === "published" && (
                                    <span className="text-[9px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-1.5 py-0.5 shrink-0">
                                      ✓ Opublikowany
                                    </span>
                                  )}
                                </p>
                                <p className="text-[10px] text-zinc-500 truncate">
                                  {t.lineCount} wersów • {t.wordCount} słów • {t.syllableCount} sylab • {t.versionCount} wersji •{" "}
                                  {new Date(t.updatedAt).toLocaleDateString("pl-PL")}
                                  {showLabels && (
                                    <span className="text-zinc-600"> • 🏷️ {t.versionLabels.length}</span>
                                  )}
                                </p>
                              </button>
                              <button
                                onClick={() => togglePublish(t)}
                                className={`w-6 h-6 rounded-lg text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shrink-0 ${
                                  t.status === "published"
                                    ? "text-emerald-400 hover:text-emerald-300"
                                    : "text-zinc-600 hover:text-emerald-400"
                                }`}
                                title={t.status === "published" ? "Cofnij publikację" : "Publikuj utwór"}
                              >
                                {t.status === "published" ? "✓" : "📤"}
                              </button>
                              <button
                                onClick={() => archiveTrack(t)}
                                className="w-6 h-6 rounded-lg text-zinc-600 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 hover:text-amber-400 transition-all shrink-0"
                                title="Archiwizuj utwór"
                              >
                                📦
                              </button>
                              <button
                                onClick={() => startRename(t)}
                                className="w-6 h-6 rounded-lg text-zinc-600 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 hover:text-amber-400 transition-all shrink-0"
                                title="Zmień nazwę"
                              >
                                ✏️
                              </button>
                              <button
                                onClick={() => setDeleteTarget(t)}
                                className="w-6 h-6 rounded-lg text-zinc-600 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all shrink-0"
                                title="Usuń utwór"
                              >
                                🗑️
                              </button>
                            </>
                          )}

                          {/* Clickable version-labels tooltip — a DOM child of the
                              row so moving onto it never triggers the row's
                              onMouseLeave (no flicker while clicking). */}
                          {versionTooltip?.trackId === t.id && (
                            <div
                              role="tooltip"
                              className="fixed z-50 w-[260px] -translate-y-full px-3 py-2 rounded-xl bg-zinc-800/95 border border-zinc-700 shadow-xl shadow-black/40 backdrop-blur-sm animate-fade-in"
                              style={{ left: versionTooltip.left, top: versionTooltip.top }}
                            >
                              <p className="text-[10px] font-medium text-zinc-500 mb-1.5 flex items-center gap-1">
                                🏷️ Wersje — kliknij, aby przywrócić:
                              </p>
                              <div className="space-y-1 max-h-32 overflow-y-auto pr-0.5">
                                {versionTooltip.labels.map((l, i) => {
                                  const isCurrentVersion = l === currentVersionLabel;
                                  return (
                                    <button
                                      key={`${l}-${i}`}
                                      onClick={() => restoreVersionFromTooltip(versionTooltip.trackId, l)}
                                      aria-label={`Przywróć wersję: ${l}`}
                                      aria-current={isCurrentVersion || undefined}
                                      className={`w-full flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] transition-colors cursor-pointer ${
                                        isCurrentVersion
                                          ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                                          : "text-zinc-300 hover:text-amber-400 hover:bg-amber-500/10 border border-transparent"
                                      }`}
                                    >
                                      <span className="shrink-0">↩️</span>
                                      <span className="flex-1 min-w-0 truncate">{l}</span>
                                      {isCurrentVersion && (
                                        <span className="shrink-0 text-[9px] font-medium text-amber-400 bg-amber-500/10 rounded-full px-1.5 py-0.5">
                                          ✓ aktualna
                                        </span>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-600 text-center py-3">
                    Brak utworów — zapisz pierwszą wersję, aby utworzyć utwór
                  </p>
                )}
                  </>
                )}
              </div>

              <RhymeAssistantPanel selectedWord={selectedWord} rhymes={rhymes} onInsert={insertText} />

              {/* Export history — fully backed by the ExportLog table */}
              <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4">
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <span>📤</span> Historia Eksportów
                  {exportHistory.length > 0 && (
                    <button
                      onClick={clearHistory}
                      className="ml-auto px-2 py-1 rounded-lg bg-zinc-800 text-zinc-400 text-[10px] font-medium hover:bg-red-500/10 hover:text-red-400 transition-colors"
                    >
                      🧹 Wyczyść historię
                    </button>
                  )}
                </h3>
                {exportHistory.length > 0 ? (
                  <div className="space-y-1.5">
                    {exportHistory.slice(0, 5).map((row) => (
                      <div key={row.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-800/50">
                        <span
                          className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${
                            row.format === "pdf"
                              ? "bg-red-500/10 text-red-400 border border-red-500/30"
                              : "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                          }`}
                        >
                          📄 {row.format.toUpperCase()}
                        </span>
                        <span className="text-[10px] text-zinc-500">
                          {new Date(row.createdAt).toLocaleString("pl-PL", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    ))}
                    {exportHistory.length > 5 && (
                      <p className="text-[10px] text-zinc-600 text-center pt-1">+{exportHistory.length - 5} więcej</p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-600 text-center py-3">Brak eksportów — wyeksportuj tekst, aby zobaczyć historię</p>
                )}
              </div>

              <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4">
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <span>📊</span> Analiza Wersów
                  {rhymeAnalysisActive && (
                    <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-medium">rymy ON</span>
                  )}
                </h3>
                
                {/* Rhyme groups legend */}
                {rhymeAnalysisActive && rhymeGroupCount > 0 && (
                  <div className="mb-3 p-2 rounded-lg bg-zinc-800/50">
                    <p className="text-[10px] text-zinc-500 mb-1.5">Wykryte grupy rymów:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {rhymeClusters?.colors.map((color, i) => (
                        <span key={i} className="flex items-center gap-1 text-[10px] text-zinc-400">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                          Grupa {i + 1}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                
                <div className="space-y-1 max-h-[300px] overflow-y-auto">
                  {panelLines.size > 0 ? (
                    editorLines.map((rawLine, idx) => {
                      const line = panelLines.get(idx);
                      // Blank lines are skipped (same as before), but the
                      // color lookup uses the RAW index so dots stay aligned
                      // with the editor overlay across stanza breaks.
                      if (!line) return null;
                      // One dot per rhyme CLUSTER present on this line (in
                      // token order) — internal rhymes get their own dots.
                      const lineHits = rhymeAnalysisActive ? (rhymeHits.get(idx) ?? []) : [];
                      const dotColors: string[] = [];
                      for (const hit of lineHits) {
                        if (!dotColors.includes(hit.color)) dotColors.push(hit.color);
                      }
                      return (
                        <div key={idx} className="flex items-center gap-2 text-xs py-1 px-2 rounded-lg hover:bg-zinc-800/50 transition-colors">
                          <span className="text-zinc-600 w-5 text-right font-mono">{idx + 1}</span>
                          {dotColors.length > 0 ? (
                            <span className="flex -space-x-1 shrink-0">
                              {dotColors.map((c) => (
                                <span
                                  key={c}
                                  data-rhyme-dot={c}
                                  className="w-3 h-3 rounded-full border border-black/40"
                                  style={{ backgroundColor: c }}
                                />
                              ))}
                            </span>
                          ) : (
                            <span className="w-3 h-3 shrink-0" />
                          )}
                          <div className="flex-1 truncate text-zinc-400">{line.text.substring(0, 35)}{line.text.length > 35 ? "..." : ""}</div>
                          <span className="text-amber-500 font-mono text-[10px]">{line.syllables}s</span>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-xs text-zinc-600 text-center py-4">Zacznij pisać...</p>
                  )}
                </div>
              </div>

              {selectedWord && (
                <div className="rounded-xl bg-zinc-900 border border-amber-500/30 p-4">
                  <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                    <span>🔍</span> Analiza: &ldquo;{selectedWord}&rdquo;
                  </h3>
                  <div className="flex flex-wrap gap-1">
                    {countWordSyllablesInLine(selectedWord).map((w, i) => (
                      <span key={i} className="px-2 py-1 rounded-lg bg-amber-500/10 text-amber-500 text-xs font-mono">
                        {w.word} ({w.syllables} {w.syllables === 1 ? "sylaba" : "sylab"})
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "versions" && (
          <div role="tabpanel" id="vault-panel-versions" aria-labelledby="vault-tab-versions">
            <VersionsPanel
              versions={versions}
              onRestore={restoreVersion}
              onDelete={deleteVersion}
              onArchive={archiveVersion}
              onRestoreArchived={restoreArchivedVersion}
              onPurgeArchive={purgeArchived}
              maxActive={MAX_ACTIVE_VERSIONS_PER_LYRIC}
            />
          </div>
        )}

      </div>
    </AppShell>
  );
}

// ─── Sub-Components ───────────────────────────────────────────────────

/** Fisher–Yates shuffle (unbiased — unlike `sort(() => 0.5 - Math.random())`). */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Moods whose keyword pool intersects the spark's text (auto-tagging). */
function sparkMoodAffinity(spark: string, moods: Record<string, string[]>): string[] {
  const lower = spark.toLowerCase();
  return Object.entries(moods)
    .filter(([, words]) => words.some((w) => lower.includes(w)))
    .map(([name]) => name);
}

interface ActiveSpark {
  text: string;
  /** Chip label — the source category or the klimat it was tailored to. */
  label: string;
}

function WriterBlockPanel({ content, onInsert }: { content: string; onInsert: (text: string) => void }) {
  const [activeSpark, setActiveSpark] = useState<ActiveSpark | null>(null);
  const [activeMoods, setActiveMoods] = useState<string[]>([]);
  // Brief glow pulse on the klimat section after „Losuj Klimat”.
  const [klimatFlash, setKlimatFlash] = useState(false);
  const klimatTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (klimatTimerRef.current !== null) window.clearTimeout(klimatTimerRef.current);
    };
  }, []);

  // Context-aware draw: with a klimat active, 45% of rolls synthesize a fresh
  // prompt from a klimat template + a mood keyword; otherwise sparks whose
  // auto-detected mood affinity matches the klimat are preferred; falls back
  // to the full categorized pool.
  const rollSparkFor = useCallback((klimat: string[]): ActiveSpark => {
    const allSparks = SPARK_CATEGORIES.flatMap((c) =>
      c.sparks.map((s) => ({ text: s, label: c.label }))
    );
    const klimatWords = klimat.flatMap((m) => MOOD_KEYWORDS[m as keyof typeof MOOD_KEYWORDS] ?? []);

    if (klimat.length > 0 && klimatWords.length > 0 && Math.random() < 0.45) {
      const tpl = KLIMAT_TEMPLATES[Math.floor(Math.random() * KLIMAT_TEMPLATES.length)];
      const word = klimatWords[Math.floor(Math.random() * klimatWords.length)];
      return { text: tpl.replaceAll("{word}", word), label: `🎭 Klimat: ${klimat.join(" + ")}` };
    }

    if (klimat.length > 0) {
      const matching = allSparks.filter((s) =>
        sparkMoodAffinity(s.text, MOOD_KEYWORDS).some((m) => klimat.includes(m))
      );
      if (matching.length > 0) {
        return matching[Math.floor(Math.random() * matching.length)];
      }
    }
    return allSparks[Math.floor(Math.random() * allSparks.length)];
  }, []);

  const rollSpark = useCallback(() => {
    setActiveSpark(rollSparkFor(activeMoods));
  }, [activeMoods, rollSparkFor]);

  // Pick 1–3 random moods, flash the vibe section and roll a spark tailored
  // to the NEW klimat in one motion — the workspace shifts direction.
  const rollKlimat = useCallback(() => {
    const names = Object.keys(MOOD_KEYWORDS);
    const picked = shuffle(names).slice(0, 1 + Math.floor(Math.random() * 2));
    setActiveMoods(picked);
    setActiveSpark(rollSparkFor(picked));
    setKlimatFlash(true);
    if (klimatTimerRef.current !== null) window.clearTimeout(klimatTimerRef.current);
    klimatTimerRef.current = window.setTimeout(() => setKlimatFlash(false), 650);
  }, [rollSparkFor]);

  const toggleMood = useCallback((mood: string) => {
    setActiveMoods((prev) => (prev.includes(mood) ? prev.filter((m) => m !== mood) : [...prev, mood]));
  }, []);

  // Deterministic per klimat (re-shuffling per render would make the words
  // jump while the user types in the editor). Merged pool of all active moods.
  const moodWords = useMemo(() => {
    if (activeMoods.length === 0) return [];
    const merged = [...new Set(activeMoods.flatMap((m) => MOOD_KEYWORDS[m as keyof typeof MOOD_KEYWORDS] ?? []))];
    return shuffle([...merged]).slice(0, 6);
  }, [activeMoods]);

  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-5">
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-medium text-zinc-400 flex items-center gap-1"><span>✨</span> Iskra Inspiracji</h4>
          <button data-roll-spark onClick={rollSpark} className="px-2.5 py-1 rounded-lg bg-gradient-to-r from-purple-500/20 to-amber-500/20 text-[10px] font-medium text-white hover:from-purple-500/30 hover:to-amber-500/30 transition-all active:scale-95">
            🎲 Losuj Iskrę
          </button>
        </div>
        {activeSpark ? (
          <button data-spark-card onClick={() => onInsert(activeSpark.text)} className="w-full text-left p-3 rounded-xl bg-gradient-to-br from-purple-500/10 to-amber-500/10 border border-purple-500/20 hover:border-purple-500/40 transition-all group">
            <p className="text-[10px] text-zinc-500 mb-1">{activeSpark.label}</p>
            <p className="text-sm text-zinc-200 group-hover:text-white transition-colors leading-relaxed">&ldquo;{activeSpark.text}&rdquo;</p>
            <p className="text-[10px] text-zinc-500 mt-2 group-hover:text-amber-500 transition-colors">↵ Kliknij, aby wstawić</p>
          </button>
        ) : (
          <button data-roll-spark onClick={rollSpark} className="w-full p-4 rounded-xl border border-dashed border-zinc-700 hover:border-purple-500/40 text-zinc-500 hover:text-zinc-300 transition-all text-sm">
            Kliknij &ldquo;Losuj Iskrę&rdquo; aby rozpocząć
          </button>
        )}
      </div>

      <div className={klimatFlash ? "rounded-xl ring-2 ring-amber-500/40 animate-[pulse_0.6s_ease-in-out] transition-shadow" : "rounded-xl transition-shadow"}>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-medium text-zinc-400 flex items-center gap-1"><span>🎭</span> Nastrój & Klimat</h4>
          <button data-roll-klimat onClick={rollKlimat} className="px-2.5 py-1 rounded-lg bg-gradient-to-r from-amber-500/20 to-rose-500/20 text-[10px] font-medium text-white hover:from-amber-500/30 hover:to-rose-500/30 transition-all active:scale-95">
            🎲 Losuj Klimat
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {Object.keys(MOOD_KEYWORDS).map((mood) => {
            const active = activeMoods.includes(mood);
            return (
              <button
                key={mood}
                data-mood-tag={mood}
                data-mood-active={active ? "true" : "false"}
                onClick={() => toggleMood(mood)}
                className={`px-2.5 py-2 rounded-lg text-[11px] font-medium transition-all ${active
                  ? "bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-[0_0_10px_rgba(245,158,11,0.45)]"
                  : "bg-zinc-800 text-zinc-400 border border-transparent hover:text-zinc-200 hover:bg-zinc-700"}`}
              >
                {mood}
              </button>
            );
          })}
        </div>
        {activeMoods.length > 0 && (
          <div className="mt-2 p-3 rounded-xl bg-zinc-800 border border-zinc-700">
            <p className="text-[10px] text-zinc-500 mb-2">Słowa: <span className="text-amber-400">{activeMoods.join(" + ")}</span></p>
            <div className="flex flex-wrap gap-1.5">
              {moodWords.map((word, i) => (
                <button key={`${word}-${i}`} data-klimat-word onClick={() => onInsert(` ${word}`)} className="px-2 py-1 rounded-lg bg-zinc-700 hover:bg-amber-500/10 text-[11px] text-zinc-300 hover:text-amber-400 transition-all">
                  {word}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MetronomePanel() {
  const [bpm, setBpm] = useState(90);
  const [isPlaying, setIsPlaying] = useState(false);
  const [beat, setBeat] = useState(0);
  const [beatsPerBar, setBeatsPerBar] = useState(4);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextNoteTimeRef = useRef<number>(0);
  // The scheduler loop timer (window.setTimeout id — a `number` in browsers).
  const schedulerTimerRef = useRef<number | null>(null);
  // Every pending visual-update timer, so stopping/unmounting can cancel
  // them all (otherwise clicks/beat flashes keep firing after „stop”).
  const pendingTimersRef = useRef<Set<number>>(new Set());
  const beatCountRef = useRef<number>(0);
  const tapTimesRef = useRef<number[]>([]);
  const lastTapRef = useRef<number>(0);
  const bpmRef = useRef(bpm);
  const beatsPerBarRef = useRef(beatsPerBar);
  const isPlayingRef = useRef(isPlaying);

  // How far ahead (seconds) beats are pre-scheduled on the audio clock, and
  // how often the scheduler wakes up. Audio is scheduled at exact `t` values
  // (`osc.start(t)`), so clicks stay metronomically precise even when the
  // tab's timers are throttled — only the visual LED may lag slightly.
  const LOOKAHEAD = 0.12;
  const SCHEDULE_INTERVAL = 25;

  // Keep refs in sync
  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { beatsPerBarRef.current = beatsPerBar; }, [beatsPerBar]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      audioContextRef.current = new Ctor();
    }
    return audioContextRef.current;
  }, []);

  /** Cancel the scheduler loop and every pending visual/beat timer. */
  const clearPendingTimers = useCallback(() => {
    pendingTimersRef.current.forEach((id) => window.clearTimeout(id));
    pendingTimersRef.current.clear();
    if (schedulerTimerRef.current !== null) {
      window.clearTimeout(schedulerTimerRef.current);
      schedulerTimerRef.current = null;
    }
  }, []);

  /**
   * Schedule a click at an exact audio-clock time. The oscillator starts at
   * `time`, not „now”, so a late timer callback never delays the tick — the
   * audio engine fires it at the precomputed instant.
   */
  const scheduleClick = useCallback((time: number, isAccent: boolean) => {
    const ctx = getAudioContext();
    if (!ctx || ctx.state === "closed") return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(isAccent ? 1000 : 800, time);
    gain.gain.setValueAtTime(0.3, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.05);
  }, [getAudioContext]);

  // Scheduler uses refs to avoid stale closures; tempo changes while playing
  // take effect on the next scheduled beat (bpmRef/beatsPerBarRef stay live).
  const scheduler = useCallback(() => {
    const ctx = getAudioContext();
    if (!ctx) return;
    const sec = 60.0 / bpmRef.current;
    const bpb = beatsPerBarRef.current;
    while (nextNoteTimeRef.current < ctx.currentTime + LOOKAHEAD) {
      const t = nextNoteTimeRef.current;
      const isAccent = beatCountRef.current % bpb === 0;
      const visualBeat = beatCountRef.current % bpb;
      scheduleClick(t, isAccent);
      // Visual tick — best-effort timing (the audio itself is already exact).
      const delay = Math.max(0, (t - ctx.currentTime) * 1000);
      const timerId = window.setTimeout(() => {
        pendingTimersRef.current.delete(timerId);
        setBeat(visualBeat);
      }, delay);
      pendingTimersRef.current.add(timerId);
      nextNoteTimeRef.current += sec;
      beatCountRef.current++;
    }
    schedulerTimerRef.current = window.setTimeout(scheduler, SCHEDULE_INTERVAL);
  }, [getAudioContext, scheduleClick]);

  const togglePlay = useCallback(() => {
    if (isPlayingRef.current) {
      // Stop — cancel everything, reset the beat phase.
      clearPendingTimers();
      setIsPlaying(false);
      setBeat(0);
      beatCountRef.current = 0;
    } else {
      // Start
      const ctx = getAudioContext();
      if (!ctx) return;
      if (ctx.state === "suspended") void ctx.resume();
      // First tick a hair in the future so the user hears it immediately.
      nextNoteTimeRef.current = ctx.currentTime + 0.05;
      beatCountRef.current = 0;
      setIsPlaying(true);
      // Kick off the scheduler loop directly.
      scheduler();
    }
  }, [getAudioContext, scheduler, clearPendingTimers]);

  // Cleanup on unmount — cancel timers, then release the audio context.
  useEffect(() => {
    return () => {
      clearPendingTimers();
      audioContextRef.current?.close().catch(() => {});
      audioContextRef.current = null;
    };
  }, [clearPendingTimers]);

  const handleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current > 2000) tapTimesRef.current = [];
    tapTimesRef.current.push(now);
    lastTapRef.current = now;
    if (tapTimesRef.current.length > 8) tapTimesRef.current.shift();
    if (tapTimesRef.current.length >= 2) {
      const intervals = tapTimesRef.current.slice(1).map((t, i) => t - tapTimesRef.current[i]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const newBpm = Math.round(60000 / avg);
      if (newBpm >= 40 && newBpm <= 200) setBpm(newBpm);
    }
  }, []);

  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2"><span>🥁</span> Metronom</h3>
        <div className="flex items-center gap-1 text-[10px] text-zinc-500">
          <span className={`w-2 h-2 rounded-full ${isPlaying ? "bg-green-500 animate-pulse" : "bg-zinc-600"}`} />
          {isPlaying ? "Aktywny" : "Wstrzymany"}
        </div>
      </div>

      <div className="text-center mb-4">
        <div className="inline-flex items-baseline gap-2">
          <button onClick={() => setBpm((p) => Math.min(200, Math.max(40, p - 5)))} className="w-8 h-8 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center transition-colors text-lg">−</button>
          <span className="text-5xl font-bold text-amber-500 font-mono tabular-nums min-w-[120px] inline-block">{bpm}</span>
          <button onClick={() => setBpm((p) => Math.min(200, Math.max(40, p + 5)))} className="w-8 h-8 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center transition-colors text-lg">+</button>
        </div>
        <p className="text-xs text-zinc-500 mt-1">BPM</p>
      </div>

      <div className="flex items-center justify-center gap-2 mb-4">
        {Array.from({ length: beatsPerBar }).map((_, i) => (
          <div key={i} className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-75 ${isPlaying && beat === i ? (i === 0 ? "bg-amber-500 text-zinc-900 shadow-lg shadow-amber-500/50 scale-110" : "bg-amber-500/80 text-zinc-900") : "bg-zinc-800 text-zinc-500"}`}>
            <span className="text-xs font-bold">{i + 1}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-center gap-3 mb-4">
        <button onClick={togglePlay} className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold transition-all ${isPlaying ? "bg-amber-500 text-zinc-900 shadow-lg" : "bg-zinc-800 text-white hover:bg-zinc-700 border border-zinc-700"}`}>
          {isPlaying ? "⏸" : "▶"}
        </button>
        <button onClick={handleTap} className="px-5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-medium transition-all active:scale-95 border border-zinc-700">
          👆 Tap Tempo
        </button>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-[10px] text-zinc-500 w-6">40</span>
        <input type="range" min="40" max="200" value={bpm} onChange={(e) => setBpm(parseInt(e.target.value))}
          className="flex-1 h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500" />
        <span className="text-[10px] text-zinc-500 w-6">200</span>
      </div>

      <div className="mt-4 pt-4 border-t border-zinc-800 flex items-center justify-between">
        <span className="text-xs text-zinc-500">Uderzenia w takcie:</span>
        <div className="flex gap-1">
          {[2, 3, 4, 5, 6].map((n) => (
            <button key={n} onClick={() => setBeatsPerBar(n)}
              className={`w-7 h-7 rounded-lg text-xs font-medium transition-all ${beatsPerBar === n ? "bg-amber-500/20 text-amber-400 border border-amber-500/40" : "bg-zinc-800 text-zinc-500 hover:text-zinc-300 border border-transparent"}`}>
              {n}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const RHYME_TYPE_RANK: Record<RhymeType, number> = { exact: 3, assonance: 2, slant: 1 };

/**
 * Rhyme group highlights that track the actual editor lines.
 *
 * An invisible "mirror" div reproduces the textarea's exact metrics (font,
 * size, line-height, padding, width) so every logical line has a real DOM
 * node (`.vault-text-line`) to measure and highlight. Every word that
 * belongs to a rhyme cluster is wrapped in a span carrying the cluster's
 * color — the same hex the „Analiza Wersów” panel shows as its color dots —
 * so internal rhymes and multi-word clusters are highlighted in the editor
 * exactly as the panel describes them (1:1 sync). The mirror text itself is
 * transparent: only the highlights show through the bg-transparent textarea
 * above it. The whole layer is translated by -scrollTop so highlights follow
 * the textarea's internal scroll, and markers are re-synced on scroll,
 * window resize and container resize (ResizeObserver).
 */
function RhymeMarkersOverlay({ lines, groups, hits, textareaRef, children }: {
  lines: string[];
  groups: Map<number, string>;
  hits: Map<number, RhymeHit[]>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  children: ReactNode;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef<(HTMLDivElement | null)[]>([]);

  const syncMarkers = useCallback(() => {
    const wrapper = wrapperRef.current;
    const mirror = mirrorRef.current;
    const ta = textareaRef.current;
    if (!wrapper || !mirror || !ta) return;

    // Match the mirror's content width to the textarea's (clientWidth
    // excludes the vertical scrollbar) so line wrapping lines up, and
    // translate the highlight layer by the textarea's scroll offset so the
    // visible slice of the text stays aligned with the visible text.
    mirror.style.width = `${ta.clientWidth}px`;
    mirror.style.transform = `translateY(${-ta.scrollTop}px)`;

    const wrapperRect = wrapper.getBoundingClientRect();
    const lineEls = mirror.querySelectorAll<HTMLElement>(".vault-text-line");

    // Two passes to avoid layout thrash: read every rect first, then write.
    // Line rects already include the mirror's translateY(-scrollTop), so
    // markers are placed relative to the wrapper without extra math.
    const rects: DOMRect[] = [];
    lineEls.forEach((el) => rects.push(el.getBoundingClientRect()));
    lineEls.forEach((_, idx) => {
      const marker = markerRefs.current[idx];
      const color = groups.get(idx);
      if (!marker) return;
      if (!color) {
        // Fully clear hidden markers so stale layout from a previous sync
        // (when the line did rhyme) can't linger on an invisible element —
        // also keeps the DOM state exact for anything inspecting markers.
        marker.style.opacity = "0";
        marker.style.top = "";
        marker.style.left = "";
        marker.style.height = "";
        return;
      }
      const rect = rects[idx];
      // Position relative to the wrapper (the rect already accounts for the
      // mirror's scroll translation).
      marker.style.opacity = "1";
      marker.style.top = `${rect.top - wrapperRect.top}px`;
      marker.style.left = `${rect.left - wrapperRect.left - 12}px`;
      marker.style.height = `${rect.height}px`;
    });
  }, [textareaRef, groups]);

  // Re-sync after content edits / type changes (before paint, no flicker).
  // Also drop stale marker refs when the line count shrinks, so the sync
  // pass can never re-measure a removed line.
  useIsomorphicLayoutEffect(() => {
    if (markerRefs.current.length > lines.length) {
      markerRefs.current.length = lines.length;
    }
    syncMarkers();
  }, [syncMarkers, lines]);

  // Keep markers glued to the lines on scroll and layout changes.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const ta = textareaRef.current;
    if (!wrapper || !ta) return;

    const ro = new ResizeObserver(() => syncMarkers());
    // Observe both the wrapper (column/layout changes) and the textarea
    // itself — a scrollbar appearing changes its content width, which alters
    // line wrapping without firing a scroll event.
    ro.observe(wrapper);
    ro.observe(ta);
    window.addEventListener("resize", syncMarkers);
    ta.addEventListener("scroll", syncMarkers, { passive: true });

    // The app loads JetBrains Mono from Google Fonts asynchronously — when
    // the font lands, line metrics change, so re-sync once it is ready.
    document.fonts?.ready.then(() => syncMarkers()).catch(() => {});

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", syncMarkers);
      ta.removeEventListener("scroll", syncMarkers);
    };
  }, [syncMarkers, textareaRef]);

  return (
    <div ref={wrapperRef} className="relative">
      {/* Highlight layer — same metrics as the textarea so wrapping and line
          heights match exactly. The text is transparent: only the per-line
          group background shows through the bg-transparent textarea above. */}
      <div
        ref={mirrorRef}
        aria-hidden="true"
        className="absolute top-0 left-0 z-0 font-mono text-sm leading-relaxed p-4 whitespace-pre-wrap break-words pointer-events-none"
        style={{ color: "transparent" }}
      >
        {lines.map((line, i) => (
          <div key={i} className="vault-text-line min-h-[1.625em]">
            {line ? <RhymeLineHighlights line={line} hits={hits.get(i) ?? []} /> : "\u00A0"}
          </div>
        ))}
      </div>

      {/* Rhyme group markers in the left margin — same color as the line's
          group dot in „Analiza Wersów”, never intercept pointer events. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-3 z-0">
        {lines.map((_, i) => {
          const color = groups.get(i);
          return (
            <div
              key={i}
              ref={(el) => {
                markerRefs.current[i] = el;
              }}
              className="absolute left-0 w-1.5 rounded-full opacity-0 transition-opacity duration-150"
              style={{ backgroundColor: color ?? "transparent" }}
            />
          );
        })}
      </div>

      {/* The textarea sits above the markers so selection/clicks pass through. */}
      <div className="relative z-10">{children}</div>
    </div>
  );
}

/**
 * Start offset of every token in the RAW line (aligned with
 * `line.trim().split(/\s+/)`): leading whitespace is skipped first, then each
 * token advances past its following separators. This is the same walk the
 * engine's hit indexes refer to, so spans wrap exactly the right slices.
 */
function tokenStartPositions(line: string): number[] {
  const starts: number[] = [];
  let pos = 0;
  while (pos < line.length && /\s/.test(line[pos])) pos++;
  const tokens = line.trim().split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    starts.push(pos);
    pos += tokens[i].length;
    while (pos < line.length && /\s/.test(line[pos])) pos++;
  }
  return starts;
}

/**
 * Renders one transparent mirror line with EVERY rhyme-cluster word wrapped
 * in a span carrying its cluster color (multiple hits per line supported —
 * internal rhymes). The original text, including repeated/extra whitespace,
 * is preserved exactly so the mirror's metrics and wrapping match the
 * textarea. Hit indexes come from the engine and refer to
 * `line.trim().split(/\s+/)`; each hit's token is located via the shared
 * token walk and wrapped in a `data-rhyme-word` span (for the E2E 1:1 check).
 */
function RhymeLineHighlights({ line, hits }: { line: string; hits: RhymeHit[] }) {
  if (hits.length === 0) return <>{line}</>;
  const tokens = line.trim().split(/\s+/);
  const starts = tokenStartPositions(line);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const hit of hits) {
    if (hit.index < 0 || hit.index >= tokens.length) continue;
    const start = starts[hit.index];
    if (start < cursor) continue;
    nodes.push(line.slice(cursor, start));
    nodes.push(
      <span
        key={hit.index}
        data-rhyme-word={hit.color}
        style={{
          backgroundColor: `${hit.color}66`,
          borderRadius: "0.25rem",
          boxShadow: `inset 0 -2px 0 ${hit.color}`,
        }}
      >
        {tokens[hit.index]}
      </span>
    );
    cursor = start + tokens[hit.index].length;
  }
  nodes.push(line.slice(cursor));
  return <>{nodes}</>;
}

type RhymeSortMode = "type" | "similarity";

function RhymeAssistantPanel({ selectedWord, rhymes, onInsert }: { selectedWord: string; rhymes: RhymeResult[]; onInsert: (w: string) => void }) {
  const [sortBy, setSortBy] = useState<RhymeSortMode>("type");

  const sortedRhymes = useMemo(() => {
    const list = [...rhymes];
    list.sort((a, b) =>
      sortBy === "type"
        ? RHYME_TYPE_RANK[b.type] - RHYME_TYPE_RANK[a.type] || b.similarity - a.similarity
        : b.similarity - a.similarity || RHYME_TYPE_RANK[b.type] - RHYME_TYPE_RANK[a.type]
    );
    return list;
  }, [rhymes, sortBy]);

  // The single best match — the top of the current sort order.
  const bestWord = sortedRhymes.length > 0 ? sortedRhymes[0].word : null;

  const indicatorRef = useRef<HTMLDivElement>(null);
  const bestRowRef = useRef<HTMLButtonElement>(null);

  // Slide the highlight pill to the best row — the container is `relative`, so
  // each row's offsetTop is measured against it and the pill animates top/
  // height/opacity smoothly as the best match changes (e.g. while typing).
  useIsomorphicLayoutEffect(() => {
    const indicator = indicatorRef.current;
    const row = bestRowRef.current;
    if (!indicator) return;
    if (!row || !bestWord) {
      indicator.style.opacity = "0";
      return;
    }
    indicator.style.top = `${row.offsetTop}px`;
    indicator.style.height = `${row.offsetHeight}px`;
    indicator.style.opacity = "1";
  }, [bestWord]);

  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2"><span>🎵</span> Asystent Rymów</h3>
        <div className="flex rounded-lg bg-zinc-800 p-0.5" role="group" aria-label="Sortowanie rymów">
          <button
            onClick={() => setSortBy("type")}
            aria-pressed={sortBy === "type"}
            title="Sortuj według typu rymu"
            className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors ${sortBy === "type" ? "bg-amber-500/15 text-amber-400" : "text-zinc-400 hover:text-zinc-200"}`}
          >
            typ
          </button>
          <button
            onClick={() => setSortBy("similarity")}
            aria-pressed={sortBy === "similarity"}
            title="Sortuj według podobieństwa"
            className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors ${sortBy === "similarity" ? "bg-amber-500/15 text-amber-400" : "text-zinc-400 hover:text-zinc-200"}`}
          >
            podobieństwo
          </button>
        </div>
      </div>
      {selectedWord ? (
        <div>
          <p className="text-xs text-zinc-400 mb-2">Rymy do: <span className="text-amber-500 font-medium">&ldquo;{selectedWord}&rdquo;</span></p>
          <div className="relative max-h-[200px] overflow-y-auto">
            <div
              ref={indicatorRef}
              aria-hidden="true"
              className="pointer-events-none absolute left-0 right-0 rounded-lg border border-amber-500/40 bg-amber-500/20 opacity-0 transition-[top,height,opacity] duration-300 ease-out motion-reduce:transition-none"
            />
            <div className="space-y-1">
              {sortedRhymes.length > 0 ? sortedRhymes.map((r) => {
                const pct = Math.round(r.similarity * 100);
                const isBest = r.word === bestWord;
                return (
                  <button key={r.word} ref={isBest ? bestRowRef : undefined} onClick={() => onInsert(r.word)} aria-current={isBest ? "true" : undefined} className={`relative w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-transparent bg-zinc-800/40 text-left transition-colors group ${isBest ? "hover:bg-amber-500/15" : "hover:bg-amber-500/10"}`}>
                    <span className={`text-sm truncate transition-colors ${isBest ? "text-amber-400 font-medium" : "text-white group-hover:text-amber-500"}`}>{r.word}</span>
                    {isBest && (
                      <span className="text-[9px] font-semibold text-amber-400 bg-amber-500/20 border border-amber-500/30 rounded-full px-1.5 py-0.5 shrink-0">
                        ★ najlepszy
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-2">
                      <span
                        role="img"
                        className="w-10 h-1 rounded-full bg-zinc-700 overflow-hidden"
                        title={`Podobieństwo: ${pct}%`}
                        aria-label={`Podobieństwo ${pct}%`}
                      >
                        <span
                          className={`block h-full rounded-full transition-[width] ${r.type === "exact" ? "bg-green-400" : r.type === "assonance" ? "bg-blue-400" : "bg-zinc-500"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${r.type === "exact" ? "bg-green-500/10 text-green-400" : r.type === "assonance" ? "bg-blue-500/10 text-blue-400" : "bg-zinc-700 text-zinc-400"}`}>
                        {r.type === "exact" ? "dokładny" : r.type === "assonance" ? "asonans" : "slant"}
                      </span>
                    </span>
                  </button>
                );
              }) : <p className="text-xs text-zinc-600 text-center py-3">Brak rymów</p>}
            </div>
          </div>
        </div>
      ) : <p className="text-xs text-zinc-500 text-center py-4">Zaznacz słowo w edytorze</p>}
    </div>
  );
}

function VersionsPanel({
  versions,
  onRestore,
  onDelete,
  onArchive,
  onRestoreArchived,
  onPurgeArchive,
  maxActive,
}: {
  versions: LyricVersion[];
  onRestore: (v: LyricVersion) => void;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
  onRestoreArchived: (v: LyricVersion) => void;
  onPurgeArchive: () => void;
  maxActive: number;
}) {
  const [showArchive, setShowArchive] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [baseId, setBaseId] = useState("");
  const [compareId, setCompareId] = useState("");
  const active = versions.filter((v) => !v.archived);
  const archived = versions.filter((v) => v.archived);
  const nearCap = active.length >= maxActive - 10;
  const atCap = active.length >= maxActive;
  const pct = Math.min(100, Math.round((active.length / maxActive) * 100));

  // Oldest → newest (ISO timestamps sort lexicographically), archive included.
  const sortedAll = useMemo(
    () => [...versions].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    [versions]
  );

  const toggleCompare = useCallback(() => {
    if (!compareMode && sortedAll.length > 0) {
      setBaseId(sortedAll[0].id);
      setCompareId(sortedAll[sortedAll.length - 1].id);
    }
    setCompareMode((s) => !s);
  }, [compareMode, sortedAll]);

  const base = versions.find((v) => v.id === baseId) ?? null;
  const other = versions.find((v) => v.id === compareId) ?? null;
  const diff = useMemo(() => {
    if (!base || !other || base.id === other.id) return null;
    return diffLines(base.content.split("\n"), other.content.split("\n"));
  }, [base, other]);
  const stats = useMemo(() => {
    if (!base || !other || base.id === other.id) return null;
    return diffStats(base.content.split("\n"), other.content.split("\n"));
  }, [base, other]);

  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-6">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2"><span>📚</span> Wersje Robocze</h3>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 rounded-full text-[10px] font-medium border ${
            atCap
              ? "bg-red-500/10 border-red-500/30 text-red-400"
              : nearCap
              ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
              : "bg-zinc-800 border-zinc-700 text-zinc-400"
          }`}>
            {active.length}/{maxActive}
          </span>
          <button
            onClick={toggleCompare}
            className={`px-2.5 py-1 rounded-full text-[10px] font-medium border transition-colors ${
              compareMode
                ? "bg-violet-500/15 border-violet-500/40 text-violet-300"
                : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-violet-300 hover:bg-zinc-700"
            }`}
          >
            🔍 Porównaj
          </button>
          <button
            onClick={() => setShowArchive((s) => !s)}
            className={`px-2.5 py-1 rounded-full text-[10px] font-medium border transition-colors ${
              showArchive
                ? "bg-zinc-700 border-zinc-600 text-white"
                : archived.length > 0
                ? "bg-blue-500/10 border-blue-500/30 text-blue-400 hover:bg-blue-500/20"
                : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700"
            }`}
          >
            📦 Archiwum ({archived.length})
          </button>
        </div>
      </div>
      {nearCap && (
        <div className="mb-4">
          <div className="h-1 rounded-full bg-zinc-800 overflow-hidden">
            <div className={`h-full rounded-full ${atCap ? "bg-red-500" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
          </div>
          <p className={`text-[10px] mt-1 ${atCap ? "text-red-400" : "text-amber-400"}`}>
            {atCap
              ? `Limit ${maxActive} aktywnych wersji osiągnięty — najstarsza wersja trafia do archiwum przy zapisie.`
              : `Pozostało ${maxActive - active.length} miejsc wśród aktywnych wersji (limit ${maxActive}).`}
          </p>
        </div>
      )}
      {active.length > 0 ? (
        <div className="space-y-3">
          {active.map((v) => {
            const lines = v.content.split("\n");
            const snippet = lines.find((l) => l.trim())?.slice(0, 80) || "—";
            return (
              <div key={v.id} className="flex items-center gap-3 p-3 rounded-xl bg-zinc-800 border border-zinc-700">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{v.label}</p>
                  <p className="text-xs text-zinc-400 mt-0.5 truncate">{snippet}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{lines.length} wersów</p>
                </div>
                <button onClick={() => onRestore(v)} className="px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-500 text-xs font-medium hover:bg-amber-500/20 transition-colors">Przywróć</button>
                <button onClick={() => onArchive(v.id)} title="Przenieś do archiwum" className="px-2.5 py-1.5 rounded-lg bg-zinc-800 text-zinc-400 text-xs font-medium hover:bg-blue-500/10 hover:text-blue-400 transition-colors">📦</button>
                <button onClick={() => onDelete(v.id)} className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-400 text-xs font-medium hover:bg-red-500/10 hover:text-red-400 transition-colors">🗑️</button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-8"><span className="text-3xl block mb-2">📭</span><p className="text-sm text-zinc-400">Brak zapisanych wersji</p></div>
      )}

      {showArchive && (
        <div className="mt-5 pt-4 border-t border-zinc-800">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Archiwum</p>
            {archived.length > 0 && (
              <button
                onClick={onPurgeArchive}
                className="px-2.5 py-1 rounded-lg bg-zinc-800 text-zinc-400 text-[10px] font-medium hover:bg-red-500/10 hover:text-red-400 transition-colors"
              >
                🧹 Wyczyść archiwum
              </button>
            )}
          </div>
          {archived.length > 0 ? (
            <div className="space-y-2">
              {archived.map((v) => {
                const lines = v.content.split("\n");
                const snippet = lines.find((l) => l.trim())?.slice(0, 80) || "—";
                return (
                  <div key={v.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-zinc-900/60 border border-zinc-800/60 opacity-80">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-300 truncate">{v.label}</p>
                      <p className="text-xs text-zinc-500 mt-0.5 truncate">{snippet}</p>
                    </div>
                    <button onClick={() => onRestoreArchived(v)} className="px-2.5 py-1 rounded-lg bg-zinc-800 text-zinc-300 text-xs font-medium hover:bg-amber-500/10 hover:text-amber-400 transition-colors">Przywróć</button>
                    <button onClick={() => onDelete(v.id)} className="px-2.5 py-1 rounded-lg bg-zinc-800 text-zinc-500 text-xs font-medium hover:bg-red-500/10 hover:text-red-400 transition-colors">🗑️</button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-zinc-600">Archiwum puste — wersje ponad limit {maxActive} trafiają tutaj zamiast znikać.</p>
          )}
        </div>
      )}

      {compareMode && (
        <div className="mt-5 pt-4 border-t border-zinc-800">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">🔍 Porównaj wersje</p>
            {stats && (
              <span className="text-[10px] text-zinc-500 font-mono">
                <span className="text-emerald-400">+{stats.added}</span>
                <span className="text-red-400"> −{stats.removed}</span>
                <span> • {stats.unchanged} wspólnych • {stats.similarity}% podobieństwa</span>
              </span>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <label className="flex-1 text-[10px] text-zinc-500">
              Wersja bazowa (starsza)
              <select
                value={baseId}
                onChange={(e) => setBaseId(e.target.value)}
                className="w-full mt-1 px-2 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-white focus:outline-none focus:ring-1 focus:ring-violet-500/50 transition-all"
              >
                {sortedAll.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                    {v.archived ? " (archiwum)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex-1 text-[10px] text-zinc-500">
              Wersja porównywana (nowsza)
              <select
                value={compareId}
                onChange={(e) => setCompareId(e.target.value)}
                className="w-full mt-1 px-2 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-white focus:outline-none focus:ring-1 focus:ring-violet-500/50 transition-all"
              >
                {sortedAll.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                    {v.archived ? " (archiwum)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {diff ? (
            diff.length > 0 ? (
              <div className="rounded-xl bg-zinc-950/60 border border-zinc-800 overflow-y-auto max-h-[320px] font-mono text-xs">
                {diff.map((line, i) => (
                  <div
                    key={i}
                    className={`px-3 py-1 whitespace-pre-wrap break-words ${
                      line.type === "added"
                        ? "bg-emerald-500/10 text-emerald-300"
                        : line.type === "removed"
                          ? "bg-red-500/10 text-red-300"
                          : "text-zinc-500"
                    }`}
                  >
                    <span className="inline-block w-4 select-none mr-2">
                      {line.type === "added" ? "+" : line.type === "removed" ? "−" : " "}
                    </span>
                    {line.text || "\u00A0"}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-500 text-center py-4">Wersje są identyczne — brak różnic 🎉</p>
            )
          ) : (
            <p className="text-xs text-zinc-500 text-center py-4">Wybierz dwie różne wersje, aby zobaczyć różnice.</p>
          )}
        </div>
      )}
    </div>
  );
}

interface MoodboardInspiration {
  id: string;
  title: string;
  url: string;
  type: "image" | "link";
  /** Data URL of an uploaded image (persisted locally alongside the card). */
  dataUrl?: string;
}

/** localStorage key for the whole moodboard (vibes, palette, words, cards). */
const MOODBOARD_KEY = "flowforge-moodboard";

function isMoodboardInspiration(x: unknown): x is MoodboardInspiration {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.title === "string" &&
    typeof o.url === "string" &&
    (o.type === "image" || o.type === "link") &&
    (o.dataUrl === undefined || typeof o.dataUrl === "string")
  );
}

function MoodboardPanel() {
  // Vibe & Atmosphere presets
  const [selectedVibes, setSelectedVibes] = useState<string[]>([]);
  const vibes = [
    { id: "industrial", label: "🏭 Industrial", color: "bg-zinc-600" },
    { id: "neon", label: "💜 Neon Nights", color: "bg-purple-500" },
    { id: "underground", label: "🕳️ Raw Underground", color: "bg-zinc-800" },
    { id: "melancholy", label: "🌧️ Melancholy", color: "bg-blue-600" },
    { id: "aggressive", label: "🔥 Aggressive", color: "bg-red-500" },
    { id: "dreamy", label: "✨ Dreamy", color: "bg-pink-400" },
    { id: "nostalgic", label: "📷 Nostalgic", color: "bg-amber-600" },
    { id: "futuristic", label: "🚀 Futuristic", color: "bg-cyan-500" },
    { id: "dark", label: "🌑 Dark", color: "bg-zinc-950" },
    { id: "ethereal", label: "☁️ Ethereal", color: "bg-indigo-400" },
  ];

  // Color Palette
  const [palette, setPalette] = useState<string[]>(["#18181b", "#f59e0b", "#dc2626"]);
  const presetColors = ["#18181b", "#27272a", "#f59e0b", "#dc2626", "#7c3aed", "#06b6d4", "#10b981", "#ec4899"];

  // Core Keywords
  const [keywords, setKeywords] = useState<string[]>(["ulica", "flow", "authentyczność"]);
  const [newKeyword, setNewKeyword] = useState("");

  // Inspiration Cards (links + uploaded images, reorderable via drag & drop)
  const [inspirations, setInspirations] = useState<MoodboardInspiration[]>([]);
  const [newInspiration, setNewInspiration] = useState({ title: "", url: "" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Drag & drop reordering state (indices into `inspirations`).
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // ── Persistence ──
  // DB-primary with the localStorage mirror as an offline cache:
  //   1. On mount, load the board from the DB; if the DB has nothing (first
  //      run, or the legacy localStorage-only era), fall back to the
  //      localStorage copy — the save effect then imports it into the DB.
  //   2. On every change, mirror to localStorage (fast, offline-safe) and
  //      debounce a DB upsert.
  // The `moodboardLoaded` guard keeps the save effect silent until the mount
  // load has been applied — otherwise the first effect pass would overwrite
  // saved data with the initial defaults (React StrictMode runs effects
  // twice, which would wipe the board on every reload).
  const [moodboardLoaded, setMoodboardLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let data: MoodboardData | null = null;
      try {
        data = await getMoodboard();
      } catch {
        /* DB unavailable — fall back to the local cache below */
      }
      if (cancelled) return;
      if (data) {
        setSelectedVibes(data.selectedVibes);
        setPalette(data.palette);
        setKeywords(data.keywords);
        setInspirations(data.inspirations);
      } else {
        // Legacy/offline copy (localStorage-only era). The save effect below
        // re-persists it to the DB, so the board survives a storage wipe.
        try {
          const saved = localStorage.getItem(MOODBOARD_KEY);
          if (saved) {
            const d = JSON.parse(saved) as Record<string, unknown>;
            if (Array.isArray(d.selectedVibes)) setSelectedVibes(d.selectedVibes.filter((v): v is string => typeof v === "string"));
            if (Array.isArray(d.palette)) setPalette(d.palette.filter((c): c is string => typeof c === "string"));
            if (Array.isArray(d.keywords)) setKeywords(d.keywords.filter((k): k is string => typeof k === "string"));
            if (Array.isArray(d.inspirations)) setInspirations(d.inspirations.filter(isMoodboardInspiration));
          }
        } catch { /* ignore corrupted data */ }
      }
      setMoodboardLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!moodboardLoaded) return;
    // Fast mirror (offline-safe; also the legacy source on first run).
    try {
      localStorage.setItem(
        MOODBOARD_KEY,
        JSON.stringify({ selectedVibes, palette, keywords, inspirations })
      );
    } catch {
      /* ignore quota errors — the board keeps working in-session */
    }
    // Debounced DB upsert — the DB row is the source of truth.
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveMoodboard({ selectedVibes, palette, keywords, inspirations }).catch(() => {
        /* offline — the localStorage mirror above already holds the state */
      });
    }, 800);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [moodboardLoaded, selectedVibes, palette, keywords, inspirations]);

  const toggleVibe = (id: string) => {
    setSelectedVibes((prev) => prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]);
  };

  const toggleColor = (color: string) => {
    setPalette((prev) => prev.includes(color) ? prev.filter((c) => c !== color) : [...prev, color]);
  };

  const addKeyword = () => {
    if (newKeyword.trim() && !keywords.includes(newKeyword.trim())) {
      setKeywords((prev) => [...prev, newKeyword.trim()]);
      setNewKeyword("");
    }
  };

  const removeKeyword = (kw: string) => {
    setKeywords((prev) => prev.filter((k) => k !== kw));
  };

  const addInspiration = () => {
    const url = newInspiration.url.trim();
    if (!url) return;
    let title = newInspiration.title.trim();
    if (!title) {
      try { title = new URL(url).hostname; } catch { title = url; }
    }
    setInspirations((prev) => [...prev, { id: `link-${Date.now()}`, title, url, type: "link" }]);
    setNewInspiration({ title: "", url: "" });
  };

  /** Read uploaded image files as data URLs and append them as cards. */
  const handleImageFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const images = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    images.forEach((file, idx) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        if (typeof dataUrl !== "string") return;
        setInspirations((prev) => [
          ...prev,
          {
            id: `img-${Date.now()}-${idx}`,
            title: file.name.replace(/\.[^.]+$/, "") || "Obraz",
            url: "",
            type: "image",
            dataUrl,
          },
        ]);
      };
      reader.onerror = () => { /* unreadable file — skip */ };
      reader.readAsDataURL(file);
    });
  }, []);

  /** Reorder: move the card currently being dragged to `targetIndex`. */
  const dropOnCard = useCallback((targetIndex: number) => {
    if (dragIndex === null || dragIndex === targetIndex) return;
    setInspirations((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
    setDragIndex(null);
    setDragOverIndex(null);
  }, [dragIndex]);

  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2"><span>🖼️</span> Moodboard</h3>
        <span className="text-[10px] text-zinc-500">Klimat utworu</span>
      </div>

      {/* Vibe & Atmosphere */}
      <div>
        <h4 className="text-xs font-medium text-zinc-400 mb-2 flex items-center gap-1"><span>🎭</span> Vibe & Atmosfera</h4>
        <div className="flex flex-wrap gap-1.5">
          {vibes.map((vibe) => (
            <button key={vibe.id} onClick={() => toggleVibe(vibe.id)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${selectedVibes.includes(vibe.id) ? "bg-amber-500/20 text-amber-400 border border-amber-500/40" : "bg-zinc-800 text-zinc-400 border border-transparent hover:text-zinc-200 hover:bg-zinc-700"}`}>
              {vibe.label}
            </button>
          ))}
        </div>
      </div>

      {/* Color Palette */}
      <div>
        <h4 className="text-xs font-medium text-zinc-400 mb-2 flex items-center gap-1"><span>🎨</span> Paleta Kolorów</h4>
        <div className="flex flex-wrap gap-2">
          {presetColors.map((color) => (
            <button key={color} onClick={() => toggleColor(color)}
              className={`w-8 h-8 rounded-lg border-2 transition-all ${palette.includes(color) ? "border-amber-500 scale-110" : "border-transparent hover:border-zinc-600"}`}
              style={{ backgroundColor: color }} />
          ))}
        </div>
        <div className="flex gap-1 mt-2">
          {palette.map((color, i) => (
            <span key={i} className="px-2 py-0.5 rounded bg-zinc-800 text-[10px] text-zinc-400 font-mono">{color}</span>
          ))}
        </div>
      </div>

      {/* Core Keywords */}
      <div>
        <h4 className="text-xs font-medium text-zinc-400 mb-2 flex items-center gap-1"><span>🏷️</span> Słowa Kluczowe</h4>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {keywords.map((kw) => (
            <span key={kw} className="px-2.5 py-1 rounded-lg bg-zinc-800 text-[11px] text-zinc-300 flex items-center gap-1.5">
              {kw}
              <button onClick={() => removeKeyword(kw)} className="text-zinc-500 hover:text-red-400 transition-colors">×</button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input type="text" value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addKeyword()}
            placeholder="Dodaj słowo..." className="flex-1 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-white text-xs placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500/50" />
          <button onClick={addKeyword} className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-400 text-xs hover:bg-zinc-700 hover:text-white transition-colors">+</button>
        </div>
      </div>

      {/* Inspiration Cards — images & links, draggable to reorder */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-medium text-zinc-400 flex items-center gap-1"><span>🔗</span> Inspiracje</h4>
          {inspirations.length > 0 && (
            <span className="text-[9px] text-zinc-600">przeciągnij karty, aby zmienić kolejność</span>
          )}
        </div>
        {inspirations.length > 0 && (
          <div className="grid grid-cols-2 gap-2 mb-3">
            {inspirations.map((insp, i) => (
              <div
                key={insp.id}
                draggable
                onDragStart={(e) => {
                  setDragIndex(i);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", insp.id);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dragOverIndex !== i) setDragOverIndex(i);
                }}
                onDragLeave={() => setDragOverIndex((cur) => (cur === i ? null : cur))}
                onDrop={(e) => {
                  e.preventDefault();
                  dropOnCard(i);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setDragOverIndex(null);
                }}
                className={`relative p-2 rounded-lg bg-zinc-800 border transition-all group cursor-grab active:cursor-grabbing select-none ${
                  dragOverIndex === i && dragIndex !== null && dragIndex !== i
                    ? "border-amber-500/60"
                    : "border-zinc-700"
                }`}
              >
                <button
                  onClick={() => setInspirations((p) => p.filter((x) => x.id !== insp.id))}
                  className="absolute top-1 right-1 z-10 w-4 h-4 rounded-full bg-zinc-700/90 text-zinc-400 text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-500/20 hover:text-red-400 transition-all"
                  title="Usuń"
                >
                  ×
                </button>
                {insp.type === "image" && insp.dataUrl ? (
                  <img
                    src={insp.dataUrl}
                    alt={insp.title}
                    draggable={false}
                    className="w-full h-24 object-cover rounded-md mb-1.5"
                  />
                ) : null}
                <p className="text-[11px] text-zinc-300 truncate pr-4">{insp.title}</p>
                {insp.type === "link" && insp.url ? (
                  <a
                    href={insp.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-zinc-500 truncate block hover:text-amber-400 transition-colors"
                  >
                    {insp.url}
                  </a>
                ) : (
                  <p className="text-[10px] text-zinc-600 truncate">🖼️ obraz</p>
                )}
                <span className="absolute bottom-1.5 right-1.5 text-[9px] text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity select-none">⠿</span>
              </div>
            ))}
          </div>
        )}

        {/* Add link */}
        <div className="flex gap-2 mb-2">
          <input type="text" value={newInspiration.title} onChange={(e) => setNewInspiration((p) => ({ ...p, title: e.target.value }))} placeholder="Tytuł..."
            className="flex-1 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-white text-xs placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500/50" />
          <input type="text" value={newInspiration.url} onChange={(e) => setNewInspiration((p) => ({ ...p, url: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && addInspiration()} placeholder="URL..."
            className="flex-1 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-white text-xs placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500/50" />
          <button onClick={addInspiration} title="Dodaj link" className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-400 text-xs hover:bg-zinc-700 hover:text-white transition-colors">+</button>
        </div>

        {/* Image upload — button + drop zone */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleImageFiles(e.dataTransfer.files);
          }}
          className="flex items-center gap-2 p-3 rounded-lg border border-dashed border-zinc-700 hover:border-amber-500/40 transition-colors"
        >
          <button
            onClick={() => fileInputRef.current?.click()}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 text-[11px] font-medium hover:bg-zinc-700 hover:text-white transition-colors"
          >
            🖼️ Wgraj obraz
          </button>
          <span className="text-[10px] text-zinc-600">lub upuść pliki obrazów tutaj</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              handleImageFiles(e.target.files);
              // Reset so selecting the same file again still fires onChange.
              e.target.value = "";
            }}
          />
        </div>
      </div>
    </div>
  );
}

function FlowMeterPanel({ content, rhymeGroups }: { content: string; rhymeGroups?: Map<number, string> }) {
  const lines = content.split("\n");
  const activeLines = lines.filter((l) => l.trim());

  // Syllable data per line
  const lineData = useMemo(() => {
    return lines.map((line, idx) => {
      const syllables = line.trim() ? countLineSyllables(line) : 0;
      const wordCount = line.trim() ? line.trim().split(/\s+/).length : 0;
      return { idx, text: line, syllables, wordCount, isEmpty: !line.trim() };
    });
  }, [content]);

  const activeLineData = lineData.filter((l) => !l.isEmpty);

  // Metrics
  const metrics = useMemo(() => {
    if (activeLineData.length === 0) return null;
    const syllCounts = activeLineData.map((l) => l.syllables);
    const totalSyl = syllCounts.reduce((a, b) => a + b, 0);
    const avgSyl = totalSyl / syllCounts.length;
    const maxSyl = Math.max(...syllCounts);
    const minSyl = Math.min(...syllCounts);
    const maxIdx = syllCounts.indexOf(maxSyl);
    const minIdx = syllCounts.indexOf(minSyl);

    // Standard deviation for flow consistency
    const variance = syllCounts.reduce((sum, s) => sum + Math.pow(s - avgSyl, 2), 0) / syllCounts.length;
    const stdDev = Math.sqrt(variance);
    const consistency = Math.max(0, 100 - stdDev * 15); // 100 = perfect, lower = more uneven

    // Rhyme density (how many lines are in a rhyme group)
    let rhymeDensity = 0;
    if (rhymeGroups && rhymeGroups.size > 0) {
      const rhymedLines = new Set(rhymeGroups.keys()).size;
      rhymeDensity = Math.round((rhymedLines / activeLineData.length) * 100);
    }

    // Breath warnings: >16 syllables is typically one long breath, >22 is very hard
    const breathWarnings = activeLineData.filter((l) => l.syllables > 16);
    const criticalBreath = activeLineData.filter((l) => l.syllables > 22);

    // Consistency rating
    let consistencyLabel = "Idealny";
    let consistencyColor = "text-green-400";
    if (consistency < 60) { consistencyLabel = "Nierówny"; consistencyColor = "text-red-400"; }
    else if (consistency < 80) { consistencyLabel = "Znośny"; consistencyColor = "text-amber-400"; }

    return {
      avgSyl: Math.round(avgSyl * 10) / 10,
      maxSyl,
      minSyl,
      maxIdx,
      minIdx,
      totalSyl,
      consistency: Math.round(consistency),
      consistencyLabel,
      consistencyColor,
      rhymeDensity,
      breathWarnings,
      criticalBreath,
      totalLines: activeLineData.length,
    };
  }, [activeLineData, rhymeGroups]);

  const maxSyl = Math.max(...activeLineData.map((l) => l.syllables), 1);

  if (!content.trim()) {
    return (
      <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-6">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2"><span>📊</span> Flow Meter</h3>
        <p className="text-xs text-zinc-500 text-center py-6">Zacznij pisać, aby zobaczyć analizę flow</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2"><span>📊</span> Flow Meter</h3>
        {metrics && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">
            {metrics.totalLines} wersów • {metrics.totalSyl} sylab
          </span>
        )}
      </div>

      {metrics && (
        <>
          {/* ── Metrics Grid ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            <MetricCard label="Śr. sylab/wers" value={metrics.avgSyl.toString()} sub="wiersz" />
            <MetricCard label="Flow" value={metrics.consistency + "%"} sub={metrics.consistencyLabel} color={metrics.consistencyColor} />
            <MetricCard label="Rymowanie" value={rhymeGroups && rhymeGroups.size > 0 ? metrics.rhymeDensity + "%" : "—"} sub="gęstość" color={metrics.rhymeDensity > 50 ? "text-green-400" : metrics.rhymeDensity > 0 ? "text-amber-400" : "text-zinc-500"} />
            <MetricCard label="Oddech" value={metrics.breathWarnings.length === 0 ? "OK" : metrics.breathWarnings.length.toString()} sub={metrics.breathWarnings.length === 0 ? "brak ostrzeżeń" : "długi wers"} color={metrics.breathWarnings.length === 0 ? "text-green-400" : "text-red-400"} />
          </div>

          {/* ── Syllable Density Bar Chart ── */}
          <div className="mb-4">
            <p className="text-[10px] text-zinc-500 mb-2 uppercase tracking-wider font-medium">Gęstość sylab na wers</p>
            <div className="space-y-1">
              {lineData.map((line) => {
                if (line.isEmpty) return (
                  <div key={line.idx} className="h-1 bg-zinc-800/30 rounded" />
                );
                const pct = maxSyl > 0 ? (line.syllables / maxSyl) * 100 : 0;
                const isLong = line.syllables > 16;
                const isCritical = line.syllables > 22;
                const color = rhymeGroups?.get(line.idx);
                const barColor = isCritical ? "bg-red-500/60" : isLong ? "bg-amber-500/50" : color ? "bg-emerald-500/40" : "bg-amber-500/30";

                return (
                  <div key={line.idx} className="flex items-center gap-2 group">
                    <span className="text-[10px] text-zinc-600 w-4 text-right font-mono shrink-0">
                      {line.idx + 1}
                    </span>
                    <div className="flex-1 h-5 rounded bg-zinc-800 overflow-hidden relative">
                      <div className={`h-full rounded transition-all duration-300 ${barColor}`} style={{ width: `${pct}%` }} />
                      {/* Center label */}
                      {line.syllables > 0 && (
                        <span className="absolute inset-0 flex items-center justify-center text-[9px] font-mono text-zinc-400 pointer-events-none">
                          {line.syllables}s
                        </span>
                      )}
                    </div>
                    {isLong && (
                      <span className={`text-[9px] font-medium shrink-0 ${isCritical ? "text-red-400" : "text-amber-400"}`}>
                        {isCritical ? "⚠️" : "💨"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Max / Min Highlight ── */}
          <div className="flex gap-2 mb-4">
            <div className="flex-1 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700">
              <p className="text-[10px] text-zinc-500 mb-0.5">Najdłuższy wers</p>
              <p className="text-xs text-white truncate">Wers {metrics.maxIdx + 1} — <span className="text-amber-400 font-mono">{metrics.maxSyl}s</span></p>
            </div>
            <div className="flex-1 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700">
              <p className="text-[10px] text-zinc-500 mb-0.5">Najkrótszy wers</p>
              <p className="text-xs text-white truncate">Wers {metrics.minIdx + 1} — <span className="text-emerald-400 font-mono">{metrics.minSyl}s</span></p>
            </div>
          </div>

          {/* ── Breath Control Hints ── */}
          {metrics.breathWarnings.length > 0 && (
            <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
              <p className="text-[10px] text-red-400 font-medium mb-2 flex items-center gap-1">
                <span>💨</span> Kontrola Oddechu — {metrics.breathWarnings.length} {metrics.breathWarnings.length === 1 ? "wers" : "wersów"} za długi na jeden wdech
              </p>
              <div className="space-y-1">
                {metrics.breathWarnings.map((line) => (
                  <div key={line.idx} className="flex items-center gap-2">
                    <span className="text-[10px] text-zinc-600 font-mono">{line.idx + 1}</span>
                    <span className={`text-[10px] font-mono ${line.syllables > 22 ? "text-red-400" : "text-amber-400"}`}>{line.syllables}s</span>
                    <span className="text-[10px] text-zinc-500 truncate flex-1">{line.text.substring(0, 50)}{line.text.length > 50 ? "..." : ""}</span>
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-zinc-600 mt-2">Tip: Podziel długie wersy na dwie linie lub użyj przerw oddechowych (…)</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MetricCard({ label, value, sub, color = "text-white" }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <div className="px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700">
      <p className="text-[10px] text-zinc-500 mb-0.5">{label}</p>
      <p className={`text-lg font-bold font-mono ${color}`}>{value}</p>
      <p className="text-[10px] text-zinc-600">{sub}</p>
    </div>
  );
}

interface Milestone {
  id: string;
  label: string;
  category: "production" | "promo" | "custom";
  done: boolean;
  dueDate?: string;
}

const DEFAULT_MILESTONES: Milestone[] = [
  // Production
  { id: "w1", label: "📝 Pisanie tekstu", category: "production", done: false },
  { id: "w2", label: "🥁 Wybór / zakup bitu", category: "production", done: false },
  { id: "w3", label: "🎙️ Nagrywanie wokalu", category: "production", done: false },
  { id: "w4", label: "🎛️ Mix", category: "production", done: false },
  { id: "w5", label: "🎚️ Mastering", category: "production", done: false },
  { id: "w6", label: "🎨 Projekt okładki", category: "production", done: false },
  // Promo
  { id: "p1", label: "🎬 Teledysk / lyric video", category: "promo", done: false },
  { id: "p2", label: "📱 Teasery na social media", category: "promo", done: false },
  { id: "p3", label: "📢 Promo u influencerów", category: "promo", done: false },
  { id: "p4", label: "🌐 Upload na platformy (DistroKid, TuneCore...)", category: "promo", done: false },
  { id: "p5", label: "🚀 Premiera! 🎉", category: "promo", done: false },
];

const STATUS_OPTIONS = [
  { value: "draft", label: "📝 Wersja robocza", color: "text-zinc-400 bg-zinc-800" },
  { value: "writing", label: "✍️ Pisanie", color: "text-blue-400 bg-blue-500/10" },
  { value: "recording", label: "🎙️ Nagrywanie", color: "text-purple-400 bg-purple-500/10" },
  { value: "mixing", label: "🎛️ Mix/Mastering", color: "text-amber-400 bg-amber-500/10" },
  { value: "promoting", label: "📢 Promocja", color: "text-cyan-400 bg-cyan-500/10" },
  { value: "ready", label: "✅ Gotowe do premiery", color: "text-green-400 bg-green-500/10" },
  { value: "released", label: "🚀 Wydane!", color: "text-emerald-400 bg-emerald-500/10" },
] as const;

function isMilestone(x: unknown): x is Milestone {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.label === "string" &&
    (o.category === "production" || o.category === "promo" || o.category === "custom") &&
    typeof o.done === "boolean" &&
    (o.dueDate === undefined || typeof o.dueDate === "string")
  );
}

function ReleasePlannerPanel() {
  const [milestones, setMilestones] = useState<Milestone[]>(DEFAULT_MILESTONES);
  const [projectStatus, setProjectStatus] = useState<string>("draft");
  const [targetDate, setTargetDate] = useState("");
  const [newTask, setNewTask] = useState("");
  const [showAddTask, setShowAddTask] = useState(false);

  // ── Persistence ──
  // DB-primary with the localStorage mirror as an offline cache:
  //   1. On mount, load the plan from the DB; if the DB has nothing (first
  //      run, or the legacy localStorage-only era), fall back to the
  //      localStorage copy — the save effect then imports it into the DB.
  //   2. On every change, mirror to localStorage (fast, offline-safe) and
  //      debounce a DB upsert.
  // The `releaseLoaded` guard keeps the save effect silent until the mount
  // load has been applied. Without it the save effect's first run writes the
  // default milestones over any saved data — and under React StrictMode
  // (dev) the load effect re-runs against that clobbered storage, wiping the
  // plan on every reload.
  const [releaseLoaded, setReleaseLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let data: ReleasePlanData | null = null;
      try {
        data = await getReleasePlan();
      } catch {
        /* DB unavailable — fall back to the local cache below */
      }
      if (cancelled) return;
      if (data) {
        setMilestones(data.milestones);
        setProjectStatus(data.projectStatus);
        setTargetDate(data.targetDate);
      } else {
        // Legacy/offline copy (localStorage-only era). The save effect below
        // re-persists it to the DB, so the plan survives a storage wipe.
        try {
          const saved = localStorage.getItem("flowforge-release-plan");
          if (saved) {
            const d = JSON.parse(saved) as Record<string, unknown>;
            if (Array.isArray(d.milestones)) {
              // Drop malformed rows, but honor a legitimately empty list (a
              // user who deleted every milestone must not get the defaults
              // back).
              setMilestones(d.milestones.filter(isMilestone));
            }
            if (typeof d.projectStatus === "string") setProjectStatus(d.projectStatus);
            if (typeof d.targetDate === "string") setTargetDate(d.targetDate);
          }
        } catch { /* ignore corrupted data */ }
      }
      setReleaseLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!releaseLoaded) return;
    // Fast mirror (offline-safe; also the legacy source on first run).
    try {
      localStorage.setItem(
        "flowforge-release-plan",
        JSON.stringify({ milestones, projectStatus, targetDate })
      );
    } catch { /* ignore quota errors */ }
    // Debounced DB upsert — the DB row is the source of truth.
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveReleasePlan({ milestones, projectStatus, targetDate }).catch(() => {
        /* offline — the localStorage mirror above already holds the state */
      });
    }, 800);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [releaseLoaded, milestones, projectStatus, targetDate]);

  const toggleMilestone = useCallback((id: string) => {
    setMilestones((prev) => prev.map((m) => m.id === id ? { ...m, done: !m.done } : m));
  }, []);

  const removeMilestone = useCallback((id: string) => {
    setMilestones((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const addCustomTask = useCallback(() => {
    if (!newTask.trim()) return;
    setMilestones((prev) => [...prev, { id: `custom-${Date.now()}`, label: newTask.trim(), category: "custom", done: false }]);
    setNewTask("");
    setShowAddTask(false);
  }, [newTask]);

  const setMilestoneDate = useCallback((id: string, date: string) => {
    setMilestones((prev) => prev.map((m) => m.id === id ? { ...m, dueDate: date } : m));
  }, []);

  // Computed
  const completed = milestones.filter((m) => m.done).length;
  const total = milestones.length;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
  const prodDone = milestones.filter((m) => m.category === "production" && m.done).length;
  const prodTotal = milestones.filter((m) => m.category === "production").length;
  const promoDone = milestones.filter((m) => m.category === "promo" && m.done).length;
  const promoTotal = milestones.filter((m) => m.category === "promo").length;

  const daysUntilRelease = targetDate ? Math.max(0, Math.ceil((new Date(targetDate).getTime() - Date.now()) / 86400000)) : null;
  const currentStatus = STATUS_OPTIONS.find((s) => s.value === projectStatus) || STATUS_OPTIONS[0];

  const productionMilestones = milestones.filter((m) => m.category === "production");
  const promoMilestones = milestones.filter((m) => m.category === "promo");
  const customMilestones = milestones.filter((m) => m.category === "custom");

  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2"><span>📅</span> Release Plan</h3>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-mono">
          {completed}/{total} ({progress}%)
        </span>
      </div>

      {/* ── Progress Bar ── */}
      <div className="mb-4">
        <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-amber-500 to-amber-600" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-[10px] text-zinc-500">Produkcja: {prodDone}/{prodTotal}</span>
          <span className="text-[10px] text-zinc-500">Promocja: {promoDone}/{promoTotal}</span>
        </div>
      </div>

      {/* ── Status & Target Date ── */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <p className="text-[10px] text-zinc-500 mb-1.5 uppercase tracking-wider font-medium">Status projektu</p>
          <select value={projectStatus} onChange={(e) => setProjectStatus(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white text-xs focus:outline-none focus:ring-1 focus:ring-amber-500/50 appearance-none cursor-pointer">
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div>
          <p className="text-[10px] text-zinc-500 mb-1.5 uppercase tracking-wider font-medium">Data premiery</p>
          <div className="relative">
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white text-xs focus:outline-none focus:ring-1 focus:ring-amber-500/50 cursor-pointer" />
            {daysUntilRelease !== null && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-amber-400 font-mono pointer-events-none">
                {daysUntilRelease}d
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Active Status Badge ── */}
      <div className="flex items-center justify-between mb-4 p-3 rounded-xl bg-zinc-800 border border-zinc-700">
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-medium px-2.5 py-1 rounded-lg ${currentStatus.color}`}>{currentStatus.label}</span>
          {targetDate && (
            <span className="text-[10px] text-zinc-500">
              Cel: {new Date(targetDate).toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" })}
            </span>
          )}
        </div>
        {daysUntilRelease !== null && daysUntilRelease > 0 && (
          <span className="text-xs font-mono text-amber-400 font-bold">{daysUntilRelease} dni</span>
        )}
      </div>

      {/* ── Production Milestones ── */}
      <div className="mb-4">
        <h4 className="text-[10px] text-zinc-500 mb-2 uppercase tracking-wider font-medium flex items-center gap-1">
          <span>🎵</span> Produkcja
        </h4>
        <div className="space-y-1.5">
          {productionMilestones.map((ms) => (
            <MilestoneRow key={ms.id} milestone={ms} onToggle={toggleMilestone} onRemove={removeMilestone} onDateChange={setMilestoneDate} />
          ))}
        </div>
      </div>

      {/* ── Promo Milestones ── */}
      <div className="mb-4">
        <h4 className="text-[10px] text-zinc-500 mb-2 uppercase tracking-wider font-medium flex items-center gap-1">
          <span>📢</span> Promocja & Dystrybucja
        </h4>
        <div className="space-y-1.5">
          {promoMilestones.map((ms) => (
            <MilestoneRow key={ms.id} milestone={ms} onToggle={toggleMilestone} onRemove={removeMilestone} onDateChange={setMilestoneDate} />
          ))}
        </div>
      </div>

      {/* ── Custom Tasks ── */}
      {customMilestones.length > 0 && (
        <div className="mb-4">
          <h4 className="text-[10px] text-zinc-500 mb-2 uppercase tracking-wider font-medium flex items-center gap-1">
            <span>✏️</span> Własne zadania
          </h4>
          <div className="space-y-1.5">
            {customMilestones.map((ms) => (
              <MilestoneRow key={ms.id} milestone={ms} onToggle={toggleMilestone} onRemove={removeMilestone} onDateChange={setMilestoneDate} />
            ))}
          </div>
        </div>
      )}

      {/* ── Add Custom Task ── */}
      {showAddTask ? (
        <div className="flex gap-2 p-3 rounded-lg bg-zinc-800 border border-zinc-700">
          <input type="text" value={newTask} onChange={(e) => setNewTask(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCustomTask()}
            placeholder="Nazwa zadania..." autoFocus
            className="flex-1 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-600 text-white text-xs placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500/50" />
          <button onClick={addCustomTask} className="px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-400 text-xs font-medium hover:bg-amber-500/30 transition-colors">Dodaj</button>
          <button onClick={() => { setShowAddTask(false); setNewTask(""); }} className="px-2 py-1.5 rounded-lg bg-zinc-700 text-zinc-400 text-xs hover:text-white transition-colors">✕</button>
        </div>
      ) : (
        <button onClick={() => setShowAddTask(true)} className="w-full py-2.5 rounded-lg border border-dashed border-zinc-700 hover:border-amber-500/40 text-zinc-500 hover:text-amber-400 text-xs font-medium transition-all">
          + Dodaj własne zadanie
        </button>
      )}
    </div>
  );
}

function MilestoneRow({ milestone, onToggle, onRemove, onDateChange }: {
  milestone: Milestone;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onDateChange: (id: string, date: string) => void;
}) {
  const isOverdue = milestone.dueDate && !milestone.done && new Date(milestone.dueDate) < new Date();
  const isDueSoon = milestone.dueDate && !milestone.done && !isOverdue &&
    (new Date(milestone.dueDate).getTime() - Date.now()) < 3 * 86400000;

  return (
    <div className="flex items-center gap-2 group">
      <button onClick={() => onToggle(milestone.id)}
        className={`w-5 h-5 rounded-md shrink-0 flex items-center justify-center text-[10px] font-bold transition-all ${
          milestone.done
            ? "bg-green-500/20 text-green-400 border border-green-500/40"
            : "bg-zinc-800 text-zinc-600 border border-zinc-700 hover:border-amber-500/40 hover:text-amber-400"
        }`}>
        {milestone.done ? "✓" : ""}
      </button>
      <span className={`flex-1 text-xs transition-all ${milestone.done ? "text-zinc-500 line-through" : "text-zinc-200"}`}>
        {milestone.label}
      </span>
      {milestone.dueDate && (
        <span className={`text-[10px] font-mono ${isOverdue ? "text-red-400" : isDueSoon ? "text-amber-400" : "text-zinc-500"}`}>
          {new Date(milestone.dueDate).toLocaleDateString("pl-PL", { day: "numeric", month: "short" })}
        </span>
      )}
      <input type="date" value={milestone.dueDate || ""} onChange={(e) => onDateChange(milestone.id, e.target.value)}
        className="w-0 opacity-0 group-hover:w-24 group-hover:opacity-100 transition-all text-[10px] bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-zinc-400" />
      <button onClick={() => onRemove(milestone.id)}
        className="w-5 h-5 rounded flex items-center justify-center text-[10px] text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">
        ×
      </button>
    </div>
  );
}
