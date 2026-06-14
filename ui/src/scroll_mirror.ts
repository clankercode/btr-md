// Block-anchored continuous scroll coupling for split view. When the
// `scroll-lock` setting is on, scrolling either pane scrolls the other pane
// to the **same source line** at the top of its viewport:
//
//   * Editor→preview: take the first visible source line in the editor
//     viewport, find the deepest preview block that covers it, scroll the
//     preview so that block is at the top of its viewport.
//   * Preview→editor: take the topmost visible `[data-src-start]` block in the
//     preview, scroll the editor so the line at that block's `data-src-start`
//     is at the top of the editor viewport (without changing the editor
//     cursor — only the scroll position moves).
//
// Active only in `split` mode and only when `isEnabled()` is `true`. Inert in
// `source` / `preview` modes and when the lock is off.
//
// This is *additive* on top of the event-driven click→cursor and edit→centre
// triggers in `scroll_sync.ts`; both keep working when the lock is on (the
// mirror just provides continuous alignment while the user scrolls).
//
// Feedback avoidance: every programmatic scroll is wrapped in a single
// `mirroring` guard. The originating side sets the flag, the listener on the
// destination side bails, and a single rAF clears the flag. This is enough
// for a chain like "user scrolls editor → mirror scrolls preview → preview
// scroll listener fires → bails" without the cycle ever running twice in a
// frame. For programmatic restores (tab activation) callers can use
// `suspendForOneFrame()` to skip the next ~50ms of scroll events on both
// panes.

import type { EditorView } from '@codemirror/view';

// These two helpers are duplicated from `scroll_sync.ts` (rather than
// imported from it) so that `node --test` can load this module directly:
// `scroll_sync.ts` carries a type-only `@codemirror/view` import that Node
// strips, and any runtime import from it (`./scroll_sync.js`) would need a
// compiled `.js` file on disk. Keeping the helpers in this file lets the
// test runner load `./scroll_mirror.ts` standalone via its `.ts` extension.
interface BlockDesc {
  /** 1-based start line. */
  start: number;
  /** 1-based inclusive end line; `NaN` (or `< start`) means single line. */
  end: number;
  /** DOM nesting depth within the preview content root. */
  depth: number;
}

interface RawTaggedBlock {
  el: HTMLElement;
  desc: BlockDesc;
}

