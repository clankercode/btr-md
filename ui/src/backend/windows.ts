// Windows domain client — new window, quit transaction, title, external URLs.
// Thin typed wrappers over `call()`.

import { call } from './invoke.js';

export function openUrl(url: string): Promise<void> {
  return call('open_url', { url });
}

export function newWindow(): Promise<void> {
  return call('new_window');
}

export function beginQuit(): Promise<void> {
  return call('begin_quit');
}

/** Persist the workspace session and relaunch the process (does not return). */
export function restartApp(): Promise<void> {
  return call('restart_app');
}

export function setWindowTitle(title: string): Promise<void> {
  return call('set_window_title', { title });
}
