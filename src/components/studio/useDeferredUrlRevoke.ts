"use client";

// Shared hook for deferred object-URL revocation (blob: URLs created with
// URL.createObjectURL).
//
// Consumers hand a URL to `revokeAfter(url, delayMs, onRevoked?)` and either
// let the timer fire (the URL is released once the delay passes — e.g. after
// an undo window) or cancel it with `cancelRevoke(url)` when an undo action
// restores the object. Non-blob URLs (e.g. data URLs of rehydrated audio) are
// ignored, duplicate schedules are skipped, and every pending timer is cleared
// on unmount — so callers never have to remember cleanup.
//
// The timer/revoke plumbing lives in the pure `createDeferredUrlRevoker`
// factory (unit-tested in scripts/test-clip-timeline.ts with a manual clock);
// the `useDeferredUrlRevoke` hook is just a thin React wrapper wiring it to
// `window.setTimeout` / `URL.revokeObjectURL` and unmount disposal.
//
// Used by the Studio page for replaced beats (short delay) and deleted takes
// (undo-window delay, cancellable via the „↩️ Cofnij” toast action).

import { useCallback, useEffect, useRef } from "react";

/** Pure, injectable core — timers are driven by the injected `setTimer`/`clearTimer`. */
export interface DeferredUrlRevoker {
  /**
   * Schedule `url` for revocation after `delayMs`. Only blob: URLs are
   * scheduled (data URLs are never revoked) and duplicates are skipped — in
   * both of those cases `onRevoked` does NOT run, so it is only invoked for
   * revocations that were actually scheduled.
   */
  revokeAfter: (
    url: string | undefined | null,
    delayMs: number,
    onRevoked?: (url: string) => void
  ) => void;
  /** Cancel a pending scheduled revocation for `url` (safe no-op if none). */
  cancelRevoke: (url: string | undefined | null) => void;
  /** Clear every pending timer (unmount cleanup). */
  dispose: () => void;
}

export function createDeferredUrlRevoker(
  setTimer: (fn: () => void, delayMs: number) => number,
  clearTimer: (id: number) => void,
  revoke: (url: string) => void = (url) => URL.revokeObjectURL(url)
): DeferredUrlRevoker {
  /** url → pending timer id. */
  const pending = new Map<string, number>();

  return {
    revokeAfter(url, delayMs, onRevoked) {
      if (!url || !url.startsWith("blob:")) return;
      if (pending.has(url)) return;
      const timer = setTimer(() => {
        pending.delete(url);
        revoke(url);
        onRevoked?.(url);
      }, delayMs);
      pending.set(url, timer);
    },
    cancelRevoke(url) {
      if (!url) return;
      const timer = pending.get(url);
      if (timer) {
        clearTimer(timer);
        pending.delete(url);
      }
    },
    dispose() {
      pending.forEach((t) => clearTimer(t));
      pending.clear();
    },
  };
}

export interface UseDeferredUrlRevokeResult {
  revokeAfter: DeferredUrlRevoker["revokeAfter"];
  cancelRevoke: DeferredUrlRevoker["cancelRevoke"];
}

export function useDeferredUrlRevoke(): UseDeferredUrlRevokeResult {
  const revokerRef = useRef<DeferredUrlRevoker | null>(null);
  if (revokerRef.current === null) {
    revokerRef.current = createDeferredUrlRevoker(
      (fn, delayMs) => window.setTimeout(fn, delayMs),
      (id) => window.clearTimeout(id)
    );
  }
  const revoker = revokerRef.current;

  // Clear any pending timers on unmount.
  useEffect(() => {
    return () => revoker.dispose();
  }, [revoker]);

  const revokeAfter = useCallback(
    (url: string | undefined | null, delayMs: number, onRevoked?: (url: string) => void) => {
      revoker.revokeAfter(url, delayMs, onRevoked);
    },
    [revoker]
  );
  const cancelRevoke = useCallback(
    (url: string | undefined | null) => {
      revoker.cancelRevoke(url);
    },
    [revoker]
  );

  return { revokeAfter, cancelRevoke };
}
