import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isConflictState,
  conflictEpisodeKey,
  sameConflictEpisode,
  isConflictBannerVisible,
  CONFLICT_BANNER_MESSAGE,
} from './conflict_banner.ts';
import type { FileState } from './doc_state.ts';

const dig = (s: string) => s.padEnd(64, '0');

const clean: FileState = { kind: 'clean', base: dig('a') };
const dirty: FileState = { kind: 'dirty', base: dig('a'), mem: dig('b') };
const diskClean: FileState = {
  kind: 'disk_changed_clean',
  base: dig('a'),
  disk: dig('c'),
};
const conflict: FileState = {
  kind: 'disk_changed_dirty',
  base: dig('a'),
  mem: dig('b'),
  disk: dig('c'),
};
const conflictLaterDisk: FileState = {
  kind: 'disk_changed_dirty',
  base: dig('a'),
  mem: dig('b'),
  disk: dig('d'),
};

test('isConflictState is true only for disk_changed_dirty', () => {
  assert.equal(isConflictState(conflict), true);
  assert.equal(isConflictState(diskClean), false);
  assert.equal(isConflictState(dirty), false);
  assert.equal(isConflictState(clean), false);
  assert.equal(isConflictState({ kind: 'untitled' }), false);
  assert.equal(
    isConflictState({ kind: 'removed', base: dig('a'), mem: dig('b') }),
    false,
  );
});

test('conflictEpisodeKey captures docId + disk digest for dirty conflicts', () => {
  assert.deepEqual(conflictEpisodeKey(7, conflict), {
    docId: 7,
    disk: dig('c'),
  });
  assert.equal(conflictEpisodeKey(7, diskClean), null);
  assert.equal(conflictEpisodeKey(7, dirty), null);
  assert.equal(conflictEpisodeKey(7, clean), null);
});

test('sameConflictEpisode compares docId and disk digest', () => {
  const a = { docId: 1, disk: dig('c') };
  assert.equal(sameConflictEpisode(a, { docId: 1, disk: dig('c') }), true);
  assert.equal(sameConflictEpisode(a, { docId: 2, disk: dig('c') }), false);
  assert.equal(sameConflictEpisode(a, { docId: 1, disk: dig('d') }), false);
  assert.equal(sameConflictEpisode(a, null), false);
  assert.equal(sameConflictEpisode(null, a), false);
  assert.equal(sameConflictEpisode(null, null), false);
});

test('isConflictBannerVisible shows on conflict when not dismissed', () => {
  assert.equal(isConflictBannerVisible(conflict, 1, null), true);
  assert.equal(isConflictBannerVisible(diskClean, 1, null), false);
  assert.equal(isConflictBannerVisible(dirty, 1, null), false);
  assert.equal(isConflictBannerVisible(conflict, null, null), false);
});

test('isConflictBannerVisible soft-dismiss hides only matching episode', () => {
  const dismissed = conflictEpisodeKey(1, conflict);
  assert.equal(isConflictBannerVisible(conflict, 1, dismissed), false);
  // Same doc, later disk change → show again.
  assert.equal(isConflictBannerVisible(conflictLaterDisk, 1, dismissed), true);
  // Different doc, same disk digest → show.
  assert.equal(isConflictBannerVisible(conflict, 2, dismissed), true);
  // Resolved state → hidden regardless of dismiss.
  assert.equal(isConflictBannerVisible(dirty, 1, dismissed), false);
});

test('CONFLICT_BANNER_MESSAGE distinguishes conflict from clean disk-change', () => {
  assert.match(CONFLICT_BANNER_MESSAGE, /conflict/i);
  assert.match(CONFLICT_BANNER_MESSAGE, /unsaved/i);
  // Status for clean disk-change (doc_state) does not say "Conflict".
  assert.doesNotMatch(CONFLICT_BANNER_MESSAGE, /reload available/i);
});
