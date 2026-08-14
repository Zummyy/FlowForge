"use client";

// Reusable toast-notification hook for the Studio module.
//
// Owns the transient "toast" state (one message at a time, newest replaces the
// current), the auto-dismiss timer, and the unmount cleanup — so consumers
// only call `showToast(message, kind, action?)` and render `toast`.

import { useCallback, useEffect, useRef, useState } from "react";

/** Optional action button rendered inside the toast (e.g. „↩️ Cofnij”). */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastMessage {
  /** Unique id — used as the React key so a re-show re-mounts the animation. */
  id: number;
  message: string;
  kind: "success" | "info";
  /** When present, the toast stays visible longer so the action can be used. */
  action?: ToastAction;
}

/** How long a plain toast stays visible before auto-dismissing (ms). */
export const TOAST_DURATION_MS = 2600;
/** Toasts carrying an action button stay up longer so they can be clicked. */
export const TOAST_ACTION_DURATION_MS = 8000;

export interface UseToastResult {
  toast: ToastMessage | null;
  showToast: (message: string, kind?: ToastMessage["kind"], action?: ToastAction) => void;
}

export function useToast(): UseToastResult {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timerRef = useRef<number | null>(null);

  const showToast = useCallback(
    (message: string, kind: ToastMessage["kind"] = "success", action?: ToastAction) => {
      // Replace any current toast immediately and restart the dismiss timer, so
      // rapid consecutive toasts never stack or flicker.
      setToast({ id: Date.now(), message, kind, action });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(
        () => setToast(null),
        action ? TOAST_ACTION_DURATION_MS : TOAST_DURATION_MS
      );
    },
    []
  );

  // Clear the pending auto-dismiss timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { toast, showToast };
}
