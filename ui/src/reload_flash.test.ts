import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFlashHunks,
  flashLineMarks,
  splitDocLines,
  rememberFlashHunks,
  getLastFlashHunks,
  clearRememberedFlashHunks,
  FLASH_DURATION_MS,
} from './reload_flash.ts';

test('FLASH_DURATION_MS is a short ephemeral window', () => {
  assert.ok(FLASH_DURATION_MS >= 800 && FLASH_DURATION_MS <= 2500);
});

test('splitDocLines: empty is one empty line', () => {
  assert.deepEqual(splitDocLines(''), ['']);
});

test('splitDocLines: no trailing newline', () => {
  assert.deepEqual(splitDocLines('a\nb'), ['a', 'b']);
});

test('splitDocLines: trailing newline yields empty last segment', () => {
  assert.deepEqual(splitDocLines('a\nb\n'), ['a', 'b', '']);
});

test('computeFlashHunks: identical → empty', () => {
  assert.deepEqual(computeFlashHunks('hello\nworld', 'hello\nworld'), []);
  assert.deepEqual(computeFlashHunks('', ''), []);
});

test('computeFlashHunks: pure add in the middle', () => {
  const before = 'a\nc';
  const after = 'a\nb\nc';
  const hunks = computeFlashHunks(before, after);
  assert.deepEqual(hunks, [
    { kind: 'add', beforeFrom: 1, beforeTo: 1, afterFrom: 1, afterTo: 2 },
  ]);
});

test('computeFlashHunks: pure remove in the middle', () => {
  const before = 'a\nb\nc';
  const after = 'a\nc';
  const hunks = computeFlashHunks(before, after);
  assert.deepEqual(hunks, [
    { kind: 'remove', beforeFrom: 1, beforeTo: 2, afterFrom: 1, afterTo: 1 },
  ]);
});

test('computeFlashHunks: replace a single line', () => {
  const before = 'a\nold\nc';
  const after = 'a\nnew\nc';
  const hunks = computeFlashHunks(before, after);
  assert.deepEqual(hunks, [
    { kind: 'replace', beforeFrom: 1, beforeTo: 2, afterFrom: 1, afterTo: 2 },
  ]);
});

test('computeFlashHunks: multi-hunk add + remove', () => {
  // before: A X B Y C
  // after:  A   B Z C
  const before = 'A\nX\nB\nY\nC';
  const after = 'A\nB\nZ\nC';
  const hunks = computeFlashHunks(before, after);
  assert.equal(hunks.length, 2);
  assert.deepEqual(hunks[0], {
    kind: 'remove',
    beforeFrom: 1,
    beforeTo: 2,
    afterFrom: 1,
    afterTo: 1,
  });
  assert.deepEqual(hunks[1], {
    kind: 'replace',
    beforeFrom: 3,
    beforeTo: 4,
    afterFrom: 2,
    afterTo: 3,
  });
});

test('computeFlashHunks: prepend lines', () => {
  const hunks = computeFlashHunks('body', 'head\nbody');
  assert.deepEqual(hunks, [
    { kind: 'add', beforeFrom: 0, beforeTo: 0, afterFrom: 0, afterTo: 1 },
  ]);
});

test('computeFlashHunks: append lines', () => {
  const hunks = computeFlashHunks('body', 'body\ntail');
  assert.deepEqual(hunks, [
    { kind: 'add', beforeFrom: 1, beforeTo: 1, afterFrom: 1, afterTo: 2 },
  ]);
});

test('computeFlashHunks: clear entire document to empty', () => {
  // Empty after is still one (empty) line, so this is a replace of content → blank.
  const hunks = computeFlashHunks('a\nb', '');
  assert.deepEqual(hunks, [
    { kind: 'replace', beforeFrom: 0, beforeTo: 2, afterFrom: 0, afterTo: 1 },
  ]);
});

test('computeFlashHunks: empty to content', () => {
  const hunks = computeFlashHunks('', 'x\ny');
  assert.deepEqual(hunks, [
    { kind: 'replace', beforeFrom: 0, beforeTo: 1, afterFrom: 0, afterTo: 2 },
  ]);
});

test('flashLineMarks: pure add marks green lines', () => {
  const marks = flashLineMarks(
    [{ kind: 'add', beforeFrom: 1, beforeTo: 1, afterFrom: 1, afterTo: 3 }],
    4,
  );
  assert.deepEqual(marks, [
    { line: 1, className: 'pmd-flash-add' },
    { line: 2, className: 'pmd-flash-add' },
  ]);
});

test('flashLineMarks: pure remove marks red locus', () => {
  const marks = flashLineMarks(
    [{ kind: 'remove', beforeFrom: 1, beforeTo: 2, afterFrom: 1, afterTo: 1 }],
    3,
  );
  assert.deepEqual(marks, [{ line: 1, className: 'pmd-flash-remove' }]);
});

test('flashLineMarks: replace marks replace class on after lines', () => {
  const marks = flashLineMarks(
    [{ kind: 'replace', beforeFrom: 1, beforeTo: 2, afterFrom: 1, afterTo: 3 }],
    4,
  );
  assert.deepEqual(marks, [
    { line: 1, className: 'pmd-flash-replace' },
    { line: 2, className: 'pmd-flash-replace' },
  ]);
});

test('flashLineMarks: remove at EOF clamps to last line', () => {
  // after has 2 lines (indices 0..1); remove locus afterFrom=2 → clamp to 1
  const marks = flashLineMarks(
    [{ kind: 'remove', beforeFrom: 2, beforeTo: 4, afterFrom: 2, afterTo: 2 }],
    2,
  );
  assert.deepEqual(marks, [{ line: 1, className: 'pmd-flash-remove' }]);
});

test('remember / get / clear last flash hunks', () => {
  clearRememberedFlashHunks();
  assert.deepEqual(getLastFlashHunks(), []);
  const h = [
    { kind: 'add' as const, beforeFrom: 0, beforeTo: 0, afterFrom: 0, afterTo: 1 },
  ];
  rememberFlashHunks(h);
  assert.deepEqual(getLastFlashHunks(), h);
  // Defensive copy: mutating the input later must not affect store.
  h[0] = { kind: 'remove', beforeFrom: 0, beforeTo: 1, afterFrom: 0, afterTo: 0 };
  assert.equal(getLastFlashHunks()[0].kind, 'add');
  clearRememberedFlashHunks();
  assert.deepEqual(getLastFlashHunks(), []);
});
