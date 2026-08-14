"use client";

// „Zapisz Projekt” confirmation modal. Asks for a custom track name (pre-filled
// with the derived title) and shows a summary of what will be saved, then calls
// `onConfirm(name)`. Enter confirms, Esc / backdrop click / Anuluj cancel.

import { useEffect, useRef, useState } from "react";

export interface SaveProjectSummary {
  takes: number;
  clips: number;
  hasLyrics: boolean;
  hasBeat: boolean;
}

export interface SaveProjectModalProps {
  open: boolean;
  /** Pre-filled track name (derived from the Vault lyrics / beat name). */
  initialName: string;
  summary: SaveProjectSummary;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}

export function SaveProjectModal({ open, initialName, summary, onCancel, onConfirm }: SaveProjectModalProps) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-seed the input whenever the modal opens.
  useEffect(() => {
    if (open) {
      setName(initialName);
      // Focus + select after mount so the user can just type over the default.
      const t = window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 30);
      return () => window.clearTimeout(t);
    }
  }, [open, initialName]);

  // Esc cancels.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const trimmed = name.trim();

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-project-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-zinc-900 border border-zinc-700/60 shadow-2xl shadow-black/50 animate-scale-in overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-zinc-800">
          <h2 id="save-project-title" className="text-lg font-bold text-white flex items-center gap-2">
            <span>💾</span> Zapisz Projekt
          </h2>
          <p className="text-xs text-zinc-500 mt-1">
            Numer trafi do sekcji „Gotowe Numery”. Nadaj mu nazwę:
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          <div>
            <label htmlFor="save-project-name" className="block text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-1.5">
              Nazwa numeru
            </label>
            <input
              id="save-project-name"
              ref={inputRef}
              type="text"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && trimmed) onConfirm(trimmed);
              }}
              placeholder="Np. Mój pierwszy singiel"
              className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all"
            />
          </div>

          {/* Summary */}
          <div className="rounded-xl bg-zinc-800/40 border border-zinc-800 p-3 space-y-1.5">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-1.5">
              Zostanie zapisane
            </p>
            <SummaryRow ok={summary.takes > 0} label={`Ścieżki wokalne: ${summary.takes}`} />
            <SummaryRow ok={summary.clips > 0} label={`Fragmenty na osi czasu: ${summary.clips}`} />
            <SummaryRow ok={summary.hasBeat} label={summary.hasBeat ? "Bit / instrumental" : "Bez bitu (a cappella)"} />
            <SummaryRow ok={summary.hasLyrics} label={summary.hasLyrics ? "Tekst z The Vault" : "Brak wybranego tekstu"} />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-400 text-sm font-medium hover:bg-zinc-700 hover:text-white transition-colors"
          >
            Anuluj
          </button>
          <button
            onClick={() => trimmed && onConfirm(trimmed)}
            disabled={!trimmed}
            className="px-5 py-2 rounded-xl bg-amber-500 text-zinc-900 text-sm font-semibold hover:bg-amber-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            💾 Zapisz
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] ${ok ? "bg-emerald-500/20 text-emerald-400" : "bg-zinc-700 text-zinc-500"}`}>
        {ok ? "✓" : "•"}
      </span>
      <span className={ok ? "text-zinc-300" : "text-zinc-500"}>{label}</span>
    </div>
  );
}
