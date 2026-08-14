// Pure LIFO undo/redo history for the Studio Waveform Editor.
//
// The undo stack stores labelled snapshots of the timeline; `pop()` returns
// the most recent entry (last-in, first-out) so the previous state can be
// restored. `undo()` moves the discarded state to the redo stack so it can be
// re-applied — mirroring the classic undo/redo model. Pushing a NEW action
// clears the redo stack, because redoing is only valid directly after undo.

export interface HistoryEntry<T> {
  state: T;
  /** Human-readable label of the action that produced this snapshot. */
  label: string;
}

export class UndoHistory<T> {
  private stack: HistoryEntry<T>[] = [];
  private redoStack: HistoryEntry<T>[] = [];

  constructor(private readonly max: number = 100) {}

  get size(): number {
    return this.stack.length;
  }

  get isEmpty(): boolean {
    return this.stack.length === 0;
  }

  /** Number of entries available for redo (only grows after an undo). */
  get redoSize(): number {
    return this.redoStack.length;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Record a new (pre-mutation) snapshot. By default it invalidates any redo
   * history (a fresh edit makes redo meaningless). Pass `invalidateRedo` =
   * false when the entry comes from a REDO itself — that must NOT clear the
   * remaining redo stack.
   */
  push(state: T, label: string, invalidateRedo: boolean = true): void {
    this.stack.push({ state, label });
    if (this.stack.length > this.max) this.stack.shift();
    if (invalidateRedo) this.redoStack = [];
  }

  /** Undo: pop the latest snapshot. The caller pushes the current state to redo. */
  pop(): HistoryEntry<T> | undefined {
    return this.stack.pop();
  }

  /** Record a state for redo (called by `undo`). */
  pushRedo(state: T, label: string): void {
    this.redoStack.push({ state, label });
    if (this.redoStack.length > this.max) this.redoStack.shift();
  }

  /** Redo: pop the latest redo entry. The caller pushes the current state back to undo. */
  popRedo(): HistoryEntry<T> | undefined {
    return this.redoStack.pop();
  }

  clear(): void {
    this.stack = [];
    this.redoStack = [];
  }
}
