import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownForTable } from './table_copy.ts';

// Line 1: intro, lines 2-4: the table (1-based, inclusive).
const SOURCE = 'intro\n| a | b |\n|---|---|\n| 1 | 2 |\nafter\n';

test('extracts the inclusive line range as verbatim markdown', () => {
  const result = markdownForTable(SOURCE, '2', '4');
  assert.equal(result, '| a | b |\n|---|---|\n| 1 | 2 |');
});

test('single-line range', () => {
  assert.equal(markdownForTable(SOURCE, '1', '1'), 'intro');
});

test('missing / undefined attrs return null', () => {
  assert.equal(markdownForTable(SOURCE, null, '4'), null);
  assert.equal(markdownForTable(SOURCE, '2', null), null);
  assert.equal(markdownForTable(SOURCE, undefined, '4'), null);
  assert.equal(markdownForTable(SOURCE, '2', undefined), null);
});

test('non-numeric attrs return null', () => {
  assert.equal(markdownForTable(SOURCE, 'abc', '4'), null);
  assert.equal(markdownForTable(SOURCE, '2', 'xyz'), null);
});

test('start < 1 returns null (lines are 1-based)', () => {
  assert.equal(markdownForTable(SOURCE, '0', '4'), null);
  assert.equal(markdownForTable(SOURCE, '-1', '4'), null);
});

test('end < start returns null', () => {
  assert.equal(markdownForTable(SOURCE, '4', '2'), null);
});

test('end beyond the document returns null', () => {
  assert.equal(markdownForTable(SOURCE, '2', '999'), null);
});
