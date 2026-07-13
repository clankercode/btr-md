// Bounded backend command surface (c1 seam).
//
// `CommandMap` is the single source of truth for every Tauri `invoke` command
// the UI sends: each entry maps a command name to its argument shape and its
// result shape. `backend/invoke.ts`'s `call()` is typed against this map and is
// the only place that touches the raw `@tauri-apps/api/core` `invoke`. Domain
// client modules (`backend/files.ts`, `backend/settings.ts`, …) and the legacy
// wrapper modules (`trust_roots.ts`, `local_asset_grants.ts`, `link_activation.ts`)
// build their typed functions on top of `call()`.
//
// DTOs are imported from the modules that already own them; two shapes that used
// to live in `main.ts` (`Settings`, `OpenedDoc`) were moved here so the seam owns
// them, and `main.ts` imports them back.

import type {
  AutosaveMode,
  AutoreloadMode,
  DiffMode,
  FileState,
  MergeStrategy,
  Mode,
} from '../doc_state.js';
import type { DirListing } from '../file_browser.js';
import type { HandlerStatus } from '../settings_menu.js';
import type { ShortcutOverrides } from '../keybindings.js';
import type { ThemeInfo } from '../picker.js';
import type {
  AssetGrant,
  DocumentTrustContext,
  RenderResult,
  TrustRootDecision,
} from '../document_contracts.js';
import type { ClosedWindowSummary } from '../chrome.js';
import type {
  LoadedWindowSession,
  OpenedDocResult,
  SaveWindowPayload,
} from '../session.js';
import type { HtmlExportPayload } from '../export_document.js';
import type { ImportedImage } from '../local_asset_grants.js';
import type {
  ActivationKind,
  LinkActivationResponse,
} from '../link_activation.js';

// ---------------------------------------------------------------------------
// DTOs moved out of main.ts (the seam now owns them; main.ts imports them back).
// ---------------------------------------------------------------------------

/** Full settings snapshot returned by `get_settings` / `set_shortcut_overrides`. */
export interface Settings {
  active_theme: string | null;
  light_theme: string | null;
  dark_theme: string | null;
  auto_switch: boolean;
  default_mode: string | null;
  autosave_mode: AutosaveMode;
  autoreload_mode: AutoreloadMode;
  // The settings-menu view (`SettingsSnapshot` in settings_menu.ts) reads this,
  // and the backend + e2e mock both emit it, but the original `Settings` shape
  // omitted it — a latent prod/mock mismatch surfaced while typing the mock.
  merge_strategy: MergeStrategy;
  browser_base_dir: string | null;
  gist_enabled: boolean;
  diff_mode: DiffMode;
  dont_ask_default_handler: boolean;
  mono_font: string | null;
  shortcut_overrides: ShortcutOverrides;
  split_scroll_locked: boolean;
  /** When true, top-bar path label shows the full path; otherwise compressed. */
  show_full_path: boolean;
}

/** A document opened by the backend (`open_dialog` / `request_open_file`). */
export interface OpenedDoc {
  doc_id: number;
  path: string;
  contents: string;
  state: FileState;
  trust_context: DocumentTrustContext | null;
}

/** Result of `register_doc` (trust_context is present on the newer path). */
export interface RegisteredDoc {
  doc_id: number;
  state: FileState;
  trust_context: DocumentTrustContext | null;
}

/** Theme bundle returned by `set_theme`. */
export interface ThemeBundle {
  css: string;
  mermaid_vars: Record<string, string>;
  mode: string;
  warnings?: string[];
}

// ---------------------------------------------------------------------------
// The command map. `void` args mean the command takes no payload (TS lets the
// `call()` arg be omitted for void-typed params).
// ---------------------------------------------------------------------------

export interface CommandMap {
  // --- files ---
  list_dir: { args: { dir: string }; result: DirListing };
  set_workspace_root: { args: { path: string }; result: string };
  pick_base_dir: { args: void; result: string | null };
  reveal_in_folder: { args: { path: string }; result: void };
  rename_path: { args: { path: string; newName: string }; result: string };
  open_in_default_app: { args: { path: string }; result: void };

