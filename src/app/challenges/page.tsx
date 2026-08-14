"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import {
  CHALLENGES,
  MAX_SCORE,
  getChallengeProgress,
  getCompletedCount,
  getTotalScore,
  loadChallengeState,
  resetChallengeProgress,
} from "@/lib/challenges";
import type { ChallengeState } from "@/lib/challenges";
import {
  getActiveChallenges,
  getChallengeProgress as getChallengeProgressDb,
  saveChallengeProgress,
} from "@/actions/challenges";
import { tryDbWrite } from "@/lib/db-sync";
import { awardPoints, deleteAchievement } from "@/actions/achievements";

export default function ChallengesPage() {
  const [state, setState] = useState<ChallengeState | null>(null);
  const [cyphers, setCyphers] = useState<Awaited<ReturnType<typeof getActiveChallenges>>>([]);
  // badgeIds already pushed to the DB profile (awardPoints is idempotent, but
  // this avoids re-issuing the server call on every refresh).
  const syncedRef = useRef<Set<string>>(new Set());

  // Mirror completed challenges into the DB profile (UserAchievement rows),
  // so the backend tracks the same score the Profile page reads.
  const syncToDb = useCallback((s: ChallengeState) => {
    for (const c of CHALLENGES) {
      const badgeId = `challenge-${c.id}`;
      if (s.completed[c.id] && !syncedRef.current.has(badgeId)) {
        syncedRef.current.add(badgeId);
        tryDbWrite(() => awardPoints(badgeId, c.title, c.icon, c.description, c.points));
      }
    }
  }, []);

  // Load on mount — DB-primary with the localStorage mirror as an offline
  // fallback. Legacy localStorage-only progress is imported into the DB so it
  // survives a browser storage wipe.
  const refresh = useCallback(() => setState(loadChallengeState()), []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let db: ChallengeState | null = null;
      try {
        db = await getChallengeProgressDb();
      } catch {
        /* DB unavailable — fall back to the local cache below */
      }
      if (cancelled) return;
      if (db) {
        setState(db);
        return;
      }
      const local = loadChallengeState();
      setState(local);
      try {
        if (localStorage.getItem("flowforge-challenge-state")) {
          // Import the legacy localStorage copy into the DB.
          await saveChallengeProgress(local);
        }
      } catch {
        /* offline — the mirror keeps working */
      }
    })();
    // Refresh live when any page updates the challenge store — the mirror is
    // kept in sync by recordChallengeEvent, so re-reading it stays correct.
    // Community cyphers — the seeded Challenge rows with deadlines + votes.
    getActiveChallenges()
      .then((rows) => {
        if (!cancelled) setCyphers(rows);
      })
      .catch(() => {
        /* DB unavailable — the section stays hidden */
      });

    const onUpdate = () => refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "flowforge-challenge-state") refresh();
    };
    window.addEventListener("flowforge-challenges-updated", onUpdate);
    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener("flowforge-challenges-updated", onUpdate);
      window.removeEventListener("storage", onStorage);
    };
  }, [refresh]);

  // Sync every newly completed challenge to the DB once the state settles.
  useEffect(() => {
    if (state) syncToDb(state);
  }, [state, syncToDb]);

  const onReset = useCallback(async () => {
    await resetChallengeProgress();
    // Wipe the mirror on the backend too.
    for (const c of CHALLENGES) {
      const badgeId = `challenge-${c.id}`;
      syncedRef.current.delete(badgeId);
      tryDbWrite(() => deleteAchievement(badgeId));
    }
    refresh();
  }, [refresh]);

  if (!state) {
    return (
      <AppShell>
        <div className="space-y-6 animate-fade-in">
          <div className="h-40 rounded-2xl bg-zinc-900/50 border border-zinc-800/50 animate-pulse" />
        </div>
      </AppShell>
    );
  }

  const score = getTotalScore(state);
  const completed = getCompletedCount(state);
  const overallProgress = completed / CHALLENGES.length;

  return (
    <AppShell>
      <div className="space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-red-500 flex items-center justify-center">
              <span className="text-lg">⚔️</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Wyzwania</h1>
              <p className="text-sm text-zinc-400">Ukończ wyzwania w Studio i The Vault, zdobywaj punkty</p>
            </div>
          </div>
          <button
            onClick={onReset}
            className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-500 text-xs font-medium hover:bg-zinc-700 hover:text-red-400 transition-colors"
            title="Wyzeruj wszystkie punkty i postęp"
          >
            ↺ Resetuj postęp
          </button>
        </div>

        {/* ── Total Score dashboard ── */}
        <div className="rounded-2xl bg-gradient-to-br from-purple-500/10 via-zinc-900/60 to-red-500/10 border border-purple-500/20 p-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium">Twój wynik</p>
              <p className="text-4xl font-bold font-mono text-white mt-1">
                {score.toLocaleString("pl-PL")}
                <span className="text-lg text-zinc-500 font-normal"> / {MAX_SCORE.toLocaleString("pl-PL")} pkt</span>
              </p>
              <p className="text-xs text-zinc-400 mt-1">
                🏅 {completed} z {CHALLENGES.length} wyzwań ukończonych
              </p>
            </div>
            <div className="text-center px-5 py-3 rounded-xl bg-zinc-900/70 border border-zinc-700/50">
              <p className="text-3xl font-bold">{completed === CHALLENGES.length ? "👑" : completed >= 5 ? "🔥" : "⭐"}</p>
              <p className="text-[10px] text-zinc-500 mt-0.5">
                {completed === CHALLENGES.length
                  ? "Wszystkie wyzwania!"
                  : completed >= 5
                    ? "Połowa drogi!"
                    : "Kontynuuj!"}
              </p>
            </div>
          </div>
          {/* Overall progress bar */}
          <div className="mt-4">
            <div className="h-2.5 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-purple-500 to-red-500 transition-all duration-500"
                style={{ width: `${Math.round(overallProgress * 100)}%` }}
              />
            </div>
            <p className="text-[10px] text-zinc-500 mt-1.5 font-mono">
              {Math.round(overallProgress * 100)}% • {score.toLocaleString("pl-PL")} / {MAX_SCORE.toLocaleString("pl-PL")} pkt
            </p>
          </div>
        </div>

        {/* ── Challenges grid ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {CHALLENGES.map((c) => {
            const isDone = !!state.completed[c.id];
            const progress = getChallengeProgress(state, c);
            return (
              <div
                key={c.id}
                className={`rounded-2xl border p-5 transition-all card-hover ${
                  isDone
                    ? "bg-emerald-500/[0.06] border-emerald-500/40 shadow-lg shadow-emerald-500/10"
                    : "bg-zinc-900/50 border-zinc-800/50"
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 ${
                        isDone ? "bg-emerald-500/15" : "bg-zinc-800"
                      }`}
                    >
                      {c.icon}
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-white truncate">{c.title}</h3>
                      <p className="text-[10px] text-zinc-500">{c.description}</p>
                    </div>
                  </div>
                  {/* Points badge */}
                  <span
                    className={`shrink-0 px-2 py-1 rounded-lg text-[10px] font-bold font-mono ${
                      isDone ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/10 text-amber-400"
                    }`}
                  >
                    +{c.points} pkt
                  </span>
                </div>

                {/* Progress bar */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        isDone ? "bg-emerald-500" : "bg-amber-500/70"
                      }`}
                      style={{ width: `${Math.round(progress * 100)}%` }}
                    />
                  </div>
                  <span className={`text-[10px] font-mono ${isDone ? "text-emerald-400" : "text-zinc-500"}`}>
                    {isDone ? "✓" : `${Math.round(progress * 100)}%`}
                  </span>
                </div>

                {/* Completion badge */}
                {isDone && (
                  <p className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
                    <span className="w-4 h-4 rounded-full bg-emerald-500/20 flex items-center justify-center text-[9px]">✓</span>
                    Ukończono {state.completed[c.id] ? `• ${new Date(state.completed[c.id]).toLocaleDateString("pl-PL")}` : ""}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Community cyphers — active challenges with deadlines + votes */}
        {cyphers.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <span className="text-purple-500">⚔️</span> Aktywne Cyphery
              </h2>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Społeczność</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {cyphers.map((c) => {
                const daysLeft = Math.max(
                  0,
                  Math.ceil((new Date(c.endDate).getTime() - Date.now()) / 86400000)
                );
                const top = c.submissions.slice(0, 3);
                return (
                  <div
                    key={c.id}
                    className="rounded-2xl bg-gradient-to-br from-purple-500/10 to-red-500/5 border border-purple-500/20 p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium">Cypher</p>
                        <h3 className="text-base font-bold text-white truncate">{c.title}</h3>
                        <p className="text-xs text-zinc-400 mt-1">{c.description}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-xl font-bold font-mono text-purple-400">{daysLeft}d</span>
                        <p className="text-[10px] text-zinc-500">{daysLeft === 1 ? "ostatni dzień!" : "do końca"}</p>
                      </div>
                    </div>
                    {c.prize && <p className="text-[11px] text-zinc-400 mt-3">🎁 {c.prize}</p>}
                    <div className="mt-3">
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-1.5">
                        Zgłoszenia • {c.submissions.length}
                      </p>
                      {top.length > 0 ? (
                        <ul className="space-y-1.5">
                          {top.map((s) => (
                            <li
                              key={s.id}
                              className="flex items-center justify-between gap-2 rounded-lg bg-zinc-800/40 border border-zinc-700/40 px-3 py-2"
                            >
                              <div className="min-w-0">
                                <p className="text-xs text-zinc-200 font-medium truncate">{s.title}</p>
                                <p className="text-[10px] text-zinc-500 truncate">{s.authorName}</p>
                              </div>
                              <span className="text-[11px] font-mono text-amber-400 shrink-0">▲ {s.voteCount}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[11px] text-zinc-500">Brak zgłoszeń — bądź pierwszy!</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* How It Works */}
        <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/50 p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Jak zdobywać punkty?</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-zinc-800/30 text-center">
              <span className="text-2xl block mb-2">🎛️</span>
              <h4 className="text-sm font-semibold text-white mb-1">Twórz w Studio</h4>
              <p className="text-xs text-zinc-400">Nagrywaj take'y, tnij i przycinaj fragmenty, zapisuj projekty</p>
            </div>
            <div className="p-4 rounded-xl bg-zinc-800/30 text-center">
              <span className="text-2xl block mb-2">📝</span>
              <h4 className="text-sm font-semibold text-white mb-1">Pisz w The Vault</h4>
              <p className="text-xs text-zinc-400">Im więcej wersów, tym bliżej do Mistrza Rymu i Maratonu Wersów</p>
            </div>
            <div className="p-4 rounded-xl bg-zinc-800/30 text-center">
              <span className="text-2xl block mb-2">🏆</span>
              <h4 className="text-sm font-semibold text-white mb-1">Automatycznie</h4>
              <p className="text-xs text-zinc-400">Punkty przyznają się same — postęp zapisuje się w przeglądarce</p>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
