import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickTopBlockIndex, withMirrorGuardForTest as withMirrorGuard } from './scroll_mirror.ts';

// Minimal stand-in for a TaggedBlock: only `rect().top` is consulted.
function blockAt(top: number): { rect: () => { top: number } } {
  return { rect: () => ({ top }) };
}

test('pickTopBlockIndex: empty list returns -1', () => {
  assert.equal(pickTopBlockIndex([], 0), -1);
  assert.equal(pickTopBlockIndex([], 100), -1);
});

test('pickTopBlockIndex: all blocks above the pane top → last wins', () => {
  const blocks = [blockAt(10), blockAt(20), blockAt(30)];
  // paneTopY = 100; all blocks are above. The "last block whose top <= paneTopY" is index 2.
  assert.equal(pickTopBlockIndex(blocks, 100), 2);
});

test('pickTopBlockIndex: block at the pane top is included', () => {
  const blocks = [blockAt(10), blockAt(100), blockAt(200)];
  // paneTopY = 100; the second block is exactly at the top → still in scope.
  assert.equal(pickTopBlockIndex(blocks, 100), 1);
});

test('pickTopBlockIndex: first block below the pane top is excluded', () => {
  const blocks = [blockAt(10), blockAt(100), blockAt(200)];
  // paneTopY = 99; only blocks 0 (top=10) qualify → 0.
  assert.equal(pickTopBlockIndex(blocks, 99), 0);
});

test('pickTopBlockIndex: returns -1 when all blocks are below the pane top', () => {
  const blocks = [blockAt(200), blockAt(300)];
  // paneTopY = 100; nothing qualifies.
  assert.equal(pickTopBlockIndex(blocks, 100), -1);
});

test('pickTopBlockIndex: stops at the first out-of-order block (assumed DOM order)', () => {
  // The function relies on DOM order: blocks are in document order, so
  // `rect().top` is monotonically non-decreasing. The implementation breaks
  // at the first block that is *below* the pane top, since further blocks
  // (also below) cannot be the "topmost" one.
  const blocks = [blockAt(10), blockAt(20), blockAt(150)];
  // paneTopY = 50; block 2 (top=150) is below the pane top → bail → 1.
  assert.equal(pickTopBlockIndex(blocks, 50), 1);
});

// --- withMirrorGuard --------------------------------------------------------
// Bug: if `action()` throws, the rAF to clear the flag is never scheduled
// and `mirroring.value` stays true forever, permanently disabling the mirror.
// We pass a synchronous scheduler so the tests work in node:test (no rAF).

const syncSchedule = (cb: () => void) => cb();

test('withMirrorGuard: sets mirroring flag during action, clears after', () => {
  const mirroring = { value: false };
  withMirrorGuard(mirroring, () => {
    assert.equal(mirroring.value, true, 'flag should be true during action');
  }, syncSchedule);
  // After the action completes, the synchronous scheduler has already cleared.
  assert.equal(mirroring.value, false, 'flag should be false after action');
});

test('withMirrorGuard: error propagates and flag is reset', () => {
  const mirroring = { value: false };
  let threw = false;
  try {
    withMirrorGuard(mirroring, () => {
      throw new Error('boom');
    }, syncSchedule);
  } catch {
    threw = true;
  }
  assert.equal(threw, true, 'action error should propagate');
  // RED until try/finally fix: without it, the flag stays true because the
  // scheduler callback was never registered. With the fix, the finally block
  // ensures the scheduler runs even after a throw.
  assert.equal(mirroring.value, false, 'mirroring flag should be reset after throw');
});
