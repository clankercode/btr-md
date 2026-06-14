import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickTopBlockIndex } from './scroll_mirror.ts';

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