function collectBlocks(content: HTMLElement): RawTaggedBlock[] {
  const out: RawTaggedBlock[] = [];
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

/** Most-specific block covering `line`: largest `start <= line` that still
 *  covers it, tie-broken by greatest DOM `depth`. -1 if none cover it. */
function pickBlockForLine(blocks: BlockDesc[], line: number): number {
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

export interface ScrollMirrorOptions {
  view: EditorView;
  /** Scroll container of the rendered preview (RHS). */
  previewPane: HTMLElement;
  /** Element holding the `data-src-*` tagged nodes (inside `previewPane`). */
  previewContent: HTMLElement;
  /** Current view mode; the mirror is active only when this returns `'split'`. */
  getMode: () => string;
  /** Whether the user has the split-scroll lock turned on. */
  isEnabled: () => boolean;
}

export interface ScrollMirrorHandle {
  detach(): void;
  /** Briefly suspend the mirror; for callers that programmatically restore
   *  scroll positions (e.g. tab activation). Cleared after ~50ms. */
  suspendForOneFrame(): void;
}

interface TaggedBlock {
  el: HTMLElement;
  desc: BlockDesc;
  rect: () => DOMRect;
}

/** Topmost visible preview block: the last `[data-src-start]` block whose
 *  `top` is at or above `paneTopY`. Returns -1 when no block satisfies the
 *  constraint (empty preview, or all blocks below the top of the pane). */
export function pickTopBlockIndex(blocks: TaggedBlock[], paneTopY: number): number {
  let best = -1;
  for (let i = 0; i < blocks.length; i += 1) {
    const top = blocks[i]!.rect().top;
    if (top <= paneTopY) best = i;
    else break;
  }
  return best;
}

function collectPreviewBlocks(content: HTMLElement): TaggedBlock[] {
  const out: TaggedBlock[] = [];
  content.querySelectorAll<HTMLElement>('[data-src-start]').forEach((el) => {
    const start = Number(el.dataset.srcStart);
    if (!Number.isFinite(start)) return;
    const endRaw = el.dataset.srcEnd;
    const end = endRaw !== undefined && endRaw !== '' ? Number(endRaw) : NaN;
    let depth = 0;
    for (let p = el.parentElement; p && p !== content; p = p.parentElement) depth += 1;
    out.push({ el, desc: { start, end, depth }, rect: () => el.getBoundingClientRect() });
  });
  return out;
}

/** Wrap a programmatic-scroll action so the mirror's feedback guard is set
 *  before the scroll and cleared on the next frame. */
function withMirrorGuard(mirroring: { value: boolean }, action: () => void): void {
  mirroring.value = true;
  action();
  requestAnimationFrame(() => {
    mirroring.value = false;
  });
}

export function attachScrollMirror(opts: ScrollMirrorOptions): ScrollMirrorHandle {
  const { view, previewPane, previewContent, getMode, isEnabled } = opts;

  // Shared between both listeners: when one side programmatically scrolls the
  // other, the destination's scroll listener bails while this is true.
  const mirroring = { value: false };
  let suspendUntil = 0;

  const active = (): boolean => getMode() === 'split' && isEnabled();

  // ---- derive "current top source line" from each pane ------------------

  /** First visible source line in the editor viewport (1-based), or null. */
  const topLineFromEditor = (): number | null => {
    const blocks = view.viewportLineBlocks;
    if (!blocks.length) return null;
    const from = blocks[0]!.from;
    return view.state.doc.lineAt(from).number;
  };

  /** Topmost visible preview block's `data-src-start`, or null. */
  const topLineFromPreview = (): number | null => {
    const blocks = collectPreviewBlocks(previewContent);
    if (!blocks.length) return null;
    const paneRect = previewPane.getBoundingClientRect();
    const idx = pickTopBlockIndex(blocks, paneRect.top);
    if (idx < 0) return null;
    return blocks[idx]!.desc.start;
  };

  // ---- mirror implementations -------------------------------------------

  const mirrorEditorToPreview = (line: number): void => {
    if (!active()) return;
    const blocks = collectBlocks(previewContent);
    if (!blocks.length) return;
    const idx = pickBlockForLine(
      blocks.map((b) => b.desc),
      line,
    );
    if (idx < 0) return;
    withMirrorGuard(mirroring, () => {
      blocks[idx]!.el.scrollIntoView({ block: 'start', inline: 'nearest' });
    });
  };

  const mirrorPreviewToEditor = (line: number): void => {
    if (!active()) return;
    const total = view.state.doc.lines;
    const n = Math.max(1, Math.min(total, line));
    const pos = view.state.doc.line(n).from;
    // Pure viewport scroll — the cursor stays put. We set scrollTop so that
    // `lineBlockAt(pos).top` lands at the top of the editor viewport.
    const block = view.lineBlockAt(pos);
    const viewportH = view.scrollDOM.clientHeight;
    const max = Math.max(0, view.scrollDOM.scrollHeight - viewportH);
    const target = Math.max(0, Math.min(max, block.top));
    withMirrorGuard(mirroring, () => {
      view.scrollDOM.scrollTop = target;
    });
  };

  // ---- rAF-coalesced listeners -----------------------------------------

  let editorRaf = 0;
  let previewRaf = 0;
  let pendingEditorLine: number | null = null;
  let pendingPreviewLine: number | null = null;

  const guardOk = (): boolean =>
    !mirroring.value && performance.now() >= suspendUntil;

  const onEditorScroll = (): void => {
    if (!active() || !guardOk()) return;
    const line = topLineFromEditor();
    if (line === null) return;
    pendingEditorLine = line;
    if (editorRaf) return;
    editorRaf = requestAnimationFrame(() => {
      editorRaf = 0;
      if (!guardOk()) return;
      const l = pendingEditorLine;
      pendingEditorLine = null;
      if (l !== null) mirrorEditorToPreview(l);
    });
  };

  const onPreviewScroll = (): void => {
    if (!active() || !guardOk()) return;
    const line = topLineFromPreview();
    if (line === null) return;
    pendingPreviewLine = line;
    if (previewRaf) return;
    previewRaf = requestAnimationFrame(() => {
      previewRaf = 0;
      if (!guardOk()) return;
      const l = pendingPreviewLine;
      pendingPreviewLine = null;
      if (l !== null) mirrorPreviewToEditor(l);
    });
  };

  view.scrollDOM.addEventListener('scroll', onEditorScroll, { passive: true });
  previewPane.addEventListener('scroll', onPreviewScroll, { passive: true });

  return {
    detach: () => {
      view.scrollDOM.removeEventListener('scroll', onEditorScroll);
      previewPane.removeEventListener('scroll', onPreviewScroll);
      if (editorRaf) cancelAnimationFrame(editorRaf);
      if (previewRaf) cancelAnimationFrame(previewRaf);
    },
    suspendForOneFrame: () => {
      suspendUntil = performance.now() + 50;
    },
  };
}
