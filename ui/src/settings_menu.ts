// The settings dropdown menu. Self-contained: it appends its own trigger button
// into the toolbar and manages a dropdown (mirroring the File-menu pattern), so
// it does not require editing chrome.ts. Each control calls its backend setter.
//
// Phase 3 hosts the lifecycle policies (autosave / autoreload / merge) + the
// file-browser base dir. It is structured so later phases (diff mode, gist,
// fonts, default-handler) can add sections without restructuring.

import type { AutoreloadMode, AutosaveMode, DiffMode, MergeStrategy } from './doc_state.js';

export interface SettingsSnapshot {
  autosave_mode: AutosaveMode;
  autoreload_mode: AutoreloadMode;
  merge_strategy: MergeStrategy;
  browser_base_dir: string | null;
  gist_enabled: boolean;
  diff_mode: DiffMode;
  mono_font: string | null;
}

/** Default-handler status mirrored from the backend `HandlerStatus`. */
export type HandlerStatus = 'default' | 'not_default' | 'unknown';

export interface SettingsMenuDeps {
  getSettings: () => Promise<SettingsSnapshot>;
  setAutosaveMode: (m: AutosaveMode) => Promise<void>;
  setAutoreloadMode: (m: AutoreloadMode) => Promise<void>;
  setMergeStrategy: (m: MergeStrategy) => Promise<void>;
  setGistEnabled: (enabled: boolean) => Promise<void>;
  setDiffMode: (m: DiffMode) => Promise<void>;
  pickBaseDir: () => Promise<string | null>;
  getDefaultHandlerStatus: () => Promise<HandlerStatus>;
  setAsDefaultHandler: () => Promise<void>;
  setMonoFont: (font: string | null) => Promise<void>;
  onAutosaveChange: (m: AutosaveMode) => void;
  onAutoreloadChange: (m: AutoreloadMode) => void;
  onBaseDirChange: (dir: string) => void;
  onGistChange: (enabled: boolean) => void;
  onDiffModeChange: (m: DiffMode) => void;
  onMonoFontChange: (font: string | null) => void;
}

export interface SettingsMenuInstance {
  el: HTMLElement;
  refresh: () => Promise<void>;
  open: () => Promise<void>;
  close: () => void;
}

interface Choice<T extends string> {
  value: T;
  label: string;
}

const AUTOSAVE_CHOICES: Choice<AutosaveMode>[] = [
  { value: 'off', label: 'Off' },
  { value: 'on_idle', label: 'On idle' },
  { value: 'on_defocus', label: 'On focus loss' },
  { value: 'on_interval', label: 'On interval' },
];

const AUTORELOAD_CHOICES: Choice<AutoreloadMode>[] = [
  { value: 'off', label: 'Off (prompt)' },
  { value: 'when_clean', label: 'When clean' },
  { value: 'always', label: 'Always' },
];

const MERGE_CHOICES: Choice<MergeStrategy>[] = [
  { value: 'raise_conflict', label: 'Raise conflict' },
  { value: 'auto_merge_raise', label: 'Auto-merge, raise on conflict' },
  { value: 'auto_merge_munge', label: 'Auto-merge, munge on conflict' },
  { value: 'ignore_disk', label: 'Ignore disk' },
  { value: 'take_disk', label: 'Take disk' },
];

const DIFF_CHOICES: Choice<DiffMode>[] = [
  { value: 'none', label: 'Off' },
  { value: 'gutter', label: 'Gutter markers' },
  { value: 'line_by_line', label: 'Line by line' },
  { value: 'word_by_word', label: 'Word by word' },
];

function makeSelect<T extends string>(
  id: string,
  labelText: string,
  choices: Choice<T>[],
  onChange: (v: T) => void
): { row: HTMLElement; select: HTMLSelectElement } {
  const row = document.createElement('div');
  row.className = 'pmd-settings-row';

  const label = document.createElement('label');
  label.className = 'pmd-settings-label';
  label.htmlFor = id;
  label.textContent = labelText;
  row.appendChild(label);

  const select = document.createElement('select');
  select.className = 'pmd-settings-select';
  select.id = id;
  for (const c of choices) {
    const opt = document.createElement('option');
    opt.value = c.value;
    opt.textContent = c.label;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => onChange(select.value as T));
  row.appendChild(select);

  return { row, select };
}

