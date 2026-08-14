"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { getDashboardStats } from "@/actions/achievements";
import { getRecentLyrics } from "@/actions/lyrics";
import { getRecentProjects } from "@/actions/beats";
import { getDashboardChallenge, submitToChallenge } from "@/actions/challenges";
import { getMonthlyBudgetSummary } from "@/actions/budget";
import { daysSince, type LevelProgress } from "@/lib/progress";

interface Stats {
  lyricCount: number;
  beatCount: number;
  totalPoints: number;
  badges: number;
}

interface DashboardProgress {
  level: number;
  totalPoints: number;
  levelProgress: LevelProgress;
  displayName: string;
  avatarEmoji: string;
  streak: number;
  lastWritingDay: string | null;
}

interface DashboardChallenge {
  id: string;
  title: string;
  description: string;
  theme: string | null;
  prize: string | null;
  endDate: string; // ISO
  submitted: boolean;
  submissionCount: number;
  userName: string;
}

interface RecentLyric {
  id: string;
  title: string;
  lineCount: number;
  wordCount: number;
  syllableCount: number;
  versionCount: number;
  updatedAt: string; // ISO
}

interface RecentProject {
  id: string;
  title: string;
  takeCount: number;
  createdAt: string; // ISO
}

interface MonthlyBudget {
  total: number;
  count: number;
  byCategory: Record<string, number>;
}

