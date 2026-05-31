import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeValidity, DragCounter } from './drag_overlay.ts';

// Minimal stand-in for DataTransferItem (only the fields we read).
function item(kind: string, type: string) {
  return { kind, type } as unknown as DataTransferItem;
}

// Minimal stand-in for DataTransfer.items.
function items(...list: DataTransferItem[]): DataTransferItemList {
  return list as unknown as DataTransferItemList;
}

test('computeValidity: markdown empty MIME -> valid', () => {
  assert.equal(computeValidity(items(item('file', ''))), 'valid');
});

test('computeValidity: text/markdown MIME -> valid', () => {
  assert.equal(computeValidity(items(item('file', 'text/markdown'))), 'valid');
  assert.equal(computeValidity(items(item('file', 'text/x-markdown'))), 'valid');
  assert.equal(computeValidity(items(item('file', 'text/plain'))), 'valid');
});

test('computeValidity: image-only -> reject', () => {
  assert.equal(computeValidity(items(item('file', 'image/png'))), 'reject');
});

test('computeValidity: pdf-only -> reject', () => {
  assert.equal(computeValidity(items(item('file', 'application/pdf'))), 'reject');
});

test('computeValidity: mixed image + markdown -> valid', () => {
  assert.equal(
    computeValidity(items(item('file', 'image/png'), item('file', 'text/markdown'))),
    'valid'
  );
});

test('computeValidity: no file items (only string) -> valid (undeterminable)', () => {
  assert.equal(computeValidity(items(item('string', 'text/plain'))), 'valid');
});

test('computeValidity: empty items -> valid (undeterminable)', () => {
  assert.equal(computeValidity(items()), 'valid');
});

test('computeValidity: null dataTransfer -> valid', () => {
  assert.equal(computeValidity(null), 'valid');
});

test('computeValidity: undefined items -> valid', () => {
  assert.equal(computeValidity(undefined), 'valid');
});

test('DragCounter: enter increments, leave decrements, active reflects count', () => {
  const c = new DragCounter();
  assert.equal(c.active, false);
  c.enter();
  assert.equal(c.active, true);
  c.enter();
  assert.equal(c.active, true);
  c.leave();
  assert.equal(c.active, true);
  c.leave();
  assert.equal(c.active, false);
});

test('DragCounter: leave never goes below zero', () => {
  const c = new DragCounter();
  c.leave();
  c.leave();
  assert.equal(c.active, false);
  c.enter();
  assert.equal(c.active, true);
});

test('DragCounter: reset clears the count', () => {
  const c = new DragCounter();
  c.enter();
  c.enter();
  c.reset();
  assert.equal(c.active, false);
});
