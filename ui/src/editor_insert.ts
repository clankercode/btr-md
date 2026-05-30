// Shared cursor-insertion primitives over a CodeMirror view, reused by the
// GitHub-alert and footnote insert buttons (Phase 4).
//
// These are *genuine* user edits: they intentionally flow through the editor's
// change listener so the document is marked modified and re-rendered. (Contrast
// with programmatic open/reload/merge dispatches, which Phase 2 tags so they do
// NOT mark the buffer dirty.)
//
// The type-only `EditorView` import is erased by esbuild at build time; the
// runtime value is the view created from the vendored CodeMirror bundle.

import type { EditorView } from '@codemirror/view';

export interface EditorChange {
  from: number;
  /** Defaults to `from` (a pure insertion). */
  to?: number;
  insert: string;
}

/**
 * Apply one or more changes in a single transaction and optionally set a
 * selection (absolute document offsets in the *resulting* document), then
 * refocus the editor.
 */
export function dispatchInsert(
  view: EditorView,
  changes: EditorChange[],
  selection?: { anchor: number; head?: number },
): void {
  view.dispatch({
    changes: changes.map((c) => ({ from: c.from, to: c.to ?? c.from, insert: c.insert })),
    ...(selection
      ? { selection: { anchor: selection.anchor, head: selection.head ?? selection.anchor } }
      : {}),
  });
  view.focus();
}

/**
 * Replace the current main selection with `text`. If `placeholder` is given,
 * the selection afterwards covers the `[start, end)` sub-range of the inserted
 * text (used to drop the caret onto a `TODO`-style placeholder); otherwise the
 * caret lands at the end of the insertion.
 */
export function insertAtCursor(
  view: EditorView,
  text: string,
  placeholder?: { start: number; end: number },
): void {
  const sel = view.state.selection.main;
  const selection = placeholder
    ? { anchor: sel.from + placeholder.start, head: sel.from + placeholder.end }
    : { anchor: sel.from + text.length };
  dispatchInsert(view, [{ from: sel.from, to: sel.to, insert: text }], selection);
}
