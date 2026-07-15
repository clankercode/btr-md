// Unit tests for the typed event seam (`backend/events.ts`).
// Fakes Tauri `listen` so we never touch the real IPC bridge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSubscribe,
  type ListenImpl,
} from './backend/events.ts';
import type { EventMap } from './backend/event_map.ts';

/** Minimal Tauri-like event envelope for the fake listen. */
type FakeEvent<T> = { event: string; id: number; payload: T };

function makeFakeListen(): {
  listen: ListenImpl;
  emit: <K extends keyof EventMap>(name: K, payload: EventMap[K]) => void;
  subscribed: string[];
  unlistenCount: () => number;
} {
  const handlers = new Map<string, Set<(event: FakeEvent<unknown>) => void>>();
  let unlistenCalls = 0;

  const listen: ListenImpl = async (event, handler) => {
    let set = handlers.get(event);
    if (!set) {
      set = new Set();
      handlers.set(event, set);
    }
    set.add(handler as (event: FakeEvent<unknown>) => void);
    return () => {
      unlistenCalls += 1;
      set!.delete(handler as (event: FakeEvent<unknown>) => void);
    };
  };

  return {
    listen,
    emit(name, payload) {
      const set = handlers.get(name);
      if (!set) return;
      for (const h of [...set]) {
        h({ event: name, id: 1, payload });
      }
    },
    get subscribed() {
      return [...handlers.keys()];
    },
    unlistenCount: () => unlistenCalls,
  };
}

test('subscribe forwards typed payload and returns unlisten', async () => {
  const fake = makeFakeListen();
  const subscribe = createSubscribe(fake.listen);
  const seen: string[] = [];

  const unlisten = await subscribe('open-file', (path) => {
    seen.push(path);
  });

  assert.deepEqual(fake.subscribed, ['open-file']);
  fake.emit('open-file', '/tmp/note.md');
  assert.deepEqual(seen, ['/tmp/note.md']);

  unlisten();
  assert.equal(fake.unlistenCount(), 1);
  fake.emit('open-file', '/tmp/other.md');
  assert.deepEqual(seen, ['/tmp/note.md'], 'unlisten stops delivery');
});

test('subscribe delivers structured payloads without envelope', async () => {
  const fake = makeFakeListen();
  const subscribe = createSubscribe(fake.listen);
  let got: EventMap['doc_state_changed'] | null = null;

  await subscribe('doc_state_changed', (payload) => {
    got = payload;
  });

  fake.emit('doc_state_changed', {
    doc_id: 7,
    state: { kind: 'dirty', base: 'aaa', mem: 'bbb' },
  });

  assert.deepEqual(got, {
    doc_id: 7,
    state: { kind: 'dirty', base: 'aaa', mem: 'bbb' },
  });
});

test('void-ish events still invoke the handler', async () => {
  const fake = makeFakeListen();
  const subscribe = createSubscribe(fake.listen);
  let calls = 0;

  await subscribe('workspace_tree_changed', () => {
    calls += 1;
  });
  await subscribe('system_theme_changed', () => {
    calls += 1;
  });

  fake.emit('workspace_tree_changed', null);
  fake.emit('system_theme_changed', undefined);
  assert.equal(calls, 2);
});

test('EventMap covers the known backend event names', () => {
  // Compile-time coverage is the main contract; this pins the name set so a
  // dropped key is a deliberate edit, not silent drift.
  const keys: (keyof EventMap)[] = [
    'open-file',
    'activate-doc',
    'doc_state_changed',
    'workspace_tree_changed',
    'pmd://diagnostics-enriched',
    'pmd://download-denied',
    'system_theme_changed',
    'mode-change',
  ];
  assert.equal(keys.length, 8);
  assert.equal(new Set(keys).size, keys.length);
});
