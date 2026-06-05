// Event-driven scroll sync for split mode. Replaces the former continuous
// scroll/input coupling. Two discrete, one-shot triggers, both active only in
// split mode:
//
//   * RHS click  -> move the LHS editor cursor to the clicked source location
//                   (best-effort word offset) and scroll it into view.
//   * LHS edit   -> after the debounced re-render settles, centre the RHS
//                   preview on the block at the cursor line.
//
// Scrolling one pane never moves the other. See
// docs/superpowers/specs/2026-06-05-scroll-sync-design.md.

import type { EditorView } from '@codemirror/view';

export interface ScrollSyncHandle {
  /** Centre the RHS preview on the most-specific block at 1-based editor
   *  `line`. No-op if no tagged block matches. */
  centerPreviewOnLine(line: number): void;
  /** Mark that a user edit happened; the next settled render recentres.
   *  No-op unless currently in split mode (so the flag never goes stale). */
  notifyEdit(): void;
  /** Called from the post-render *success* hook (DOM is fresh): clears the
   *  pending flag and, if it was set and we are still in split mode, recentres
   *  on the current cursor line. */
  flushPendingEditCenter(): void;
  /** Called from the render `finally` (covers rejected / superseded renders):
   *  clears the pending flag without centring, so it can never carry over to a
   *  later unrelated render. */
  cancelPendingEditCenter(): void;
  detach(): void;
}

export interface ScrollSyncOptions {
  view: EditorView;
  /** Scroll container of the rendered preview. */
  previewPane: HTMLElement;
  /** Element holding the `data-src-*` tagged nodes (inside `previewPane`). */
  previewContent: HTMLElement;
  /** Current view mode; sync is active only when this returns `'split'`. */
  getMode: () => string;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in scroll_sync.test.ts — kept DOM-free).
// ---------------------------------------------------------------------------

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Extract the word at `offset` within `text`. A "word" is a maximal run of
 *  Unicode letters/numbers. If the offset sits on a non-word char but the
 *  preceding char is a word char (caret just after a word), step back one.
 *  Returns '' when no word is adjacent. */
export function wordAt(text: string, offset: number): string {
  const len = text.length;
  const isWord = (i: number): boolean => i >= 0 && i < len && WORD_CHAR.test(text[i]!);
  let o = Math.max(0, Math.min(len, offset));
  if (!isWord(o) && isWord(o - 1)) o -= 1;
  if (!isWord(o)) return '';
  let s = o;
  let e = o;
  while (isWord(s - 1)) s -= 1;
  while (isWord(e + 1)) e += 1;
  return text.slice(s, e + 1);
}

export interface SourcePos {
  /** 1-based line. */
  line: number;
  /** 0-based column. */
  col: number;
}

/** Find `word` within the source line range `[srcStart..srcEnd]` (1-based,
 *  inclusive) of the full document `srcText`. Returns the first match's
 *  line+column. Falls back to `{ line: srcStart, col: 0 }` when the word is
 *  empty or not found. A non-finite or backwards `srcEnd` is treated as a
 *  single line (`srcStart`); the end is clamped to the document length. */
export function resolveSourcePosition(
  srcText: string,
  srcStart: number,
  srcEnd: number,
  word: string,
): SourcePos {
  const fallback: SourcePos = { line: srcStart, col: 0 };
  if (!word) return fallback;
  const lines = srcText.split('\n');
  const start = Math.max(1, srcStart);
  let end = Number.isFinite(srcEnd) && srcEnd >= start ? srcEnd : start;
  end = Math.min(end, lines.length);
  for (let n = start; n <= end; n += 1) {
    const idx = lines[n - 1]?.indexOf(word) ?? -1;
    if (idx >= 0) return { line: n, col: idx };
  }
  return fallback;
}

export interface BlockDesc {
  /** 1-based start line. */
  start: number;
  /** 1-based inclusive end line; `NaN` (or `< start`) means single line. */
  end: number;
  /** DOM nesting depth within the preview content root. */
  depth: number;
}

/** Index of the most-specific block covering `line`: the largest `start` that
 *  still covers the line (`start <= line <= effectiveEnd`), tie-broken by
 *  greatest DOM `depth` (so a cell/row/list-item wins over an enclosing
 *  table/list sharing the same source range). Returns -1 if none cover it. */
export function pickBlockForLine(blocks: BlockDesc[], line: number): number {
  let best = -1;
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i]!;
    const end = Number.isFinite(b.end) && b.end >= b.start ? b.end : b.start;
    if (b.start > line || line > end) continue;
    if (best === -1) {
      best = i;
      continue;
    }
    const cur = blocks[best]!;
    if (b.start > cur.start || (b.start === cur.start && b.depth >= cur.depth)) {
      best = i;
    }
  }
  return best;
}

/** One-shot gate for the LHS-edit -> RHS-centre trigger. DOM-free so the
 *  arm/flush/cancel state machine is unit-testable. "Armed" means a user edit
 *  in split mode is awaiting the next settled render; `flush`/`cancel` both
 *  disarm, so a pending request can never survive a render attempt. */
