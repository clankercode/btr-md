// Theme domain client — theme listing, active/pair selection, auto-switch, and
// the `set_theme` bundle fetch. Thin typed wrappers over `call()`.

import { call } from './invoke.js';
import type { ThemeBundle } from './commands.js';
import type { ThemeInfo } from '../picker.js';
import type { Mode } from '../doc_state.js';

export function listThemes(): Promise<ThemeInfo[]> {
  return call('list_themes');
}

export function setThemePair(pair: { light?: string; dark?: string }): Promise<void> {
  return call('set_theme_pair', pair);
}

export function setAutoSwitch(autoSwitch: boolean): Promise<void> {
  return call('set_auto_switch', { autoSwitch });
}

/** Fetch (and activate CSS for) a theme, returning its CSS + mermaid vars. */
export function setTheme(slug: string): Promise<ThemeBundle> {
  return call('set_theme', { slug });
}

export function setActiveTheme(slug: string): Promise<void> {
  return call('set_active_theme', { slug });
}

export function setDefaultMode(mode: Mode): Promise<void> {
  return call('set_default_mode', { mode });
}
