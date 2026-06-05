import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wordAt,
  resolveSourcePosition,
  pickBlockForLine,
  createEditCenterGate,
} from './scroll_sync.ts';

// --- wordAt -----------------------------------------------------------------

test('wordAt: middle of a word', () => {
  assert.equal(wordAt('the quick brown', 5), 'quick');
});

test('wordAt: at the start boundary of a word', () => {
  assert.equal(wordAt('the quick brown', 4), 'quick');
});

test('wordAt: caret just after a word (between word and space) steps back', () => {
  // offset 9 sits on the space after "quick"; caret commonly lands here.
  assert.equal(wordAt('the quick brown', 9), 'quick');
});

test('wordAt: on whitespace not adjacent to a word returns empty', () => {
  // 'a  b': offset 2 is the second space; char before is also a space → empty.
  assert.equal(wordAt('a  b', 2), '');
});

test('wordAt: punctuation is not part of a word', () => {
  assert.equal(wordAt('foo, bar', 0), 'foo');
});

test('wordAt: offset past end clamps', () => {
  assert.equal(wordAt('hello', 99), 'hello');
});

test('wordAt: empty string', () => {
  assert.equal(wordAt('', 0), '');
});

test('wordAt: unicode letters', () => {
  assert.equal(wordAt('café туда', 1), 'café');
});

// --- resolveSourcePosition --------------------------------------------------

const SRC = 'first line\nsecond has target\nthird line\n';

test('resolveSourcePosition: word on the start line', () => {
  assert.deepEqual(resolveSourcePosition(SRC, 1, 1, 'line'), { line: 1, col: 6 });
});

test('resolveSourcePosition: word on a later line within range', () => {
  assert.deepEqual(resolveSourcePosition(SRC, 1, 3, 'target'), { line: 2, col: 11 });
});

test('resolveSourcePosition: empty word falls back to block start, col 0', () => {
  assert.deepEqual(resolveSourcePosition(SRC, 2, 3, ''), { line: 2, col: 0 });
});

test('resolveSourcePosition: word not found falls back to block start', () => {
  assert.deepEqual(resolveSourcePosition(SRC, 2, 3, 'absent'), { line: 2, col: 0 });
});

test('resolveSourcePosition: NaN end treated as single line (start only)', () => {
  // "target" lives on line 2, but range is just line 1 → not found → fallback.
  assert.deepEqual(resolveSourcePosition(SRC, 1, NaN, 'target'), { line: 1, col: 0 });
});

test('resolveSourcePosition: end clamped to available lines', () => {
  assert.deepEqual(resolveSourcePosition(SRC, 1, 999, 'third'), { line: 3, col: 0 });
});

// --- pickBlockForLine -------------------------------------------------------

test('pickBlockForLine: single covering block', () => {
  const idx = pickBlockForLine([{ start: 1, end: 3, depth: 1 }], 2);
  assert.equal(idx, 0);
});

test('pickBlockForLine: no covering block returns -1', () => {
  const idx = pickBlockForLine([{ start: 1, end: 2, depth: 1 }], 5);
  assert.equal(idx, -1);
});

test('pickBlockForLine: larger start wins among overlapping (more specific line)', () => {
  // table 5..8 vs cell 6..6 ; line 6 → cell (start 6 > 5)
  const idx = pickBlockForLine(
    [{ start: 5, end: 8, depth: 2 }, { start: 6, end: 6, depth: 5 }],
    6
  );
  assert.equal(idx, 1);
});

test('pickBlockForLine: line outside nested falls back to enclosing block', () => {
  const idx = pickBlockForLine(
    [{ start: 5, end: 8, depth: 2 }, { start: 6, end: 6, depth: 5 }],
    7
  );
  assert.equal(idx, 0);
});

test('pickBlockForLine: equal start tie-broken by greatest DOM depth', () => {
  // ul 3..5 depth2 vs li 3..3 depth3 ; line 3 → li (deeper)
  const idx = pickBlockForLine(
    [{ start: 3, end: 5, depth: 2 }, { start: 3, end: 3, depth: 3 }],
    3
  );
  assert.equal(idx, 1);
});

test('pickBlockForLine: NaN end treated as single line', () => {
  const idx = pickBlockForLine([{ start: 4, end: NaN, depth: 1 }], 4);
  assert.equal(idx, 0);
  assert.equal(pickBlockForLine([{ start: 4, end: NaN, depth: 1 }], 5), -1);
});

// --- createEditCenterGate ---------------------------------------------------

test('editCenterGate: arm for a doc then settle that doc in split centres once', () => {
  const g = createEditCenterGate();
  g.arm(7);
  assert.equal(g.settle(7, true), true);
  // Disarmed after settle — a later render of the same doc must not recentre.
  assert.equal(g.settle(7, true), false);
});

test('editCenterGate: idle (never armed) settle does not centre', () => {
  const g = createEditCenterGate();
  assert.equal(g.settle(7, true), false);
});

test('editCenterGate: arm(null) (edit outside split) does not centre', () => {
  const g = createEditCenterGate();
  g.arm(null);
  assert.equal(g.settle(7, true), false);
});

test('editCenterGate: settle for a different doc disarms without centring', () => {
  // Armed for doc 7, but a render for doc 9 lands first (e.g. tab switch).
  const g = createEditCenterGate();
  g.arm(7);
  assert.equal(g.settle(9, true), false);
  // The stale arming for 7 is gone — a later render of 7 must not recentre.
  assert.equal(g.settle(7, true), false);
});

test('editCenterGate: settle while not in split disarms without centring', () => {
  const g = createEditCenterGate();
  g.arm(7);
  assert.equal(g.settle(7, false), false);
  assert.equal(g.settle(7, true), false);
});

test('editCenterGate: a later arm overrides an earlier unsettled one', () => {
  const g = createEditCenterGate();
  g.arm(7);
  g.arm(9);
  assert.equal(g.settle(7, true), false); // 7 was superseded by 9
});

test('editCenterGate: reset disarms', () => {
  const g = createEditCenterGate();
  g.arm(7);
  g.reset();
  assert.equal(g.settle(7, true), false);
});
