// Settings domain client — the settings snapshot plus each individual setter,
// default-handler status, and startup flags. Thin typed wrappers over `call()`.

import { call } from './invoke.js';
import type { Settings } from './commands.js';
import type {
  AutosaveMode,
  AutoreloadMode,
  DiffMode,
  MergeStrategy,
} from '../doc_state.js';
import type { ShortcutOverrides } from '../keybindings.js';
import type { HandlerStatus } from '../settings_menu.js';

export function getSettings(): Promise<Settings> {
  return call('get_settings');
}

export function setAutosaveMode(mode: AutosaveMode): Promise<void> {
  return call('set_autosave_mode', { mode });
}

export function setAutoreloadMode(mode: AutoreloadMode): Promise<void> {
  return call('set_autoreload_mode', { mode });
}

export function setMergeStrategy(strategy: MergeStrategy): Promise<void> {
  return call('set_merge_strategy', { strategy });
}

export function setGistEnabled(enabled: boolean): Promise<void> {
  return call('set_gist_enabled', { enabled });
}

export function setDiffMode(mode: DiffMode): Promise<void> {
  return call('set_diff_mode', { mode });
}

export function defaultHandlerStatus(): Promise<{
  status: HandlerStatus;
  platform: string;
}> {
  return call('default_handler_status');
}

export function setAsDefaultHandler(): Promise<void> {
  return call('set_as_default_handler');
}

export function setMonoFont(font: string | null): Promise<void> {
  return call('set_mono_font', { font });
}

export function setSplitScrollLocked(enabled: boolean): Promise<void> {
  return call('set_split_scroll_locked', { enabled });
}

export function setShowFullPath(enabled: boolean): Promise<void> {
  return call('set_show_full_path', { enabled });
}

export function setShowHiddenFiles(enabled: boolean): Promise<void> {
  return call('set_show_hidden_files', { enabled });
}

export function setShortcutOverrides(overrides: ShortcutOverrides): Promise<Settings> {
  return call('set_shortcut_overrides', { overrides });
}

export function setDontAskDefaultHandler(value: boolean): Promise<void> {
  return call('set_dont_ask_default_handler', { value });
}

export function getOpenDialogOnStart(): Promise<boolean> {
  return call('get_open_dialog_on_start');
}
