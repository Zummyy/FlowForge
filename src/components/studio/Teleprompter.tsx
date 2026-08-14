"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { VaultTextItem, VaultVersion } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// VAULT TEXT PICKER — select lyrics/texts saved in The Vault (no paste area)
// ═══════════════════════════════════════════════════════════════════════════

function VaultTextPicker({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string, content: string, label: string) => void;
}) {
  const [items, setItems] = useState<VaultTextItem[]>([]);
  const [filter, setFilter] = useState("");
  const [loaded, setLoaded] = useState(false);

  const formatDate = useCallback((ts?: string) => {
    if (!ts) return "";
    const d = new Date(ts);
    return isNaN(d.getTime()) ? "" : d.toLocaleString("pl-PL");
  }, []);

  const buildMeta = useCallback((content: string) => {
    const lines = content.split("\n").filter((l) => l.trim());
    const words = content.split(/\s+/).filter(Boolean).length;
    return `${lines.length} ${lines.length === 1 ? "wers" : "wersów"} • ${words} słów`;
  }, []);

  const refresh = useCallback(() => {
    try {
      const raw = localStorage.getItem("flowforge-versions");
      const versions: VaultVersion[] = raw ? JSON.parse(raw) : [];
      const list: VaultTextItem[] = versions.map((v) => ({
        id: v.id,
        label: v.label,
        content: v.content,
        meta: `${buildMeta(v.content)}${v.timestamp ? ` • ${formatDate(v.timestamp)}` : ""}`,
      }));
      // Pin the Vault editor's current draft at the top (if any)
      const draft = localStorage.getItem("flowforge-content");
      if (draft && draft.trim()) {
        const draftTitle = localStorage.getItem("flowforge-title");
        list.unshift({
          id: "__draft__",
          label: draftTitle ? `${draftTitle} — szkic z edytora` : "Szkic z edytora The Vault",
          content: draft,
          meta: `${buildMeta(draft)} • bieżący szkic`,
          isDraft: true,
        });
      }
      setItems(list);
    } catch {
      setItems([]);
    }
    setLoaded(true);
  }, [buildMeta, formatDate]);

  // Load on mount and stay in sync with The Vault
  useEffect(() => {
    refresh();
    window.addEventListener("flowforge-versions-updated", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("flowforge-versions-updated", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) => it.label.toLowerCase().includes(q) || it.content.toLowerCase().includes(q)
    );
  }, [items, filter]);

  return (
    <div className="rounded-xl bg-zinc-800/30 border border-zinc-700/30 p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-xs text-zinc-400 font-medium flex items-center gap-1.5">
          <span>📚</span> Teksty z The Vault ({items.length})
        </h3>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Szukaj..."
          className="w-40 px-2.5 py-1 rounded-lg bg-zinc-800 border border-zinc-700 text-[11px] text-white placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
        />
      </div>

      {!loaded ? (
        <p className="text-xs text-zinc-600 text-center py-6">Ładowanie...</p>
      ) : filtered.length > 0 ? (
        <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
          {filtered.map((item) => {
            const firstLine = item.content.split("\n").find((l) => l.trim())?.slice(0, 70) || "—";
            const active = item.id === selectedId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id, item.content, item.label)}
                className={`w-full text-left p-2.5 rounded-lg border transition-all group ${
                  active
                    ? "bg-amber-500/15 border-amber-500/40"
                    : "bg-zinc-800 border-zinc-700 hover:border-amber-500/30 hover:bg-zinc-700/50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium truncate ${active ? "text-amber-400" : "text-white"}`}>
                    {item.isDraft ? "📌 " : ""}
                    {item.label}
                  </span>
                  <span
                    className={`ml-auto shrink-0 text-[9px] px-1.5 py-0.5 rounded-full ${
                      active ? "bg-amber-500/20 text-amber-400" : "bg-zinc-700 text-zinc-400"
                    }`}
                  >
                    {active ? "✓ Załadowany" : "Załaduj"}
                  </span>
                </div>
                <p className="text-[10px] text-zinc-500 truncate mt-0.5">{firstLine}</p>
                <p className="text-[9px] text-zinc-600 mt-0.5">{item.meta}</p>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-6">
          <p className="text-2xl mb-2">📭</p>
          <p className="text-xs text-zinc-500 mb-3">
            {items.length === 0
              ? "Brak zapisanych tekstów. Zapisz wersję w The Vault, aby użyć jej w teleprompterze."
              : "Brak wyników dla tej frazy."}
          </p>
          {items.length === 0 && (
            <Link
              href="/vault"
              className="inline-block px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-500 text-xs font-medium hover:bg-amber-500/20 transition-colors"
            >
              Otwórz The Vault →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// FULLSCREEN TELEPROMPTER — smooth, seamless scroll of the selected vault text
// ═══════════════════════════════════════════════════════════════════════════

export function TeleprompterMode({
  text,
  speed,
  sourceLabel,
  onClose,
}: {
  text: string;
  speed: number;
  sourceLabel?: string | null;
  onClose: () => void;
}) {
  const [isPaused, setIsPaused] = useState(false);
  const [fontSize, setFontSize] = useState(48);
  const [runId, setRunId] = useState(0);

  const lines = text.split("\n").filter((l) => l.trim());
  const copyHeight = Math.max(120, lines.length * fontSize * 1.4);
  // Constant px/s: one full copy (50% of the doubled block) scrolls at `speed` px/s.
  const durationSec = Math.max(6, copyHeight / (2 * speed));

  // Keyboard shortcuts: Space = pause/resume, Esc = close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        setIsPaused((p) => !p);
      } else if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      {/* Top controls */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-4 bg-gradient-to-b from-black/80 to-transparent">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-zinc-800/80 text-white text-sm font-medium hover:bg-zinc-700/80 transition-colors"
          >
            ← Zamknij
          </button>
          {sourceLabel && (
            <span className="hidden sm:inline-block truncate max-w-[240px] px-2.5 py-1 rounded-lg bg-purple-500/10 border border-purple-500/20 text-[11px] text-purple-300">
              📚 {sourceLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setRunId((r) => r + 1)}
            className="px-3 py-2 rounded-xl bg-zinc-800/80 text-white text-xs font-medium hover:bg-zinc-700/80 transition-colors"
            title="Przewiń od początku"
          >
            ↺ Od początku
          </button>
          <button
            onClick={() => setIsPaused((p) => !p)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              isPaused ? "bg-amber-500/20 text-amber-500" : "bg-zinc-800/80 text-white"
            }`}
          >
            {isPaused ? "▶ Wznów" : "⏸ Pauza"}
          </button>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setFontSize((s) => Math.max(24, s - 8))}
              className="w-8 h-8 rounded-lg bg-zinc-800/80 text-white flex items-center justify-center hover:bg-zinc-700/80 transition-colors text-xs"
            >
              A−
            </button>
            <button
              onClick={() => setFontSize((s) => Math.min(96, s + 8))}
              className="w-8 h-8 rounded-lg bg-zinc-800/80 text-white flex items-center justify-center hover:bg-zinc-700/80 transition-colors text-xs"
            >
              A+
            </button>
          </div>
        </div>
      </div>

      {/* Scrolling text */}
      <div className="flex-1 overflow-hidden flex items-center justify-center">
        <div
          key={runId}
          className={`whitespace-pre-wrap text-center px-8 ${isPaused ? "" : "teleprompter-scroll"}`}
          style={
            {
              fontSize: `${fontSize}px`,
              lineHeight: "1.4",
              color: "#f59e0b",
              textShadow: "0 0 30px rgba(245, 158, 11, 0.3)",
              animationDuration: `${durationSec}s`,
              "--scroll-duration": `${durationSec}s`,
            } as React.CSSProperties
          }
        >
          {text}
          <div aria-hidden="true">{text}</div>
        </div>
      </div>

      {/* Bottom gradient + status */}
      <div className="absolute bottom-0 left-0 right-0 z-10 h-36 bg-gradient-to-t from-black to-transparent pointer-events-none" />
      <div className="absolute bottom-3 left-0 right-0 z-20 flex items-center justify-center gap-3 pointer-events-none">
        <span className="px-2.5 py-1 rounded-full bg-black/60 border border-zinc-800 text-[10px] text-zinc-500 font-mono">
          {speed} px/s
        </span>
        <span className="px-2.5 py-1 rounded-full bg-black/60 border border-zinc-800 text-[10px] text-zinc-500">
          {isPaused ? "⏸ pauza" : "spacja = pauza • esc = zamknij"}
        </span>
      </div>
    </div>
  );
}

export default VaultTextPicker;
