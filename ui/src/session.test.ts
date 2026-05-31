import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSavePayload,
  classifyRestore,
  type TabSnapshot,
  type SessionDoc,
} from './session.ts';

function doc(docId: number, buffer: string, mode = 'split'): TabSnapshot {
  return { kind: 'doc', docId, buffer, mode: mode as TabSnapshot['mode'] };
}

test('buildSavePayload: docs in order, content for every doc', () => {
  const p = buildSavePayload([doc(7, 'hello', 'source'), doc(9, 'world')], 0);
  assert.deepEqual(p.docs, [
    { docId: 7, mode: 'source', content: 'hello' },
    { docId: 9, mode: 'split', content: 'world' },
  ]);
  assert.deepEqual(p.active, { doc: 0 });
  assert.equal(p.browserTab, false);
});

test('buildSavePayload: browser tab excluded from docs, drives browserTab + active', () => {
  const tabs: TabSnapshot[] = [doc(1, 'a'), { kind: 'browser' }, doc(2, 'b')];
  const p = buildSavePayload(tabs, 1);
  assert.equal(p.docs.length, 2);
  assert.equal(p.browserTab, true);
  assert.equal(p.active, 'browser');
});

test('buildSavePayload: active doc index maps to position within docs (not tabs)', () => {
  // browser at tab index 0, the active doc is tab index 2 but docs index 1.
  const tabs: TabSnapshot[] = [{ kind: 'browser' }, doc(1, 'a'), doc(2, 'b')];
  const p = buildSavePayload(tabs, 2);
  assert.deepEqual(p.active, { doc: 1 });
});

test('buildSavePayload: empty tab excluded, no active when index out of range', () => {
  const tabs: TabSnapshot[] = [doc(1, 'a'), { kind: 'empty' }];
  const p = buildSavePayload(tabs, -1);
  assert.equal(p.docs.length, 1);
  assert.equal(p.browserTab, false);
  assert.equal(p.active, null);
});

test('buildSavePayload: active on an empty tab yields null active', () => {
  const tabs: TabSnapshot[] = [doc(1, 'a'), { kind: 'empty' }];
  const p = buildSavePayload(tabs, 1);
  assert.equal(p.active, null);
});

test('classifyRestore: untitled when path is null', () => {
  const d: SessionDoc = { path: null, mode: 'source', unsaved: { content: 'draft' } };
  assert.deepEqual(classifyRestore(d), { kind: 'untitled', content: 'draft', mode: 'source' });
});

test('classifyRestore: clean when no unsaved buffer', () => {
  const d: SessionDoc = { path: '/x/a.md', mode: 'split' };
  assert.deepEqual(classifyRestore(d), { kind: 'clean', path: '/x/a.md', mode: 'split' });
});

test('classifyRestore: dirty when unsaved present and path set', () => {
  const d: SessionDoc = {
    path: '/x/a.md',
    mode: 'preview',
    unsaved: { content: 'edited', baseline_content: 'original' },
  };
  assert.deepEqual(classifyRestore(d), {
    kind: 'dirty',
    path: '/x/a.md',
    content: 'edited',
    baselineContent: 'original',
    mode: 'preview',
  });
});

test('classifyRestore: unknown mode falls back to split', () => {
  const d: SessionDoc = { path: '/x/a.md', mode: 'bogus' };
  assert.equal(classifyRestore(d).mode, 'split');
});
