import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debounce } from './debounce.ts';

test('flush runs the pending call immediately and returns its result', () => {
  let seen: number | null = null;
  const d = debounce((n: number) => {
    seen = n;
    return n * 2;
  }, 1000);
  d(21);
  assert.equal(seen, null, 'not called synchronously');
  const result = d.flush();
  assert.equal(seen, 21, 'flush invoked fn with the latest args');
  assert.equal(result, 42, 'flush returns fn result');
});

test('flush is a no-op (undefined) with nothing pending', () => {
  let calls = 0;
  const d = debounce(() => {
    calls++;
    return 'x';
  }, 1000);
  assert.equal(d.flush(), undefined);
  assert.equal(calls, 0);
});

test('flush uses the most recent args and clears the pending timer', () => {
  const seen: number[] = [];
  const d = debounce((n: number) => {
    seen.push(n);
  }, 1000);
  d(1);
  d(2);
  d(3);
  d.flush();
  assert.deepEqual(seen, [3], 'only the latest args fire, once');
  // A second flush should not re-fire the (now cleared) pending call.
  d.flush();
  assert.deepEqual(seen, [3]);
});

test('cancel drops the pending call so flush does nothing', () => {
  let calls = 0;
  const d = debounce(() => {
    calls++;
  }, 1000);
  d();
  d.cancel();
  assert.equal(d.flush(), undefined);
  assert.equal(calls, 0);
});
