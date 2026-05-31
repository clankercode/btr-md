import test from 'node:test';
import assert from 'node:assert/strict';
import {
  wrapInlineTransform,
  linkTransform,
  headingToggleTransform,
  listToggleTransform,
} from './editor_format.ts';

// Minimal EditorState-like stub covering only the surface the pure transforms
// use: `selection.main`, `sliceDoc(from, to)`, and a line-addressable `doc`.
// Lines are split on "\n"; `from`/`to` are absolute offsets, `to` excludes the
// trailing newline (matching CodeMirror's Line semantics).
function makeState(text: string, from: number, to = from) {
  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') lineStarts.push(i + 1);
  }
  const lineAt = (pos: number) => {
    let n = 0;
    for (let i = 0; i < lineStarts.length; i++) {
      if (lineStarts[i] <= pos) n = i;
      else break;
    }
    return line(n + 1);
  };
  const line = (num: number) => {
    const start = lineStarts[num - 1];
    const end = num < lineStarts.length ? lineStarts[num] - 1 : text.length;
    return { number: num, from: start, to: end, text: text.slice(start, end) };
  };
  return {
    selection: { main: { from, to } },
    sliceDoc: (a: number, b: number) => text.slice(a, b),
    doc: {
      length: text.length,
      lines: lineStarts.length,
      lineAt,
      line,
    },
  } as any;
}

test('bold wraps a selection with **', () => {
  const edit = wrapInlineTransform(makeState('hello world', 0, 5), '**');
  assert.deepEqual(edit.changes, { from: 0, to: 5, insert: '**hello**' });
  assert.deepEqual(edit.selection, { anchor: 2, head: 7 });
});

test('bold toggles off when selection is already wrapped inside', () => {
  const edit = wrapInlineTransform(makeState('**hi** there', 0, 6), '**');
  assert.deepEqual(edit.changes, { from: 0, to: 6, insert: 'hi' });
  assert.deepEqual(edit.selection, { anchor: 0, head: 2 });
});

test('bold toggles off when markers surround the selection', () => {
  // selection is just "hi", markers sit immediately around it.
  const edit = wrapInlineTransform(makeState('**hi**', 2, 4), '**');
  assert.deepEqual(edit.changes, { from: 0, to: 6, insert: 'hi' });
  assert.deepEqual(edit.selection, { anchor: 0, head: 2 });
});

test('bold on empty selection inserts the pair with caret between', () => {
  const edit = wrapInlineTransform(makeState('ab', 1, 1), '**');
  assert.deepEqual(edit.changes, { from: 1, to: 1, insert: '****' });
  assert.deepEqual(edit.selection, { anchor: 3, head: 3 });
});

test('italic uses a single _ marker', () => {
  const edit = wrapInlineTransform(makeState('word', 0, 4), '_');
  assert.deepEqual(edit.changes, { from: 0, to: 4, insert: '_word_' });
});

test('inline code uses backtick', () => {
  const edit = wrapInlineTransform(makeState('x', 0, 1), '`');
  assert.deepEqual(edit.changes, { from: 0, to: 1, insert: '`x`' });
});

test('link wraps selection and selects the url placeholder', () => {
  const edit = linkTransform(makeState('site', 0, 4));
  assert.deepEqual(edit.changes, { from: 0, to: 4, insert: '[site](url)' });
  // url placeholder: "[site](" is 7 chars, then "url".
  assert.deepEqual(edit.selection, { anchor: 7, head: 10 });
});

test('link with empty selection inserts skeleton, caret in label', () => {
  const edit = linkTransform(makeState('', 0, 0));
  assert.deepEqual(edit.changes, { from: 0, to: 0, insert: '[](url)' });
  assert.deepEqual(edit.selection, { anchor: 1, head: 1 });
});

test('heading toggle adds # to a plain line', () => {
  const edit = headingToggleTransform(makeState('Title', 0, 0));
  assert.deepEqual(edit.changes, [{ from: 0, to: 5, insert: '# Title' }]);
});

test('heading toggle bumps an existing level', () => {
  const edit = headingToggleTransform(makeState('## Title', 0, 0));
  assert.deepEqual(edit.changes, [{ from: 0, to: 8, insert: '### Title' }]);
});

test('heading toggle wraps from h6 back to plain', () => {
  const edit = headingToggleTransform(makeState('###### Title', 0, 0));
  assert.deepEqual(edit.changes, [{ from: 0, to: 12, insert: 'Title' }]);
});

test('list toggle adds a bullet preserving indentation', () => {
  const edit = listToggleTransform(makeState('  item', 0, 0));
  assert.deepEqual(edit.changes, [{ from: 0, to: 6, insert: '  - item' }]);
});

test('list toggle removes an existing bullet', () => {
  const edit = listToggleTransform(makeState('- item', 0, 0));
  assert.deepEqual(edit.changes, [{ from: 0, to: 6, insert: 'item' }]);
});

test('heading toggle applies uniformly to a multi-line selection', () => {
  const text = 'one\ntwo';
  const edit = headingToggleTransform(makeState(text, 0, 7));
  assert.deepEqual(edit.changes, [
    { from: 0, to: 3, insert: '# one' },
    { from: 4, to: 7, insert: '# two' },
  ]);
});

test('heading toggle does not include the next line when selection ends at line start', () => {
  const text = 'one\ntwo';
  const edit = headingToggleTransform(makeState(text, 0, 4));
  assert.deepEqual(edit.changes, [{ from: 0, to: 3, insert: '# one' }]);
});

test('list toggle does not include the next line when selection ends at line start', () => {
  const text = 'one\ntwo';
  const edit = listToggleTransform(makeState(text, 0, 4));
  assert.deepEqual(edit.changes, [{ from: 0, to: 3, insert: '- one' }]);
});
