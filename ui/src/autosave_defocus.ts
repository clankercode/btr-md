// on_defocus autosave helpers.
//
// Window `blur` alone is not enough: switching app document tabs never blurs
// the window, so dirty buffers must also be saved when a doc tab is
// deactivated. This module holds the pure eligibility decision and a per-doc
// trailing coalescer so rapid tab switches do not stampede saves.

import type { AutosaveMode, FileState } from './doc_state.js';

/** Short trailing debounce for defocus saves (window blur + tab switch). */
export const DEFOCUS_AUTOSAVE_DEBOUNCE_MS = 75;

/**
 * Whether on_defocus should attempt to save this document.
 *
 * - Requires `on_defocus` mode and a path (untitled would open a save dialog).
 * - Saves `dirty` states.
 * - Also saves `clean` when the buffer already differs from baseline (edits
 *   whose `doc_edited` IPC has not yet updated `FileState`).
 * - Never autosaves conflict / removed / in-progress states (matches the
 *   historical `maybeAutosave` dirty-only policy for those variants).
 */
export function shouldAutosaveOnDefocus(args: {
  mode: AutosaveMode;
  filePath: string | null | undefined;
  stateKind: FileState['kind'] | null | undefined;
  bufferDiffersFromBase: boolean;
}): boolean {
  if (args.mode !== 'on_defocus') return false;
  if (!args.filePath) return false;
  if (args.stateKind === 'dirty') return true;
  if (args.stateKind === 'clean' && args.bufferDiffersFromBase) return true;
  return false;
}

export interface DefocusSaveCoalescer {
  /** Schedule a save for `docId`; rapid re-schedules of the same id coalesce. */
  schedule(docId: number): void;
  /** Drop a pending save (e.g. tab closed). */
  cancel(docId: number): void;
  cancelAll(): void;
  /** Doc ids with a pending timer (for tests / diagnostics). */
  pending(): number[];
  /** Resolve when the serial save queue is idle (tests / diagnostics). */
  whenIdle(): Promise<void>;
}

/**
 * Per-docId trailing debounce with a global save queue.
 *
 * Different docs may be *pending* concurrently (each with its own timer), but
 * actual `save` calls are serialised. That matters because `saveTab` temporarily
 * claims backend active-doc authority; parallel saves would race `setActiveDoc`.
 * A mid-flight re-schedule of the same doc queues one follow-up.
 */
export function createDefocusSaveCoalescer(opts: {
  delayMs: number;
  save: (docId: number) => void | Promise<void>;
  /** Re-check eligibility when the timer fires / before a queued run. */
  stillEligible: (docId: number) => boolean;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}): DefocusSaveCoalescer {
  const setTimer = opts.setTimeout ?? setTimeout;
  const clearTimer = opts.clearTimeout ?? clearTimeout;
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  /** Docs currently executing (or queued on the global chain). */
  const inFlight = new Set<number>();
  /** Docs that need another save after the current in-flight run finishes. */
  const retrigger = new Set<number>();
  /** Serialises all save calls across docs. */
  let tail: Promise<void> = Promise.resolve();

  function schedule(docId: number): void {
    const existing = timers.get(docId);
    if (existing !== undefined) clearTimer(existing);
    timers.set(
      docId,
      setTimer(() => {
        timers.delete(docId);
        enqueue(docId);
      }, opts.delayMs) as ReturnType<typeof setTimeout>,
    );
  }

  function enqueue(docId: number): void {
    if (inFlight.has(docId)) {
      retrigger.add(docId);
      return;
    }
    if (!opts.stillEligible(docId)) return;
    inFlight.add(docId);
    const run = async (): Promise<void> => {
      try {
        // Re-check: a prior save in the queue may have cleaned this doc, or
        // the tab may have been closed while we waited.
        if (!opts.stillEligible(docId)) return;
        await opts.save(docId);
      } catch {
        // Callers (saveTab) already surface errors; never break the chain.
      } finally {
        inFlight.delete(docId);
        if (retrigger.delete(docId)) {
          schedule(docId);
        }
      }
    };
    // Keep the chain alive after rejections (run already swallows).
    tail = tail.then(run, run);
  }

  function cancel(docId: number): void {
    const existing = timers.get(docId);
    if (existing !== undefined) clearTimer(existing);
    timers.delete(docId);
    retrigger.delete(docId);
  }

  function cancelAll(): void {
    for (const id of [...timers.keys()]) cancel(id);
    retrigger.clear();
  }

  return {
    schedule,
    cancel,
    cancelAll,
    pending: () => [...timers.keys()],
    whenIdle: () => tail.then(() => undefined, () => undefined),
  };
}
