// Files domain client — file-browser + workspace + reveal/rename/open.
// Thin typed wrappers over the `call()` seam.

import { call } from './invoke.js';
import type { DirListing } from '../file_browser.js';

export function listDir(dir: string): Promise<DirListing> {
  return call('list_dir', { dir });
}

export function setWorkspaceRoot(path: string): Promise<string> {
  return call('set_workspace_root', { path });
}

export function pickBaseDir(): Promise<string | null> {
  return call('pick_base_dir');
}

export function revealInFolder(path: string): Promise<void> {
  return call('reveal_in_folder', { path });
}

export function renamePath(path: string, newName: string): Promise<string> {
  return call('rename_path', { path, newName });
}

export function openInDefaultApp(path: string): Promise<void> {
  return call('open_in_default_app', { path });
}
