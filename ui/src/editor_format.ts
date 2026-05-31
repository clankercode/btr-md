// Markdown formatting commands for the source editor (Slice A, feature #2).
//
// Each command is a CodeMirror `Command` ((view) => boolean) that mutates the
// document via a single transaction and returns true when it handled the key.
// The *pure* selection transforms live in the exported `*Transform` helpers so
// they can be unit-tested without a live `EditorView`; the thin command
// wrappers turn a transform into a dispatch. The same `Command`s are reused by
// the editor keymap and may be invoked directly from a toolbar/insert menu.
//
// The `EditorView`/`EditorState` types are imported type-only (erased at build
// time); the runtime values come from the vendored CodeMirror bundle.

import type { EditorView } from '@codemirror/view';
import type { EditorState, ChangeSpec } from '@codemirror/state';

/** A computed edit: the changes to apply plus the resulting main selection. */
export interface FormatEdit {
  changes: ChangeSpec;
  /** Resulting selection (absolute offsets in the *new* document). */
  selection: { anchor: number; head: number };
}

interface Region {
  from: number;
  to: number;
  text: string;
}

function mainRegion(state: Pick<EditorState, 'selection' | 'sliceDoc'>): Region {
  const sel = state.selection.main;
  return { from: sel.from, to: sel.to, text: state.sliceDoc(sel.from, sel.to) };
}

/**
 * Wrap (or unwrap) the current selection with a symmetric inline marker such as
 * `**` (bold), `*` (italic) or `` ` `` (code). If the selection is already
 * wrapped by the marker (either the selected text itself or the characters
 * immediately surrounding the selection) the marker is removed (toggle off).
 * With an empty selection the marker pair is inserted and the caret is placed
 * between the two halves so the user can type the content.
 *
 * Pure: depends only on the doc text + selection, returns the edit to dispatch.
 */
export function wrapInlineTransform(
  state: Pick<EditorState, 'selection' | 'sliceDoc' | 'doc'>,
  marker: string,
): FormatEdit {
  const { from, to, text } = mainRegion(state);
  const mlen = marker.length;
  const docLen = state.doc.length;

  // Already wrapped *inside* the selection: "**x**" -> "x".
  if (
    text.length >= 2 * mlen &&
    text.startsWith(marker) &&
    text.endsWith(marker) &&
    text.length > 2 * mlen - 1
  ) {
    const inner = text.slice(mlen, text.length - mlen);
    return {
      changes: { from, to, insert: inner },
      selection: { anchor: from, head: from + inner.length },
    };
  }

  // Already wrapped *around* the selection: <**>x<**> -> x.
  const before = state.sliceDoc(Math.max(0, from - mlen), from);
  const after = state.sliceDoc(to, Math.min(docLen, to + mlen));
  if (before === marker && after === marker) {
    return {
      changes: { from: from - mlen, to: to + mlen, insert: text },
      selection: { anchor: from - mlen, head: from - mlen + text.length },
    };
  }

  // Not wrapped: add the marker pair.
  const insert = `${marker}${text}${marker}`;
  const innerStart = from + mlen;
  return {
    changes: { from, to, insert },
    selection: { anchor: innerStart, head: innerStart + text.length },
  };
}

/**
 * Turn the selection into a Markdown link `[text](url)`. With a non-empty
 * selection the text becomes the label and the caret lands inside the empty
 * `()` for the URL; with an empty selection a `[](url)` skeleton is inserted
 * with the caret in the label.
 */
export function linkTransform(
  state: Pick<EditorState, 'selection' | 'sliceDoc'>,
): FormatEdit {
  const { from, to, text } = mainRegion(state);
  if (text.length === 0) {
    const insert = '[](url)';
    // Caret inside the label brackets.
    return { changes: { from, to, insert }, selection: { anchor: from + 1, head: from + 1 } };
  }
  const insert = `[${text}](url)`;
  // Select the `url` placeholder so the user can overtype it.
  const urlStart = from + text.length + 3; // `[` + text + `](`
  return { changes: { from, to, insert }, selection: { anchor: urlStart, head: urlStart + 3 } };
}

