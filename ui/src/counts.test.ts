import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCounts } from './counts.ts';

test('empty string', () => {
  const c = computeCounts('');
  assert.equal(c.words, 0);
  assert.equal(c.bytes, 0);
  assert.equal(c.sentences, 0);
  assert.equal(c.paragraphs, 0);
  assert.equal(c.sections, 0);
});

test('bytes counts utf-8 encoding', () => {
  // "é" is 2 bytes in UTF-8
  assert.equal(computeCounts('é').bytes, 2);
  assert.equal(computeCounts('hello').bytes, 5);
});

test('words: whitespace-separated tokens', () => {
  assert.equal(computeCounts('hello world').words, 2);
  assert.equal(computeCounts('  hello   world  ').words, 2);
  assert.equal(computeCounts('one\ntwo\tthree').words, 3);
});

test('sentences: punctuation runs', () => {
  assert.equal(computeCounts('Hello world. How are you?').sentences, 2);
  assert.equal(computeCounts('Wow!!! Really...').sentences, 2);
  assert.equal(computeCounts('No punctuation').sentences, 0);
  // at end of string
  assert.equal(computeCounts('End.').sentences, 1);
});

test('sections: ATX headings', () => {
  const md = '# H1\n## H2\n### H3\n\nsome text\n#### H4';
  assert.equal(computeCounts(md).sections, 4);
});

test('sections: must have space after #', () => {
  // '#no-space' should not count
  assert.equal(computeCounts('#nospace').sections, 0);
  assert.equal(computeCounts('# yes').sections, 1);
});

test('paragraphs: simple blank-line separation', () => {
  const md = 'Para one.\n\nPara two.\n\nPara three.';
  assert.equal(computeCounts(md).paragraphs, 3);
});

test('paragraphs: single paragraph no trailing newline', () => {
  assert.equal(computeCounts('Just one para').paragraphs, 1);
});

test('paragraphs: leading/trailing blank lines do not add paragraphs', () => {
  const md = '\n\nPara one.\n\nPara two.\n\n';
  assert.equal(computeCounts(md).paragraphs, 2);
});

test('paragraphs: fenced block with blank lines inside counts as one paragraph', () => {
  const md = '```\ncode line 1\n\ncode line 2\n```\n\nAfter fence.';
  assert.equal(computeCounts(md).paragraphs, 2);
});

test('paragraphs: tilde fence also works', () => {
  const md = '~~~\ncode\n\nmore code\n~~~\n\nRegular paragraph.';
  assert.equal(computeCounts(md).paragraphs, 2);
});

test('paragraphs: text before and after fence', () => {
  const md = 'Before.\n\n```\ncode\n```\n\nAfter.';
  assert.equal(computeCounts(md).paragraphs, 3);
});

test('paragraphs: longer fence marker closes longer fence', () => {
  const md = '````\nsome\n\ncode\n````\n\ntext';
  assert.equal(computeCounts(md).paragraphs, 2);
});
