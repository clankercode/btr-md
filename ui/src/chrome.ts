import type { Mode } from './doc_state.js';
import type { Counts } from './counts.js';
export type { Mode };

/**
 * Abbreviate a file path by shortening each directory component to its first
 * character, except for dot-prefixed dirs (like `.worktrees`) which get the
 * first two characters. The filename itself is always shown in full.
 *
 * Examples:
 *   ~/src/preview-md/.worktrees/feature/foo.md → ~/s/p/.wo/f/foo.md
 *   /home/user/documents/report.md → /h/u/d/report.md
 */
export function abbreviatePath(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  if (lastSlash < 0) return path;
  const dir = path.slice(0, lastSlash);
  const file = path.slice(lastSlash + 1);
  const parts = dir.split('/');
  const abbreviated = parts.map((part) => {
    if (!part) return '';
    // Dot-prefixed dirs: keep first two chars (e.g. .w for .worktrees).
    if (part.startsWith('.')) return part.slice(0, 2);
    return part[0];
  });
  return abbreviated.join('/') + '/' + file;
}

export interface ChromeState {
  mode: Mode;
  filename: string | null;
  modified: boolean;
}

export interface ClosedWindowSummary {
  tabs: string[];
  browserTab: boolean;
}

export interface ChromeInstance {
  el: HTMLElement;
  setMode: (mode: Mode) => void;
  setFilename: (filename: string | null, tooltip?: string | null) => void;
  setModified: (modified: boolean) => void;
  setStatus: (text: string) => void;
  setCounts: (counts: Counts | null) => void;
  onCountsClick: (handler: () => void) => void;
  onFrontmatterClick: (handler: () => void) => void;
  setFrontmatterState: (state: { present: boolean; malformed: boolean }) => void;
  setRecentFiles: (files: string[]) => void;
  setFileOpsEnabled: (enabled: boolean) => void;
  focusMenu: () => void;
  onCloseWindow: (handler: () => void) => void;
  onCloseAllWindows: (handler: () => void) => void;
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
  setRecentlyClosedWindows: (windows: ClosedWindowSummary[]) => void;
  onReopenLastClosed: (handler: () => void) => void;
  onRestoreClosedWindow: (handler: (index: number) => void) => void;
  onClearRecentlyClosed: (handler: () => void) => void;
  onHistoryMenuOpen: (handler: () => void) => void;
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
  // Recent files live in a collapsible submenu (collapsed by default) so they
  // don't dominate the menu height; the list scrolls within the viewport-capped
  // dropdown when there are many entries.
  const recentsToggle = document.createElement('button');
  recentsToggle.type = 'button';
  recentsToggle.className = 'pmd-dropdown-item pmd-submenu-toggle';
  recentsToggle.setAttribute('role', 'menuitem');
  recentsToggle.setAttribute('aria-expanded', 'false');
  const recentsToggleLabel = document.createElement('span');
  recentsToggleLabel.textContent = 'Recent files';
  const recentsCaret = document.createElement('span');
  recentsCaret.className = 'pmd-submenu-caret';
  recentsCaret.setAttribute('aria-hidden', 'true');
  recentsCaret.textContent = '▸';
  recentsToggle.append(recentsToggleLabel, recentsCaret);

  const recentsList = document.createElement('ul');
  recentsList.className = 'pmd-recents-list pmd-submenu-list';