  // --- settings ---
  get_settings: { args: void; result: Settings };
  set_autosave_mode: { args: { mode: AutosaveMode }; result: void };
  set_autoreload_mode: { args: { mode: AutoreloadMode }; result: void };
  set_merge_strategy: { args: { strategy: MergeStrategy }; result: void };
  set_gist_enabled: { args: { enabled: boolean }; result: void };
  set_diff_mode: { args: { mode: DiffMode }; result: void };
  default_handler_status: {
    args: void;
    result: { status: HandlerStatus; platform: string };
  };
  set_as_default_handler: { args: void; result: void };
  set_mono_font: { args: { font: string | null }; result: void };
  set_split_scroll_locked: { args: { enabled: boolean }; result: void };
  set_show_full_path: { args: { enabled: boolean }; result: void };
  set_shortcut_overrides: { args: { overrides: ShortcutOverrides }; result: Settings };
  set_dont_ask_default_handler: { args: { value: boolean }; result: void };
  get_open_dialog_on_start: { args: void; result: boolean };

  // --- theme ---
  list_themes: { args: void; result: ThemeInfo[] };
  set_theme_pair: { args: { light?: string; dark?: string }; result: void };
  set_auto_switch: { args: { autoSwitch: boolean }; result: void };
  set_theme: { args: { slug: string }; result: ThemeBundle };
  set_active_theme: { args: { slug: string }; result: void };
  set_default_mode: { args: { mode: Mode }; result: void };

  // --- docs ---
  register_doc: { args: { path: string | null; contents: string }; result: RegisteredDoc };
  render_cmd: {
    args: { docId: number; version: number; markdown: string };
    result: RenderResult;
  };
  doc_edited: { args: { docId: number; contents: string }; result: FileState };
  save_doc: {
    args: { docId: number; contents: string; path: string | null };
    result: FileState;
  };
  drop_doc: { args: { docId: number }; result: void };
  set_active_doc: { args: { docId: number }; result: void };
  pull_from_disk: {
    args: { docId: number };
    result: { contents: string; state: FileState };
  };
  resolve_disk_change: {
    args: { docId: number; oursText: string; diskDigestSeen: string };
    result: { merged: string; state: FileState; conflicted: boolean };
  };
  restore_dirty_doc: {
    args: {
      path: string;
      content: string;
      baselineContent: string;
      background: boolean;
    };
    result: OpenedDocResult;
  };
  request_open_file: {
    args: { path: string; background: boolean };
    result: OpenedDoc;
  };
  export_html: {
    args: { payload: HtmlExportPayload; suggestedName: string };
    result: string | null;
  };
  get_initial_path: { args: void; result: string | null };
  import_image_asset: {
    args: {
      docId: number;
      fileName: string;
      bytes: number[];
      confirmNewFolder: boolean;
    };
    result: ImportedImage | null;
  };
  paste_html_as_markdown: { args: { html: string }; result: string };

  // --- windows ---
  open_url: { args: { url: string }; result: void };
  new_window: { args: void; result: void };
  begin_quit: { args: void; result: void };
  set_window_title: { args: { title: string }; result: void };

  // --- session ---
  get_window_session: {
    args: { label: string };
    result: LoadedWindowSession | null;
  };
  save_window_session: { args: { input: SaveWindowPayload }; result: void };
  get_recently_closed_windows: { args: void; result: ClosedWindowSummary[] };
  restore_recently_closed_window: { args: { index: number }; result: void };
  clear_recently_closed_windows: { args: void; result: void };
  window_closing: { args: { label: string }; result: void };

  // --- trust / asset grants ---
  list_asset_grants: { args: { docId: number }; result: AssetGrant[] };
  grant_asset_folder: {
    args: { docId: number; version: number; placeholderId: string };
    result: AssetGrant | null;
  };
  revoke_asset_grant: {
    args: { docId: number; grantId: number };
    result: void;
  };
  grant_recommended_root: {
    args: { docId: number; version: number; canonicalRoot: string };
    result: AssetGrant;
  };
  remember_declined_root: { args: { canonicalRoot: string }; result: void };
  forget_trust_root: { args: { canonicalRoot: string }; result: void };
  list_trust_roots: { args: void; result: TrustRootDecision[] };

  // --- links ---
  prepare_link_activation: {
    args: {
      docId: number;
      version: number;
      linkId: string;
      activationKind: ActivationKind;
    };
    result: LinkActivationResponse;
  };
  confirm_external_open: {
    args: { docId: number; version: number; actionToken: string };
    result: void;
  };

  // --- dialogs / recent ---
  open_dialog: { args: void; result: OpenedDoc | null };
  save_dialog: { args: { suggestedName: string }; result: string | null };
  get_recent_files: { args: void; result: string[] };
  clear_recent_files: { args: void; result: void };
}