const ATX = /^(#{1,6})\s/;

function selectedLineRange(state: Pick<EditorState, 'selection' | 'doc'>) {
  const sel = state.selection.main;
  const startLine = state.doc.lineAt(sel.from);
  const endPos = sel.to > sel.from ? sel.to - 1 : sel.to;
  return { startLine, endLine: state.doc.lineAt(endPos) };
}

/**
 * Cycle the ATX heading level of every line touched by the selection. The level
 * is taken from the first touched line: `none -> #` then each toggle adds a
 * level up to `######`, after which it wraps back to plain text. All touched
 * lines are set to the same resulting prefix so a multi-line selection toggles
 * uniformly.
 */
export function headingToggleTransform(
  state: Pick<EditorState, 'selection' | 'doc'>,
): FormatEdit {
  const { startLine, endLine } = selectedLineRange(state);

  const firstMatch = ATX.exec(startLine.text);
  const currentLevel = firstMatch ? firstMatch[1].length : 0;
  const nextLevel = currentLevel >= 6 ? 0 : currentLevel + 1;
  const prefix = nextLevel === 0 ? '' : `${'#'.repeat(nextLevel)} `;

  const changes: ChangeSpec[] = [];
  for (let n = startLine.number; n <= endLine.number; n++) {
    const line = state.doc.line(n);
    const stripped = line.text.replace(ATX, '');
    const replacement = prefix + stripped;
    if (replacement !== line.text) {
      changes.push({ from: line.from, to: line.to, insert: replacement });
    }
  }
  const newFrom = startLine.from;
  return { changes, selection: { anchor: newFrom, head: newFrom } };
}

const BULLET = /^(\s*)([-*+])\s/;

/**
 * Toggle an unordered-list (`- `) prefix on every line touched by the
 * selection. If the first touched line is already a bullet, all touched lines
 * have their bullet removed; otherwise a `- ` bullet is added (preserving each
 * line's leading indentation).
 */
export function listToggleTransform(
  state: Pick<EditorState, 'selection' | 'doc'>,
): FormatEdit {
  const { startLine, endLine } = selectedLineRange(state);
  const addBullet = !BULLET.test(startLine.text);

  const changes: ChangeSpec[] = [];
  for (let n = startLine.number; n <= endLine.number; n++) {
    const line = state.doc.line(n);
    let replacement: string;
    if (addBullet) {
      const indent = /^(\s*)/.exec(line.text)?.[1] ?? '';
      replacement = `${indent}- ${line.text.slice(indent.length)}`;
    } else {
      replacement = line.text.replace(BULLET, '$1');
    }
    if (replacement !== line.text) {
      changes.push({ from: line.from, to: line.to, insert: replacement });
    }
  }
  const newFrom = startLine.from;
  return { changes, selection: { anchor: newFrom, head: newFrom } };
}

// --- Command wrappers (dispatch the computed edit) -------------------------

function applyEdit(view: EditorView, edit: FormatEdit): boolean {
  view.dispatch({ changes: edit.changes, selection: edit.selection, scrollIntoView: true });
  view.focus();
  return true;
}

export function toggleBold(view: EditorView): boolean {
  return applyEdit(view, wrapInlineTransform(view.state, '**'));
}
export function toggleItalic(view: EditorView): boolean {
  return applyEdit(view, wrapInlineTransform(view.state, '_'));
}
export function toggleInlineCode(view: EditorView): boolean {
  return applyEdit(view, wrapInlineTransform(view.state, '`'));
}
export function insertLink(view: EditorView): boolean {
  return applyEdit(view, linkTransform(view.state));
}
export function toggleHeading(view: EditorView): boolean {
  return applyEdit(view, headingToggleTransform(view.state));
}
export function toggleList(view: EditorView): boolean {
  return applyEdit(view, listToggleTransform(view.state));
}
