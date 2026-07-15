// Backend → UI event name → payload shape (the typed half of the event seam).
//
// Kept free of Tauri imports so the e2e mock can type `__pmdEmitEvent` against
// the same map without pulling `@tauri-apps/api/event`'s global Window
// augmentations into the mock's declaration merge.

import type { DocStateChanged } from '../doc_state.js';
import type { DocumentDiagnostics } from '../document_contracts.js';

/**
 * Backend → UI events. Payloads with no useful content use `unknown` so the
 * handler signature is uniform (`(payload) => …`) and callers can ignore it.
 */
export interface EventMap {
  /** Open a path in this window (OS / second-instance handoff). */
  'open-file': string;
  /** Focus an already-open doc by path, or open it if missing. */
  'activate-doc': string;
  /** Watcher-driven file-lifecycle state transition for a registered doc. */
  'doc_state_changed': DocStateChanged;
  /** Workspace root tree changed (create/rename/delete coalesced). */
  'workspace_tree_changed': unknown;
  /** Enriched diagnostics for the active (or a) document. */
  'pmd://diagnostics-enriched': DocumentDiagnostics;
  /** Preview download of a remote URL was denied by policy. */
  'pmd://download-denied': string;
  /** OS light/dark preference changed (theme auto-switch). */
  'system_theme_changed': unknown;
  /** View mode request from the native menu / another surface. */
  'mode-change': string;
}
