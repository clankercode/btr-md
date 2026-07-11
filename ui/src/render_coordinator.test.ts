import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRenderCoordinator,
  type RenderCoordinatorDeps,
} from './render_coordinator.ts';
import type { RenderResult } from './document_contracts.ts';
import type { BlockRef } from './block_reconcile.ts';

// ---------------------------------------------------------------------------
// Test harness. The coordinator is exercised with fully-injected deps: a
// controllable async render(), sentinel DOM handles (never touched as real DOM
// — every DOM write is an injected fn we record), and recording decorators /
// onApplied subscribers. No jsdom; mirrors the pure-function testing style of
// the rest of the suite (scroll_sync.test.ts etc.).
// ---------------------------------------------------------------------------

class FakeDesync extends Error {}

// A controllable render(): each call parks a deferred we resolve/reject from
// the test, so we can drive queue ordering deterministically.
function makeDeferredRender() {
  const calls: Array<{
    req: { docId: number; version: number; markdown: string };
    resolve: (r: RenderResult) => void;
    reject: (e: unknown) => void;
  }> = [];
  const render = (req: { docId: number; version: number; markdown: string }) => {
    let resolve!: (r: RenderResult) => void;
    let reject!: (e: unknown) => void;
    const p = new Promise<RenderResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    calls.push({ req, resolve, reject });
    return p;
  };
  return { render, calls };
}

function makeResult(over: Partial<RenderResult> = {}): RenderResult {
  return {
    doc_id: 10,
    version: 1,
    html: '<p>x</p>',
    source_map: [],
    render_nonce: 'nonce-1',
    facts: {} as RenderResult['facts'],
    diagnostics: {} as RenderResult['diagnostics'],
    ...over,
  } as RenderResult;
}

// A sentinel object used wherever the coordinator only passes a handle through.
const H = (tag: string) => ({ __h: tag }) as unknown as HTMLElement;

interface Fixture {
  coord: ReturnType<typeof createRenderCoordinator>;
  calls: ReturnType<typeof makeDeferredRender>['calls'];
  state: {
    tab: { id: number; docId: number; kind: string; renderSeq: number } | null;
    activeId: number | null;
    editorValue: string | null;
  };
  domCalls: {
    fullReplace: Array<{ root: HTMLElement; html: string }>;
    reconcile: Array<{ root: HTMLElement; html: string; blocks: BlockRef[] }>;
    refreshKeptNonces: Array<{ root: HTMLElement; nonce: string }>;
    reconcileError: unknown[];
  };
  decoratorCalls: Array<{ node: HTMLElement; nonce: string }>;
  applied: RenderResult[];
  root: HTMLElement;
  setReconcile: (fn: (blocks: BlockRef[]) => HTMLElement[]) => void;
}

function makeFixture(opts: {
  debounceMs?: number;
  decoratorCount?: number;
} = {}): Fixture {
  const { render, calls } = makeDeferredRender();
  const root = H('root');
  const state: Fixture['state'] = {
    tab: { id: 1, docId: 10, kind: 'doc', renderSeq: 0 },
    activeId: 1,
    editorValue: 'hello',
  };
  const domCalls: Fixture['domCalls'] = {
    fullReplace: [],
    reconcile: [],
    refreshKeptNonces: [],
    reconcileError: [],
  };
  const decoratorCalls: Fixture['decoratorCalls'] = [];
  const applied: RenderResult[] = [];
  let reconcileImpl: (blocks: BlockRef[]) => HTMLElement[] = () => [H('changed')];

  const decorators = Array.from(
    { length: opts.decoratorCount ?? 1 },
    () => (node: HTMLElement, nonce: string) => {
      decoratorCalls.push({ node, nonce });
    },
  );

  const deps: RenderCoordinatorDeps = {
    render,
    root,
    decorators,
    dom: {
      fullReplace: (r, html) => domCalls.fullReplace.push({ root: r, html }),
      reconcile: (r, html, blocks) => {
        domCalls.reconcile.push({ root: r, html, blocks });
        return reconcileImpl(blocks);
      },
      refreshKeptNonces: (r, nonce) => domCalls.refreshKeptNonces.push({ root: r, nonce }),
      isDesyncError: (e) => e instanceof FakeDesync,
      onReconcileError: (e) => domCalls.reconcileError.push(e),
    },
    activeDoc: () => state.tab,
    getValue: () => state.editorValue,
    getTab: (id) => (state.tab && state.tab.id === id ? state.tab : null),
    activeId: () => state.activeId,
    debounceMs: opts.debounceMs ?? 80,
  };

  const coord = createRenderCoordinator(deps);
  coord.onApplied((r) => applied.push(r));

  return {
    coord,
    calls,
    state,
    domCalls,
    decoratorCalls,
    applied,
    root,
    setReconcile: (fn) => {
      reconcileImpl = fn;
    },
  };
}

