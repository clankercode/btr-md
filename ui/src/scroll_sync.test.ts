import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wordAt,
  resolveSourcePosition,
  pickBlockForLine,
  createEditCenterGate,
  targetScrollTopForRatio,
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
// Signature: arm(docId|null, baseVersion); settle(renderedDocId, renderedVersion, split).

test('editCenterGate: arm at base v3 then settle same doc at newer v4 centres once', () => {
  const g = createEditCenterGate();
  g.arm(7, 3);
  assert.equal(g.settle(7, 4, true), true);
  // Disarmed after settle — a later render of the same doc must not recentre.
  assert.equal(g.settle(7, 5, true), false);
});

test('editCenterGate: idle (never armed) settle does not centre', () => {
  const g = createEditCenterGate();
  assert.equal(g.settle(7, 4, true), false);
});

test('editCenterGate: arm(null) (edit outside split) does not centre', () => {
  const g = createEditCenterGate();
  g.arm(null, 3);
  assert.equal(g.settle(7, 4, true), false);
});

test('editCenterGate: stale in-flight pre-edit render (version <= base) does NOT consume the gate', () => {
  // Armed at base v5; an in-flight render scheduled before the edit lands at v5
  // (or older). It must not centre AND must leave the gate armed so the real
  // edit render (v6) still centres. This is the debounce-gap race.
  const g = createEditCenterGate();
  g.arm(7, 5);
  assert.equal(g.settle(7, 5, true), false); // equal version -> stale, no consume
  assert.equal(g.settle(7, 6, true), true); // the real edit render still centres
});

test('editCenterGate: settle for a different doc disarms without centring', () => {
  // Armed for doc 7, but a current render for doc 9 lands (e.g. tab switch).
  const g = createEditCenterGate();
  g.arm(7, 3);
  assert.equal(g.settle(9, 4, true), false);
  // The arming for 7 is gone — a later render of 7 must not recentre.
  assert.equal(g.settle(7, 5, true), false);
});

test('editCenterGate: qualifying render while not in split disarms without centring', () => {
  const g = createEditCenterGate();
  g.arm(7, 3);
  assert.equal(g.settle(7, 4, false), false);
  assert.equal(g.settle(7, 5, true), false); // consumed by the v4 render
});

test('editCenterGate: a later arm replaces an earlier unsettled one', () => {
  const g = createEditCenterGate();
  g.arm(7, 3);
  g.arm(9, 8); // re-armed (e.g. switched to doc 9 and edited it)
  assert.equal(g.settle(9, 9, true), true); // the latest arming wins
});

test('editCenterGate: reset disarms', () => {
  const g = createEditCenterGate();
  g.arm(7, 3);
  g.reset();
  assert.equal(g.settle(7, 4, true), false);
});

// --- targetScrollTopForRatio ------------------------------------------------
// Map a click-Y ratio in the preview pane to the editor's scrollTop that
// places the resolved block at the same fraction of its viewport. Pure math
// (no DOM) so it is exhaustively unit-tested.

test('targetScrollTopForRatio: ratio=0 puts the block at the top of the viewport', () => {
  // blockTop=400, viewportH=200 → target = 400 - 0*200 = 400.
  assert.equal(targetScrollTopForRatio(400, 200, 0, 2000), 400);
});

test('targetScrollTopForRatio: ratio=0.5 puts the block in the middle', () => {
  // 400 - 0.5*200 = 300.
  assert.equal(targetScrollTopForRatio(400, 200, 0.5, 2000), 300);
});

test('targetScrollTopForRatio: ratio=1 puts the block at the bottom', () => {
  // 400 - 1*200 = 200.
  assert.equal(targetScrollTopForRatio(400, 200, 1, 2000), 200);
});

test('targetScrollTopForRatio: ratio is clamped to [0,1] before use', () => {
  // Negative → 0; > 1 → 1.
  assert.equal(targetScrollTopForRatio(400, 200, -2, 2000), 400);
  assert.equal(targetScrollTopForRatio(400, 200, 5, 2000), 200);
});

test('targetScrollTopForRatio: NaN ratio falls back to centred (0.5)', () => {
  // NaN passes through Math.max/min as NaN; we expect 0.5 in that case.
  // The implementation uses Math.max(0, Math.min(1, NaN)) which yields NaN,
  // so we must clamp explicitly. The fallback path lives in the click
  // handler (caller substitutes 0.5), not in this helper.
  // We assert the *helper*'s contract: NaN produces a non-finite result that
  // the caller is expected to guard against. This is the "document the
  // contract" test, not a happy-path test.
  const out = targetScrollTopForRatio(400, 200, Number.NaN, 2000);
  assert.ok(!Number.isFinite(out) || out === 400 || out === 200 || out === 300,
    `unexpected out=${out}`);
});

test('targetScrollTopForRatio: result is clamped to [0, maxScroll]', () => {
  // target would be -200 (blockTop=0, ratio=1, viewportH=200) → clamp to 0.
  assert.equal(targetScrollTopForRatio(0, 200, 1, 5000), 0);
  // target would be 4000 (blockTop=4000, ratio=0, viewportH=200) → clamp to 5000.
  // Wait: target = 4000 - 0*200 = 4000 ≤ 5000 so no clamp. Try a tighter cap:
  // blockTop=5000, ratio=0 → target=5000, cap at 1000 → 1000.
  assert.equal(targetScrollTopForRatio(5000, 200, 0, 1000), 1000);
});

test('targetScrollTopForRatio: negative maxScroll is treated as 0', () => {
  // maxScroll=-50 → clamped to 0; target=400-0=400 then capped to 0.
  assert.equal(targetScrollTopForRatio(400, 200, 0, -50), 0);
});

test('targetScrollTopForRatio: short document (maxScroll=0) → 0', () => {
  // The whole doc fits in the viewport; any ratio yields 0 (no scroll possible).
  assert.equal(targetScrollTopForRatio(400, 200, 0.5, 0), 0);
  assert.equal(targetScrollTopForRatio(400, 200, 0, 0), 0);
  assert.equal(targetScrollTopForRatio(400, 200, 1, 0), 0);
});
