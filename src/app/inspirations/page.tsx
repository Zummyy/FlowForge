"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { useToast } from "@/components/studio/useToast";
import { ToastView } from "@/components/studio/ToastView";
import { fetchDbOrCache, saveCache, tryDbWrite } from "@/lib/db-sync";
import { createInspiration, getInspirations, voteInspiration } from "@/actions/inspirations";

const CACHE_KEY = "flowforge-inspirations";

type DbInspiration = Awaited<ReturnType<typeof getInspirations>>[number];

interface InspirationCard {
  id: string;
  artist: string;
  songTitle: string;
  lyrics: string;
  analysis?: string;
  tags: string[];
  difficulty: string;
  year?: number;
  album?: string;
  voteCount: number;
}

function toCard(i: DbInspiration): InspirationCard {
  let tags: string[] = [];
  try {
    tags = i.tags ? (JSON.parse(i.tags) as string[]) : [];
  } catch {
    tags = [];
  }
  return {
    id: i.id,
    artist: i.artist,
    songTitle: i.songTitle,
    lyrics: i.lyrics,
    analysis: i.analysis || undefined,
    tags,
    difficulty: i.difficulty,
    year: i.year || undefined,
    album: i.album || undefined,
    voteCount: i.voteCount,
  };
}

const DIFFICULTY_LABEL: Record<string, { label: string; cls: string }> = {
  easy: { label: "Łatwy", cls: "bg-green-500/10 text-green-400 border-green-500/30" },
  medium: { label: "Średni", cls: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  hard: { label: "Trudny", cls: "bg-red-500/10 text-red-400 border-red-500/30" },
};

/** Which card ids this browser already voted for (persisted per browser). */
function loadVotes(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem("flowforge-inspiration-votes") || "[]"));
  } catch {
    return new Set();
  }
}