function makeToggle(
  id: string,
  labelText: string,
  onChange: (checked: boolean) => void
): { row: HTMLElement; input: HTMLInputElement } {
  const row = document.createElement('div');
  row.className = 'pmd-settings-row';
  const label = document.createElement('label');
  label.className = 'pmd-settings-label';
  label.htmlFor = id;
  label.textContent = labelText;
  row.appendChild(label);
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  input.className = 'pmd-settings-toggle';
  input.addEventListener('change', () => onChange(input.checked));
  row.appendChild(input);
  return { row, input };
}

export function createSettingsMenu(
  toolbar: HTMLElement,
  deps: SettingsMenuDeps
): SettingsMenuInstance {
  const wrapper = document.createElement('div');
  wrapper.className = 'pmd-dropdown';

  const btn = document.createElement('button');
  btn.className = 'pmd-btn pmd-btn-ghost pmd-btn-sm';
  btn.type = 'button';
  btn.textContent = 'Settings';
  btn.title = 'Settings';

  const menu = document.createElement('div');
  menu.className = 'pmd-dropdown-menu pmd-settings-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('data-align', 'end');
  menu.style.display = 'none';

  const heading = document.createElement('div');
  heading.className = 'pmd-dropdown-label';
  heading.textContent = 'File lifecycle';
  menu.appendChild(heading);

  const autosave = makeSelect<AutosaveMode>('pmd-set-autosave', 'Autosave', AUTOSAVE_CHOICES, (v) => {
    deps.setAutosaveMode(v).catch((e) => console.error('set_autosave_mode failed:', e));
    deps.onAutosaveChange(v);
  });
  const autoreload = makeSelect<AutoreloadMode>('pmd-set-autoreload', 'Auto-reload', AUTORELOAD_CHOICES, (v) => {
    deps.setAutoreloadMode(v).catch((e) => console.error('set_autoreload_mode failed:', e));
    deps.onAutoreloadChange(v);
  });
  const merge = makeSelect<MergeStrategy>('pmd-set-merge', 'Merge', MERGE_CHOICES, (v) => {
    deps.setMergeStrategy(v).catch((e) => console.error('set_merge_strategy failed:', e));
  });
  menu.appendChild(autosave.row);
  menu.appendChild(autoreload.row);
  menu.appendChild(merge.row);

  const divider = document.createElement('div');
  divider.className = 'pmd-dropdown-divider';
  menu.appendChild(divider);

  const browseHeading = document.createElement('div');
  browseHeading.className = 'pmd-dropdown-label';
  browseHeading.textContent = 'File browser';
  menu.appendChild(browseHeading);

  const baseRow = document.createElement('div');
  baseRow.className = 'pmd-settings-row pmd-settings-row-col';
  const basePath = document.createElement('span');
  basePath.className = 'pmd-settings-base pmd-truncate';
  const baseBtn = document.createElement('button');
  baseBtn.className = 'pmd-btn pmd-btn-outline pmd-btn-sm';
  baseBtn.type = 'button';
  baseBtn.textContent = 'Choose base folder…';
  baseBtn.addEventListener('click', async () => {
    try {
      const dir = await deps.pickBaseDir();
      if (dir) {
        basePath.textContent = dir;
        basePath.title = dir;
        deps.onBaseDirChange(dir);
      }
    } catch (e) {
      console.error('pick_base_dir failed:', e);
    }
  });
  baseRow.appendChild(basePath);
  baseRow.appendChild(baseBtn);
  menu.appendChild(baseRow);

  const divider2 = document.createElement('div');
  divider2.className = 'pmd-dropdown-divider';
  menu.appendChild(divider2);
  const exportHeading = document.createElement('div');
  exportHeading.className = 'pmd-dropdown-label';
  exportHeading.textContent = 'Editing & integration';
  menu.appendChild(exportHeading);

  const diff = makeSelect<DiffMode>('pmd-set-diff', 'Diff view', DIFF_CHOICES, (v) => {
    deps.setDiffMode(v).catch((e) => console.error('set_diff_mode failed:', e));
    deps.onDiffModeChange(v);
  });
  menu.appendChild(diff.row);

  const gist = makeToggle('pmd-set-gist', 'Gist export button', (checked) => {
    deps.setGistEnabled(checked).catch((e) => console.error('set_gist_enabled failed:', e));
    deps.onGistChange(checked);
  });
  menu.appendChild(gist.row);

  const handlerRow = document.createElement('div');
  handlerRow.className = 'pmd-settings-row pmd-settings-row-col';
  const handlerStatus = document.createElement('span');
  handlerStatus.className = 'pmd-settings-base';
  const handlerBtn = document.createElement('button');
  handlerBtn.className = 'pmd-btn pmd-btn-outline pmd-btn-sm';
  handlerBtn.type = 'button';
  handlerBtn.textContent = 'Set as default markdown app';
  handlerBtn.addEventListener('click', async () => {
    try {
      await deps.setAsDefaultHandler();
      void refreshHandler();
    } catch (e) {
      handlerStatus.textContent = `Default app: ${String(e)}`;
    }
  });
  handlerRow.appendChild(handlerStatus);
  handlerRow.appendChild(handlerBtn);
  menu.appendChild(handlerRow);

  const fontRow = document.createElement('div');
  fontRow.className = 'pmd-settings-row';
  const fontLabel = document.createElement('label');
  fontLabel.className = 'pmd-settings-label';
  fontLabel.htmlFor = 'pmd-set-font';
  fontLabel.textContent = 'Editor font';
  const fontInput = document.createElement('input');
  fontInput.type = 'text';
  fontInput.id = 'pmd-set-font';
  fontInput.className = 'pmd-input pmd-settings-font';
  fontInput.placeholder = 'JetBrains Mono';
  fontInput.title = 'A monospace font family installed on your system (e.g. a Nerd Font)';
  fontInput.addEventListener('change', () => {
    const v = fontInput.value.trim() || null;
    deps.setMonoFont(v).catch((e) => console.error('set_mono_font failed:', e));
    deps.onMonoFontChange(v);
  });
  fontRow.appendChild(fontLabel);
  fontRow.appendChild(fontInput);
  menu.appendChild(fontRow);

  wrapper.appendChild(btn);
  wrapper.appendChild(menu);
  toolbar.appendChild(wrapper);

  async function refreshHandler(): Promise<void> {
    try {
      const status = await deps.getDefaultHandlerStatus();
      handlerStatus.textContent =
        status === 'default'
          ? 'Default markdown app: yes'
          : status === 'not_default'
            ? 'Default markdown app: no'
            : 'Default markdown app: unknown';
      handlerBtn.disabled = status === 'default';
    } catch {
      handlerStatus.textContent = 'Default markdown app: unknown';
    }
  }

  async function refresh(): Promise<void> {
    try {
      const s = await deps.getSettings();
      autosave.select.value = s.autosave_mode;
      autoreload.select.value = s.autoreload_mode;
      merge.select.value = s.merge_strategy;
      basePath.textContent = s.browser_base_dir ?? '(none)';
      basePath.title = s.browser_base_dir ?? '';
      diff.select.value = s.diff_mode;
      gist.input.checked = s.gist_enabled;
      fontInput.value = s.mono_font ?? '';
    } catch (e) {
      console.error('getSettings failed:', e);
    }
    void refreshHandler();
  }

  function close(): void {
    menu.style.display = 'none';
  }
  async function open(): Promise<void> {
    await refresh();
    menu.style.display = 'block';
    btn.focus();
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const hidden = menu.style.display === 'none';
    if (hidden) {
      void open();
    } else {
      close();
    }
  });
  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target as Node)) close();
  });

  return { el: wrapper, refresh, open, close };
}