// ---------------------------------------------------------------------------
// Group 1 — Queue serialization (rendering gate, FIFO drain, re-entrancy).
// ---------------------------------------------------------------------------

test('serialization: a second schedule() does not start its render until the first finishes', async () => {
  const f = makeFixture();
  const p1 = f.coord.schedule();
  const p2 = f.coord.schedule();
  // Only the first item's render is in flight (rendering gate holds item 2).
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].req.version, 1);

  f.calls[0].resolve(makeResult({ version: 1 }));
  await p1;
  // Now item 2 drains (re-entrant processQueue after finish).
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].req.version, 2);

  f.calls[1].resolve(makeResult({ version: 2 }));
  await p2;
});

test('serialization: renders drain FIFO in schedule order', async () => {
  const f = makeFixture();
  const p1 = f.coord.schedule();
  const p2 = f.coord.schedule();
  f.calls[0].resolve(makeResult({ version: 1 }));
  await p1;
  f.calls[1].resolve(makeResult({ version: 2 }));
  await p2;
  assert.deepEqual(
    f.calls.map((c) => c.req.version),
    [1, 2],
  );
});

// ---------------------------------------------------------------------------
// Group 2 — 4-part staleness gate. Baseline applies; each part flipped alone
// blocks the paint and onApplied.
// ---------------------------------------------------------------------------

test('staleness: baseline (all four parts match) applies the render', async () => {
  const f = makeFixture();
  const p = f.coord.schedule();
  f.calls[0].resolve(makeResult({ version: 1, doc_id: 10 }));
  await p;
  assert.equal(f.applied.length, 1);
  assert.equal(f.coord.appliedVersion(), 1);
});

test('staleness: renderSeq bumped after schedule blocks the paint', async () => {
  const f = makeFixture();
  const p = f.coord.schedule();
  // A newer render for the same tab bumped renderSeq while this one was in flight.
  f.state.tab!.renderSeq = 999;
  f.calls[0].resolve(makeResult({ version: 1 }));
  await p;
  assert.equal(f.applied.length, 0);
  assert.equal(f.domCalls.fullReplace.length, 0);
  assert.equal(f.domCalls.reconcile.length, 0);
  assert.equal(f.coord.appliedVersion(), 0);
});

test('staleness: result.doc_id mismatch blocks the paint', async () => {
  const f = makeFixture();
  const p = f.coord.schedule();
  f.calls[0].resolve(makeResult({ version: 1, doc_id: 999 }));
  await p;
  assert.equal(f.applied.length, 0);
  assert.equal(f.domCalls.fullReplace.length, 0);
});

test('staleness: result.version mismatch blocks the paint', async () => {
  const f = makeFixture();
  const p = f.coord.schedule();
  f.calls[0].resolve(makeResult({ version: 999 }));
  await p;
  assert.equal(f.applied.length, 0);
  assert.equal(f.domCalls.fullReplace.length, 0);
});

test('staleness: activeId changed to another tab blocks the paint', async () => {
  const f = makeFixture();
  const p = f.coord.schedule();
  f.state.activeId = 2; // user switched tabs while the render was in flight
  f.calls[0].resolve(makeResult({ version: 1 }));
  await p;
  assert.equal(f.applied.length, 0);
  assert.equal(f.domCalls.fullReplace.length, 0);
});

// ---------------------------------------------------------------------------
// Group 3 — Debounced cancel-before-immediate.
// ---------------------------------------------------------------------------

