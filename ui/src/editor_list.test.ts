import test from 'node:test';
import assert from 'node:assert/strict';
import { listEnterTransform } from './editor_list.ts';

// EditorState-like stub: caret at `pos`; lines are split on "\n".
function makeState(text: string, pos: number, to = pos) {
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
    selection: { main: { from: pos, to } },
    doc: {
      lines: lineStarts.length,
      lineAt,
      line,
    },
  } as any;
}

test('continues an unordered bullet', () => {
  const r = listEnterTransform(makeState('- item', 6));
  assert.deepEqual(r, { kind: 'continue', insert: '\n- ', renumber: [] });
});

test('continues a * bullet preserving the marker char', () => {
  const r = listEnterTransform(makeState('* item', 6));
  assert.deepEqual(r, { kind: 'continue', insert: '\n* ', renumber: [] });
});

test('continues an indented bullet preserving indentation', () => {
  const r = listEnterTransform(makeState('  - item', 8));
  assert.deepEqual(r, { kind: 'continue', insert: '\n  - ', renumber: [] });
});

test('continues an ordered item with incremented number', () => {
  const r = listEnterTransform(makeState('1. first', 8));
  assert.deepEqual(r, { kind: 'continue', insert: '\n2. ', renumber: [] });
});

test('continues ordered item with ) delimiter', () => {
  const r = listEnterTransform(makeState('3) third', 8));
  assert.deepEqual(r, { kind: 'continue', insert: '\n4) ', renumber: [] });
});

test('continues a task item with a fresh unchecked box', () => {
  const r = listEnterTransform(makeState('- [x] done', 10));
  assert.deepEqual(r, { kind: 'continue', insert: '\n- [ ] ', renumber: [] });
});

test('continues an ordered task item with renumber + fresh box', () => {
  const r = listEnterTransform(makeState('2. [ ] todo', 11));
  assert.deepEqual(r, { kind: 'continue', insert: '\n3. [ ] ', renumber: [] });
});

test('empty bullet exits the list (removes the marker)', () => {
  const r = listEnterTransform(makeState('- ', 2));
  assert.deepEqual(r, { kind: 'exit', removeFrom: 0, removeTo: 2 });
});

test('empty ordered item exits the list', () => {
  const r = listEnterTransform(makeState('1. ', 3));
  assert.deepEqual(r, { kind: 'exit', removeFrom: 0, removeTo: 3 });
});

test('empty indented bullet exits the list while preserving indentation', () => {
  const r = listEnterTransform(makeState('  - ', 4));
  assert.deepEqual(r, { kind: 'exit', removeFrom: 2, removeTo: 4 });
});

test('empty task item exits the list', () => {
  const r = listEnterTransform(makeState('- [ ] ', 6));
  assert.deepEqual(r, { kind: 'exit', removeFrom: 0, removeTo: 6 });
});

test('ordered continuation renumbers following sibling items', () => {
  const text = '1. one\n2. two\n3. three';
  const r = listEnterTransform(makeState(text, 6));
  assert.deepEqual(r, {
    kind: 'continue',
    insert: '\n2. ',
    renumber: [
      { from: 7, to: 8, insert: '3' },
      { from: 14, to: 15, insert: '4' },
    ],
  });
});

test('ordered renumbering stops at a different indent', () => {
  const text = '1. one\n  2. nested\n2. two';
  const r = listEnterTransform(makeState(text, 6));
  assert.deepEqual(r, { kind: 'continue', insert: '\n2. ', renumber: [] });
});

test('non-list line yields none', () => {
  const r = listEnterTransform(makeState('plain text', 10));
  assert.deepEqual(r, { kind: 'none' });
});

test('caret not at line end yields none', () => {
  const r = listEnterTransform(makeState('- item', 3));
  assert.deepEqual(r, { kind: 'none' });
});

test('non-collapsed selection yields none', () => {
  const r = listEnterTransform(makeState('- item', 2, 6));
  assert.deepEqual(r, { kind: 'none' });
});
