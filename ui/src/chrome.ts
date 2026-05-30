import type { Mode } from './doc_state.js';
export type { Mode };

export interface ChromeState {
  mode: Mode;
  filename: string | null;
  modified: boolean;
}

export interface ChromeInstance {
  el: HTMLElement;
  setMode: (mode: Mode) => void;
  setFilename: (filename: string | null) => void;
  setModified: (modified: boolean) => void;
  setStatus: (text: string) => void;
  setRecentFiles: (files: string[]) => void;
  onModeChange: (handler: (mode: Mode) => void) => void;
  onRecentFileSelect: (handler: (path: string) => void) => void;
  onThemePickerClick: (handler: () => void) => void;
  onClearRecentFiles: (handler: () => void) => void;
  setReloadVisible: (visible: boolean) => void;
  onReloadClick: (handler: () => void) => void;
  setSaveEnabled: (enabled: boolean) => void;
  onSaveClick: (handler: () => void) => void;
  setMergeVisible: (visible: boolean) => void;
  onMergeClick: (handler: () => void) => void;
  destroy: () => void;
}

export function createChrome(parent: HTMLElement): ChromeInstance {
  const container = document.createElement('div');
  container.className = 'pmd-chrome';

  const toolbar = document.createElement('div');
  toolbar.className = 'pmd-toolbar';

  const fileMenuWrapper = document.createElement('div');
  fileMenuWrapper.className = 'pmd-dropdown';

  const fileMenuBtn = document.createElement('button');
  fileMenuBtn.className = 'pmd-btn pmd-btn-ghost pmd-btn-sm';
  fileMenuBtn.textContent = 'File';
  fileMenuBtn.type = 'button';

  const fileDropdown = document.createElement('ul');
  fileDropdown.className = 'pmd-dropdown-menu';
  fileDropdown.setAttribute('role', 'menu');
  fileDropdown.style.display = 'none';

  fileMenuWrapper.appendChild(fileMenuBtn);
  fileMenuWrapper.appendChild(fileDropdown);

  const titleSection = document.createElement('div');
  titleSection.className = 'pmd-title-section';

  const modifiedDot = document.createElement('span');
  modifiedDot.className = 'pmd-modified-dot';
  modifiedDot.setAttribute('aria-hidden', 'true');
  modifiedDot.textContent = '●';

  const filenameEl = document.createElement('span');
  filenameEl.className = 'pmd-filename pmd-truncate';

  titleSection.appendChild(modifiedDot);
  titleSection.appendChild(filenameEl);

  const modeGroup = document.createElement('div');
  modeGroup.className = 'pmd-segmented';
  modeGroup.setAttribute('role', 'tablist');

  const modes: { id: Mode; label: string; icon: string }[] = [
    { id: 'source', label: 'Source', icon: '⎔' },
    { id: 'split', label: 'Split', icon: '◫' },
    { id: 'preview', label: 'Preview', icon: '◉' },
  ];

  const modeButtons: HTMLButtonElement[] = modes.map(({ id, label }) => {
    const btn = document.createElement('button');
    btn.className = 'pmd-segmented-btn';
    btn.textContent = label;
    btn.dataset.mode = id;
    btn.type = 'button';
    btn.title = `Switch to ${label} mode (Ctrl+\\)`;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', 'false');
    modeGroup.appendChild(btn);
    return btn;
  });

  toolbar.appendChild(fileMenuWrapper);
  toolbar.appendChild(titleSection);
  toolbar.appendChild(modeGroup);

  const toolbarSpacer = document.createElement('div');
  toolbarSpacer.className = 'pmd-toolbar-spacer';
  toolbar.appendChild(toolbarSpacer);

  // Save button: always present, disabled unless the lifecycle state has
  // something writable (dirty / untitled / conflict / removed).
  const saveBtn = document.createElement('button');
  saveBtn.className = 'pmd-btn pmd-btn-primary pmd-btn-sm pmd-save-btn';
  saveBtn.textContent = 'Save';
  saveBtn.type = 'button';
  saveBtn.title = 'Save (Ctrl+S)';
  saveBtn.disabled = true;
  toolbar.appendChild(saveBtn);

  // Merge button: animated in (see CSS) on a real disk-vs-memory conflict.
  const mergeBtn = document.createElement('button');
  mergeBtn.className = 'pmd-btn pmd-btn-ghost pmd-btn-sm pmd-merge-btn';
  mergeBtn.textContent = 'Merge';
  mergeBtn.type = 'button';
  mergeBtn.title = 'Merge the on-disk changes into the editor (does not save)';
  toolbar.appendChild(mergeBtn);

  // Reload button: hidden by default, animated in (see CSS) when the active
  // file changes on disk while the buffer is modified. Sits to the LEFT of
  // the Theme button.
  const reloadBtn = document.createElement('button');
  reloadBtn.className = 'pmd-btn pmd-btn-ghost pmd-btn-sm pmd-reload-btn';
  reloadBtn.textContent = 'Reload';
  reloadBtn.type = 'button';
  reloadBtn.title = 'File changed on disk — reload';
  toolbar.appendChild(reloadBtn);

  const themeBtn = document.createElement('button');
  themeBtn.className = 'pmd-btn pmd-btn-ghost pmd-btn-sm';
  themeBtn.textContent = 'Theme';
  themeBtn.type = 'button';
  themeBtn.title = 'Change theme (Ctrl+T)';
  toolbar.appendChild(themeBtn);

  container.appendChild(toolbar);
  parent.appendChild(container);

  const statusBar = document.createElement('div');
  statusBar.className = 'pmd-status-bar';
  statusBar.setAttribute('role', 'status');

  const statusText = document.createElement('span');
  statusText.className = 'pmd-status-item pmd-status-text';
  statusBar.appendChild(statusText);

  const statusModeText = document.createElement('span');
  statusModeText.className = 'pmd-status-item pmd-status-mode';
  statusBar.appendChild(statusModeText);

  parent.appendChild(statusBar);

  let currentMode: Mode = 'split';
  const modeHandlers: ((mode: Mode) => void)[] = [];

  function closeDropdown() {
    fileDropdown.style.display = 'none';
  }

  function toggleDropdown() {
    const isHidden = fileDropdown.style.display === 'none';
    fileDropdown.style.display = isHidden ? 'block' : 'none';
  }

  const handleDocumentClick = (e: MouseEvent) => {
    if (!fileMenuWrapper.contains(e.target as Node)) {
      closeDropdown();
    }
  };
  document.addEventListener('click', handleDocumentClick);

  fileMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown();
  });

  let recentFileHandlers: ((path: string) => void)[] = [];
  let clearHandlers: (() => void)[] = [];

  function setMode(mode: Mode) {
    currentMode = mode;
    document.body.dataset.mode = mode;
    modeButtons.forEach((btn) => {
      const isActive = btn.dataset.mode === mode;
      btn.classList.toggle('data-active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    });
    statusModeText.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
  }

  function handleModeClick(e: Event) {
    const btn = (e.target as HTMLElement).closest('.pmd-segmented-btn');
    if (!btn) return;
    const mode = btn.dataset.mode as Mode;
    setMode(mode);
    modeHandlers.forEach((h) => h(mode));
    document.body.dispatchEvent(new CustomEvent('mode-change', { detail: { mode } }));
  }

  modeGroup.addEventListener('click', handleModeClick);

  themeBtn.addEventListener('click', () => {
    themePickerHandlers.forEach((h) => h());
  });

  reloadBtn.addEventListener('click', () => {
    reloadHandlers.forEach((h) => h());
  });

  saveBtn.addEventListener('click', () => {
    saveHandlers.forEach((h) => h());
  });

  mergeBtn.addEventListener('click', () => {
    mergeHandlers.forEach((h) => h());
  });

  setMode(currentMode);

  let themePickerHandlers: (() => void)[] = [];
  let reloadHandlers: (() => void)[] = [];
  let saveHandlers: (() => void)[] = [];
  let mergeHandlers: (() => void)[] = [];

  return {
    el: container,
    setMode,
    setFilename: (filename: string | null) => {
      filenameEl.textContent = filename || '';
      filenameEl.title = filename || '';
    },
    setModified: (modified: boolean) => {
      modifiedDot.toggleAttribute('data-modified', modified);
    },
    setStatus: (text: string) => {
      statusText.textContent = text;
    },
    setRecentFiles: (files: string[]) => {
      fileDropdown.innerHTML = '';
      if (files.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'pmd-dropdown-item';
        empty.style.opacity = '0.5';
        empty.style.cursor = 'default';
        empty.textContent = 'No recent files';
        fileDropdown.appendChild(empty);
      } else {
        files.forEach((file) => {
          const item = document.createElement('li');
          item.className = 'pmd-dropdown-item';
          item.setAttribute('role', 'menuitem');
          item.textContent = file.split('/').pop() || file;
          item.title = file;
          item.addEventListener('click', () => {
            closeDropdown();
            recentFileHandlers.forEach((h) => h(file));
          });
          fileDropdown.appendChild(item);
        });

        const divider = document.createElement('li');
        divider.className = 'pmd-dropdown-divider';
        divider.setAttribute('role', 'separator');
        fileDropdown.appendChild(divider);

        const clearItem = document.createElement('li');
        clearItem.className = 'pmd-dropdown-item';
        clearItem.setAttribute('role', 'menuitem');
        clearItem.textContent = 'Clear Recent Files';
        clearItem.addEventListener('click', () => {
          closeDropdown();
          clearHandlers.forEach((h) => h());
        });
        fileDropdown.appendChild(clearItem);
      }
    },
    onModeChange: (handler: (mode: Mode) => void) => {
      modeHandlers.push(handler);
    },
    onRecentFileSelect: (handler: (path: string) => void) => {
      recentFileHandlers.push(handler);
    },
    onThemePickerClick: (handler: () => void) => {
      themePickerHandlers.push(handler);
    },
    onClearRecentFiles: (handler: () => void) => {
      clearHandlers.push(handler);
    },
    setReloadVisible: (visible: boolean) => {
      reloadBtn.toggleAttribute('data-visible', visible);
    },
    onReloadClick: (handler: () => void) => {
      reloadHandlers.push(handler);
    },
    setSaveEnabled: (enabled: boolean) => {
      saveBtn.disabled = !enabled;
    },
    onSaveClick: (handler: () => void) => {
      saveHandlers.push(handler);
    },
    setMergeVisible: (visible: boolean) => {
      mergeBtn.toggleAttribute('data-visible', visible);
    },
    onMergeClick: (handler: () => void) => {
      mergeHandlers.push(handler);
    },
    destroy: () => {
      document.removeEventListener('click', handleDocumentClick);
      container.remove();
      statusBar.remove();
    },
  };
}