export default function InspirationsPage() {
  const [cards, setCards] = useState<InspirationCard[]>([]);
  const [cardsLoaded, setCardsLoaded] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newInsp, setNewInsp] = useState({ artist: "", songTitle: "", lyrics: "" });
  const [query, setQuery] = useState("");
  const [difficultyFilter, setDifficultyFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [votedIds, setVotedIds] = useState<Set<string>>(loadVotes);

  const { toast, showToast } = useToast();

  // ── Load inspirations from the DB (fallback: localStorage cache) ──
  useEffect(() => {
    let cancelled = false;
    fetchDbOrCache(CACHE_KEY, async () => (await getInspirations()).map(toCard), [] as InspirationCard[]).then((rows) => {
      if (cancelled) return;
      setCards(rows);
      setCardsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Mirror the list into the cache whenever it changes ──
  useEffect(() => {
    if (!cardsLoaded) return;
    saveCache(CACHE_KEY, cards);
  }, [cards, cardsLoaded]);

  const addInspiration = useCallback(async () => {
    if (!newInsp.artist.trim() || !newInsp.songTitle.trim() || !newInsp.lyrics.trim()) return;
    const artist = newInsp.artist.trim();
    const songTitle = newInsp.songTitle.trim();
    const lyrics = newInsp.lyrics.trim();
    setNewInsp({ artist: "", songTitle: "", lyrics: "" });
    setShowAddForm(false);
    const ok = await tryDbWrite(async () => {
      const created = await createInspiration({ artist, songTitle, lyrics });
      setCards((prev) => [toCard(created), ...prev]);
    });
    if (!ok) {
      showToast("⚠️ Baza danych niedostępna — inspiracja zapisana lokalnie", "info");
    } else {
      showToast(`🏆 Dodano: ${artist} — ${songTitle}`);
    }
  }, [newInsp, showToast]);

  const toggleVote = useCallback(
    (id: string) => {
      const nowVoted = !votedIds.has(id);
      // Optimistic UI + persist the per-browser vote set.
      setVotedIds((prev) => {
        const next = new Set(prev);
        if (nowVoted) next.add(id);
        else next.delete(id);
        try {
          localStorage.setItem("flowforge-inspiration-votes", JSON.stringify([...next]));
        } catch {
          /* quota — best effort */
        }
        return next;
      });
      setCards((prev) =>
        prev.map((c) => (c.id === id ? { ...c, voteCount: c.voteCount + (nowVoted ? 1 : -1) } : c))
      );
      tryDbWrite(() => voteInspiration(id, nowVoted));
    },
    [votedIds]
  );

  // Client-side filtering: search text + difficulty + tag.
  const availableTags = useMemo(() => {
    const all = new Set<string>();
    for (const c of cards) for (const t of c.tags) all.add(t);
    return [...all].sort();
  }, [cards]);

  const filteredCards = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cards.filter((c) => {
      if (difficultyFilter !== "all" && c.difficulty !== difficultyFilter) return false;
      if (tagFilter !== "all" && !c.tags.includes(tagFilter)) return false;
      if (q && !(`${c.artist} ${c.songTitle}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [cards, query, difficultyFilter, tagFilter]);

  return (
    <AppShell>
      {/* Toast notification — shared component driven by the useToast hook */}
      <ToastView toast={toast} />
      <div className="space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-500 to-amber-500 flex items-center justify-center">
              <span className="text-lg">🏆</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Polish Lyric Hall of Fame</h1>
              <p className="text-sm text-zinc-400">Legendarny polski hip-hop • Analiza rymów i technik</p>
            </div>
          </div>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="px-4 py-2 rounded-xl bg-amber-500/10 text-amber-500 text-sm font-medium hover:bg-amber-500/20 transition-colors"
          >
            + Dodaj Inspirację
          </button>
        </div>

        {/* Search + filters */}
        <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/50 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm">🔍</span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Szukaj artysty lub utworu..."
              className="flex-1 px-3 py-2 rounded-xl bg-zinc-800/50 border border-zinc-700/30 text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/30"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Trudność:</span>
            {[
              { v: "all", label: "Wszystkie" },
              { v: "easy", label: "Łatwy" },
              { v: "medium", label: "Średni" },
              { v: "hard", label: "Trudny" },
            ].map((d) => (
              <button
                key={d.v}
                onClick={() => setDifficultyFilter(d.v)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                  difficultyFilter === d.v
                    ? "bg-amber-500/15 text-amber-400 border-amber-500/40"
                    : "bg-zinc-800 text-zinc-400 border-zinc-700/50 hover:text-white"
                }`}
              >
                {d.label}
              </button>
            ))}
            {availableTags.length > 0 && (
              <>
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium ml-3">Tag:</span>
                <button
                  onClick={() => setTagFilter("all")}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                    tagFilter === "all"
                      ? "bg-amber-500/15 text-amber-400 border-amber-500/40"
                      : "bg-zinc-800 text-zinc-400 border-zinc-700/50 hover:text-white"
                  }`}
                >
                  Wszystkie
                </button>
                {availableTags.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTagFilter(t)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                      tagFilter === t
                        ? "bg-amber-500/15 text-amber-400 border-amber-500/40"
                        : "bg-zinc-800 text-zinc-400 border-zinc-700/50 hover:text-white"
                    }`}
                  >
                    #{t}
                  </button>
                ))}
              </>
            )}
          </div>
        </div>

        {/* Add Form */}
        {showAddForm && (
          <div className="rounded-2xl bg-zinc-900/50 border border-amber-500/20 p-6 space-y-4 animate-slide-down">
            <h3 className="text-lg font-semibold text-white">Nowa Inspiracja</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <input
                type="text"
                value={newInsp.artist}
                onChange={(e) => setNewInsp({ ...newInsp, artist: e.target.value })}
                placeholder="Artysta..."
                className="w-full px-4 py-2.5 rounded-xl bg-zinc-800/50 border border-zinc-700/30 text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/30"
              />
              <input
                type="text"
                value={newInsp.songTitle}
                onChange={(e) => setNewInsp({ ...newInsp, songTitle: e.target.value })}
                placeholder="Tytuł utworu..."
                className="w-full px-4 py-2.5 rounded-xl bg-zinc-800/50 border border-zinc-700/30 text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/30"
              />
            </div>
            <textarea
              value={newInsp.lyrics}
              onChange={(e) => setNewInsp({ ...newInsp, lyrics: e.target.value })}
              placeholder="Wklej fragment tekstu do analizy..."
              className="w-full h-32 px-4 py-3 rounded-xl bg-zinc-800/50 border border-zinc-700/30 text-white font-mono text-sm placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/30 resize-none"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-400 text-sm font-medium hover:bg-zinc-700 transition-colors"
              >
                Anuluj
              </button>
              <button
                onClick={addInspiration}
                className="px-4 py-2 rounded-xl bg-amber-500 text-zinc-900 text-sm font-medium hover:bg-amber-400 transition-colors"
              >
                Dodaj
              </button>
            </div>
          </div>
        )}

        {/* Cards / Empty State */}
        {cards.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredCards.length === 0 && (
              <div className="col-span-full text-center py-10 text-sm text-zinc-500">
                Brak inspiracji pasujących do filtrów.
              </div>
            )}
            {filteredCards.map((card) => {
              const diff = DIFFICULTY_LABEL[card.difficulty] || DIFFICULTY_LABEL.medium;
              return (
                <div key={card.id} className="rounded-2xl bg-zinc-900/50 border border-zinc-800/50 p-5 card-hover">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <h3 className="text-base font-bold text-white truncate">{card.songTitle}</h3>
                      <p className="text-sm text-amber-500">{card.artist}{card.year ? ` • ${card.year}` : ""}</p>
                      {card.album && <p className="text-[10px] text-zinc-500 mt-0.5">{card.album}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`shrink-0 px-2 py-1 rounded-lg text-[10px] font-bold border ${diff.cls}`}>
                        {diff.label}
                      </span>
                      <button
                        onClick={() => toggleVote(card.id)}
                        aria-pressed={votedIds.has(card.id)}
                        title={votedIds.has(card.id) ? "Cofnij głos" : "Zagłosuj"}
                        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
                          votedIds.has(card.id)
                            ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
                            : "bg-zinc-800 text-zinc-400 border-zinc-700/50 hover:text-amber-400"
                        }`}
                      >
                        {votedIds.has(card.id) ? "▲" : "△"} {card.voteCount}
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed bg-zinc-800/30 rounded-xl p-4 max-h-40 overflow-y-auto">
                    {card.lyrics.length > 600 ? `${card.lyrics.slice(0, 600)}…` : card.lyrics}
                  </p>
                  {card.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {card.tags.map((t) => (
                        <span key={t} className="px-2 py-0.5 rounded-full bg-zinc-800 text-[10px] text-zinc-400">
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800/50 p-16 text-center">
            <span className="text-5xl block mb-4">🏆</span>
            <h3 className="text-xl font-bold text-white mb-2">Baza inspiracji jest pusta</h3>
            <p className="text-sm text-zinc-400 max-w-md mx-auto mb-6">
              Dodaj analizę legendarnego utworu albo odwiedź Akademię po lekcje technik lirycznych.
            </p>
            <button
              onClick={() => setShowAddForm(true)}
              className="px-5 py-2.5 rounded-xl bg-amber-500/10 text-amber-500 text-sm font-semibold hover:bg-amber-500/20 transition-colors inline-block"
            >
              + Dodaj Pierwszą Inspirację
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
