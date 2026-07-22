// TS mirror of the Rust `FileState` / lifecycle-mode enums.
//
// This is the ONLY place the frontend branches on lifecycle state. `uiForState`
// maps each variant to the chrome it should drive; `assertNever` makes the
// switch exhaustive at *compile* time (under the scoped tsconfig), mirroring the
// Rust `match`'s no-`_` guarantee. Add a `FileState` variant in Rust → add it
// here → the compiler points at every switch that must handle it.

/** The editor view mode. Defined here (a typechecked module) so the tab/lifecycle
 *  modules can share it without importing the untyped legacy `chrome.ts`. */
export type Mode = 'source' | 'split' | 'preview';

/** A blake3 digest, hex-encoded. Opaque to the UI — only variant identity matters. */
export type Digest = string;

export type FileState =
  | { kind: 'untitled' }
  | { kind: 'clean'; base: Digest }
  | { kind: 'dirty'; base: Digest; mem: Digest }
  | { kind: 'disk_changed_clean'; base: Digest; disk: Digest }
  | { kind: 'disk_changed_dirty'; base: Digest; mem: Digest; disk: Digest }
  | { kind: 'removed'; base: Digest; mem: Digest }
  | { kind: 'save_in_progress'; base: Digest | null; target: Digest; edited_during: Digest | null; disk_before: Digest | null; disk_during: Digest | null; removed_during: boolean };

/** The `doc_state_changed` event payload emitted by the watcher. */
export interface DocStateChanged {
  doc_id: number;
  state: FileState;
}

// Lifecycle-policy unions (mirror the serde `snake_case` enums).
export type AutosaveMode = 'off' | 'on_idle' | 'on_defocus' | 'on_interval';
export type AutoreloadMode = 'off' | 'when_clean' | 'always';
export type MergeStrategy =
  | 'raise_conflict'
  | 'auto_merge_raise'
  | 'auto_merge_munge'
  | 'ignore_disk'
  | 'take_disk';
export type DiffMode = 'none' | 'gutter' | 'line_by_line' | 'word_by_word';

/** Compile-time exhaustiveness guard. */
export function assertNever(x: never): never {
  throw new Error(`unexpected variant: ${JSON.stringify(x)}`);
}

/** How a given lifecycle state drives the chrome. */
export interface DocUi {
  /** Whether the Save button is enabled (there is something writable to save). */
  saveEnabled: boolean;
  /** Status-bar text. */
  status: string;
  /** Whether to surface the Reload (pull-from-disk) affordance. */
  showReload: boolean;
  /** Whether to surface the Merge affordance (a real disk-vs-memory conflict). */
  showMerge: boolean;
  /** Whether the buffer currently has unsaved edits (drives the modified dot). */
  modified: boolean;
}

export function uiForState(s: FileState): DocUi {
  switch (s.kind) {
    case 'untitled':
      return { saveEnabled: true, status: 'Untitled', showReload: false, showMerge: false, modified: false };
    case 'clean':
      return { saveEnabled: false, status: 'Saved', showReload: false, showMerge: false, modified: false };
    case 'dirty':
      return { saveEnabled: true, status: 'Modified', showReload: false, showMerge: false, modified: true };
    case 'disk_changed_clean':
      return {
        saveEnabled: false,
        status: 'Changed on disk — reload available',
        showReload: true,
        showMerge: false,
        modified: false,
      };
    case 'disk_changed_dirty':
      return {
        saveEnabled: true,
        status: 'Conflict: changed on disk and in editor',
        showReload: true,
        showMerge: true,
        modified: true,
      };
    case 'removed':
      return {
        saveEnabled: true,
        status: 'File removed on disk — save to recreate',
        showReload: false,
        showMerge: false,
        modified: true,
      };
    case 'save_in_progress':
      return { saveEnabled: false, status: 'Saving…', showReload: false, showMerge: false, modified: true };
    default:
      return assertNever(s);
  }
}

/** Tab-level disk-change indicator (orthogonal to the unsaved/modified dot). */
export type DiskChangeBadge = 'none' | 'disk' | 'conflict';

/**
 * Pure mapping from lifecycle state → tab badge kind.
 * - `disk`: buffer clean, file changed on disk (`disk_changed_clean`)
 * - `conflict`: unsaved buffer + disk change (`disk_changed_dirty`)
 * - `none`: every other state (clears after reload/merge/save)
 */
export function diskChangeBadge(s: FileState): DiskChangeBadge {
  switch (s.kind) {
    case 'disk_changed_clean':
      return 'disk';
    case 'disk_changed_dirty':
      return 'conflict';
    case 'untitled':
    case 'clean':
    case 'dirty':
    case 'removed':
    case 'save_in_progress':
      return 'none';
    default:
      return assertNever(s);
  }
}

/** Hover text for a disk-change badge; null when no badge is shown. */
export function diskChangeTooltip(badge: DiskChangeBadge): string | null {
  switch (badge) {
    case 'disk':
      return 'Changed on disk';
    case 'conflict':
      return 'Conflict: disk + unsaved';
    case 'none':
      return null;
    default:
      return assertNever(badge);
  }
}
