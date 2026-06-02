// Tab / Shift-Tab indentation for the source editor (todo #1, #6).
//
// Like `editor_list.ts`, this is a small pure transform rather than a pull of
// CodeMirror's `indentMore`/`indentLess`/`insertTab`: those commands are NOT
// re-exported by our vendored bundle (`codemirror-entry.ts`), and a focused
// transform here is directly unit-testable and gives exactly the behaviour we
// want — list-aware nesting on Tab, caret-level indentation inside code blocks,
// and block indent/outdent across a multi-line selection.
//
// Indent unit is two spaces: it nests Markdown bullet lists correctly and, when
// pressed twice at a line start, produces the 4-space prefix that makes an
// indented code block (todo #6).

import type { EditorView } from '@codemirror/view';
import type { ChangeSpec, EditorState } from '@codemirror/state';

export const INDENT_UNIT = '  ';

/** `<indent>- ` / `<indent>1. ` (with optional task box) — a list item line. */
const LIST_LINE = /^\s*(?:[-*+]|\d+[.)])\s/;

/** Whether `text` is a Markdown list item line (so Tab should nest it). */
export function isListLine(text: string): boolean {
  return LIST_LINE.test(text);
}

export interface IndentResult {
  changes: ChangeSpec[];
  selection: { anchor: number; head: number };
}

/** How many leading characters Shift-Tab removes from `text`: one hard tab, or
 *  up to `INDENT_UNIT.length` spaces. Zero when the line has no leading blank. */
function dedentLen(text: string): number {
  if (text.startsWith('\t')) return 1;
  let n = 0;
  while (n < INDENT_UNIT.length && text[n] === ' ') n += 1;
  return n;
}

/**
 * Compute the edits + resulting selection for a Tab (`dedent=false`) or
 * Shift-Tab (`dedent=true`) keypress. Pure. Returns `null` when there is
 * nothing to do (Shift-Tab on lines with no leading indentation), in which case
 * the key is still consumed by the caller so focus does not leave the editor.
 *
 *  - Tab, collapsed caret on a non-list line: insert one unit at the caret
 *    (indents inside code blocks / prose without disturbing the line start).
 *  - Tab, collapsed caret on a list line: indent the whole line (nest the item).
 *  - Tab with a selection: indent every line the selection touches.
 *  - Shift-Tab: outdent every line the selection touches (or the caret's line).
 */
export function indentTransform(
  state: Pick<EditorState, 'selection' | 'doc'>,
  dedent: boolean,
): IndentResult | null {
  const sel = state.selection.main;
  const doc = state.doc;

  // Tab on a collapsed caret on a non-list line: literal indent at the caret.
  if (!dedent && sel.empty) {
    const line = doc.lineAt(sel.from);
    if (!isListLine(line.text)) {
      const at = sel.from + INDENT_UNIT.length;
      return { changes: [{ from: sel.from, insert: INDENT_UNIT }], selection: { anchor: at, head: at } };
    }
  }

  // Block path: operate on the line start of every line the selection touches.
  const first = doc.lineAt(sel.from).number;
  const last = doc.lineAt(sel.to).number;
  const changes: ChangeSpec[] = [];
  // Edits at line starts, in original-document coordinates. `len` is the number
  // of chars inserted (Tab) or removed (Shift-Tab) at `from`.
  const edits: { from: number; len: number }[] = [];

  for (let n = first; n <= last; n++) {
    const line = doc.line(n);
    if (dedent) {
      const removed = dedentLen(line.text);
      if (removed === 0) continue;
      changes.push({ from: line.from, to: line.from + removed });
      edits.push({ from: line.from, len: removed });
    } else {
      changes.push({ from: line.from, insert: INDENT_UNIT });
      edits.push({ from: line.from, len: INDENT_UNIT.length });
    }
  }

  if (changes.length === 0) return null;
  const map = (pos: number) => mapEndpoint(pos, edits, dedent);
  return { changes, selection: { anchor: map(sel.anchor), head: map(sel.head) } };
}

/**
 * Map a selection endpoint past a set of line-start edits, all expressed in the
 * original document's coordinates (so the edits do not interfere with each
 * other). Insertions push later positions right; removals pull them left, and a
 * position sitting inside a removed run clamps to the start of that run.
 */
function mapEndpoint(pos: number, edits: { from: number; len: number }[], dedent: boolean): number {
  let delta = 0;
  for (const { from, len } of edits) {
    if (dedent) {
      if (pos >= from + len) delta -= len;
      else if (pos > from) delta -= pos - from; // inside the removed run -> clamp
    } else if (from <= pos) {
      delta += len;
    }
  }
  return pos + delta;
}

function applyIndent(view: EditorView, dedent: boolean): boolean {
  const result = indentTransform(view.state, dedent);
  if (result) {
    view.dispatch({ changes: result.changes, selection: result.selection, scrollIntoView: true });
  }
  // Always consume Tab/Shift-Tab while the editor is focused so the key never
  // moves focus out of the editor (the pre-fix behaviour).
  return true;
}

/** CodeMirror `Command` for Tab. */
export function editorIndent(view: EditorView): boolean {
  return applyIndent(view, false);
}

/** CodeMirror `Command` for Shift-Tab. */
export function editorDedent(view: EditorView): boolean {
  return applyIndent(view, true);
}
