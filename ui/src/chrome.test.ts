import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abbreviatePath, formatPathDisplay } from './chrome.ts';

test('abbreviatePath shortens each directory component', () => {
  assert.equal(abbreviatePath('/home/user/documents/report.md'), '/h/u/d/report.md');
  assert.equal(abbreviatePath('~/src/preview-md/foo.md'), '~/s/p/foo.md');
});

test('abbreviatePath keeps two chars for dot-prefixed dirs', () => {
  assert.equal(
    abbreviatePath('~/src/preview-md/.worktrees/feature/foo.md'),
    '~/s/p/.w/f/foo.md'
  );
});

test('abbreviatePath leaves bare filenames and empty-ish inputs alone', () => {
  assert.equal(abbreviatePath('readme.md'), 'readme.md');
  assert.equal(abbreviatePath('Untitled'), 'Untitled');
  assert.equal(abbreviatePath(''), '');
});

test('formatPathDisplay returns full path when showFull is true', () => {
  const path = '/home/user/documents/report.md';
  assert.equal(formatPathDisplay(path, true), path);
});

test('formatPathDisplay returns compressed path when showFull is false', () => {
  assert.equal(
    formatPathDisplay('/home/user/documents/report.md', false),
    '/h/u/d/report.md'
  );
});
