/**
 * Line-level change hunks between the previous editor buffer and reloaded
 * on-disk content (B009).
 *
 * Pure module — no DOM / CodeMirror imports — so unit tests can exercise it
 * with plain `node:test`. Downstream tasks reuse the same hunk list:
 * - B010 minimap markers
 * - B012 jump-to-first / next-prev change
 */

export type FlashHunkKind = 'add' | 'remove' | 'replace';

/** One contiguous line-level change region. Line indices are 0-based. */
export interface FlashHunk {
  kind: FlashHunkKind;
  /** Inclusive start line in the *before* document. */
  beforeFrom: number;
  /** Exclusive end line in the *before* document. */
  beforeTo: number;
  /** Inclusive start line in the *after* document (reload result). */
  afterFrom: number;
  /** Exclusive end line in the *after* document. */
  afterTo: number;
}

/** CSS class names applied to `.cm-line` during the ephemeral flash. */
export type FlashLineClass = 'pmd-flash-add' | 'pmd-flash-remove' | 'pmd-flash-replace';

/** A single line in the *after* document that should flash. */
export interface FlashLineMark {
  /** 0-based line index in the after document. */
  line: number;
  className: FlashLineClass;
}

/**
 * Ephemeral flash duration (ms). Decorations auto-clear after this.
 * Keep in sync with `.cm-line.pmd-flash-*` animation length in components.css
 * (currently 1.4s).
 */
export const FLASH_DURATION_MS = 1400;

/**
 * Cap on `n * m` for full LCS. Larger middles collapse to a single replace
 * hunk so a multi-MB paste cannot OOM the UI thread. Prefix/suffix stripping
 * still gives a tight span for typical "edit in the middle" reloads.
 */
const LCS_CELL_BUDGET = 1_500_000;

/**
 * Per-document flash / jump state (B010 / B012).
 *
 * Scoped by backend `docId` so tab switches cannot paint another doc's
 * minimap markers or jump to another tab's change hunks.
 *
 * When APIs omit `docId`, they use the active flash doc (set on tab activate).
 * Unit tests that never set an active doc fall back to {@link FALLBACK_FLASH_DOC_ID}.
 */
const FALLBACK_FLASH_DOC_ID = -1;

interface FlashDocState {
  hunks: FlashHunk[];
  /** Index into `hunks` for next/prev navigation; `-1` when empty / never jumped. */
  jumpIndex: number;
}

const flashByDocId = new Map<number, FlashDocState>();

/** Backend docId of the currently displayed document, or null when none. */
let activeFlashDocId: number | null = null;

/** Record which document is active so omit-docId APIs target the right store. */
export function setActiveFlashDocId(docId: number | null): void {
  activeFlashDocId = docId;
}

export function getActiveFlashDocId(): number | null {
  return activeFlashDocId;
}

function resolveFlashDocId(docId?: number): number {
  if (docId !== undefined) return docId;
  return activeFlashDocId ?? FALLBACK_FLASH_DOC_ID;
}

function flashState(docId: number): FlashDocState {
  let s = flashByDocId.get(docId);
  if (!s) {
    s = { hunks: [], jumpIndex: -1 };
    flashByDocId.set(docId, s);
  }
  return s;
}

export function getLastFlashHunks(docId?: number): readonly FlashHunk[] {
  return flashState(resolveFlashDocId(docId)).hunks;
}

export function rememberFlashHunks(hunks: readonly FlashHunk[], docId?: number): void {
  const id = resolveFlashDocId(docId);
  const copy = hunks.slice();
  flashByDocId.set(id, {
    hunks: copy,
    // New flash: land index on first change (or clear when empty).
    jumpIndex: copy.length > 0 ? 0 : -1,
  });
}

export function clearRememberedFlashHunks(docId?: number): void {
  const id = resolveFlashDocId(docId);
  flashByDocId.set(id, { hunks: [], jumpIndex: -1 });
}

/** Drop all per-doc flash state (tests / full reset). */
export function clearAllRememberedFlashHunks(): void {
  flashByDocId.clear();
}

