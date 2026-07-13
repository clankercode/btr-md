import test from 'node:test';
import assert from 'node:assert/strict';
import { diffViewConfig } from './editor_diff.ts';

test('diffViewConfig: none clears all merge chrome', () => {
  const c = diffViewConfig('none');
  assert.equal(c.mode, 'none');
  assert.equal(c.editorClass, '');
  assert.equal(c.gutter, false);
  assert.equal(c.highlightChanges, false);
  assert.equal(c.allowInlineDiffs, false);
});

test('diffViewConfig: unknown mode is treated as none', () => {
  assert.equal(diffViewConfig('').mode, 'none');
  assert.equal(diffViewConfig('bogus').mode, 'none');
});

test('diffViewConfig: gutter is gutter-markers only (no word / no inline)', () => {
  const c = diffViewConfig('gutter');
  assert.equal(c.mode, 'gutter');
  assert.equal(c.editorClass, 'pmd-diff-gutter');
  assert.equal(c.gutter, true);
  assert.equal(c.highlightChanges, false);
  assert.equal(c.allowInlineDiffs, false);
});

test('diffViewConfig: line_by_line is whole-line unified diff', () => {
  const c = diffViewConfig('line_by_line');
  assert.equal(c.mode, 'line_by_line');
  assert.equal(c.editorClass, 'pmd-diff-line');
  assert.equal(c.gutter, true);
  assert.equal(c.highlightChanges, false);
  assert.equal(c.allowInlineDiffs, false);
});

test('diffViewConfig: word_by_word enables intra-line marks + inline diffs', () => {
  const c = diffViewConfig('word_by_word');
  assert.equal(c.mode, 'word_by_word');
  assert.equal(c.editorClass, 'pmd-diff-word');
  assert.equal(c.gutter, true);
  assert.equal(c.highlightChanges, true);
  assert.equal(c.allowInlineDiffs, true);
});

test('diffViewConfig: the three active modes are pairwise distinct', () => {
  const g = diffViewConfig('gutter');
  const l = diffViewConfig('line_by_line');
  const w = diffViewConfig('word_by_word');

  // Distinct mode identities + editor classes (CSS gates visual chrome).
  assert.notEqual(g.mode, l.mode);
  assert.notEqual(g.mode, w.mode);
  assert.notEqual(l.mode, w.mode);
  assert.notEqual(g.editorClass, l.editorClass);
  assert.notEqual(g.editorClass, w.editorClass);
  assert.notEqual(l.editorClass, w.editorClass);

  // Word mode is the only one with highlightChanges / allowInlineDiffs.
  assert.equal(g.highlightChanges, false);
  assert.equal(l.highlightChanges, false);
  assert.equal(w.highlightChanges, true);
  assert.equal(g.allowInlineDiffs, false);
  assert.equal(l.allowInlineDiffs, false);
  assert.equal(w.allowInlineDiffs, true);

  // Gutter vs line share merge flags by design — distinction is CSS
  // (gutter hides line fills + deleted chunks; line keeps them). The
  // editorClass is the only structural differentiator at the config layer.
  assert.equal(g.gutter, l.gutter);
  assert.equal(g.highlightChanges, l.highlightChanges);
  assert.equal(g.allowInlineDiffs, l.allowInlineDiffs);
  assert.notEqual(g.editorClass, l.editorClass);
});
