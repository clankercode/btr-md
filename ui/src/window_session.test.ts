import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWindowPayload, classifyRestore, type LoadedWindowSession } from './session.ts';

test('buildWindowPayload wraps slice with label + geometry', () => {
  const p = buildWindowPayload('w-2',
    { x: 5, y: 6, width: 800, height: 600, maximized: false },
    [{ kind: 'doc', docId: 1, mode: 'split', buffer: 'hi' }], 0);
  assert.equal(p.label, 'w-2');
  assert.equal(p.geometry.width, 800);
  assert.equal(p.docs.length, 1);
  assert.deepEqual(p.active, { doc: 0 });
  assert.equal(p.browserTab, false);
});

test('classifyRestore still works on a window slice doc', () => {
  const w: LoadedWindowSession = {
    label: 'main',
    geometry: { x: 0, y: 0, width: 1100, height: 720, maximized: false },
    docs: [{ path: null, mode: 'source', unsaved: { content: 'draft' } }],
    active: { doc: 0 }, browser_tab: false,
  };
  assert.equal(classifyRestore(w.docs[0]).kind, 'untitled');
});
