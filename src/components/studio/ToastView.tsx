"use client";

// Shared toast renderer. Pair it with the `useToast` hook:
//
//   const { toast, showToast } = useToast();
//   ...
//   <ToastView toast={toast} />
//
// Renders a single fixed top-center notification (auto-dismissing is handled
// by the hook). `key={toast.id}` re-mounts the slide-down animation whenever a
// new toast replaces the current one. Toasts may carry an optional action
// button (e.g. „↩️ Cofnij”) — it stays clickable thanks to `pointer-events-auto`.

import type { ToastMessage } from "./useToast";

export interface ToastViewProps {
  toast: ToastMessage | null;
}

export function ToastView({ toast }: ToastViewProps) {
  if (!toast) return null;
  return (
    <div
      key={toast.id}
      role="status"
      aria-live="polite"
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl border text-sm font-medium animate-slide-down shadow-xl pointer-events-none flex items-center gap-3 ${
        toast.kind === "success"
          ? "bg-zinc-900/95 border-amber-500/40 text-amber-300"
          : "bg-zinc-900/95 border-zinc-700 text-zinc-400"
      }`}
    >
      <span>{toast.message}</span>
      {toast.action && (
        <button
          onClick={toast.action.onClick}
          className={`pointer-events-auto shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
            toast.kind === "success"
              ? "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
              : "bg-zinc-700/60 text-zinc-200 hover:bg-zinc-600"
          }`}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
