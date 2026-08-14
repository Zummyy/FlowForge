/* eslint-disable no-console */
// Smoke tests for the pure clip-timeline operations.
// Run: npx tsx scripts/test-clip-timeline.ts
import {
  computeSplit,
  computeDelete,
  computeMove,
  computeEdgeTrim,
  createGestureTracker,
  makeInitialClip,
  MIN_CLIP_SECONDS,
} from "../src/components/studio/useClipTimeline";
import { UndoHistory } from "../src/components/studio/history";
import { computePunchIn } from "../src/components/studio/recording";
import { createDeferredUrlRevoker } from "../src/components/studio/useDeferredUrlRevoke";
import { createDebouncedPersister, PERSIST_DEBOUNCE_MS } from "../src/components/studio/debounce";
import { matchShortcut, normalizeKeyEvent } from "../src/components/studio/shortcuts";
import type { ShortcutContext } from "../src/components/studio/shortcuts";
import type { VocalTake } from "../src/components/studio/types";
import {
  CHALLENGES,
  MAX_SCORE,
  emptyChallengeState,
  evaluateNewlyCompleted,
  getChallengeProgress,
  getCompletedCount,
  getTotalScore,
  isChallengeConditionMet,
} from "../src/lib/challenges";
import type { ChallengeState } from "../src/lib/challenges";