// Same ids/labels/icons as the /budget page — display-only metadata.
const BUDGET_CATEGORIES: Record<string, { label: string; icon: string }> = {
  beat_license: { label: "Licencja na bit", icon: "🎵" },
  mix_master: { label: "Mix/Mastering", icon: "🎛️" },
  cover_art: { label: "Okładka", icon: "🎨" },
  promo: { label: "Promocja", icon: "📢" },
  studio: { label: "Sesja studyjna", icon: "🎙️" },
  equipment: { label: "Sprzęt", icon: "🎧" },
  other: { label: "Inne", icon: "📦" },
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "przed chwilą";
  if (mins < 60) return `${mins} min temu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} godz. temu`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} dni temu`;
  return new Date(iso).toLocaleDateString("pl-PL");
}

const QUICK_TILES = [
  { href: "/vault", label: "Nowy Tekst", icon: "✍️", color: "from-amber-500 to-amber-600", desc: "Otwórz edytor rymów" },
  { href: "/studio", label: "Sesja Nagraniowa", icon: "🎙️", color: "from-red-500 to-red-600", desc: "Nagraj nowy utwór" },
  { href: "/beats", label: "Gotowe Numery", icon: "🎵", color: "from-blue-500 to-blue-600", desc: "Przeglądaj gotowe numery" },
  { href: "/challenges", label: "Wyzwanie Tygodnia", icon: "⚔️", color: "from-purple-500 to-purple-600", desc: "Dołącz do cyphera" },
  { href: "/feed", label: "Ściana Raperów", icon: "🔥", color: "from-orange-500 to-orange-600", desc: "Pokaż swój tekst" },
  { href: "/inspirations", label: "Hall of Fame", icon: "🏆", color: "from-yellow-500 to-yellow-600", desc: "Inspiracje liryczne" },
  { href: "/budget", label: "Budżet", icon: "💰", color: "from-green-500 to-green-600", desc: "Zarządzaj finansami" },
  { href: "/cover", label: "Okładka", icon: "🎨", color: "from-pink-500 to-pink-600", desc: "Stwórz artwork" },
];

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({
    lyricCount: 0,
    beatCount: 0,
    totalPoints: 0,
    badges: 0,
  });
  const [recentLyrics, setRecentLyrics] = useState<RecentLyric[]>([]);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [progress, setProgress] = useState<DashboardProgress | null>(null);
  const [challenge, setChallenge] = useState<DashboardChallenge | null>(null);
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [submitTitle, setSubmitTitle] = useState("");
  const [submitText, setSubmitText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [budget, setBudget] = useState<MonthlyBudget | null>(null);

  // Load stats + recent lyrics from the DB and listen for live updates.
  useEffect(() => {
    let cancelled = false;

    // DB-primary: ALL four stat cards come from the backend (lyricCount =
    // prisma.lyric.count(), the same source as Numery/Punkty/Odznaki). The
    // vault localStorage mirror is never consulted, so the cards can't drift
    // apart — a stale mirror would otherwise show a different „Teksty” count.
    const loadStats = () => {
      getDashboardStats()
        .then((s) => {
          if (cancelled) return;
          setStats({
            lyricCount: s.lyricCount,
            beatCount: s.beatCount,
            totalPoints: s.totalPoints,
            badges: s.achievementCount,
          });
          setProgress({
            level: s.level,
            totalPoints: s.totalPoints,
            levelProgress: s.levelProgress,
            displayName: s.displayName,
            avatarEmoji: s.avatarEmoji,
            streak: s.streak,
            lastWritingDay: s.lastWritingDay,
          });
        })
        .catch(() => {
          /* DB unavailable — keep the last known values */
        });
    };

    loadStats();

    const loadBudget = () => {
      getMonthlyBudgetSummary()
        .then((b) => {
          if (cancelled) return;
          setBudget(b);
        })
        .catch(() => {
          /* DB unavailable — the tile stays hidden */
        });
    };

    loadBudget();

    getDashboardChallenge()
      .then((c) => {
        if (cancelled) return;
        setChallenge(c);
      })
      .catch(() => {
        /* DB unavailable — the tile stays hidden */
      });

    const loadRecent = () => {
      getRecentLyrics(5)
        .then((rows) => {
          if (cancelled) return;
          setRecentLyrics(
            rows.map((r) => ({
              id: r.id,
              title: r.title,
              lineCount: r.lineCount ?? 0,
              wordCount: r.wordCount ?? 0,
              syllableCount: r.syllableCount ?? 0,
              versionCount: r._count?.versions ?? 0,
              updatedAt: new Date(r.updatedAt).toISOString(),
            }))
          );
        })
        .catch(() => {
          /* DB unavailable — leave the section empty */
        });
    };

    loadRecent();

    const loadRecentProjects = () => {
      getRecentProjects(5)
        .then((rows) => {
          if (cancelled) return;
          setRecentProjects(rows);
        })
        .catch(() => {
          /* DB unavailable — leave the section empty */
        });
    };

    loadRecentProjects();

    // Live updates re-fetch from the DB too — the mirror is not a source of
    // truth, so a vault save in another tab shows up on the cards only after
    // the backend write lands.
    const refresh = () => {
      loadStats();
      loadBudget();
      loadRecent();
      loadRecentProjects();
    };

    // Listen for custom event when Vault updates versions
    window.addEventListener("flowforge-versions-updated", refresh);
    // Listen for custom event when the Studio saves a project
    window.addEventListener("flowforge-library-updated", refresh);
    // Listen for storage changes from other tabs
    window.addEventListener("storage", refresh);

    return () => {
      cancelled = true;
      window.removeEventListener("flowforge-versions-updated", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const handleChallengeSubmit = async () => {
    if (!challenge || submitting) return;
    if (!submitText.trim()) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      await submitToChallenge({
        challengeId: challenge.id,
        authorName: challenge.userName,
        title: submitTitle.trim() || challenge.title,
        content: submitText.trim(),
      });
      setChallenge((prev) =>
        prev
          ? { ...prev, submitted: true, submissionCount: prev.submissionCount + 1 }
          : prev
      );
      setShowSubmitForm(false);
      setSubmitTitle("");
      setSubmitText("");
    } catch {
      setSubmitError("⚠️ Nie udało się zgłosić — spróbuj ponownie");
    } finally {
      setSubmitting(false);
    }
  };

  const challengeDaysLeft = challenge
    ? Math.max(0, Math.ceil((new Date(challenge.endDate).getTime() - Date.now()) / 86400000))
    : null;

  return (
    <AppShell>
      <div className="space-y-8 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">
              Witaj w <span className="text-gradient-amber">FlowForge</span>
            </h1>
            <p className="text-zinc-400 mt-1">Twoje studio rapowe w jednym miejscu</p>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard icon="📝" label="Teksty" value={stats.lyricCount} color="amber" />
          <StatsCard icon="🎵" label="Numery" value={stats.beatCount} color="blue" />
          <StatsCard icon="⭐" label="Punkty" value={stats.totalPoints} color="yellow" />
          <StatsCard icon="🏅" label="Odznaki" value={stats.badges} color="purple" />
        </div>

        {/* Streak + Level progress */}
        {progress && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Writing streak */}
            <div className="rounded-2xl bg-gradient-to-br from-orange-500/10 to-red-500/5 border border-orange-500/20 p-5">
              <div className="flex items-center gap-3">
                <span className={`text-3xl ${progress.streak > 0 ? "" : "grayscale opacity-40"}`}>🔥</span>
                <div>
                  <p className="text-2xl font-bold text-white">
                    {progress.streak > 0 ? `${progress.streak} ${progress.streak === 1 ? "dzień" : "dni"} z rzędu` : "Brak serii"}
                  </p>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    {progress.streak > 0
                      ? progress.lastWritingDay && daysSince(progress.lastWritingDay) === 0
                        ? "Napisałeś dziś — podtrzymaj serię! ✍️"
                        : "Ostatnio wczoraj — napisz dziś, aby nie przerwać serii"
                      : progress.lastWritingDay
                        ? `Ostatnio pisałeś ${daysSince(progress.lastWritingDay)} dni temu — zacznij nową serię`
                        : "Zapisz pierwszą wersję w The Vault, aby rozpalić serię"}
                  </p>
                </div>
              </div>
            </div>

            {/* Level progress */}
            <div className="rounded-2xl bg-gradient-to-br from-amber-500/10 to-purple-500/5 border border-amber-500/20 p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-white">
                  {progress.avatarEmoji} {progress.displayName} · Poziom {progress.levelProgress.level}
                </p>
                <span className="text-[11px] font-mono text-amber-400">
                  {Math.round(progress.levelProgress.progress * 100)}%
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-amber-500 to-purple-500"
                  style={{ width: `${Math.round(progress.levelProgress.progress * 100)}%` }}
                />
              </div>
              <p className="text-[11px] text-zinc-500 mt-2">
                {progress.levelProgress.next > progress.levelProgress.current
                  ? `${progress.totalPoints.toLocaleString("pl-PL")} pkt • ${(progress.levelProgress.next - progress.totalPoints).toLocaleString("pl-PL")} pkt do poziomu ${progress.levelProgress.level + 1}`
                  : `Maksymalny poziom — ${progress.totalPoints.toLocaleString("pl-PL")} pkt 🏆`}
              </p>
            </div>
          </div>
        )}

        {/* Active challenge tile */}
        {challenge && (
          <div className="rounded-2xl bg-gradient-to-br from-purple-500/10 to-red-500/5 border border-purple-500/20 p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-red-500 flex items-center justify-center text-lg shrink-0">
                  ⚔️
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium">Aktywne wyzwanie</p>
                  <h3 className="text-sm font-semibold text-white truncate">{challenge.title}</h3>
                  <p className="text-[11px] text-zinc-400">{challenge.description}</p>
                </div>
              </div>
              {/* Countdown to deadline */}
              {challengeDaysLeft !== null && (
                <div className="text-right shrink-0">
                  <span className="text-xl font-bold font-mono text-purple-400">{challengeDaysLeft}d</span>
                  <p className="text-[10px] text-zinc-500">
                    {challengeDaysLeft === 1 ? "ostatni dzień!" : "dni do końca"}
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
              {challenge.prize && <p className="text-[11px] text-zinc-400 truncate">🎁 {challenge.prize}</p>}
              <span
                className={`text-[11px] font-medium px-2.5 py-1 rounded-lg shrink-0 ${
                  challenge.submitted
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-zinc-800 text-zinc-400"
                }`}
              >
                {challenge.submitted ? "✔ Zgłoszono się" : "Nie zgłoszono się"} • {challenge.submissionCount}{" "}
                {challenge.submissionCount === 1 ? "zgłoszenie" : "zgłoszeń"}
              </span>
            </div>

            {/* Submit / CTA */}
            <div className="mt-4">
              {challenge.submitted ? (
                <Link
                  href="/challenges"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 text-xs font-medium hover:bg-zinc-700 hover:text-white transition-colors"
                >
                  Przejdź do wyzwań →
                </Link>
              ) : showSubmitForm ? (
                <div className="space-y-2 p-3 rounded-xl bg-zinc-800/60 border border-zinc-700">
                  <input
                    type="text"
                    value={submitTitle}
                    onChange={(e) => setSubmitTitle(e.target.value)}
                    placeholder="Tytuł / nazwa wersu..."
                    className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-white text-xs placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-purple-500/50"
                  />
                  <textarea
                    rows={3}
                    value={submitText}
                    onChange={(e) => setSubmitText(e.target.value)}
                    placeholder="Twój wers..."
                    className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-white text-xs placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-purple-500/50 resize-none"
                  />
                  {submitError && <p className="text-[11px] text-red-400">{submitError}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={handleChallengeSubmit}
                      disabled={submitting || !submitText.trim()}
                      className="px-4 py-2 rounded-lg bg-purple-500/20 text-purple-300 text-xs font-medium hover:bg-purple-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {submitting ? "Zgłaszanie..." : "Zgłoś"}
                    </button>
                    <button
                      onClick={() => {
                        setShowSubmitForm(false);
                        setSubmitError("");
                      }}
                      className="px-3 py-2 rounded-lg bg-zinc-800 text-zinc-400 text-xs hover:text-white transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowSubmitForm(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-500/20 text-purple-300 text-xs font-medium hover:bg-purple-500/30 transition-colors"
                >
                  ⚔️ Weź udział
                </button>
              )}
            </div>
          </div>
        )}

        {/* Budget at a glance — current-month expenses, DB-primary */}
        {budget && (
          <div className="rounded-2xl bg-gradient-to-br from-green-500/10 to-emerald-500/5 border border-green-500/20 p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-lg shrink-0">
                  💰
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium">
                    Budżet w pigułce •{" "}
                    {new Date().toLocaleDateString("pl-PL", { month: "long" }).replace(/^./, (c) => c.toUpperCase())}
                  </p>
                  <p className="text-2xl font-bold text-white">
                    {budget.total.toLocaleString("pl-PL")}{" "}
                    <span className="text-sm font-normal text-zinc-400">PLN</span>
                  </p>
                  <p className="text-[11px] text-zinc-400">
                    {budget.count === 0
                      ? "Brak wydatków w tym miesiącu"
                      : `${budget.count} ${budget.count === 1 ? "wydatek" : budget.count < 5 ? "wydatki" : "wydatków"} w tym miesiącu`}
                  </p>
                </div>
              </div>
              <Link
                href="/budget"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-green-500/10 text-green-400 text-xs font-medium hover:bg-green-500/20 transition-colors shrink-0"
              >
                Przejdź do budżetu →
              </Link>
            </div>
            {budget.count > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {Object.entries(budget.byCategory)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 3)
                  .map(([cat, total]) => {
                    const meta = BUDGET_CATEGORIES[cat] || { label: cat, icon: "📦" };
                    return (
                      <span
                        key={cat}
                        className="px-2.5 py-1 rounded-lg bg-zinc-800/60 border border-zinc-700/40 text-[11px] text-zinc-300"
                      >
                        {meta.icon} {meta.label} · {total.toLocaleString("pl-PL")} PLN
                      </span>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {/* Quick Access Tiles */}
        <div>
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <span className="text-amber-500">⚡</span> Szybki Dostęp
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {QUICK_TILES.map((tile) => (
              <Link
                key={tile.href}
                href={tile.href}
                className="group relative overflow-hidden rounded-2xl bg-zinc-900/50 border border-zinc-800/50 p-4 card-hover"
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${tile.color} opacity-0 group-hover:opacity-5 transition-opacity duration-300`} />
                <div className="relative">
                  <span className="text-2xl mb-2 block group-hover:scale-110 transition-transform duration-200">
                    {tile.icon}
                  </span>
                  <h3 className="text-sm font-semibold text-white mb-0.5">{tile.label}</h3>
                  <p className="text-[11px] text-zinc-500">{tile.desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Recent Lyrics + Saved Projects — both DB-primary */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <span className="text-amber-500">📝</span> Ostatnio Edytowane
              </h2>
            <Link href="/vault" className="text-sm text-amber-500 hover:text-amber-400 transition-colors">
              Zobacz wszystkie →
            </Link>
          </div>
          {recentLyrics.length > 0 ? (
            <div className="space-y-2">
              {recentLyrics.map((lyric) => (
                <Link
                  key={lyric.id}
                  href={`/vault?track=${encodeURIComponent(lyric.id)}`}
                  className="group flex items-center justify-between gap-3 rounded-2xl bg-zinc-900/50 border border-zinc-800/50 px-4 py-3 card-hover"
                >
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-white truncate group-hover:text-amber-400 transition-colors">
                      {lyric.title}
                    </h3>
                    <p className="text-[11px] text-zinc-500 mt-0.5 truncate">
                      {lyric.lineCount} wersów • {lyric.wordCount} słów • {lyric.syllableCount} sylab •{" "}
                      {lyric.versionCount} wersji
                    </p>
                  </div>
                  <span className="text-[11px] text-zinc-600 shrink-0">{timeAgo(lyric.updatedAt)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/50 p-12 text-center">
              <span className="text-4xl block mb-3">📭</span>
              <h3 className="text-lg font-semibold text-white mb-2">Brak tekstów</h3>
              <p className="text-sm text-zinc-400 mb-4">Zacznij tworzyć! Napisz swój pierwszy tekst w The Vault.</p>
              <Link
                href="/vault"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500/10 text-amber-500 text-sm font-medium hover:bg-amber-500/20 transition-colors"
              >
                ✍️ Nowy Tekst
              </Link>
            </div>
          )}
        </div>

          {/* Recently Saved Projects — DB-primary (SavedProject.createdAt) */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <span className="text-blue-500">🎛️</span> Ostatnio zapisane projekty
              </h2>
              <Link href="/beats" className="text-sm text-blue-500 hover:text-blue-400 transition-colors">
                Zobacz wszystkie →
              </Link>
            </div>
            {recentProjects.length > 0 ? (
              <div className="space-y-2">
                {recentProjects.map((p) => (
                  <Link
                    key={p.id}
                    href="/beats"
                    className="group flex items-center justify-between gap-3 rounded-2xl bg-zinc-900/50 border border-zinc-800/50 px-4 py-3 card-hover"
                  >
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-white truncate group-hover:text-blue-400 transition-colors">
                        {p.title}
                      </h3>
                      <p className="text-[11px] text-zinc-500 mt-0.5 truncate">
                        {p.takeCount > 0 ? `${p.takeCount} ${p.takeCount === 1 ? "take" : "take'ów"} • ` : ""}
                        projekt ze Studio
                      </p>
                    </div>
                    <span className="text-[11px] text-zinc-600 shrink-0">{timeAgo(p.createdAt)}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/50 p-8 text-center">
                <span className="text-3xl block mb-2">🎛️</span>
                <h3 className="text-sm font-semibold text-white mb-1">Brak zapisanych projektów</h3>
                <p className="text-[11px] text-zinc-400 mb-3">Zapisz sesję w Studio, aby zobaczyć ją tutaj.</p>
                <Link
                  href="/studio"
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-blue-500/10 text-blue-500 text-xs font-medium hover:bg-blue-500/20 transition-colors"
                >
                  🎙️ Otwórz Studio
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Welcome Banner */}
        <div className="rounded-2xl bg-gradient-to-br from-amber-500/10 via-zinc-900/50 to-purple-500/10 border border-zinc-800/50 p-8 text-center">
          <span className="text-5xl block mb-4">🎤</span>
          <h3 className="text-2xl font-bold text-white mb-3">
            Zacznij swoją przygodę z FlowForge
          </h3>
          <p className="text-sm text-zinc-400 max-w-md mx-auto mb-6">
            Napisz pierwszy tekst, nagraj wokal lub dołącz do wyzwania społeczności. Twoje studio rapowe czeka!
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Link
              href="/vault"
              className="px-5 py-2.5 rounded-xl bg-amber-500 text-zinc-900 text-sm font-semibold hover:bg-amber-400 transition-colors"
            >
              ✍️ Zacznij Pisać
            </Link>
            <Link
              href="/academy"
              className="px-5 py-2.5 rounded-xl bg-zinc-800 text-white text-sm font-medium hover:bg-zinc-700 transition-colors"
            >
              📚 Akademia
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function StatsCard({ icon, label, value, color }: { icon: string; label: string; value: number; color: string }) {
  const colorMap: Record<string, string> = {
    amber: "from-amber-500/10 to-amber-600/5 border-amber-500/20",
    blue: "from-blue-500/10 to-blue-600/5 border-blue-500/20",
    yellow: "from-yellow-500/10 to-yellow-600/5 border-yellow-500/20",
    purple: "from-purple-500/10 to-purple-600/5 border-purple-500/20",
  };

  return (
    <div className={`rounded-2xl bg-gradient-to-br ${colorMap[color]} border p-4 card-hover`}>
      <span className="text-2xl mb-2 block">{icon}</span>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-xs text-zinc-400 mt-0.5">{label}</p>
    </div>
  );
}
