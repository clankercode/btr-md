import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldAutosaveOnDefocus,
  createDefocusSaveCoalescer,
  DEFOCUS_AUTOSAVE_DEBOUNCE_MS,
} from './autosave_defocus.ts';

/** Fake timer harness for the coalescer. */
function makeTimers() {
  const timers = new Map<number, () => void>();
  let nextId = 1;
  return {
    timers,
    setTimeout: (fn: () => void, _ms?: number) => {
      const id = nextId++;
      timers.set(id, fn as () => void);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (id: ReturnType<typeof setTimeout>) => {
      timers.delete(id as unknown as number);
    },
    async flushAll() {
      // Drain iteratively so retrigger schedules also run.
      while (timers.size > 0) {
        const batch = [...timers.values()];
        timers.clear();
        for (const fire of batch) await fire();
      }
    },
  };
}

test('shouldAutosaveOnDefocus requires on_defocus mode', () => {
  for (const mode of ['off', 'on_idle', 'on_interval'] as const) {
    assert.equal(
      shouldAutosaveOnDefocus({
        mode,
        filePath: '/a.md',
        stateKind: 'dirty',
        bufferDiffersFromBase: true,
      }),
      false,
      mode,
    );
  }
  assert.equal(
    shouldAutosaveOnDefocus({
      mode: 'on_defocus',
      filePath: '/a.md',
      stateKind: 'dirty',
      bufferDiffersFromBase: false,
    }),
    true,
  );
});

test('shouldAutosaveOnDefocus skips untitled (no path → save dialog)', () => {
  assert.equal(
    shouldAutosaveOnDefocus({
      mode: 'on_defocus',
      filePath: null,
      stateKind: 'dirty',
      bufferDiffersFromBase: true,
    }),
    false,
  );
});

test('shouldAutosaveOnDefocus saves dirty, and clean-with-pending-buffer-diff', () => {
  assert.equal(
    shouldAutosaveOnDefocus({
      mode: 'on_defocus',
      filePath: '/a.md',
      stateKind: 'dirty',
      bufferDiffersFromBase: false,
    }),
    true,
  );
  assert.equal(
    shouldAutosaveOnDefocus({
      mode: 'on_defocus',
      filePath: '/a.md',
      stateKind: 'clean',
      bufferDiffersFromBase: true,
    }),
    true,
    'doc_edited may still be in flight after a quick tab switch',
  );
  assert.equal(
    shouldAutosaveOnDefocus({
      mode: 'on_defocus',
      filePath: '/a.md',
      stateKind: 'clean',
      bufferDiffersFromBase: false,
    }),
    false,
  );
});

test('shouldAutosaveOnDefocus does not autosave conflict/removed/in-progress', () => {
  const kinds = [
    'untitled',
    'disk_changed_clean',
    'disk_changed_dirty',
    'removed',
    'save_in_progress',
  ] as const;
  for (const stateKind of kinds) {
    assert.equal(
      shouldAutosaveOnDefocus({
        mode: 'on_defocus',
        filePath: '/a.md',
        stateKind,
        bufferDiffersFromBase: true,
      }),
      false,
      stateKind,
    );
  }
});

test('DEFOCUS_AUTOSAVE_DEBOUNCE_MS is a small positive trailing window', () => {
  assert.ok(DEFOCUS_AUTOSAVE_DEBOUNCE_MS > 0);
  assert.ok(DEFOCUS_AUTOSAVE_DEBOUNCE_MS <= 250);
});

test('coalescer fires once per doc after trailing delay', async () => {
  const calls: number[] = [];
  const t = makeTimers();
  const coalescer = createDefocusSaveCoalescer({
    delayMs: 10,
    stillEligible: () => true,
    save: (docId) => {
      calls.push(docId);
    },
    setTimeout: t.setTimeout as typeof setTimeout,
    clearTimeout: t.clearTimeout,
  });

  coalescer.schedule(1);
  coalescer.schedule(1);
  coalescer.schedule(1);
  assert.deepEqual(coalescer.pending(), [1]);
  assert.equal(t.timers.size, 1, 'only one timer for doc 1');

  await t.flushAll();
  await coalescer.whenIdle();
  assert.deepEqual(calls, [1]);
  assert.deepEqual(coalescer.pending(), []);
});

test('coalescer allows concurrent pending timers for different docs', () => {
  const t = makeTimers();
  const coalescer = createDefocusSaveCoalescer({
    delayMs: 10,
    stillEligible: () => true,
    save: () => {},
    setTimeout: t.setTimeout as typeof setTimeout,
    clearTimeout: t.clearTimeout,
  });

  coalescer.schedule(10);
  coalescer.schedule(20);
  assert.equal(coalescer.pending().sort((a, b) => a - b).join(','), '10,20');
  assert.equal(t.timers.size, 2);
});

test('coalescer serialises saves across different docs', async () => {
  const order: string[] = [];
  const t = makeTimers();
  let releaseFirst: (() => void) | null = null;

  const coalescer = createDefocusSaveCoalescer({
    delayMs: 10,
    stillEligible: () => true,
    save: (docId) => {
      order.push(`start-${docId}`);
      if (docId === 1) {
        return new Promise<void>((resolve) => {
          releaseFirst = () => {
            order.push(`end-${docId}`);
            resolve();
          };
        });
      }
      order.push(`end-${docId}`);
    },
    setTimeout: t.setTimeout as typeof setTimeout,
    clearTimeout: t.clearTimeout,
  });

  coalescer.schedule(1);
  coalescer.schedule(2);
  // Fire both timers; doc 2 must wait until doc 1's save finishes.
  await t.flushAll();
  // Let the microtask chain start run-1.
  await Promise.resolve();
  assert.deepEqual(order, ['start-1']);
  releaseFirst!();
  await coalescer.whenIdle();
  assert.deepEqual(order, ['start-1', 'end-1', 'start-2', 'end-2']);
});

test('coalescer skips save when no longer eligible', async () => {
  const calls: number[] = [];
  let eligible = true;
  const t = makeTimers();
  const coalescer = createDefocusSaveCoalescer({
    delayMs: 10,
    stillEligible: () => eligible,
    save: (docId) => {
      calls.push(docId);
    },
    setTimeout: t.setTimeout as typeof setTimeout,
    clearTimeout: t.clearTimeout,
  });

  coalescer.schedule(3);
  eligible = false;
  await t.flushAll();
  await coalescer.whenIdle();
  assert.deepEqual(calls, []);
});

test('coalescer cancel drops pending timer', async () => {
  const calls: number[] = [];
  const t = makeTimers();
  const coalescer = createDefocusSaveCoalescer({
    delayMs: 10,
    stillEligible: () => true,
    save: (docId) => {
      calls.push(docId);
    },
    setTimeout: t.setTimeout as typeof setTimeout,
    clearTimeout: t.clearTimeout,
  });

  coalescer.schedule(5);
  coalescer.cancel(5);
  assert.deepEqual(coalescer.pending(), []);
  assert.equal(t.timers.size, 0);
  assert.deepEqual(calls, []);
});

test('coalescer serializes in-flight save and queues one retrigger', async () => {
  const calls: number[] = [];
  const saveWaiters: Array<() => void> = [];
  const t = makeTimers();
  const coalescer = createDefocusSaveCoalescer({
    delayMs: 10,
    stillEligible: () => true,
    save: (docId) => {
      calls.push(docId);
      return new Promise<void>((resolve) => {
        saveWaiters.push(resolve);
      });
    },
    setTimeout: t.setTimeout as typeof setTimeout,
    clearTimeout: t.clearTimeout,
  });

  coalescer.schedule(7);
  await t.flushAll();
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.equal(saveWaiters.length, 1);

  // Mid-flight re-schedule → marks retrigger (doc already inFlight).
  coalescer.schedule(7);
  await t.flushAll();
  assert.equal(calls.length, 1, 'no parallel second save');

  // Complete first save → coalescer schedules follow-up timer.
  saveWaiters.shift()!();
  await coalescer.whenIdle();
  assert.equal(t.timers.size, 1, 'retrigger scheduled');

  await t.flushAll();
  await Promise.resolve();
  assert.equal(calls.length, 2);
  saveWaiters.shift()!();
  await coalescer.whenIdle();
});

test('coalescer continues chain after save throws', async () => {
  const calls: number[] = [];
  const t = makeTimers();
  const coalescer = createDefocusSaveCoalescer({
    delayMs: 10,
    stillEligible: () => true,
    save: (docId) => {
      calls.push(docId);
      if (docId === 1) throw new Error('boom');
    },
    setTimeout: t.setTimeout as typeof setTimeout,
    clearTimeout: t.clearTimeout,
  });

  coalescer.schedule(1);
  coalescer.schedule(2);
  await t.flushAll();
  await coalescer.whenIdle();
  assert.deepEqual(calls, [1, 2]);
});