export interface EditCenterGate {
  /** Arm only when `active` (i.e. in split mode); otherwise leave unchanged. */
  arm(active: boolean): void;
  /** Disarm and report whether a centre should happen now (`armed && active`).
   *  Called on a successful render. */
  flush(active: boolean): boolean;
  /** Disarm without centring. Called on rejected / superseded renders. */
  cancel(): void;
}

export function createEditCenterGate(): EditCenterGate {
  let armed = false;
  return {
    arm: (active) => {
      if (active) armed = true;
    },
    flush: (active) => {
      const center = armed && active;
      armed = false;
      return center;
    },
    cancel: () => {
      armed = false;
    },
  };
}

// ---------------------------------------------------------------------------
// DOM / CodeMirror glue (verified manually on `just run`; see CLAUDE.md note
// on why the mocked-Chromium e2e suite cannot exercise it).
// ---------------------------------------------------------------------------

interface TaggedBlock {
  el: HTMLElement;
  desc: BlockDesc;
}

function collectBlocks(content: HTMLElement): TaggedBlock[] {
  const out: TaggedBlock[] = [];
  content.querySelectorAll<HTMLElement>('[data-src-start]').forEach((el) => {
    const start = Number(el.dataset.srcStart);
    if (!Number.isFinite(start)) return;
    const endRaw = el.dataset.srcEnd;
    const end = endRaw !== undefined && endRaw !== '' ? Number(endRaw) : NaN;
    let depth = 0;
    for (let p = el.parentElement; p && p !== content; p = p.parentElement) depth += 1;
    out.push({ el, desc: { start, end, depth } });
  });
  return out;
}

/** Resolve the word under the pointer via the caret-from-point APIs
 *  (`caretRangeFromPoint` on WebKit/Chromium, `caretPositionFromPoint`
 *  elsewhere). Returns '' when unavailable or not over a text node. */
function wordAtPoint(doc: Document, x: number, y: number): string {
  const d = doc as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
  };
  let node: Node | null = null;
  let offset = 0;
  if (typeof d.caretRangeFromPoint === 'function') {
    const r = d.caretRangeFromPoint(x, y);
    if (r) {
      node = r.startContainer;
      offset = r.startOffset;
    }
  } else if (typeof d.caretPositionFromPoint === 'function') {
    const p = d.caretPositionFromPoint(x, y);
    if (p) {
      node = p.offsetNode;
      offset = p.offset;
    }
  }
  if (node && node.nodeType === Node.TEXT_NODE) {
    return wordAt((node as Text).data, offset);
  }
  return '';
}

const SKIP_SELECTOR = 'a,button,input,textarea,select,[contenteditable],[role="button"]';

export function attachScrollSync(opts: ScrollSyncOptions): ScrollSyncHandle {
  const { view, previewPane, previewContent, getMode } = opts;
  const editGate = createEditCenterGate();

  const centerPreviewOnLine = (line: number): void => {
    const blocks = collectBlocks(previewContent);
    const idx = pickBlockForLine(
      blocks.map((b) => b.desc),
      line,
    );
    if (idx < 0) return;
    blocks[idx]!.el.scrollIntoView({ block: 'center', inline: 'nearest' });
  };

  // Place the editor cursor, clamping line+column (CodeMirror's dispatch does
  // not clamp out-of-range positions).
  const moveCursorTo = (pos: SourcePos): void => {
    const doc = view.state.doc;
    const line = Math.max(1, Math.min(doc.lines, pos.line));
    const lineObj = doc.line(line);
    const col = Math.max(0, Math.min(lineObj.length, pos.col));
    view.dispatch({ selection: { anchor: lineObj.from + col }, scrollIntoView: true });
  };

  const onClick = (ev: MouseEvent): void => {
    if (getMode() !== 'split') return;
    const target = ev.target as HTMLElement | null;
    if (!target || target.closest(SKIP_SELECTOR)) return;
    // Don't steal the cursor while the user is selecting text to copy.
    const sel = previewPane.ownerDocument.getSelection();
    if (sel && !sel.isCollapsed) return;
    const block = target.closest<HTMLElement>('[data-src-start]');
    if (!block) return;
    const start = Number(block.dataset.srcStart);
    if (!Number.isFinite(start)) return;
    const endRaw = block.dataset.srcEnd;
    const end = endRaw !== undefined && endRaw !== '' ? Number(endRaw) : start;
    const word = wordAtPoint(previewPane.ownerDocument, ev.clientX, ev.clientY);
    moveCursorTo(resolveSourcePosition(view.state.doc.toString(), start, end, word));
    view.focus();
  };

  previewPane.addEventListener('click', onClick);

  return {
    centerPreviewOnLine,
    notifyEdit: () => {
      editGate.arm(getMode() === 'split');
    },
    flushPendingEditCenter: () => {
      if (!editGate.flush(getMode() === 'split')) return;
      const head = view.state.selection.main.head;
      centerPreviewOnLine(view.state.doc.lineAt(head).number);
    },
    cancelPendingEditCenter: () => {
      editGate.cancel();
    },
    detach: () => {
      previewPane.removeEventListener('click', onClick);
    },
  };
}
