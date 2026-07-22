import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diskChangeBadge,
  diskChangeTooltip,
  uiForState,
  type FileState,
} from './doc_state.ts';

const dig = 'aa';

function everyKind(): FileState[] {
  return [
    { kind: 'untitled' },
    { kind: 'clean', base: dig },
    { kind: 'dirty', base: dig, mem: 'bb' },
    { kind: 'disk_changed_clean', base: dig, disk: 'cc' },
    { kind: 'disk_changed_dirty', base: dig, mem: 'bb', disk: 'cc' },
    { kind: 'removed', base: dig, mem: 'bb' },
    {
      kind: 'save_in_progress',
      base: dig,
      target: 'dd',
      edited_during: null,
      disk_before: null,
      disk_during: null,
      removed_during: false,
    },
  ];
}

test('diskChangeBadge: disk_changed_clean → disk', () => {
  assert.equal(
    diskChangeBadge({ kind: 'disk_changed_clean', base: dig, disk: 'cc' }),
    'disk',
  );
});

test('diskChangeBadge: disk_changed_dirty → conflict', () => {
  assert.equal(
    diskChangeBadge({ kind: 'disk_changed_dirty', base: dig, mem: 'bb', disk: 'cc' }),
    'conflict',
  );
});

test('diskChangeBadge: all non-disk-changed states → none', () => {
  for (const s of everyKind()) {
    if (s.kind === 'disk_changed_clean' || s.kind === 'disk_changed_dirty') continue;
    assert.equal(diskChangeBadge(s), 'none', s.kind);
  }
});

test('diskChangeTooltip: labels match expected copy', () => {
  assert.equal(diskChangeTooltip('disk'), 'Changed on disk');
  assert.equal(diskChangeTooltip('conflict'), 'Conflict: disk + unsaved');
  assert.equal(diskChangeTooltip('none'), null);
});

test('diskChangeBadge vs modified: orthogonal on disk states', () => {
  // Clean disk change: badge only, no modified dot.
  const cleanDisk: FileState = { kind: 'disk_changed_clean', base: dig, disk: 'cc' };
  assert.equal(diskChangeBadge(cleanDisk), 'disk');
  assert.equal(uiForState(cleanDisk).modified, false);

  // Conflict: badge + modified (dual indicators).
  const conflict: FileState = {
    kind: 'disk_changed_dirty',
    base: dig,
    mem: 'bb',
    disk: 'cc',
  };
  assert.equal(diskChangeBadge(conflict), 'conflict');
  assert.equal(uiForState(conflict).modified, true);

  // Ordinary dirty: modified only, no disk badge.
  const dirty: FileState = { kind: 'dirty', base: dig, mem: 'bb' };
  assert.equal(diskChangeBadge(dirty), 'none');
  assert.equal(uiForState(dirty).modified, true);
});

test('diskChangeBadge clears when leaving disk-changed states', () => {
  // Simulate reload/merge/save leaving a disk-changed state for clean/dirty.
  assert.equal(diskChangeBadge({ kind: 'clean', base: dig }), 'none');
  assert.equal(diskChangeBadge({ kind: 'dirty', base: dig, mem: 'bb' }), 'none');
});
