// The settings dropdown menu. Self-contained: it appends its own trigger button
// into the toolbar and manages a dropdown (mirroring the File-menu pattern), so
// it does not require editing chrome.ts. Each control calls its backend setter.
//
// Phase 3 hosts the lifecycle policies (autosave / autoreload / merge) + the
// file-browser base dir. It is structured so later phases (diff mode, gist,
// fonts, default-handler) can add sections without restructuring.

import type { AutoreloadMode, AutosaveMode, MergeStrategy } from './doc_state.js';

export interface SettingsSnapshot {
  autosave_mode: AutosaveMode;
  autoreload_mode: AutoreloadMode;
  merge_strategy: MergeStrategy;
  browser_base_dir: string | null;
}

export interface SettingsMenuDeps {
  getSettings: () => Promise<SettingsSnapshot>;
  setAutosaveMode: (m: AutosaveMode) => Promise<void>;
  setAutoreloadMode: (m: AutoreloadMode) => Promise<void>;
  setMergeStrategy: (m: MergeStrategy) => Promise<void>;
  pickBaseDir: () => Promise<string | null>;
  onAutosaveChange: (m: AutosaveMode) => void;
  onAutoreloadChange: (m: AutoreloadMode) => void;
  onBaseDirChange: (dir: string) => void;
}

export interface SettingsMenuInstance {
  el: HTMLElement;
  refresh: () => Promise<void>;
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

  wrapper.appendChild(btn);
  wrapper.appendChild(menu);
  toolbar.appendChild(wrapper);

  async function refresh(): Promise<void> {
    try {
      const s = await deps.getSettings();
      autosave.select.value = s.autosave_mode;
      autoreload.select.value = s.autoreload_mode;
      merge.select.value = s.merge_strategy;
      basePath.textContent = s.browser_base_dir ?? '(none)';
      basePath.title = s.browser_base_dir ?? '';
    } catch (e) {
      console.error('getSettings failed:', e);
    }
  }

  function close(): void {
    menu.style.display = 'none';
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const hidden = menu.style.display === 'none';
    if (hidden) {
      refresh();
      menu.style.display = 'block';
    } else {
      close();
    }
  });
  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target as Node)) close();
  });

  return { el: wrapper, refresh };
}