/** Current next/prev change index into `getLastFlashHunks()` (`-1` if none). */
export function getChangeJumpIndex(docId?: number): number {
  return flashState(resolveFlashDocId(docId)).jumpIndex;
}

/**
 * 0-based line in the *after* document to place the caret for a flash hunk.
 *
 * - add / replace → start of the after span (`afterFrom`)
 * - pure remove (`afterFrom === afterTo`) → deletion locus; clamped into doc
 *
 * `afterLineCount` must be ≥ 1 (CodeMirror always has at least one line).
 */
export function hunkJumpLine(hunk: FlashHunk, afterLineCount: number): number {
  const n = Math.max(1, afterLineCount);
  return Math.max(0, Math.min(n - 1, hunk.afterFrom));
}

/**
 * Pure: next/prev index into a hunk list. **Wraps** at ends (VS Code style).
 * Returns `null` when `hunkCount === 0`.
 *
 * If `currentIndex` is out of range (`-1` or past the end), `direction +1`
 * seeds at the first hunk and `-1` seeds at the last.
 */
export function stepChangeIndex(
  hunkCount: number,
  currentIndex: number,
  direction: 1 | -1,
): number | null {
  if (hunkCount <= 0) return null;
  if (currentIndex < 0 || currentIndex >= hunkCount) {
    return direction === 1 ? 0 : hunkCount - 1;
  }
  return (currentIndex + direction + hunkCount) % hunkCount;
}

/**
 * Advance the remembered change-jump index and return the target hunk, or
 * `null` when there are no remembered flash hunks (quiet no-op for commands).
 *
 * Pass `stay = true` to re-target the current index without stepping (used
 * after reload to jump to the first change already selected by
 * `rememberFlashHunks`).
 *
 * Optional `docId` scopes the jump to that document; defaults to the active
 * flash doc (or the test fallback bucket).
 */
export function advanceChangeJump(
  direction: 1 | -1,
  options?: { stay?: boolean; docId?: number },
): { index: number; hunk: FlashHunk } | null {
  const id = resolveFlashDocId(options?.docId);
  const state = flashState(id);
  const hunks = state.hunks;
  if (hunks.length === 0) return null;
  if (options?.stay) {
    const index =
      state.jumpIndex >= 0 && state.jumpIndex < hunks.length ? state.jumpIndex : 0;
    state.jumpIndex = index;
    return { index, hunk: hunks[index]! };
  }
  const next = stepChangeIndex(hunks.length, state.jumpIndex, direction);
  if (next === null) return null;
  state.jumpIndex = next;
  return { index: next, hunk: hunks[next]! };
}

/**
 * Split document text into lines the same way CodeMirror's `Text.toString()`
 * round-trips: `split('\n')`, so a trailing newline yields a final empty
 * segment. Empty documents are a single empty line.
 */
export function splitDocLines(text: string): string[] {
  if (text.length === 0) return [''];
  return text.split('\n');
}

/**
 * Compute line-level added / removed / replaced hunks of `after` vs `before`.
 * Returns `[]` when the texts are identical (quiet — no flash).
 */
export function computeFlashHunks(before: string, after: string): FlashHunk[] {
  if (before === after) return [];
  return lineDiffHunks(splitDocLines(before), splitDocLines(after));
}

/**
 * Map hunks onto per-line CSS classes in the *after* document.
 *
 * - pure add → green on each added line
 * - pure remove → red on the locus line (where the deleted span used to sit)
 * - replace → green+red accent on every new line in the span
 *
 * `afterLineCount` must be ≥ 1 (CodeMirror always has at least one line).
 */