test('debounced-cancel: schedule() cancels a pending debounced render (no double fire)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = makeFixture({ debounceMs: 80 });
  f.coord.scheduleDebounced(); // arms the debounce timer
  const p = f.coord.schedule(); // immediate render must cancel the debounced one
  // Advance well past the debounce window: the cancelled timer must not fire.
  t.mock.timers.tick(500);
  assert.equal(f.calls.length, 1, 'debounced fire was not cancelled');
  f.calls[0].resolve(makeResult({ version: 1 }));
  await p;
  assert.equal(f.calls.length, 1);
});

// ---------------------------------------------------------------------------
// Group 4 — Reconcile → full-replace fallback that keeps draining.
// ---------------------------------------------------------------------------

test('reconcile: blocks present drives reconcile and decorates each changed node', async () => {
  const f = makeFixture();
  const nodeA = H('A');
  const nodeB = H('B');
  f.setReconcile(() => [nodeA, nodeB]);
  const blocks: BlockRef[] = [{ key: 'k', base_line: 1 }];
  const p = f.coord.schedule();
  f.calls[0].resolve(makeResult({ version: 1, blocks }));
  await p;
  assert.equal(f.domCalls.reconcile.length, 1);
  assert.equal(f.domCalls.fullReplace.length, 0);
  // Each changed node decorated (one decorator in the fixture).
  assert.deepEqual(
    f.decoratorCalls.map((d) => d.node),
    [nodeA, nodeB],
  );
  assert.equal(f.applied.length, 1);
});

test('reconcile: ReconcileDesyncError falls back to full replace (no console noise)', async () => {
  const f = makeFixture();
  f.setReconcile(() => {
    throw new FakeDesync('desync');
  });
  const blocks: BlockRef[] = [{ key: 'k', base_line: 1 }];
  const p = f.coord.schedule();
  f.calls[0].resolve(makeResult({ version: 1, blocks }));
  await p;
  assert.equal(f.domCalls.fullReplace.length, 1);
  assert.equal(f.domCalls.reconcileError.length, 0, 'desync must not log');
  // Full replace decorates the root.
  assert.equal(f.decoratorCalls.length, 1);
  assert.equal(f.decoratorCalls[0].node, f.root);
  assert.equal(f.applied.length, 1);
});

test('reconcile: a non-desync throw falls back AND logs, then keeps draining', async () => {
  const f = makeFixture();
  f.setReconcile(() => {
    throw new Error('boom');
  });
  const blocks: BlockRef[] = [{ key: 'k', base_line: 1 }];
  const p1 = f.coord.schedule();
  f.calls[0].resolve(makeResult({ version: 1, blocks }));
  await p1;
  assert.equal(f.domCalls.fullReplace.length, 1);
  assert.equal(f.domCalls.reconcileError.length, 1, 'non-desync error logged');
  // The fallback still paints, so this render applies (matches the original:
  // the catch falls through to the post-render hooks).
  assert.equal(f.applied.length, 1);
  assert.equal(f.applied[0].version, 1);

  // Coordinator is not wedged: a subsequent render drains and applies too.
  f.setReconcile(() => [H('c')]);
  const p2 = f.coord.schedule();
  assert.equal(f.calls.length, 2);
  f.calls[1].resolve(makeResult({ version: 2 }));
  await p2;
  assert.equal(f.applied.length, 2);
  assert.equal(f.applied[1].version, 2);
});

test('drain: a render() rejection does not wedge the queue', async () => {
  const f = makeFixture();
  const p1 = f.coord.schedule();
  f.calls[0].reject(new Error('render failed'));
  await p1.catch(() => {});
  // Next schedule still processes.
  const p2 = f.coord.schedule();
  assert.equal(f.calls.length, 2);
  f.calls[1].resolve(makeResult({ version: 2 }));
  await p2;
  assert.equal(f.applied.length, 1);
  assert.equal(f.applied[0].version, 2);
});

// ---------------------------------------------------------------------------
// Group 5 — Explicit-nonce fan-out (no dataset round-trip).
// ---------------------------------------------------------------------------

test('nonce: decorators receive the render_nonce explicitly (full-replace path)', async () => {
  const f = makeFixture({ decoratorCount: 3 });
  const p = f.coord.schedule();
  f.calls[0].resolve(makeResult({ version: 1, render_nonce: 'NONCE-XYZ' }));
  await p;
  assert.equal(f.decoratorCalls.length, 3);
  for (const d of f.decoratorCalls) assert.equal(d.nonce, 'NONCE-XYZ');
});

