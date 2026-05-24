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
  onModeChange: (handler: (mode: Mode) => void) => void;
  onThemePickerClick: (handler: () => void) => void;
  destroy: () => void;
}

export function createChrome(parent: HTMLElement): ChromeInstance {
  const container = document.createElement('div');
  container.className = 'pmd-chrome';

  const toolbar = document.createElement('div');
  toolbar.className = 'pmd-toolbar';

  const titleSection = document.createElement('div');
  titleSection.className = 'pmd-title-section';

  const modifiedDot = document.createElement('span');
  modifiedDot.className = 'pmd-modified-dot';
  modifiedDot.textContent = '●';
  modifiedDot.hidden = true;

  const filenameEl = document.createElement('span');
  filenameEl.className = 'pmd-filename';
  filenameEl.textContent = '';

  titleSection.appendChild(modifiedDot);
  titleSection.appendChild(filenameEl);

  const fileMenuBtn = document.createElement('button');
  fileMenuBtn.className = 'pmd-file-menu-btn';
  fileMenuBtn.textContent = 'File';
  fileMenuBtn.type = 'button';

  const fileDropdown = document.createElement('div');
  fileDropdown.className = 'pmd-file-dropdown';
  fileDropdown.hidden = true;

  const recentHeader = document.createElement('div');
  recentHeader.className = 'pmd-dropdown-header';
  recentHeader.textContent = 'Recent Files';
  fileDropdown.appendChild(recentHeader);

  const recentList = document.createElement('div');
  recentList.className = 'pmd-recent-list';
  fileDropdown.appendChild(recentList);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'pmd-dropdown-clear';
  clearBtn.textContent = 'Clear Recent Files';
  clearBtn.type = 'button';
  fileDropdown.appendChild(clearBtn);

  document.addEventListener('click', (e) => {
    if (!fileMenuBtn.contains(e.target as Node) && !fileDropdown.contains(e.target as Node)) {
      fileDropdown.hidden = true;
    }
  });

  fileMenuBtn.addEventListener('click', () => {
    fileDropdown.hidden = !fileDropdown.hidden;
  });

  let recentFileHandlers: ((path: string) => void)[] = [];
  let clearHandlers: (() => void)[] = [];

  clearBtn.addEventListener('click', () => {
    clearHandlers.forEach((h) => h());
    fileDropdown.hidden = true;
  });

  const modeGroup = document.createElement('div');
  modeGroup.className = 'pmd-mode-group';

  const modes: { id: Mode; label: string }[] = [
    { id: 'source', label: 'Source' },
    { id: 'split', label: 'Split' },
    { id: 'preview', label: 'Preview' },
  ];

  const modeButtons: HTMLButtonElement[] = modes.map(({ id, label }) => {
    const btn = document.createElement('button');
    btn.className = `pmd-mode-btn pmd-mode-btn--${id}`;
    btn.textContent = label;
    btn.dataset.mode = id;
    btn.type = 'button';
    modeGroup.appendChild(btn);
    return btn;
  });

  toolbar.appendChild(fileMenuBtn);
  toolbar.appendChild(fileDropdown);
  toolbar.appendChild(titleSection);
  toolbar.appendChild(modeGroup);

  const statusBar = document.createElement('div');
  statusBar.className = 'pmd-status-bar';
  const statusText = document.createElement('span');
  statusText.className = 'pmd-status-text';
  statusBar.appendChild(statusText);

  container.appendChild(toolbar);
  container.appendChild(statusBar);
  parent.appendChild(container);

  let currentMode: Mode = 'split';
  const modeHandlers: ((mode: Mode) => void)[] = [];

  function setMode(mode: Mode) {
    currentMode = mode;
    document.body.dataset.mode = mode;
    modeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
  }

  function handleModeClick(e: Event) {
    const btn = (e.target as HTMLElement).closest('.pmd-mode-btn');
    if (!btn) return;
    const mode = btn.dataset.mode as Mode;
    setMode(mode);
    modeHandlers.forEach((h) => h(mode));
    document.body.dispatchEvent(new CustomEvent('mode-change', { detail: { mode } }));
  }

  modeGroup.addEventListener('click', handleModeClick);

  setMode(currentMode);

  return {
    el: container,
    setMode,
    setFilename: (filename: string | null) => {
      filenameEl.textContent = filename || '';
    },
    setModified: (modified: boolean) => {
      modifiedDot.hidden = !modified;
    },
    setStatus: (text: string) => {
      statusText.textContent = text;
    },
    setRecentFiles: (files: string[]) => {
      recentList.innerHTML = '';
      if (files.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'pmd-recent-empty';
        empty.textContent = 'No recent files';
        recentList.appendChild(empty);
      } else {
        files.forEach((file) => {
          const item = document.createElement('button');
          item.className = 'pmd-recent-item';
          item.type = 'button';
          const name = file.split('/').pop() || file;
          item.textContent = name;
          item.title = file;
          item.addEventListener('click', () => {
            recentFileHandlers.forEach((h) => h(file));
            fileDropdown.hidden = true;
          });
          recentList.appendChild(item);
        });
      }
    },
    onModeChange: (handler: (mode: Mode) => void) => {
      modeHandlers.push(handler);
    },
    onRecentFileSelect: (handler: (path: string) => void) => {
      recentFileHandlers.push(handler);
    },
    destroy: () => {
      container.remove();
    },
  };
}
