import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialFindReplaceState,
  buildReplaceQuery,
  canReplace,
  isValidSearch,
} from './find_replace.ts';

test('initial state is empty and find-only', () => {
  assert.deepEqual(initialFindReplaceState(), {
    search: '',
    replace: '',
    caseSensitive: false,
    regexp: false,
  });
});

test('buildReplaceQuery passes through all fields', () => {
  const spec = buildReplaceQuery({
    search: 'foo',
    replace: 'bar',
    caseSensitive: true,
    regexp: true,
  });
  assert.deepEqual(spec, {
    search: 'foo',
    replace: 'bar',
    caseSensitive: true,
    regexp: true,
  });
});

test('canReplace is false with an empty search term', () => {
  assert.equal(canReplace({ search: '', regexp: false }), false);
});

test('canReplace is true with a non-empty search term', () => {
  assert.equal(canReplace({ search: 'x', regexp: false }), true);
});

test('isValidSearch rejects invalid regular expressions', () => {
  assert.equal(isValidSearch({ search: '[', regexp: true }), false);
});

test('canReplace is false with invalid regular expressions', () => {
  assert.equal(canReplace({ search: '[', regexp: true }), false);
});