let failures = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ FAIL: ${label}`);
  }
}

const take: VocalTake = {
  id: "t1",
  label: "Take 1",
  duration: 10,
  offset: 0,
  volume: 1,
  isMuted: false,
  isSoloed: false,
  trimStart: 0,
  trimEnd: 1,
};
const takeTrimmed: VocalTake = {
  ...take,
  trimStart: 0.2,
  trimEnd: 0.8,
  offset: 2,
};

console.log("makeInitialClip");
{
  const c = makeInitialClip(takeTrimmed);
  assert(c.offset === 2, "offset inherited from take");
  assert(Math.abs(c.duration - 10 * 0.6) < 1e-6, `initial duration respects trims (got ${c.duration})`);
  assert(c.trimStart === 0.2 && c.trimEnd === 0.8, "trims inherited");
}

console.log("computeSplit — persistent sequential splits");
{
  // Split 10s take at t=4 → A[0..4] B[4..10]
  const r1 = computeSplit([makeInitialClip(take)], take, 4);
  assert(!!r1, "first split succeeds");
  assert(r1!.clips.length === 2, "first split → 2 clips");
  assert(Math.abs(r1!.clips[0].duration - 4) < 1e-6, "A duration 4s");
  assert(Math.abs(r1!.clips[1].duration - 6) < 1e-6, "B duration 6s");
  assert(Math.abs(r1!.clips[1].offset - 4) < 1e-6, "B offset 4s");
  assert(r1!.selectedClipId === r1!.clips[1].id, "B selected after split");

  // Split B again at t=7 → A[0..4] B1[4..7] B2[7..10]
  const r2 = computeSplit(r1!.clips, take, 7);
  assert(!!r2, "second split succeeds (no rollback)");
  assert(r2!.clips.length === 3, "second split → 3 clips");
  const durations = r2!.clips.map((c) => Math.round(c.duration * 100) / 100);
  assert(JSON.stringify(durations) === "[4,3,3]", `durations preserved: ${JSON.stringify(durations)}`);
  const offsets = r2!.clips.map((c) => c.offset);
  assert(JSON.stringify(offsets) === "[0,4,7]", `offsets contiguous: ${JSON.stringify(offsets)}`);

  // Split a clip that was created from a trimmed take
  const base = makeInitialClip(takeTrimmed); // audible 6s at offset 2
  const rt = computeSplit([base], takeTrimmed, 4); // mid of [2..8]
  assert(!!rt && rt!.clips.length === 2, "trimmed take splits");
  if (rt) {
    assert(Math.abs(rt.clips[0].duration - 2) < 1e-6, "trimmed A = 2s");
    assert(Math.abs(rt.clips[0].trimEnd - 0.4) < 1e-6, "trimmed A ends at source 0.4");
    assert(Math.abs(rt.clips[1].offset - 4) < 1e-6, "trimmed B offset 4s");
  }

  // Splits outside any clip are rejected
  const r3 = computeSplit([makeInitialClip(take)], take, 0.001);
  assert(r3 === null, "split at clip boundary rejected");
}

console.log("computeDelete — clean removal, no parent restore");
{
  const r1 = computeSplit([makeInitialClip(take)], take, 4)!;
  // Delete B → only A remains, offset untouched
  const d = computeDelete(r1.clips, r1.clips[1].id);
  assert(!!d && d!.clips.length === 1, "delete removes only the target clip");
  assert(!!d && d!.clips[0].id === r1.clips[0].id, "surviving clip is the other one");
  assert(!!d && d!.clips[0].offset === 0, "surviving offset preserved");
  assert(!!d && d!.selectedClipId === r1.clips[0].id, "selection moves to remaining clip");

  // Delete the last clip → empty array (NOT a revert to the original take)
  const d2 = computeDelete([r1.clips[0]], r1.clips[0].id);
  assert(!!d2 && d2!.clips.length === 0, "deleting last clip yields empty array (edited mode)");
  assert(!!d2 && d2!.selectedClipId === null, "no selection after deleting last clip");
}

console.log("computeMove — neighbour clamping");
{
  const r1 = computeSplit([makeInitialClip(take)], take, 4)!;
  const [a, b] = r1.clips;
  // Move A left beyond 0 → clamps to 0
  const m1 = computeMove([a, b], a.id, -3, 60);
  assert(!!m1 && m1![0].offset === 0, "move clamps at timeline start");
  // Move A right: max = B.offset - A.duration = 4 - 4 = 0
  const m2 = computeMove([a, b], a.id, 10, 60);
  assert(!!m2 && m2![0].offset === 0, "move clamps against next neighbour");
  // Move B left: min = A.offset + A.duration = 4
  const m3 = computeMove([a, b], b.id, 0, 60);
  assert(!!m3 && m3![1].offset === 4, "move clamps against previous neighbour");
  // B right: max = timeline - duration
  const m4 = computeMove([a, b], b.id, 59, 60);
  assert(!!m4 && m4![1].offset === 54, "move clamps at timeline end");
}

console.log("computeEdgeTrim — source/min-length/neighbour clamps");
{
  const r1 = computeSplit([makeInitialClip(take)], take, 4)!;
  const [a, b] = r1.clips;
  // Right trim of B beyond source end (10s) → clamps to take end
  const t1 = computeEdgeTrim([a, b], take, b.id, "end", 50, 60)!;
  assert(Math.abs(t1[1].offset + t1[1].duration - 10) < 1e-6, "right edge clamps at source end");
  // Right trim of B past A boundary → clamps at next clip (none → timeline/source)
  const t2 = computeEdgeTrim([a, b], take, a.id, "end", 3, 60)!;
  assert(Math.abs(t2[0].duration - 3) < 1e-6, "right edge trims into gap");
  assert(Math.abs(t2[0].trimEnd - 0.3) < 1e-6, "trimEnd recomputed");
  // Left trim of B before A end → clamps at A end
  const t3 = computeEdgeTrim([a, b], take, b.id, "start", 1, 60)!;
  assert(Math.abs(t3[1].offset - 4) < 1e-6, "left edge clamps at previous neighbour");
  // Left trim of B dragged past its right content edge → min-length guard binds
  const t4 = computeEdgeTrim([a, b], take, b.id, "start", 10, 60)!;
  assert(Math.abs(t4[1].duration - MIN_CLIP_SECONDS) < 1e-6, "left edge keeps MIN_CLIP_SECONDS when dragged past right edge");
  assert(Math.abs(t4[1].offset - (10 - MIN_CLIP_SECONDS)) < 1e-6, "left edge clamps at maxStart");
  // Source-start clamp: take offset 5, trimStart 0.2 → extending left stops at source 0
  const take2: VocalTake = { ...take, offset: 5, trimStart: 0.2, trimEnd: 1 };
  const base2 = makeInitialClip(take2); // offset 5, duration 8
  const t5 = computeEdgeTrim([base2], take2, base2.id, "start", 1, 60)!;
  assert(Math.abs(t5[0].offset - 3) < 1e-6, "left edge clamps at source start (offset 3 = 5 - 0.2*10)");
  assert(Math.abs(t5[0].trimStart) < 1e-9, "trimStart reaches 0 at source start");
  // Shrink below minimum → rejected
  const t6 = computeEdgeTrim([a, b], take, b.id, "end", 4 + MIN_CLIP_SECONDS / 2, 60)!;
  assert(t6[1].duration >= MIN_CLIP_SECONDS - 1e-9, "min length enforced");
}

console.log("createGestureTracker — one snapshot per gesture");
{
  const g = createGestureTracker();
  // Standalone mutations (no gesture): the first snapshots, continuations don't.
  assert(g.takeSnapshotLabel("A") === "A", "first standalone mutation snapshots");
  assert(g.takeSnapshotLabel("A") === null, "continuation without end() does not snapshot");
  assert(g.takeSnapshotLabel("A") === null, "third mutation also does not snapshot");

  // A drag gesture: begin → many micro-movements → exactly one snapshot → end.
  g.begin();
  assert(
    g.takeSnapshotLabel("Przesunięto fragment") === "Przesunięto fragment",
    "first mutation of a gesture snapshots"
  );
  assert(g.takeSnapshotLabel("Przesunięto fragment") === null, "drag micro-movements are deduped");
  assert(g.takeSnapshotLabel("Przesunięto fragment") === null, "more micro-movements stay deduped");
  g.end();
  assert(
    g.takeSnapshotLabel("Przycięto fragment") === "Przycięto fragment",
    "after end() the next gesture snapshots again"
  );
  assert(g.takeSnapshotLabel("Przycięto fragment") === null, "second trim mutation is deduped");

  // A fresh tracker starts armed; begin() and end() both re-arm it.
  const g2 = createGestureTracker();
  assert(g2.takeSnapshotLabel("X") === "X", "a fresh tracker starts armed");
  g2.end();
  assert(g2.takeSnapshotLabel("Y") === "Y", "end() re-arms for the next gesture");
  g2.begin();
  assert(g2.takeSnapshotLabel("Z") === "Z", "begin() also re-arms");
  assert(g2.takeSnapshotLabel("Z") === null, "dedup resumes inside the new gesture");
}

console.log("computePunchIn — position-based recording");
{
  // Mid-playback punch-in uses the exact beat position, not 0
  assert(
    computePunchIn({ audioCurrentTime: 45.7, fallbackTime: 0, audioDuration: 120, totalDuration: 120 }) === 45.7,
    "punch-in mid-playback uses the exact beat position (45.7)"
  );
  // No beat loaded → falls back to the displayed playhead
  assert(
    computePunchIn({ audioCurrentTime: undefined, fallbackTime: 12, totalDuration: 0 }) === 12,
    "no beat loaded → falls back to playhead (12)"
  );
  // Defaults to 0:00 when nothing is positioned
  assert(
    computePunchIn({ audioCurrentTime: undefined, fallbackTime: 0, totalDuration: 0 }) === 0,
    "defaults to 0:00"
  );
  // Clamped just before the beat ends so playback can start there
  assert(
    computePunchIn({ audioCurrentTime: 119.99, fallbackTime: 0, audioDuration: 120, totalDuration: 120 }) < 120,
    "clamped below the beat end"
  );
  assert(
    computePunchIn({ audioCurrentTime: 200, fallbackTime: 0, audioDuration: 120, totalDuration: 120 }) === 119.95,
    "position past the beat end clamps to duration - 0.05"
  );
  // Never negative
  assert(
    computePunchIn({ audioCurrentTime: -3, fallbackTime: 0, audioDuration: 120, totalDuration: 120 }) === 0,
    "never negative"
  );
}

console.log("UndoHistory — undo stack");
{
  const h = new UndoHistory<string>(100);
  assert(h.isEmpty && h.size === 0, "starts empty");
  h.push("state-a", "Rozcięto fragment");
  h.push("state-b", "Usunięto fragment");
  assert(h.size === 2, "two entries pushed");
  const first = h.pop();
  assert(first?.state === "state-b" && first?.label === "Usunięto fragment", "pop is LIFO (latest first)");
  assert(h.size === 1, "size decrements after pop");
  const second = h.pop();
  assert(second?.state === "state-a", "second pop returns older state");
  assert(h.pop() === undefined, "pop on empty returns undefined");
  h.push("x", "X");
  h.clear();
  assert(h.isEmpty, "clear empties the stack");
  // Cap trims the oldest entries
  const capped = new UndoHistory<string>(2);
  capped.push("a", "A");
  capped.push("b", "B");
  capped.push("c", "C");
  assert(capped.size === 2, "cap keeps only the newest entries");
  assert(capped.pop()?.state === "c", "cap preserves newest");
  assert(capped.pop()?.state === "b", "cap drops oldest");
}

console.log("UndoHistory — redo stack mirrors undo");
{
  // Simulate: S0 --split--> S1 --delete--> S2
  const h = new UndoHistory<string>(100);
  h.push("S0", "Rozcięto fragment"); // pre-split snapshot
  h.push("S1", "Usunięto fragment"); // pre-delete snapshot → current state is S2

  // Undo #1: current S2 is mirrored to redo, restore S1.
  const u1 = h.pop();
  assert(u1?.state === "S1", "first undo pops latest snapshot (S1)");
  h.pushRedo("S2", u1!.label);
  assert(h.redoSize === 1 && h.canRedo, "undo pushes current state (S2) to redo");
  assert(h.size === 1, "undo stack shrinks");

  // Undo #2: current S1 mirrored to redo, restore S0.
  const u2 = h.pop();
  assert(u2?.state === "S0", "second undo pops S0");
  h.pushRedo("S1", u2!.label);
  assert(h.redoSize === 2, "redo stack accumulates (S2, S1)");
  assert(h.size === 0, "undo stack empty");

  // Redo #1: restore S1, push S0 back to undo WITHOUT clearing the redo stack.
  const r1 = h.popRedo();
  assert(r1?.state === "S1" && r1?.label === "Rozcięto fragment", "redo pops latest redo entry (S1)");
  h.push("S0", r1!.label, false);
  assert(h.redoSize === 1, "redo keeps the remaining redo entry (S2) intact");
  assert(h.size === 1, "redo pushes current state back to undo");

  // Redo #2: restore S2.
  const r2 = h.popRedo();
  assert(r2?.state === "S2" && r2?.label === "Usunięto fragment", "second redo restores S2 with its label");
  h.push("S1", r2!.label, false);
  assert(h.redoSize === 0 && !h.canRedo, "redo stack drains");
  assert(h.size === 2, "undo stack rebuilt to depth 2");

  // A NEW mutation clears redo history.
  h.push("S3", "Zmieniono głośność fragmentu");
  assert(!h.canRedo && h.redoSize === 0, "new push invalidates redo history");
}

console.log("UndoHistory — capacity, eviction and mirror under load");
{
  // The undo/redo path is fully synchronous (no timers): snapshots are taken
  // eagerly on each mutation, eviction is capacity-based, and the gesture
  // dedup is a plain flag — so these history behaviors are tested directly.

  // 1. Production cap (default max = MAX_HISTORY = 100): oldest evicted in order.
  const h = new UndoHistory<string>();
  for (let i = 1; i <= 105; i++) h.push(`S${i}`, `Akcja ${i}`);
  assert(h.size === 100, "default cap keeps exactly 100 entries");
  const popped: { state: string; label: string }[] = [];
  let e = h.pop();
  while (e) {
    popped.push({ state: e.state, label: e.label });
    e = h.pop();
  }
  assert(popped.length === 100, "all 100 kept entries are popable");
  assert(
    popped[0].state === "S105" && popped[99].state === "S6",
    "newest kept in LIFO order, S1..S5 evicted"
  );
  assert(
    popped[0].label === "Akcja 105" && popped[99].label === "Akcja 6",
    "labels survive eviction alongside their states"
  );
  assert(
    popped.every((p) => p.label === `Akcja ${Number(p.state.slice(1))}`),
    "every surviving entry keeps its correct label after eviction"
  );
  assert(
    !popped.some((p) => p.state === "S5" || p.state === "S1"),
    "oldest entries are the evicted ones"
  );

  // Peek at the class internals to observe exactly which entries eviction
  // discards: the internal stack's front is the oldest entry, and each
  // over-cap push `shift()`s it away. Assert the evictees' states AND labels.
  const h2 = new UndoHistory<string>(100);
  for (let i = 1; i <= 100; i++) h2.push(`S${i}`, `Akcja ${i}`);
  const internals = h2 as unknown as { stack: { state: string; label: string }[] };
  assert(internals.stack.length === 100, "internal stack holds 100 entries before eviction");
  for (let i = 1; i <= 5; i++) {
    const evictee = internals.stack[0];
    h2.push(`S${100 + i}`, `Akcja ${100 + i}`);
    assert(
      evictee.state === `S${i}` && evictee.label === `Akcja ${i}`,
      `eviction discards S${i} (label „Akcja ${i}”) as the oldest entry`
    );
    assert(
      !internals.stack.some((e) => e === evictee),
      `S${i} is gone from the internal stack after the push`
    );
  }
  assert(internals.stack.length === 100, "internal stack stays capped at 100 after 5 evictions");
  assert(
    internals.stack[0].state === "S6" && internals.stack[0].label === "Akcja 6",
    "the new oldest surviving entry is S6 with its label"
  );

  // 2. Mirror invariant at production scale: a full undo→redo round trip
  //    restores every state in exact reverse order, and the redo stack can
  //    never exceed the cap (an undo mirrors at most `max` entries).
  const big = new UndoHistory<string>(100);
  for (let i = 1; i <= 100; i++) big.push(`S${i}`, `Akcja ${i}`);
  const undone: string[] = [];
  for (let i = 0; i < 100; i++) {
    const u = big.pop()!;
    big.pushRedo(u.state, u.label);
    undone.push(u.state);
  }
  assert(big.size === 0 && big.redoSize === 100, "100 undos mirror the whole stack to redo");
  assert(undone[0] === "S100" && undone[99] === "S1", "undos walk the stack newest-first");
  // Invariant lock: redo only grows via undo (≤ `max` entries), so it can never
  // exceed the cap — pushRedo's own shift() branch is unreachable by design.
  assert(big.redoSize <= 100, "redo stack never exceeds the cap");
  const redone: string[] = [];
  for (let i = 0; i < 100; i++) {
    const r = big.popRedo()!;
    big.push(r.state, r.label, false);
    redone.push(r.state);
  }
  assert(redone[0] === "S1" && redone[99] === "S100", "redos restore states oldest-first");
  assert(big.size === 100 && !big.canRedo, "redo drains and the undo stack is rebuilt");

  // 3. Eviction + redo invalidation: after undoing half the stack, new pushes
  //    clear the redo history AND trim the oldest undo entries.
  const mix = new UndoHistory<string>(100);
  for (let i = 1; i <= 100; i++) mix.push(`S${i}`, `Akcja ${i}`);
  for (let i = 0; i < 50; i++) {
    const u = mix.pop()!;
    mix.pushRedo(u.state, u.label);
  }
  assert(mix.size === 50 && mix.redoSize === 50, "half undone: 50 undo + 50 redo entries");
  for (let i = 1; i <= 60; i++) mix.push(`N${i}`, `Nowa akcja ${i}`);
  assert(mix.size === 100, "60 new pushes fill the stack back to the cap");
  assert(!mix.canRedo && mix.redoSize === 0, "every new push invalidates the redo history");
  const mixed: { state: string; label: string }[] = [];
  let m = mix.pop();
  while (m) {
    mixed.push({ state: m.state, label: m.label });
    m = mix.pop();
  }
  assert(mixed.length === 100, "cap holds 100 entries after eviction");
  assert(
    mixed[0].state === "N60" && mixed[0].label === "Nowa akcja 60",
    "newest edit pops first with its label"
  );
  assert(
    !mixed.some((p) => p.state === "S10") && mixed.some((p) => p.state === "S11"),
    "eviction drops the 10 oldest (S1..S10)"
  );
  assert(
    mixed[mixed.length - 1].state === "S11" && mixed[mixed.length - 1].label === "Akcja 11",
    "oldest surviving entry is S11 with its label"
  );
}

console.log("matchShortcut — Ctrl+Z undo is layout-independent and reliable");
{
  // Editing context: a take and its clip are selected, marker at 4s.
  const ctx: ShortcutContext = {
    teleprompterOpen: false,
    typing: false,
    selectedTakeId: "t1",
    selectedClipId: "c1",
    takeHasClips: true,
    markerPosition: 4,
  };

  // ── Ctrl+Z on QWERTY (the primary binding)
  const qwerty = matchShortcut(normalizeKeyEvent({ key: "z", code: "KeyZ", ctrlKey: true }), ctx);
  assert(qwerty.kind === "undo", "Ctrl+Z (QWERTY) → undo");

  // ── Cmd+Z on macOS: Meta+Z is the platform convention; e.key may be "Ω"
  //    with Option held, but plain Cmd+Z gives key "z" and code "KeyZ".
  const mac = matchShortcut(normalizeKeyEvent({ key: "z", code: "KeyZ", metaKey: true }), ctx);
  assert(mac.kind === "undo", "Cmd+Z on macOS → undo via e.code");

  // ── Ctrl+Z on AZERTY: the physical Z key produces "<"
  const azerty = matchShortcut(normalizeKeyEvent({ key: "<", code: "KeyZ", ctrlKey: true }), ctx);
  assert(azerty.kind === "undo", "Ctrl+Z on AZERTY (key '<') → undo via e.code");

  // ── Dvorak: physical Z key produces ";" with Ctrl held
  const dvorak = matchShortcut(normalizeKeyEvent({ key: ";", code: "KeyZ", ctrlKey: true }), ctx);
  assert(dvorak.kind === "undo", "Ctrl+Z on Dvorak (key ';') → undo via e.code");

  // ── Modifier combinations must NOT trigger our undo
  assert(
    matchShortcut(normalizeKeyEvent({ key: "z", code: "KeyZ", altKey: true }), ctx).kind === "none",
    "Alt+Z alone no longer undoes (replaced by Ctrl+Z)"
  );
  assert(
    matchShortcut(normalizeKeyEvent({ key: "z", code: "KeyZ", ctrlKey: true, altKey: true }), ctx).kind === "none",
    "Ctrl+Alt+Z does not trigger undo"
  );
  assert(
    matchShortcut(normalizeKeyEvent({ key: "z", code: "KeyZ", metaKey: true, altKey: true }), ctx).kind === "none",
    "Cmd+Alt+Z does not trigger undo"
  );
  assert(
    matchShortcut(normalizeKeyEvent({ key: "z", code: "KeyZ" }), ctx).kind === "none",
    "plain Z without Ctrl is not undo"
  );
  assert(
    matchShortcut(normalizeKeyEvent({ key: "x", code: "KeyX", ctrlKey: true }), ctx).kind === "none",
    "Ctrl+X is not undo"
  );

  // ── Guards: teleprompter open / typing must suppress ALL shortcuts
  assert(
    matchShortcut(normalizeKeyEvent({ key: "z", code: "KeyZ", ctrlKey: true }), { ...ctx, teleprompterOpen: true })
      .kind === "none",
    "teleprompter open → Ctrl+Z ignored (it owns the keyboard)"
  );
  assert(
    matchShortcut(normalizeKeyEvent({ key: "z", code: "KeyZ", ctrlKey: true }), { ...ctx, typing: true }).kind ===
      "none",
    "typing in a field → Ctrl+Z ignored"
  );

  // ── Ctrl+S → save session (and its edge cases)
  const save = matchShortcut(normalizeKeyEvent({ key: "s", code: "KeyS", ctrlKey: true }), ctx);
  assert(save.kind === "saveSession", "Ctrl+S → saveSession");
  const saveMac = matchShortcut(normalizeKeyEvent({ key: "s", code: "KeyS", metaKey: true }), ctx);
  assert(saveMac.kind === "saveSession", "Cmd+S on macOS → saveSession");
  const saveAzerty = matchShortcut(normalizeKeyEvent({ key: "&", code: "KeyS", ctrlKey: true }), ctx);
  assert(saveAzerty.kind === "saveSession", "Ctrl+S on AZERTY (key '&') → saveSession via e.code");
  // Saving is a global gesture — it fires even while typing in a field.
  const saveTyping = matchShortcut(normalizeKeyEvent({ key: "s", code: "KeyS", ctrlKey: true }), {
    ...ctx,
    typing: true,
  });
  assert(saveTyping.kind === "saveSession", "Ctrl+S fires even while typing in a field");
  // Ctrl+Shift+S is the browser's Save As — never hijacked.
  assert(
    matchShortcut(normalizeKeyEvent({ key: "s", code: "KeyS", ctrlKey: true, shiftKey: true }), ctx).kind === "none",
    "Ctrl+Shift+S (browser Save As) is not hijacked"
  );
  assert(
    matchShortcut(normalizeKeyEvent({ key: "s", code: "KeyS", ctrlKey: true, altKey: true }), ctx).kind === "none",
    "Ctrl+Alt+S is not save"
  );
  // Teleprompter still owns the keyboard.
  assert(
    matchShortcut(normalizeKeyEvent({ key: "s", code: "KeyS", ctrlKey: true }), { ...ctx, teleprompterOpen: true })
      .kind === "none",
    "teleprompter open → Ctrl+S ignored"
  );
  // Plain S still means split, not save.
  assert(
    matchShortcut(normalizeKeyEvent({ key: "s", code: "KeyS" }), ctx).kind === "split",
    "S (no modifier) → split, not save"
  );

  // ── Ctrl+Shift+Z / Ctrl+Y → redo
  const redoShift = matchShortcut(normalizeKeyEvent({ key: "z", code: "KeyZ", ctrlKey: true, shiftKey: true }), ctx);
  assert(redoShift.kind === "redo", "Ctrl+Shift+Z → redo");
  const redoMac = matchShortcut(normalizeKeyEvent({ key: "z", code: "KeyZ", metaKey: true, shiftKey: true }), ctx);
  assert(redoMac.kind === "redo", "Cmd+Shift+Z on macOS → redo");
  const redoY = matchShortcut(normalizeKeyEvent({ key: "y", code: "KeyY", ctrlKey: true }), ctx);
  assert(redoY.kind === "redo", "Ctrl+Y → redo");
  assert(
    matchShortcut(normalizeKeyEvent({ key: "z", code: "KeyZ", ctrlKey: true }), ctx).kind === "undo",
    "plain Ctrl+Z still → undo (not redo)"
  );
  assert(
    matchShortcut(normalizeKeyEvent({ key: "y", code: "KeyY", ctrlKey: true, shiftKey: true }), ctx).kind === "none",
    "Ctrl+Shift+Y is not redo"
  );
  assert(
    matchShortcut(normalizeKeyEvent({ key: "y", code: "KeyY", metaKey: true }), ctx).kind === "none",
    "Cmd+Y is not redo (macOS uses Cmd+Shift+Z)"
  );
  assert(
    matchShortcut(normalizeKeyEvent({ key: "z", code: "KeyZ", ctrlKey: true, shiftKey: true }), { ...ctx, typing: true })
      .kind === "none",
    "typing in a field → redo ignored"
  );

  assert(
    matchShortcut(normalizeKeyEvent({ key: " ", code: "Space" }), ctx).kind === "togglePlay",
    "Space → togglePlay"
  );
  const del = matchShortcut(normalizeKeyEvent({ key: "Delete", code: "Delete" }), ctx);
  assert(del.kind === "deleteClip" && del.kind === "deleteClip" && del.clipId === "c1", "Delete → deleteClip");
  const right = matchShortcut(normalizeKeyEvent({ key: "ArrowRight", code: "ArrowRight" }), ctx);
  assert(right.kind === "nudgeClip" && right.kind === "nudgeClip" && right.delta === 0.1, "→ nudges clip +0.1");
  const up = matchShortcut(normalizeKeyEvent({ key: "ArrowUp", code: "ArrowUp" }), ctx);
  assert(up.kind === "setClipVolume" && up.kind === "setClipVolume" && up.delta === 0.05, "↑ raises clip volume +0.05");
  const upShift = matchShortcut(normalizeKeyEvent({ key: "ArrowUp", code: "ArrowUp", shiftKey: true }), ctx);
  assert(upShift.kind === "setClipVolume" && upShift.kind === "setClipVolume" && upShift.delta === 0.2, "Shift+↑ raises volume +0.2");
  // Unsplit take (no clips) → arrows nudge the take instead
  const takeCtx: ShortcutContext = { ...ctx, selectedClipId: null, takeHasClips: false };
  const left = matchShortcut(normalizeKeyEvent({ key: "ArrowLeft", code: "ArrowLeft" }), takeCtx);
  assert(left.kind === "nudgeTake" && left.kind === "nudgeTake" && left.delta === -0.1, "← nudges unsplit take −0.1");
}

console.log("Challenges — point-based scoring");
{
  // Exactly the 10 required challenges with the required point values.
  const expected: [string, number][] = [
    ["Szybki Start", 50],
    ["Mistrz Rymu", 100],
    ["Cięcie Chirurgiczne", 150],
    ["Złoty Środek", 100],
    ["Dźwięk z Pamięci", 200],
    ["Bit i Słowo", 150],
    ["Maraton Wersów", 200],
    ["Minimalista", 300],
    ["Teleprompter Pro", 100],
    ["Mistrz Archiwum", 100],
  ];
  assert(
    CHALLENGES.length === 10 &&
      CHALLENGES.every((c, i) => c.title === expected[i][0] && c.points === expected[i][1]),
    "10 challenges with the required titles and point values"
  );
  assert(MAX_SCORE === 1450, `MAX_SCORE is the sum of all points (got ${MAX_SCORE})`);

  const empty = emptyChallengeState();
  assert(getTotalScore(empty) === 0 && getCompletedCount(empty) === 0, "empty state scores 0");

  // Completion conditions
  const partiallyDone: ChallengeState = {
    ...emptyChallengeState(),
    stats: { ...emptyChallengeState().stats, takes: 3, lyricsLines: 30, beats: 1 },
    completed: {},
  };
  assert(
    isChallengeConditionMet(partiallyDone, CHALLENGES[0]), // Szybki Start: takes ≥ 1
    "Szybki Start met at 1+ takes"
  );
  assert(
    isChallengeConditionMet(partiallyDone, CHALLENGES[4]), // Dźwięk z Pamięci: takes ≥ 3
    "Dźwięk z Pamięci met at 3 takes"
  );
  assert(
    isChallengeConditionMet(partiallyDone, CHALLENGES[6]), // Maraton Wersów: 30 lines
    "Maraton Wersów met at 30 lines"
  );
  const noTakesState: ChallengeState = {
    ...empty,
    stats: { ...empty.stats, beats: 1 },
  };
  assert(
    !isChallengeConditionMet(noTakesState, CHALLENGES[5]), // beats without any take
    "Bit i Słowo requires a take too"
  );
  assert(
    isChallengeConditionMet(partiallyDone, CHALLENGES[5]), // beats:1 + takes:3
    "Bit i Słowo met with beat + take"
  );

  // evaluateNewlyCompleted only returns unmet-but-now-satisfied challenges
  const newly = evaluateNewlyCompleted(partiallyDone);
  assert(newly.length === 5, `5 newly completable from partial stats (got ${newly.length})`);
  assert(newly.some((c) => c.id === "dzwiek-z-pamieci"), "Dźwięk z Pamięci among newly");

  // Scoring after marking completions
  const scored: ChallengeState = { ...partiallyDone, completed: { "szybki-start": "2026-01-01", "mistrz-rymu": "2026-01-01" } };
  assert(getTotalScore(scored) === 150, "score sums completed challenge points (50+100)");
  assert(getCompletedCount(scored) === 2, "completed count is 2");
  assert(getChallengeProgress(scored, CHALLENGES[0]) === 1, "completed challenge shows 100% progress");
  assert(
    Math.abs(getChallengeProgress(scored, CHALLENGES[4]) - 1) < 1e-9,
    "progress caps at 1 when stats exceed target"
  );
  assert(
    Math.abs(getChallengeProgress(scored, CHALLENGES[2]) - 0) < 1e-9,
    "zero-progress challenge shows 0%"
  );
}

// ── useDeferredUrlRevoke core (createDeferredUrlRevoker) tests ────────────────
{
  // Manual clock: timers only fire when we advance `now` and call `fireDue()`.
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { fn: () => void; at: number }>();
  const setTimer = (fn: () => void, delayMs: number) => {
    const id = nextId++;
    timers.set(id, { fn, at: now + delayMs });
    return id;
  };
  const clearTimer = (id: number) => timers.delete(id);
  /** Fire every timer due at or before the current `now`, once each. */
  const fireDue = () => {
    const due = [...timers.values()]
      .filter((t) => t.at <= now)
      .sort((a, b) => a.at - b.at);
    due.forEach((t) => {
      const hit = [...timers.entries()].find(([, v]) => v === t);
      if (hit) {
        timers.delete(hit[0]);
        t.fn();
      }
    });
  };
  const revoked: string[] = [];
  const events: string[] = [];
  const revoker = createDeferredUrlRevoker(setTimer, clearTimer, (u) => {
    revoked.push(u);
    events.push(`revoke:${u}`);
  });
  const onRevoked = (u: string) => events.push(`cb:${u}`);

  revoker.revokeAfter("blob:1", 100);
  revoker.revokeAfter("blob:1", 100); // duplicate — must be ignored
  revoker.revokeAfter("data:audio/wav;base64,xxx", 100); // non-blob — must be ignored
  revoker.revokeAfter(null, 100);
  revoker.revokeAfter(undefined, 100);
  assert(timers.size === 1, "deferred revoke: duplicates + non-blob/null URLs are not scheduled");

  revoker.revokeAfter("blob:2", 50, onRevoked);
  assert(timers.size === 2, "deferred revoke: distinct blob URLs each get a timer");

  now = 50;
  fireDue();
  assert(revoked.includes("blob:2"), "deferred revoke: URL revoked once its delay elapses");
  assert(
    events.join(",") === "revoke:blob:2,cb:blob:2",
    "deferred revoke: onRevoked runs AFTER the URL is revoked"
  );
  assert(timers.size === 1, "deferred revoke: fired timers are removed from the queue");

  revoker.revokeAfter("blob:3", 100);
  revoker.cancelRevoke("blob:3");
  revoker.cancelRevoke("blob:3"); // double cancel — safe no-op
  revoker.cancelRevoke("blob:nope");
  revoker.cancelRevoke("");
  assert(timers.size === 1, "deferred revoke: cancelRevoke removes exactly its own timer");

  now = 100;
  fireDue();
  assert(revoked.includes("blob:1"), "deferred revoke: blob:1 revoked at 100ms");
  assert(!revoked.includes("blob:3"), "deferred revoke: cancelled URL is never revoked");
  assert(timers.size === 0, "deferred revoke: queue drains after firing");

  revoker.revokeAfter("blob:4", 500);
  revoker.revokeAfter("blob:5", 600);
  assert(timers.size === 2, "deferred revoke: two pending timers before dispose");
  revoker.dispose();
  assert(timers.size === 0, "deferred revoke: dispose clears every pending timer");
  now = 1000;
  fireDue();
  assert(
    !revoked.includes("blob:4") && !revoked.includes("blob:5"),
    "deferred revoke: disposed timers never fire"
  );

  // A URL whose timer already fired can be scheduled again — the delete →
  // Cofnij → delete flow must not be blocked by the dedup guard.
  revoker.revokeAfter("blob:1", 200); // fired earlier at 100ms
  assert(timers.size === 1, "deferred revoke: a fired URL can be re-scheduled");
  now = 1200;
  fireDue();
  assert(
    revoked.filter((u) => u === "blob:1").length === 2,
    "deferred revoke: re-scheduled URL is revoked again"
  );
  assert(timers.size === 0, "deferred revoke: re-scheduled timer drains after firing");
}

// ── createDebouncedPersister (StudioContext 400ms debounce) tests ─────────────
{
  // Manual clock: writes only happen when we advance `now` and call `fireDue()`.
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { fn: () => void; at: number }>();
  const setTimer = (fn: () => void) => {
    const id = nextId++;
    timers.set(id, { fn, at: now + PERSIST_DEBOUNCE_MS });
    return id;
  };
  const clearTimer = (id: number) => timers.delete(id);
  const fireDue = () => {
    const due = [...timers.values()]
      .filter((t) => t.at <= now)
      .sort((a, b) => a.at - b.at);
    due.forEach((t) => {
      const hit = [...timers.entries()].find(([, v]) => v === t);
      if (hit) {
        timers.delete(hit[0]);
        t.fn();
      }
    });
  };
  let writes = 0;
  const persister = createDebouncedPersister(setTimer, clearTimer, () => {
    writes++;
  });

  // Rapid changes batch into a single write once the window elapses.
  persister.schedule();
  persister.schedule();
  persister.schedule();
  assert(writes === 0, "debounced persister: rapid changes do not write immediately");
  assert(timers.size === 1, "debounced persister: rapid changes collapse to one pending write");
  now = PERSIST_DEBOUNCE_MS;
  fireDue();
  assert(writes === 1, "debounced persister: exactly one write fires after the window");
  assert(timers.size === 0, "debounced persister: a fired write leaves no pending timer");

  // A change inside the window resets the deadline (true debounce).
  persister.schedule();
  now = PERSIST_DEBOUNCE_MS - 100; // 300ms in
  fireDue();
  assert(writes === 1, "debounced persister: no write before the (reset) deadline");
  persister.schedule(); // deadline moves to 700ms
  now = PERSIST_DEBOUNCE_MS + 200; // 600ms since the first schedule
  fireDue();
  assert(writes === 1, "debounced persister: an in-window change extends the deadline");
  now += 100; // 700ms total
  fireDue();
  assert(writes === 2, "debounced persister: write fires 400ms after the LAST change");

  // flush() writes immediately and cancels the pending timer.
  persister.schedule();
  persister.flush();
  assert(writes === 3, "debounced persister: flush writes immediately");
  assert(timers.size === 0, "debounced persister: flush leaves no pending timer");
  now += PERSIST_DEBOUNCE_MS;
  fireDue();
  assert(writes === 3, "debounced persister: the flushed write does not double-fire later");
  persister.flush(); // nothing pending — safe no-op
  assert(writes === 3, "debounced persister: flush with nothing pending is a no-op");

  // cancel() drops the pending write without writing.
  persister.schedule();
  persister.cancel();
  assert(timers.size === 0, "debounced persister: cancel drops the pending write");
  now += PERSIST_DEBOUNCE_MS;
  fireDue();
  assert(writes === 3, "debounced persister: a cancelled write never fires");
  persister.cancel(); // nothing pending — safe no-op

  // Separated changes produce separate writes.
  persister.schedule();
  now += PERSIST_DEBOUNCE_MS;
  fireDue();
  assert(writes === 4, "debounced persister: a settled change writes");
  persister.schedule();
  now += PERSIST_DEBOUNCE_MS;
  fireDue();
  assert(writes === 5, "debounced persister: a later settled change writes again");
}

console.log("");
if (failures > 0) {
  console.error(`${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("All clip-timeline tests passed ✔");