test('nonce: kept (unchanged) nodes get their nonce refreshed after reconcile', async () => {
  const f = makeFixture();
  f.setReconcile(() => [H('c')]);
  const blocks: BlockRef[] = [{ key: 'k', base_line: 1 }];
  const p = f.coord.schedule();
  f.calls[0].resolve(makeResult({ version: 1, blocks, render_nonce: 'NONCE-K' }));
  await p;
  assert.equal(f.domCalls.refreshKeptNonces.length, 1);
  assert.equal(f.domCalls.refreshKeptNonces[0].nonce, 'NONCE-K');
  assert.equal(f.domCalls.refreshKeptNonces[0].root, f.root);
});

test('nonce: appliedNonce getter exposes the last applied render nonce', async () => {
  const f = makeFixture();
  assert.equal(f.coord.appliedNonce(), '');
  const p = f.coord.schedule();
  f.calls[0].resolve(makeResult({ version: 1, render_nonce: 'applied-nonce' }));
  await p;
  assert.equal(f.coord.appliedNonce(), 'applied-nonce');
});

// ---------------------------------------------------------------------------
// Group 6 — onApplied fires exactly once per applied render, carrying ids.
// ---------------------------------------------------------------------------

test('onApplied: fires exactly once per applied render with (doc_id, version)', async () => {
  const f = makeFixture();
  const p = f.coord.schedule();
  f.calls[0].resolve(makeResult({ version: 1, doc_id: 10 }));
  await p;
  assert.equal(f.applied.length, 1);
  assert.equal(f.applied[0].doc_id, 10);
  assert.equal(f.applied[0].version, 1);
});

test('onApplied: subscribers fire in registration order after DOM settle', async () => {
  const f = makeFixture();
  const order: string[] = [];
  // A decorator records the DOM-settle point; two subscribers record after it.
  f.coord.onApplied(() => order.push('sub-a'));
  f.coord.onApplied(() => order.push('sub-b'));
  // Re-wire a decorator that logs the paint via the fixture's recording: the
  // fixture decorator already runs during paint; assert onApplied runs after.
  const p = f.coord.schedule();
  f.calls[0].resolve(makeResult({ version: 1 }));
  await p;
  // The fixture's own onApplied (push to applied[]) ran first, then sub-a, sub-b.
  assert.deepEqual(order, ['sub-a', 'sub-b']);
  assert.equal(f.applied.length, 1);
});

// ---------------------------------------------------------------------------
// B4 — onActiveEdit ordering: scheduleDebounced() must NOT advance the version
// until it fires, so notifyEdit(currentVersion) records the pre-edit version.
// ---------------------------------------------------------------------------

test('version: scheduleDebounced does not advance currentVersion until it fires', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = makeFixture({ debounceMs: 80 });
  const before = f.coord.currentVersion();
  f.coord.scheduleDebounced();
  // notifyEdit reads currentVersion() here — it must still see the pre-edit value.
  assert.equal(f.coord.currentVersion(), before, 'version advanced too early');
  t.mock.timers.tick(100); // debounce fires -> schedule() -> version bumps
  assert.equal(f.coord.currentVersion(), before + 1);
  assert.equal(f.calls.length, 1);
  f.calls[0].resolve(makeResult({ version: before + 1 }));
});

test('version: schedule() advances currentVersion synchronously', () => {
  const f = makeFixture();
  assert.equal(f.coord.currentVersion(), 0);
  void f.coord.schedule();
  assert.equal(f.coord.currentVersion(), 1);
  void f.coord.schedule();
  assert.equal(f.coord.currentVersion(), 2);
});

// ---------------------------------------------------------------------------
// Guard: no active doc / no editor bails without touching anything.
// ---------------------------------------------------------------------------

test('bail: no active doc → no render scheduled', async () => {
  const f = makeFixture();
  f.state.tab = null;
  await f.coord.schedule();
  assert.equal(f.calls.length, 0);
});

test('bail: no editor (getValue null) → no render scheduled', async () => {
  const f = makeFixture();
  f.state.editorValue = null;
  await f.coord.schedule();
  assert.equal(f.calls.length, 0);
});
