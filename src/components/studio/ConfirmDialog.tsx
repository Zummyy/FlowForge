"use client";

// Shared confirmation modal — same look & behavior as the Studio's
// SaveProjectModal (backdrop blur, Esc / backdrop-click / Anuluj cancel),
// but for destructive actions. Enter confirms, Esc cancels.

import { useEffect, useRef } from "react";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" → red confirm button (delete flows); "default" → amber. */
  tone?: "danger" | "default";
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Usuń",
  cancelLabel = "Anuluj",
  tone = "default",
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Esc cancels. Focus is put on the SAFE action: for a destructive dialog a
  // stray Enter (muscle memory) must never fire the delete, so the cancel
  // button gets focus; non-destructive dialogs focus the confirm.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => {
      if (tone === "danger") cancelRef.current?.focus();
      else confirmRef.current?.focus();
    }, 30);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onCancel, tone]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="w-full max-w-sm rounded-2xl bg-zinc-900 border border-zinc-700/60 shadow-2xl shadow-black/50 animate-scale-in overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-zinc-800">
          <h2 id="confirm-dialog-title" className="text-lg font-bold text-white flex items-center gap-2">
            <span>🗑️</span> {title}
          </h2>
          {description && <p className="text-xs text-zinc-500 mt-1">{description}</p>}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button
            ref={cancelRef}
            data-cancel
            onClick={onCancel}
            className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-400 text-sm font-medium hover:bg-zinc-700 hover:text-white transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            data-confirm
            onClick={onConfirm}
            className={`px-5 py-2 rounded-xl text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-0 ${
              tone === "danger"
                ? "bg-red-500/90 text-white hover:bg-red-500 focus:ring-red-500/50"
                : "bg-amber-500 text-zinc-900 hover:bg-amber-400 focus:ring-amber-500/50"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