export function flashLineMarks(
  hunks: readonly FlashHunk[],
  afterLineCount: number,
): FlashLineMark[] {
  const n = Math.max(1, afterLineCount);
  const byLine = new Map<number, FlashLineClass>();

  const put = (line: number, cls: FlashLineClass): void => {
    const clamped = Math.max(0, Math.min(n - 1, line));
    const cur = byLine.get(clamped);
    if (!cur) {
      byLine.set(clamped, cls);
    } else if (cur !== cls) {
      // Mixed signals on one line (e.g. remove locus + nearby add) → replace.
      byLine.set(clamped, 'pmd-flash-replace');
    }
  };

  for (const h of hunks) {
    if (h.afterTo > h.afterFrom) {
      // pure add → green; replace (also dropped lines) → green+red accent
      const cls: FlashLineClass = h.kind === 'add' ? 'pmd-flash-add' : 'pmd-flash-replace';
      for (let line = h.afterFrom; line < h.afterTo; line++) put(line, cls);
    } else if (h.kind === 'remove' || h.kind === 'replace') {
      // Pure deletion (or empty-after replace): mark the locus line.
      put(h.afterFrom, h.kind === 'remove' ? 'pmd-flash-remove' : 'pmd-flash-replace');
    }
  }

  return [...byLine.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([line, className]) => ({ line, className }));
}

// ---------------------------------------------------------------------------
// Line diff
// ---------------------------------------------------------------------------

function lineDiffHunks(a: string[], b: string[]): FlashHunk[] {
  // Common prefix.
  let start = 0;
  const aLen = a.length;
  const bLen = b.length;
  while (start < aLen && start < bLen && a[start] === b[start]) start++;

  // Common suffix (do not cross `start`).
  let aEnd = aLen;
  let bEnd = bLen;
  while (aEnd > start && bEnd > start && a[aEnd - 1] === b[bEnd - 1]) {
    aEnd--;
    bEnd--;
  }

  if (start === aEnd && start === bEnd) return [];

  if (start === aEnd) {
    return [{ kind: 'add', beforeFrom: start, beforeTo: start, afterFrom: start, afterTo: bEnd }];
  }
  if (start === bEnd) {
    return [{ kind: 'remove', beforeFrom: start, beforeTo: aEnd, afterFrom: start, afterTo: start }];
  }

  const aMid = a.slice(start, aEnd);
  const bMid = b.slice(start, bEnd);

  if (aMid.length * bMid.length > LCS_CELL_BUDGET) {
    return [
      {
        kind: 'replace',
        beforeFrom: start,
        beforeTo: aEnd,
        afterFrom: start,
        afterTo: bEnd,
      },
    ];
  }

  return lcsHunks(aMid, bMid, start);
}

/** Prefix-LCS DP + forward coalesce into hunks. `offset` shifts indices. */
function lcsHunks(a: string[], b: string[], offset: number): FlashHunk[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[0..i) and b[0..j)
  const dp: Int32Array[] = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);

  for (let i = 1; i <= n; i++) {
    const ai = a[i - 1];
    const row = dp[i];
    const prev = dp[i - 1];
    for (let j = 1; j <= m; j++) {
      row[j] =
        ai === b[j - 1] ? prev[j - 1] + 1 : prev[j] >= row[j - 1] ? prev[j] : row[j - 1];
    }
  }

  // Backtrack → reverse edit script.
  type Op = 0 | 1 | 2; // 0 = eq, 1 = del, 2 = ins
  const ops: Op[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push(0);
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push(2);
      j--;
    } else {
      ops.push(1);
      i--;
    }
  }
  ops.reverse();

  const hunks: FlashHunk[] = [];
  let ai = 0;
  let bi = 0;
  let k = 0;
  while (k < ops.length) {
    if (ops[k] === 0) {
      ai++;
      bi++;
      k++;
      continue;
    }
    const beforeFrom = offset + ai;
    const afterFrom = offset + bi;
    while (k < ops.length && ops[k] !== 0) {
      if (ops[k] === 1) ai++;
      else bi++;
      k++;
    }
    const beforeTo = offset + ai;
    const afterTo = offset + bi;
    const kind: FlashHunkKind =
      beforeFrom === beforeTo ? 'add' : afterFrom === afterTo ? 'remove' : 'replace';
    hunks.push({ kind, beforeFrom, beforeTo, afterFrom, afterTo });
  }
  return hunks;
}
