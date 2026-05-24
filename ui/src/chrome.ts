export type Mode = 'source' | 'split' | 'preview';

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

  const themeBtn = document.createElement('button');
  themeBtn.className = 'pmd-btn pmd-btn-ghost pmd-btn-sm';
  themeBtn.textContent = 'Theme';
  themeBtn.type = 'button';
  themeBtn.title = 'Change theme (Ctrl+T)';
  toolbar.appendChild(themeBtn);

  const statusBar = document.createElement('div');
  statusBar.className = 'pmd-status-bar';
  const statusText = document.createElement('span');
  statusText.className = 'pmd-status-item';
  statusBar.appendChild(statusText);

  container.appendChild(toolbar);
  container.appendChild(statusBar);
  parent.appendChild(container);

  let currentMode: Mode = 'split';
  const modeHandlers: ((mode: Mode) => void)[] = [];

  function closeDropdown() {
    fileDropdown.style.display = 'none';
  }

  function toggleDropdown() {
    const isHidden = fileDropdown.style.display === 'none';
    fileDropdown.style.display = isHidden ? 'block' : 'none';
  }

  document.addEventListener('click', (e) => {
    if (!fileMenuWrapper.contains(e.target as Node)) {
      closeDropdown();
    }
  });

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

  setMode(currentMode);

  let themePickerHandlers: (() => void)[] = [];

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
    destroy: () => {
      container.remove();
    },
  };
}
