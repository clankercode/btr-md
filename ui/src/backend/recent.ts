// Dialogs + recent-files domain client — open/save file dialogs and the recent
// files list. Thin typed wrappers over `call()`.

import { call } from './invoke.js';
import type { OpenedDoc } from './commands.js';

export function openDialog(): Promise<OpenedDoc | null> {
  return call('open_dialog');
}

export function saveDialog(suggestedName: string): Promise<string | null> {
  return call('save_dialog', { suggestedName });
}

export function getRecentFiles(): Promise<string[]> {
  return call('get_recent_files');
}

export function clearRecentFiles(): Promise<void> {
  return call('clear_recent_files');
}
