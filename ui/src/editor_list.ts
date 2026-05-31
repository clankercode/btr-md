// Smart list continuation for the source editor (Slice A, feature #3).
//
// Why a custom keymap rather than @codemirror/lang-markdown's
// `insertNewlineContinueMarkup`: that command IS shipped by the language
// package, but it is not re-exported by our vendored CodeMirror bundle
// (`codemirror-entry.ts`), and pulling it in would still leave ordered-list
// renumbering and the empty-item "exit list" behaviour partly up to the
// surrounding markup heuristics. A small focused transform here is pure,
// directly unit-testable, and gives us exactly the three behaviours the spec
// asks for: continue bullets/ordered/task items, renumber ordered lists, and
// exit the list on an empty item.

import type { EditorView } from '@codemirror/view';
import type { ChangeSpec, EditorState } from '@codemirror/state';

/** What pressing Enter on a list line should do. */
export type ListEnterResult =
  | { kind: 'continue'; insert: string; renumber: ChangeSpec[] }
  | { kind: 'exit'; removeFrom: number; removeTo: number }
  | { kind: 'none' };

// `<indent>- `, `<indent>* `, `<indent>+ `, optional task box.
const UNORDERED = /^(\s*)([-*+])\s(\[[ xX]\]\s)?(.*)$/;
// `<indent>1. ` / `<indent>1) `, optional task box.
const ORDERED = /^(\s*)(\d+)([.)])\s(\[[ xX]\]\s)?(.*)$/;

/**
 * Decide what an Enter keypress at `pos` should produce, given the line it is
 * on. Pure. Returns:
 *  - `continue` with the text to insert after a newline (next marker, with a
 *    fresh `[ ]` for task items and the incremented number for ordered lists),
 *    plus edits to renumber following ordered-list siblings when needed;
 *  - `exit` (the marker range to delete) when the item has no content — pressing
 *    Enter on an empty bullet removes the marker and drops out of the list;
 *  - `none` when the line is not a list item (fall through to default Enter).
 *
 * Only fires when the caret is collapsed at the end of the line, matching the
 * familiar editor behaviour and keeping mid-line Enter as a plain split.
 */
export function listEnterTransform(
  state: Pick<EditorState, 'selection' | 'doc'>,
): ListEnterResult {
  const sel = state.selection.main;
  if (sel.from !== sel.to) return { kind: 'none' };
  const line = state.doc.lineAt(sel.from);
  // Only continue when the caret is at the line end.
  if (sel.from !== line.to) return { kind: 'none' };

  const ordered = ORDERED.exec(line.text);
  if (ordered) {
    const [, indent, num, delim, task, content] = ordered;
    if (content.length === 0) {
      // Empty ordered item -> exit the list (remove the whole marker).
      return { kind: 'exit', removeFrom: line.from + indent.length, removeTo: line.to };
    }
    const nextNum = Number.parseInt(num, 10) + 1;
    const taskBox = task ? '[ ] ' : '';
    return {
      kind: 'continue',
      insert: `\n${indent}${nextNum}${delim} ${taskBox}`,
      renumber: orderedRenumberChanges(state.doc, line.number + 1, indent, delim, nextNum + 1),
    };
  }

  const unordered = UNORDERED.exec(line.text);
  if (unordered) {
    const [, indent, bullet, task, content] = unordered;
    if (content.length === 0) {
      return { kind: 'exit', removeFrom: line.from + indent.length, removeTo: line.to };
    }
    const taskBox = task ? '[ ] ' : '';
    return { kind: 'continue', insert: `\n${indent}${bullet} ${taskBox}`, renumber: [] };
  }

  return { kind: 'none' };
}

function orderedRenumberChanges(
  doc: EditorState['doc'],
  startLineNumber: number,
  indent: string,
  delim: string,
  firstNumber: number,
): ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  let nextNumber = firstNumber;
  for (let n = startLineNumber; n <= doc.lines; n++) {
    const line = doc.line(n);
    const match = ORDERED.exec(line.text);
    if (!match || match[1] !== indent || match[3] !== delim) break;
    const current = match[2];
    const replacement = String(nextNumber);
    if (current !== replacement) {
      const from = line.from + indent.length;
      changes.push({ from, to: from + current.length, insert: replacement });
    }
    nextNumber += 1;
  }
  return changes;
}

/**
 * CodeMirror `Command`: applies `listEnterTransform`. Returns false (so the
 * default Enter binding runs) when the line is not a list item.
 */
export function listEnter(view: EditorView): boolean {
  const result = listEnterTransform(view.state);
  if (result.kind === 'none') return false;

  if (result.kind === 'exit') {
    view.dispatch({
      changes: { from: result.removeFrom, to: result.removeTo, insert: '' },
      selection: { anchor: result.removeFrom },
      scrollIntoView: true,
    });
    return true;
  }

  const pos = view.state.selection.main.from;
  view.dispatch({
    changes: [{ from: pos, insert: result.insert }, ...result.renumber],
    selection: { anchor: pos + result.insert.length },
    scrollIntoView: true,
  });
  return true;
}