  const setRecentsOpen = (open: boolean): void => {
    recentsToggle.setAttribute('aria-expanded', String(open));
    recentsList.toggleAttribute('data-open', open);
    recentsCaret.textContent = open ? '▾' : '▸';
  };
  recentsToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    setRecentsOpen(!recentsList.hasAttribute('data-open'));
  });

  fileDropdown.appendChild(fileOpsList);
  fileDropdown.appendChild(recentsToggle);
  fileDropdown.appendChild(recentsList);

  fileMenuWrapper.appendChild(fileMenuBtn);
  fileMenuWrapper.appendChild(fileDropdown);

  // Window controls — separate from the path-based file ops so they stay
  // enabled even for unsaved buffers (no file path). "Close Window" closes the
  // current window; "Close All Windows" quits the app, preserving the whole
  // workspace for next launch.
  const closeWindowHandlers: (() => void)[] = [];
  const closeAllWindowsHandlers: (() => void)[] = [];
  const closeItem = document.createElement('li');
  closeItem.className = 'pmd-dropdown-item';
  closeItem.setAttribute('role', 'menuitem');
  closeItem.textContent = 'Close Window';
  closeItem.addEventListener('click', () => {
    closeDropdown();
    closeWindowHandlers.forEach((h) => h());
  });
  fileOpsList.appendChild(closeItem);

  const closeAllItem = document.createElement('li');
  closeAllItem.className = 'pmd-dropdown-item';
  closeAllItem.setAttribute('role', 'menuitem');
  closeAllItem.textContent = 'Close All Windows';
  closeAllItem.addEventListener('click', () => {
    closeDropdown();
    closeAllWindowsHandlers.forEach((h) => h());
  });
  fileOpsList.appendChild(closeAllItem);

  const closeDivider = document.createElement('li');
  closeDivider.className = 'pmd-dropdown-divider';
  closeDivider.setAttribute('role', 'separator');
  fileOpsList.appendChild(closeDivider);

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
  filenameEl.className = 'pmd-filename';

  const abbrevPathEl = document.createElement('span');
  abbrevPathEl.className = 'pmd-abbrev-path';

  titleSection.appendChild(modifiedDot);
  titleSection.appendChild(filenameEl);
  titleSection.appendChild(abbrevPathEl);

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

  // -------------------------------------------------------------------------
  // History menu: reopen last closed window + list of recently closed windows.
  // -------------------------------------------------------------------------
  const historyMenuWrapper = document.createElement('div');
  historyMenuWrapper.className = 'pmd-dropdown';

  const historyMenuBtn = document.createElement('button');
  historyMenuBtn.className = 'pmd-btn pmd-btn-ghost pmd-btn-sm';
  historyMenuBtn.textContent = 'History';
  historyMenuBtn.type = 'button';
  historyMenuBtn.setAttribute('role', 'menuitem');

  const historyDropdown = document.createElement('div');
  historyDropdown.className = 'pmd-dropdown-menu';
  historyDropdown.setAttribute('role', 'menu');
  historyDropdown.style.display = 'none';

  const reopenItem = document.createElement('li');
  reopenItem.className = 'pmd-dropdown-item';
  reopenItem.setAttribute('role', 'menuitem');
  reopenItem.textContent = 'Reopen Last Closed Window';
  reopenItem.title = 'Ctrl+Shift+T';
  const reopenHandlers: (() => void)[] = [];
  reopenItem.addEventListener('click', () => {
    closeHistoryDropdown();
    reopenHandlers.forEach((h) => h());
  });
  historyDropdown.appendChild(reopenItem);

  const historyDivider = document.createElement('li');
  historyDivider.className = 'pmd-dropdown-divider';
  historyDivider.setAttribute('role', 'separator');
  historyDropdown.appendChild(historyDivider);

  const historyList = document.createElement('div');
  historyList.className = 'pmd-history-list';
  historyDropdown.appendChild(historyList);

  const clearHistoryItem = document.createElement('li');
  clearHistoryItem.className = 'pmd-dropdown-item';
  clearHistoryItem.setAttribute('role', 'menuitem');
  clearHistoryItem.textContent = 'Clear Recently Closed';
  const clearHistoryHandlers: (() => void)[] = [];
  clearHistoryItem.addEventListener('click', () => {
    closeHistoryDropdown();
    clearHistoryHandlers.forEach((h) => h());
  });
  historyDropdown.appendChild(clearHistoryItem);

  historyMenuWrapper.appendChild(historyMenuBtn);
  historyMenuWrapper.appendChild(historyDropdown);
  toolbar.appendChild(historyMenuWrapper);

  let restoreClosedWindowHandlers: ((index: number) => void)[] = [];
  let historyMenuOpenHandlers: (() => void)[] = [];

  function closeHistoryDropdown() {
    historyDropdown.style.display = 'none';
  }

  function toggleHistoryDropdown() {
    const isHidden = historyDropdown.style.display === 'none';
    historyDropdown.style.display = isHidden ? 'block' : 'none';
  }

  historyMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    historyMenuOpenHandlers.forEach((h) => h());
    toggleHistoryDropdown();
  });

  function setRecentlyClosedWindows(windows: ClosedWindowSummary[]): void {
    historyList.innerHTML = '';
    reopenItem.classList.toggle('data-disabled', windows.length === 0);
    if (windows.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'pmd-dropdown-item';
      empty.style.opacity = '0.5';
      empty.style.cursor = 'default';
      empty.textContent = 'No recently closed windows';
      historyList.appendChild(empty);
      return;
    }
    windows.forEach((win, index) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'pmd-history-window';

      const header = document.createElement('div');
      header.className = 'pmd-history-window-header';

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'pmd-dropdown-item pmd-submenu-toggle pmd-history-toggle';
      toggle.setAttribute('role', 'menuitem');
      toggle.setAttribute('aria-expanded', 'false');
      const toggleLabel = document.createElement('span');
      const tabCount = win.tabs.length + (win.browserTab ? 1 : 0);
      toggleLabel.textContent = `Window (${tabCount} tab${tabCount === 1 ? '' : 's'})`;
      const caret = document.createElement('span');
      caret.className = 'pmd-submenu-caret';
      caret.setAttribute('aria-hidden', 'true');
      caret.textContent = '▸';
      toggle.append(toggleLabel, caret);

      const restoreBtn = document.createElement('button');
      restoreBtn.type = 'button';
      restoreBtn.className = 'pmd-btn pmd-btn-ghost pmd-btn-sm pmd-history-restore';
      restoreBtn.textContent = 'Restore';
      restoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeHistoryDropdown();
        restoreClosedWindowHandlers.forEach((h) => h(index));
      });

      header.append(toggle, restoreBtn);

      const tabsList = document.createElement('ul');
      tabsList.className = 'pmd-submenu-list pmd-history-tabs';
      win.tabs.forEach((tab) => {
        const li = document.createElement('li');
        li.className = 'pmd-dropdown-item';
        li.setAttribute('role', 'menuitem');
        li.textContent = tab;
        tabsList.appendChild(li);
      });
      if (win.browserTab) {
        const li = document.createElement('li');
        li.className = 'pmd-dropdown-item';
        li.setAttribute('role', 'menuitem');
        li.textContent = 'Files';
        tabsList.appendChild(li);
      }

      const setOpen = (open: boolean): void => {
        toggle.setAttribute('aria-expanded', String(open));
        tabsList.toggleAttribute('data-open', open);
        caret.textContent = open ? '▾' : '▸';
      };
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        setOpen(!tabsList.hasAttribute('data-open'));
      });

      wrapper.append(header, tabsList);
      historyList.appendChild(wrapper);
    });
  }

  setRecentlyClosedWindows([]);

  toolbar.appendChild(modeGroup);
  toolbar.appendChild(titleSection);

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
    setRecentsOpen(false);
  }

  function toggleDropdown() {
    const isHidden = fileDropdown.style.display === 'none';
    fileDropdown.style.display = isHidden ? 'block' : 'none';
  }

  const handleDocumentClick = (e: MouseEvent) => {
    if (!fileMenuWrapper.contains(e.target as Node)) {
      closeDropdown();
    }
    if (!historyMenuWrapper.contains(e.target as Node)) {
      closeHistoryDropdown();
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
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.pmd-segmented-btn');
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
    setFilename: (filename: string | null, tooltip?: string | null) => {
      filenameEl.textContent = filename || '';
      filenameEl.title = tooltip || filename || '';
      // Compute abbreviated path: ~/s/b/.w/f/f/filename.md
      if (tooltip) {
        abbrevPathEl.textContent = abbreviatePath(tooltip);
        abbrevPathEl.title = tooltip;
      } else {
        abbrevPathEl.textContent = '';
      }
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
    onCloseWindow: (handler: () => void) => {
      closeWindowHandlers.push(handler);
    },
    onCloseAllWindows: (handler: () => void) => {
      closeAllWindowsHandlers.push(handler);
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
    setRecentlyClosedWindows: (windows: ClosedWindowSummary[]) => {
      setRecentlyClosedWindows(windows);
    },
    onReopenLastClosed: (handler: () => void) => {
      reopenHandlers.push(handler);
    },
    onRestoreClosedWindow: (handler: (index: number) => void) => {
      restoreClosedWindowHandlers.push(handler);
    },
    onClearRecentlyClosed: (handler: () => void) => {
      clearHistoryHandlers.push(handler);
    },
    onHistoryMenuOpen: (handler: () => void) => {
      historyMenuOpenHandlers.push(handler);
    },
    destroy: () => {
      document.removeEventListener('click', handleDocumentClick);
      container.remove();
      statusBar.remove();
    },
  };
}
