import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldAutosaveOnDefocus,
  createDefocusSaveCoalescer,
  DEFOCUS_AUTOSAVE_DEBOUNCE_MS,
} from './autosave_defocus.ts';

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
  const timers = new Map<number, () => void>();
  let nextId = 1;
  const coalescer = createDefocusSaveCoalescer({
    delayMs: 10,
    stillEligible: () => true,
    save: (docId) => {
      calls.push(docId);
    },
    setTimeout: (fn, _ms) => {
      const id = nextId++;
      timers.set(id, fn as () => void);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (id) => {
      timers.delete(id as unknown as number);
    },
  });

  coalescer.schedule(1);
  coalescer.schedule(1);
  coalescer.schedule(1);
  assert.deepEqual(coalescer.pending(), [1]);
  assert.equal(timers.size, 1, 'only one timer for doc 1');

  // Fire the pending timer.
  const fire = [...timers.values()][0];
  timers.clear();
  await fire();
  assert.deepEqual(calls, [1]);
  assert.deepEqual(coalescer.pending(), []);
});

test('coalescer allows concurrent pending saves for different docs', async () => {
  const calls: number[] = [];
  const timers = new Map<number, () => void>();
  let nextId = 1;
  const coalescer = createDefocusSaveCoalescer({
    delayMs: 10,
    stillEligible: () => true,
    save: (docId) => {
      calls.push(docId);
    },
    setTimeout: (fn, _ms) => {
      const id = nextId++;
      timers.set(id, fn as () => void);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (id) => {
      timers.delete(id as unknown as number);
    },
  });

  coalescer.schedule(10);
  coalescer.schedule(20);
  assert.equal(coalescer.pending().sort((a, b) => a - b).join(','), '10,20');

  for (const fire of [...timers.values()]) {
    await fire();
  }
  assert.deepEqual(calls.sort((a, b) => a - b), [10, 20]);
});

test('coalescer skips save when no longer eligible', async () => {
  const calls: number[] = [];
  let eligible = true;
  const timers = new Map<number, () => void>();
  let nextId = 1;
  const coalescer = createDefocusSaveCoalescer({
    delayMs: 10,
    stillEligible: () => eligible,
    save: (docId) => {
      calls.push(docId);
    },
    setTimeout: (fn, _ms) => {
      const id = nextId++;
      timers.set(id, fn as () => void);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (id) => {
      timers.delete(id as unknown as number);
    },
  });

  coalescer.schedule(3);
  eligible = false;
  const fire = [...timers.values()][0];
  await fire();
  assert.deepEqual(calls, []);
});

test('coalescer cancel drops pending timer', async () => {
  const calls: number[] = [];
  const timers = new Map<number, () => void>();
  let nextId = 1;
  const coalescer = createDefocusSaveCoalescer({
    delayMs: 10,
    stillEligible: () => true,
    save: (docId) => {
      calls.push(docId);
    },
    setTimeout: (fn, _ms) => {
      const id = nextId++;
      timers.set(id, fn as () => void);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (id) => {
      timers.delete(id as unknown as number);
    },
  });

  coalescer.schedule(5);
  coalescer.cancel(5);
  assert.deepEqual(coalescer.pending(), []);
  assert.equal(timers.size, 0);
  assert.deepEqual(calls, []);
});

test('coalescer serializes in-flight save and queues one retrigger', async () => {
  const calls: number[] = [];
  const saveWaiters: Array<() => void> = [];
  const timers = new Map<number, () => void>();
  let nextId = 1;
  const coalescer = createDefocusSaveCoalescer({
    delayMs: 10,
    stillEligible: () => true,
    save: (docId) => {
      calls.push(docId);
      return new Promise<void>((resolve) => {
        saveWaiters.push(resolve);
      });
    },
    setTimeout: (fn, _ms) => {
      const id = nextId++;
      timers.set(id, fn as () => void);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (id) => {
      timers.delete(id as unknown as number);
    },
  });

  coalescer.schedule(7);
  const firstFire = [...timers.values()][0]!;
  timers.clear();
  const firstDone = firstFire();
  assert.equal(calls.length, 1);

  // Mid-flight re-schedule → timer fires while in-flight → marks retrigger.
  coalescer.schedule(7);
  const midFire = [...timers.values()][0]!;
  timers.clear();
  await midFire();
  assert.equal(calls.length, 1, 'no parallel second save');

  // Complete first save → coalescer schedules follow-up.
  saveWaiters.shift()!();
  await firstDone;
  assert.equal(timers.size, 1, 'retrigger scheduled');

  const secondFire = [...timers.values()][0]!;
  timers.clear();
  const secondDone = secondFire();
  assert.equal(calls.length, 2);
  saveWaiters.shift()!();
  await secondDone;
});
