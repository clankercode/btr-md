import type { Mode } from './doc_state.js';
import type { Counts } from './counts.js';
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
  setCounts: (counts: Counts | null) => void;
  onCountsClick: (handler: () => void) => void;
  onFrontmatterClick: (handler: () => void) => void;
  setFrontmatterState: (state: { present: boolean; malformed: boolean }) => void;
  setRecentFiles: (files: string[]) => void;
  setFileOpsEnabled: (enabled: boolean) => void;
  focusMenu: () => void;
  onCopyPath: (handler: () => void) => void;
  onCopyFilename: (handler: () => void) => void;
  onCopyUrl: (handler: () => void) => void;
  onRevealInFolder: (handler: () => void) => void;
  onOpenInApp: (handler: () => void) => void;
  onExportPdf: (handler: () => void) => void;
  onExportHtml: (handler: () => void) => void;
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
  toolbar.setAttribute('role', 'menubar');
  toolbar.tabIndex = -1;

  const fileMenuWrapper = document.createElement('div');
  fileMenuWrapper.className = 'pmd-dropdown';

  const fileMenuBtn = document.createElement('button');
  fileMenuBtn.className = 'pmd-btn pmd-btn-ghost pmd-btn-sm';
  fileMenuBtn.textContent = 'File';
  fileMenuBtn.type = 'button';
  fileMenuBtn.setAttribute('role', 'menuitem');

  const fileDropdown = document.createElement('div');
  fileDropdown.className = 'pmd-dropdown-menu';
  fileDropdown.setAttribute('role', 'menu');
  fileDropdown.style.display = 'none';

  // Fixed quick-file-ops section (persists across recents rebuilds), then a
  // recents section that `setRecentFiles` rebuilds independently.
  const fileOpsList = document.createElement('ul');
  fileOpsList.className = 'pmd-file-ops';
  const recentsLabel = document.createElement('div');
  recentsLabel.className = 'pmd-dropdown-label';
  recentsLabel.textContent = 'Recent files';
  const recentsList = document.createElement('ul');
  recentsList.className = 'pmd-recents-list';
  fileDropdown.appendChild(fileOpsList);
  fileDropdown.appendChild(recentsLabel);
  fileDropdown.appendChild(recentsList);

  fileMenuWrapper.appendChild(fileMenuBtn);
  fileMenuWrapper.appendChild(fileDropdown);

  // Quick file ops (disabled when there is no file path).
  const fileOpHandlers: Record<string, (() => void)[]> = {
    copyPath: [],
    copyFilename: [],
    copyUrl: [],
    reveal: [],
    openApp: [],
  };
  const fileOpItems: HTMLLIElement[] = [];
  const addFileOp = (key: string, label: string) => {
    const li = document.createElement('li');
    li.className = 'pmd-dropdown-item';
    li.setAttribute('role', 'menuitem');
    li.textContent = label;
    li.addEventListener('click', () => {
      if (li.hasAttribute('data-disabled')) return;
      closeDropdown();
      fileOpHandlers[key].forEach((h) => h());
    });
    fileOpsList.appendChild(li);
    fileOpItems.push(li);
  };
  addFileOp('copyPath', 'Copy path');
  addFileOp('copyFilename', 'Copy filename');
  addFileOp('copyUrl', 'Copy file:// URL');
  addFileOp('reveal', 'Reveal in folder');
  addFileOp('openApp', 'Open in default app');

  // Export section: divider then PDF / HTML. Always enabled (export operates on
  // the rendered document, which exists even for an unsaved buffer).
  const exportDivider = document.createElement('li');
  exportDivider.className = 'pmd-dropdown-divider';
  exportDivider.setAttribute('role', 'separator');
  fileOpsList.appendChild(exportDivider);

  const exportHandlers: Record<string, (() => void)[]> = { pdf: [], html: [] };
  const addExportItem = (key: string, label: string) => {
    const li = document.createElement('li');
    li.className = 'pmd-dropdown-item';
    li.setAttribute('role', 'menuitem');
    li.textContent = label;
    li.addEventListener('click', () => {
      closeDropdown();
      exportHandlers[key].forEach((h) => h());
    });
    fileOpsList.appendChild(li);
  };
  addExportItem('pdf', 'Export to PDF…');
  addExportItem('html', 'Export to HTML…');

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

  // Sliding active-indicator thumb (shadcn style). Positioned/sized to the
  // active button in `setMode`; the active background lives here, not on the
  // button, so it animates between options.
  const modeThumb = document.createElement('div');
  modeThumb.className = 'pmd-segmented-thumb';
  modeThumb.setAttribute('aria-hidden', 'true');
  modeGroup.appendChild(modeThumb);

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
  saveBtn.setAttribute('aria-label', 'Write document');
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

  const statusCounts = document.createElement('button');
  statusCounts.type = 'button';
  statusCounts.className = 'pmd-status-item pmd-status-counts';
  statusCounts.setAttribute('aria-label', 'Document statistics');
  statusBar.appendChild(statusCounts);

  const statusFrontmatter = document.createElement('button');
  statusFrontmatter.type = 'button';
  statusFrontmatter.className = 'pmd-status-item pmd-status-frontmatter';
  statusFrontmatter.setAttribute('aria-label', 'Frontmatter');
  statusFrontmatter.textContent = '+ frontmatter';
  statusBar.appendChild(statusFrontmatter);

  // Render-profile indicator: purely informational, static label noting that
  // btr.md renders with a GitHub-flavored (GFM) profile. See docs/github-parity.md
  // for the known, intentional differences from GitHub.
  const statusProfile = document.createElement('span');
  statusProfile.className = 'pmd-status-item pmd-status-profile';
  statusProfile.textContent = 'GitHub-flavored';
  statusProfile.title =
    'Render profile: GitHub-flavored Markdown (GFM). Raw HTML is sanitized and remote images blocked — see docs/github-parity.md.';
  statusProfile.setAttribute('aria-label', 'Render profile: GitHub-flavored Markdown (GFM)');
  statusBar.appendChild(statusProfile);

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

  function positionThumb(): void {
    const active = modeButtons.find((b) => b.dataset.mode === currentMode);
    if (active && active.offsetWidth > 0) {
      modeThumb.style.transform = `translateX(${active.offsetLeft}px)`;
      modeThumb.style.width = `${active.offsetWidth}px`;
      modeThumb.style.opacity = '1';
    }
  }

  function setMode(mode: Mode) {
    currentMode = mode;
    document.body.dataset.mode = mode;
    modeButtons.forEach((btn) => {
      const isActive = btn.dataset.mode === mode;
      btn.classList.toggle('data-active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    });
    statusModeText.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
    positionThumb();
    // Re-measure after layout settles (initial call runs before the toolbar
    // is attached/visible, when offsetWidth is still 0).
    requestAnimationFrame(positionThumb);
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

  statusCounts.addEventListener('click', () => {
    countsClickHandlers.forEach((h) => h());
  });

  statusFrontmatter.addEventListener('click', () => {
    frontmatterClickHandlers.forEach((h) => h());
  });

  setMode(currentMode);

  let themePickerHandlers: (() => void)[] = [];
  let reloadHandlers: (() => void)[] = [];
  let saveHandlers: (() => void)[] = [];
  let mergeHandlers: (() => void)[] = [];
  let countsClickHandlers: (() => void)[] = [];
  let frontmatterClickHandlers: (() => void)[] = [];

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
    setCounts: (counts: Counts | null) => {
      if (!counts) {
        statusCounts.textContent = '';
        return;
      }
      const n = (x: number) => x.toLocaleString();
      statusCounts.textContent =
        `${n(counts.words)} words · ${n(counts.bytes)} B · ` +
        `${n(counts.sentences)} sent · ${n(counts.paragraphs)} ¶ · ${n(counts.sections)} §`;
    },
    onCountsClick: (handler: () => void) => {
      countsClickHandlers.push(handler);
    },
    onFrontmatterClick: (handler: () => void) => {
      frontmatterClickHandlers.push(handler);
    },
    setFrontmatterState: (state: { present: boolean; malformed: boolean }) => {
      statusFrontmatter.textContent = state.present ? 'frontmatter' : '+ frontmatter';
      statusFrontmatter.classList.toggle('pmd-status-frontmatter-present', state.present);
      statusFrontmatter.classList.toggle('pmd-status-frontmatter-malformed', state.malformed);
    },
    setRecentFiles: (files: string[]) => {
      recentsList.innerHTML = '';
      if (files.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'pmd-dropdown-item';
        empty.style.opacity = '0.5';
        empty.style.cursor = 'default';
        empty.textContent = 'No recent files';
        recentsList.appendChild(empty);
        return;
      }
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
        recentsList.appendChild(item);
      });

      const divider = document.createElement('li');
      divider.className = 'pmd-dropdown-divider';
      divider.setAttribute('role', 'separator');
      recentsList.appendChild(divider);

      const clearItem = document.createElement('li');
      clearItem.className = 'pmd-dropdown-item';
      clearItem.setAttribute('role', 'menuitem');
      clearItem.textContent = 'Clear Recent Files';
      clearItem.addEventListener('click', () => {
        closeDropdown();
        clearHandlers.forEach((h) => h());
      });
      recentsList.appendChild(clearItem);
    },
    setFileOpsEnabled: (enabled: boolean) => {
      fileOpItems.forEach((li) => li.toggleAttribute('data-disabled', !enabled));
    },
    focusMenu: () => {
      fileDropdown.style.display = 'block';
      fileMenuBtn.focus();
    },
    onCopyPath: (handler: () => void) => {
      fileOpHandlers.copyPath.push(handler);
    },
    onCopyFilename: (handler: () => void) => {
      fileOpHandlers.copyFilename.push(handler);
    },
    onCopyUrl: (handler: () => void) => {
      fileOpHandlers.copyUrl.push(handler);
    },
    onRevealInFolder: (handler: () => void) => {
      fileOpHandlers.reveal.push(handler);
    },
    onOpenInApp: (handler: () => void) => {
      fileOpHandlers.openApp.push(handler);
    },
    onExportPdf: (handler: () => void) => {
      exportHandlers.pdf.push(handler);
    },
    onExportHtml: (handler: () => void) => {
      exportHandlers.html.push(handler);
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
