import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFootnoteInsertion } from './footnotes.ts';

test('empty doc: first footnote is 1', () => {
  const r = planFootnoteInsertion('');
  assert.equal(r.id, '1');
  assert.equal(r.refText, '[^1]');
  assert.equal(r.defText, '\n\n[^1]: TODO');
  assert.equal(r.placeholder.start, r.defText.length - 4);
  assert.equal(r.placeholder.end, r.defText.length);
});

test('placeholder covers TODO', () => {
  const r = planFootnoteInsertion('');
  const extracted = r.defText.slice(r.placeholder.start, r.placeholder.end);
  assert.equal(extracted, 'TODO');
});

test('existing numeric ids: uses max+1', () => {
  const doc = 'See [^1] and [^3].';
  const r = planFootnoteInsertion(doc);
  assert.equal(r.id, '4');
});

test('single existing numeric id', () => {
  const doc = '[^2]: def';
  const r = planFootnoteInsertion(doc);
  assert.equal(r.id, '3');
});

test('multiple refs in one paragraph', () => {
  const doc = 'Foo [^1] bar [^2] baz [^3].';
  const r = planFootnoteInsertion(doc);
  assert.equal(r.id, '4');
});

test('refs across paragraphs', () => {
  const doc = 'Para one [^1].\n\nPara two [^5].';
  const r = planFootnoteInsertion(doc);
  assert.equal(r.id, '6');
});

test('named (non-numeric) ids: uses lowest free integer 1', () => {
  const doc = '[^abc]: def\n[^xyz]: def2';
  const r = planFootnoteInsertion(doc);
  assert.equal(r.id, '1');
});

test('mixed named and numeric: numeric wins for max+1', () => {
  const doc = '[^abc] [^2] [^foo]';
  const r = planFootnoteInsertion(doc);
  assert.equal(r.id, '3');
});

test('ids inside inline code spans are ignored', () => {
  const doc = 'Look at `[^1]` and `[^2]`.';
  const r = planFootnoteInsertion(doc);
  assert.equal(r.id, '1');
});

test('ids inside fenced code blocks are ignored', () => {
  const doc = '```\n[^1]: something\n[^2]: else\n```\nReal text.';
  const r = planFootnoteInsertion(doc);
  assert.equal(r.id, '1');
});

test('ids inside tilde fence are ignored', () => {
  const doc = '~~~\n[^3]\n~~~\n\nText [^1].';
  const r = planFootnoteInsertion(doc);
  assert.equal(r.id, '2');
});

test('escaped \\[^ is ignored', () => {
  const doc = 'An escaped \\[^1] reference.';
  const r = planFootnoteInsertion(doc);
  assert.equal(r.id, '1');
});

test('ref with no definition still counts', () => {
  // A ref [^5] with no corresponding def block: id still recognized
  const doc = 'Text [^5].';
  const r = planFootnoteInsertion(doc);
  assert.equal(r.id, '6');
});

test('non-contiguous numeric ids: uses max+1 not gap-fill', () => {
  // IDs 1 and 5 exist, next should be 6 (max+1), not 2
  const doc = '[^1] [^5]';
  const r = planFootnoteInsertion(doc);
  assert.equal(r.id, '6');
});

test('id "0" is not treated as positive integer start', () => {
  // id "0" is numeric (parseInt gives 0) but String(0) === "0"
  // Since numeric ids exist (0), max+1 = 1
  const doc = '[^0]';
  const r = planFootnoteInsertion(doc);
  assert.equal(r.id, '1');
});

test('defText format is correct', () => {
  const r = planFootnoteInsertion('[^1]');
  assert.equal(r.defText, '\n\n[^2]: TODO');
});
