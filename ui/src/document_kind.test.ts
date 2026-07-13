import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectDocumentKind,
  kindFromPath,
  looksLikeHtml,
} from './document_kind.ts';

test('kindFromPath maps known extensions', () => {
  assert.equal(kindFromPath('a.MD'), 'markdown');
  assert.equal(kindFromPath('/x/y.HtM'), 'html');
  assert.equal(kindFromPath('c.json'), 'json');
  assert.equal(kindFromPath('c.yml'), 'yaml');
  assert.equal(kindFromPath('c.toml'), 'toml');
  assert.equal(kindFromPath('c.ini'), 'ini');
  assert.equal(kindFromPath('c.cfg'), 'ini');
  assert.equal(kindFromPath('c.txt'), null);
  assert.equal(kindFromPath(null), null);
});

test('looksLikeHtml sniffs doctype and html root', () => {
  assert.equal(looksLikeHtml('<!DOCTYPE html><html></html>'), true);
  assert.equal(looksLikeHtml('  \n<!doctype HTML>'), true);
  assert.equal(looksLikeHtml('<html lang="en">'), true);
  assert.equal(looksLikeHtml('\uFEFF<html>'), true);
  assert.equal(looksLikeHtml('<h1>nope</h1>'), false);
  assert.equal(looksLikeHtml('# md'), false);
  assert.equal(looksLikeHtml('<htmlish>'), false);
});

test('detectDocumentKind prefers path over content', () => {
  assert.equal(
    detectDocumentKind('notes.md', '<!DOCTYPE html><html>'),
    'markdown',
  );
  assert.equal(detectDocumentKind('page.html', '<p>x</p>'), 'html');
  assert.equal(
    detectDocumentKind(null, '<!DOCTYPE html><html><body>x</body></html>'),
    'html',
  );
  assert.equal(detectDocumentKind('c.json', '{}'), 'json');
});
