import test from 'node:test';
import assert from 'node:assert/strict';
import { indentTransform, isListLine, INDENT_UNIT } from './editor_indent.ts';

// EditorState-like stub: selection [from,to); anchor=from, head=to.
function makeState(text: string, from: number, to = from) {
  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') lineStarts.push(i + 1);
  }
  const line = (num: number) => {
    const start = lineStarts[num - 1];
    const end = num < lineStarts.length ? lineStarts[num] - 1 : text.length;
    return { number: num, from: start, to: end, text: text.slice(start, end) };
  };
  const lineAt = (p: number) => {
    let n = 0;
    for (let i = 0; i < lineStarts.length; i++) {
      if (lineStarts[i] <= p) n = i;
      else break;
    }
    return line(n + 1);
  };
  return {
    selection: { main: { from, to, anchor: from, head: to, empty: from === to } },
    doc: { lines: lineStarts.length, lineAt, line },
  } as any;
}

test('indent unit is two spaces', () => {
  assert.equal(INDENT_UNIT, '  ');
});

test('isListLine recognises bullets, ordered, task items, indented', () => {
  for (const t of ['- a', '* a', '+ a', '1. a', '12) a', '  - a', '- [ ] a', '1. [x] a']) {
    assert.equal(isListLine(t), true, t);
  }
  for (const t of ['a', '  code', '#- not', '-no space', '']) {
    assert.equal(isListLine(t), false, t);
  }
});

test('Tab on a collapsed caret in plain text inserts a unit at the caret', () => {
  const r = indentTransform(makeState('code', 0), false);
  assert.deepEqual(r, { changes: [{ from: 0, insert: '  ' }], selection: { anchor: 2, head: 2 } });
});

test('Tab on a collapsed caret mid-line inserts at the caret (code blocks)', () => {
  const r = indentTransform(makeState('abcd', 2), false);
  assert.deepEqual(r, { changes: [{ from: 2, insert: '  ' }], selection: { anchor: 4, head: 4 } });
});

test('Tab on a list line nests the whole item (insert at line start)', () => {
  const r = indentTransform(makeState('- item', 6), false);
  assert.deepEqual(r, { changes: [{ from: 0, insert: '  ' }], selection: { anchor: 8, head: 8 } });
});

test('Tab on an ordered list line nests it', () => {
  const r = indentTransform(makeState('1. item', 7), false);
  assert.deepEqual(r, { changes: [{ from: 0, insert: '  ' }], selection: { anchor: 9, head: 9 } });
});

test('Tab with a multi-line selection indents every touched line', () => {
  // "abc\ndef", selection covering both lines (0..7)
  const r = indentTransform(makeState('abc\ndef', 0, 7), false);
  assert.deepEqual(r, {
    changes: [
      { from: 0, insert: '  ' },
      { from: 4, insert: '  ' },
    ],
    selection: { anchor: 2, head: 11 },
  });
});

test('Shift-Tab removes one indent unit from the caret line', () => {
  const r = indentTransform(makeState('    code', 8), true);
  assert.deepEqual(r, { changes: [{ from: 0, to: 2 }], selection: { anchor: 6, head: 6 } });
});

test('Shift-Tab removes a single hard tab', () => {
  const r = indentTransform(makeState('\tcode', 5), true);
  assert.deepEqual(r, { changes: [{ from: 0, to: 1 }], selection: { anchor: 4, head: 4 } });
});

test('Shift-Tab removes a lone leading space (less than a full unit)', () => {
  const r = indentTransform(makeState(' code', 5), true);
  assert.deepEqual(r, { changes: [{ from: 0, to: 1 }], selection: { anchor: 4, head: 4 } });
});

test('Shift-Tab on an unindented line is a no-op (null)', () => {
  assert.equal(indentTransform(makeState('code', 4), true), null);
});

test('Shift-Tab with caret inside the removed whitespace clamps to line start', () => {
  // caret at column 1, inside the 2 leading spaces being removed
  const r = indentTransform(makeState('    code', 1), true);
  assert.deepEqual(r, { changes: [{ from: 0, to: 2 }], selection: { anchor: 0, head: 0 } });
});

test('Shift-Tab across multiple lines outdents each', () => {
  const r = indentTransform(makeState('  a\n  b', 0, 7), true);
  assert.deepEqual(r, {
    changes: [
      { from: 0, to: 2 },
      { from: 4, to: 6 },
    ],
    selection: { anchor: 0, head: 3 },
  });
});
