import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownForTable } from './table_copy.ts';

const SOURCE = '| a | b |\n|---|---|\n| 1 | 2 |\n';

test('valid slice returns trimmed markdown', () => {
  const result = markdownForTable(SOURCE, '0', String(SOURCE.length));
  // trailing newline trimmed
  assert.equal(result, SOURCE.trimEnd());
});

test('valid slice with inner range', () => {
  const inner = '| a | b |';
  const start = SOURCE.indexOf(inner);
  const end = start + inner.length;
  const result = markdownForTable(SOURCE, String(start), String(end));
  assert.equal(result, inner);
});

test('missing startAttr returns null', () => {
  assert.equal(markdownForTable(SOURCE, null, '5'), null);
});

test('missing endAttr returns null', () => {
  assert.equal(markdownForTable(SOURCE, '0', null), null);
});

test('undefined startAttr returns null', () => {
  assert.equal(markdownForTable(SOURCE, undefined, '5'), null);
});

test('undefined endAttr returns null', () => {
  assert.equal(markdownForTable(SOURCE, '0', undefined), null);
});

test('non-numeric startAttr returns null', () => {
  assert.equal(markdownForTable(SOURCE, 'abc', '5'), null);
});

test('non-numeric endAttr returns null', () => {
  assert.equal(markdownForTable(SOURCE, '0', 'xyz'), null);
});

test('start < 0 returns null', () => {
  assert.equal(markdownForTable(SOURCE, '-1', '5'), null);
});

test('start >= end returns null', () => {
  assert.equal(markdownForTable(SOURCE, '5', '5'), null);
  assert.equal(markdownForTable(SOURCE, '10', '5'), null);
});

test('end > source.length returns null', () => {
  assert.equal(markdownForTable(SOURCE, '0', String(SOURCE.length + 1)), null);
});

test('empty source with 0,0 returns null (start >= end)', () => {
  assert.equal(markdownForTable('', '0', '0'), null);
});

test('float-like strings parsed as integers via parseInt', () => {
  // parseInt('0.9') === 0, parseInt('5.9') === 5 — valid range
  const result = markdownForTable(SOURCE, '0.9', '5.9');
  // 0 < 5 <= source.length, so valid
  assert.notEqual(result, null);
});
