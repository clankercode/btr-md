// Session / window-history domain client — per-window session save/load,
// recently-closed-window stack, and the close handshake. Thin typed wrappers
// over `call()`.

import { call } from './invoke.js';
import type { LoadedWindowSession, SaveWindowPayload } from '../session.js';
import type { ClosedWindowSummary } from '../chrome.js';

export function getWindowSession(
  label: string,
): Promise<LoadedWindowSession | null> {
  return call('get_window_session', { label });
}

export function saveWindowSession(input: SaveWindowPayload): Promise<void> {
  return call('save_window_session', { input });
}

export function getRecentlyClosedWindows(): Promise<ClosedWindowSummary[]> {
  return call('get_recently_closed_windows');
}

export function restoreRecentlyClosedWindow(index: number): Promise<void> {
  return call('restore_recently_closed_window', { index });
}

export function clearRecentlyClosedWindows(): Promise<void> {
  return call('clear_recently_closed_windows');
}

export function windowClosing(label: string): Promise<void> {
  return call('window_closing', { label });
}
