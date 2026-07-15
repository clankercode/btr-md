import { type Settings, type OpenedDoc } from './backend/commands.js';
import * as filesApi from './backend/files.js';
import * as settingsApi from './backend/settings.js';
import * as themeApi from './backend/theme.js';
import * as docsApi from './backend/docs.js';
import * as windowsApi from './backend/windows.js';
import * as sessionApi from './backend/session.js';
import { linkActivationInvoke } from './backend/links.js';
import * as recentApi from './backend/recent.js';
import { subscribe } from './backend/events.js';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { mountEditor, type EditorHandle } from './editor.js';
import { detectDocumentKind } from './document_kind.js';
import { createChrome, type Mode, type ClosedWindowSummary } from './chrome.js';
import { attachScrollSync, type ScrollSyncHandle } from './scroll_sync.js';
import { attachScrollMirror, type ScrollMirrorHandle } from './scroll_mirror.js';
import { markAllNodes, rerenderForThemeChange } from './theme_apply.js';
import { renderMermaidNodes, setMermaidGotoLine, setMermaidTheme } from './mermaid_runner.js';
import { renderMathNodes } from './katex_runner.js';
import { decorateCodeBlocks } from './code_blocks.js';
import { openThemePicker, isPickerOpen, closeThemePicker, type ThemeInfo } from './picker.js';
import { debounce } from './debounce.js';
import {
  uiForState,
  assertNever,
  type FileState,
  type AutosaveMode,
  type AutoreloadMode,
  type DiffMode,
} from './doc_state.js';
import {
  shouldAutosaveOnDefocus,
  createDefocusSaveCoalescer,
  DEFOCUS_AUTOSAVE_DEBOUNCE_MS,
} from './autosave_defocus.js';
import { createTabStore, type DocTab } from './tabs.js';
import { createTabBar, type TabBarInstance } from './tabbar.js';
import { createFileBrowser, type FileBrowserInstance, type DirListing } from './file_browser.js';
import { createWorkspaceModel, parentOf, isUnder } from './workspace.js';
import { createSettingsMenu, type SettingsSnapshot, type HandlerStatus } from './settings_menu.js';
import { computeCounts } from './counts.js';
import { createInsertMenu, type AlertType, type InsertMenuInstance } from './insert_menu.js';
import { planFootnoteInsertion } from './footnotes.js';
import { insertAtCursor, dispatchInsert } from './editor_insert.js';
import { htmlContainsList } from './clipboard_paste.js';
import { decorateTables } from './table_copy.js';
import { installDragOverlay } from './drag_overlay.js';
import { type LoadedWindowSession } from './session.js';
import { createSessionManager } from './session_manager.js';
import { reconcileBlocks, ReconcileDesyncError, type BlockRef } from './block_reconcile.js';
import { createRenderCoordinator } from './render_coordinator.js';
import {
  createActionRegistry,
  defaultActionSpecs,
  type ActionId,
} from './actions.js';
import {
  installActionHotkeys,
  type ShortcutOverrides,
} from './keybindings.js';
import { createCommandOverlay } from './command_overlay.js';
import { createFindController } from './find_controller.js';
import { openFrontmatterPanel } from './frontmatter_panel.js';
import { openStatsPopover } from './stats_popover.js';
import {
  addEntryChange,
  editValueChange,
  hasOpeningFence,
  insertBlockChange,
  type FmChange,
} from './frontmatter_edit.js';
import { createShortcutEditor } from './shortcut_editor.js';
import {
  buildHtmlExportPayload,
  suggestedExportName,
  type HtmlExportPayload,
} from './export_document.js';
import {
  attachPreviewLinkActivation,
  createExternalConfirmationDialog,
  handleLinkActivationResponse,
  type OpenedDocumentFromLink,
} from './link_activation.js';
import { showConfirmCloseDialog } from './confirm_close_dialog.js';
import {
  type DocumentDiagnostics,
  type AssetGrant,
  type DocumentTrustContext,
  type FrontmatterFact,
  type HeadingFact,
  type RenderResult,
  type StructureCounts,
} from './document_contracts.js';
import { createDocumentFactsStore } from './document_facts_store.js';
import { createOutlinePanel } from './outline_panel.js';
import { deriveDiagnosticsPresentation, type DiagnosticsSettings } from './diagnostics.js';
import { createDiagnosticsPanel } from './diagnostics_panel.js';
import { renderInlineIssues } from './inline_issues.js';
import { deriveTrustStatus } from './resource_policy.js';
import { createTrustPolicyPanel } from './trust_policy_panel.js';
import {
  grantAssetFolderForBlockedImage,
  importImageAsset,
  listAssetGrants,
  pasteHtmlAsMarkdown,
  revokeAssetGrantForDocument,
} from './local_asset_grants.js';
import {
  buildImageMarkdown,
  classifyDroppedFile,
  clipboardImageName,
  isImageMime,
} from './image_embed.js';
import {
  forgetTrustRoot,
  grantRecommendedRoot,
  listTrustRoots,
  rememberDeclinedRoot,
} from './trust_roots.js';

declare global {
  interface Window {
    __pmdE2e?: boolean;
    __pmdE2eActions?: string[];
    __pmdOpenPathForTest?: (path: string) => Promise<void>;
  }
}

// ---------------------------------------------------------------------------
// Layout: editor/preview panes for document tabs + a separate body for
// empty/browser tabs. `body[data-tabkind]` toggles which is visible (CSS).
// ---------------------------------------------------------------------------

const previewPane = document.getElementById('preview-pane') as HTMLElement;
const previewContent = document.getElementById('pmd-content') as HTMLElement;
const externalConfirmation = createExternalConfirmationDialog();
const editorPane = document.createElement('div');
editorPane.id = 'editor-pane';
editorPane.className = 'pmd-editor-pane';

const splitResizer = document.createElement('div');
splitResizer.id = 'split-resizer';
splitResizer.className = 'pmd-split-resizer';
splitResizer.setAttribute('role', 'separator');
splitResizer.setAttribute('aria-orientation', 'vertical');
splitResizer.setAttribute('aria-label', 'Resize editor and preview panes');
splitResizer.setAttribute('aria-controls', 'editor-pane preview-pane');
splitResizer.setAttribute('aria-valuemin', '20');
splitResizer.setAttribute('aria-valuemax', '80');
splitResizer.tabIndex = 0;

const tabBodyEl = document.createElement('div');
tabBodyEl.id = 'pmd-tab-body';

const mainRegion = document.createElement('div');
mainRegion.id = 'main-region';
mainRegion.appendChild(editorPane);
mainRegion.appendChild(splitResizer);
mainRegion.appendChild(previewPane);
mainRegion.appendChild(tabBodyEl);

const appContainer = document.createElement('div');
appContainer.id = 'app-container';

const SIDEBAR_VISIBLE_KEY = 'pmd:sidebar:visible';
const SIDEBAR_WIDTH_KEY = 'pmd:sidebar:width';

const sidebarEl = document.createElement('div');
sidebarEl.id = 'pmd-sidebar';

const sidebarResizer = document.createElement('div');
sidebarResizer.id = 'sidebar-resizer';
sidebarResizer.className = 'pmd-split-resizer';
sidebarResizer.setAttribute('role', 'separator');
sidebarResizer.setAttribute('aria-orientation', 'vertical');
sidebarResizer.setAttribute('aria-label', 'Resize folder sidebar');
sidebarResizer.tabIndex = 0;

function applySidebarWidth(px: number): void {
  const clamped = Math.max(140, Math.min(px, 600));
  // Set on :root so viewport-fixed overlays (the trust pill) can offset by the
  // sidebar width too, not just the #app-container subtree.
  document.documentElement.style.setProperty('--pmd-sidebar-w', `${clamped}px`);
}
function applySidebarVisible(visible: boolean): void {
  document.body.dataset.sidebar = visible ? 'on' : 'off';
}

const savedWidth = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY) || '260');
applySidebarWidth(Number.isFinite(savedWidth) ? savedWidth : 260);
applySidebarVisible(localStorage.getItem(SIDEBAR_VISIBLE_KEY) !== '0');

let sidebarResizing = false;
sidebarResizer.addEventListener('pointerdown', (e) => {
  sidebarResizing = true;
  sidebarResizer.setPointerCapture(e.pointerId);
});
sidebarResizer.addEventListener('pointermove', (e) => {
  if (!sidebarResizing) return;
  const rect = appContainer.getBoundingClientRect();
  applySidebarWidth(e.clientX - rect.left);
});
const endSidebarResize = (e: PointerEvent) => {
  if (!sidebarResizing) return;
  sidebarResizing = false;
  try { sidebarResizer.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  const w = document.documentElement.style.getPropertyValue('--pmd-sidebar-w').replace('px', '');
  localStorage.setItem(SIDEBAR_WIDTH_KEY, w || '260');
};
sidebarResizer.addEventListener('pointerup', endSidebarResize);
sidebarResizer.addEventListener('pointercancel', endSidebarResize);

appContainer.appendChild(sidebarEl);
appContainer.appendChild(sidebarResizer);
appContainer.appendChild(mainRegion);
document.body.appendChild(appContainer);

const workspace = createWorkspaceModel({
  listDir: (dir) => filesApi.listDir(dir),
});

async function setWorkspaceRoot(path: string): Promise<boolean> {
  try {
    const canon = await filesApi.setWorkspaceRoot(path);
    await workspace.setRoot(canon);
    return true;
  } catch (e) {
    console.warn('set_workspace_root rejected:', e);
    return false;
  }
}

/**
 * Tab context-menu "Re-root to git": switch the sidebar base to the document's
 * git/worktree root when it is already listable (granted). Never widens grants;
 * on rejection, surface a clear status/console message.
 */
async function reRootWorkspaceToGit(gitRoot: string, filePath: string): Promise<void> {
  if (workspace.root() === gitRoot) {
    chrome.setStatus(`Workspace already at git root: ${gitRoot}`);
    await workspace.revealFile(filePath).catch(() => {});
    return;
  }
  const ok = await setWorkspaceRoot(gitRoot);
  if (ok) {
    chrome.setStatus(`Workspace root → ${gitRoot}`);
    await workspace.revealFile(filePath).catch(() => {});
    return;
  }
  const msg =
    `Cannot re-root to git root (not listable / not granted): ${gitRoot}. ` +
    'Open or grant that folder first (Settings → Choose base folder…).';
  console.warn(msg);
  chrome.setStatus(msg);
}

// Keep the workspace's active-file highlight mirroring the active document.
// When the document is under the current root, expand ancestors + select/scroll.
// When it is outside (or there is no root), re-root to the best listable base
// for that document (git worktree/repo → home → parent, intersected with path
// grants) so the file is reachable in the sidebar.
// Monotonic seq so rapid tab switches drop stale async re-root work.
let revealActiveSeq = 0;
async function revealActiveFile(filePath: string): Promise<void> {
  const seq = ++revealActiveSeq;
  const stillCurrent = () => seq === revealActiveSeq;

  const currentRoot = workspace.root();
  if (currentRoot && isUnder(currentRoot, filePath)) {
    if (!stillCurrent()) return;
    await workspace.revealFile(filePath);
    return;
  }

  // Outside current base (or cold start): ask the backend for a listable root.
  let resolved: string | null = null;
  try {
    resolved = await filesApi.resolveDocumentWorkspaceRoot(filePath);
  } catch (e) {
    console.warn('resolve_document_workspace_root failed:', e);
  }
  if (!stillCurrent()) return;

  if (resolved) {
    if (resolved !== workspace.root()) {
      const ok = await setWorkspaceRoot(resolved);
      if (!stillCurrent()) return;
      if (!ok) {
        // Grant race / rejection — try the document's parent as a last resort.
        const parent = parentOf(filePath);
        if (parent && parent !== workspace.root()) await setWorkspaceRoot(parent);
        if (!stillCurrent()) return;
      }
    }
  } else if (!workspace.root()) {
    const parent = parentOf(filePath);
    if (parent) await setWorkspaceRoot(parent);
    if (!stillCurrent()) return;
  } else {
    // Still outside the sticky root and no listable alternative: try parent so
    // an admitted sibling folder can become the base for this document.
    const parent = parentOf(filePath);
    if (parent && parent !== workspace.root()) await setWorkspaceRoot(parent);
    if (!stillCurrent()) return;
  }

  if (!stillCurrent()) return;
  await workspace.revealFile(filePath);
}

const browserDeps = {
  model: workspace,
  pickBaseDir: () => filesApi.pickBaseDir(),
  onOpenFile: (
    path: string,
    opts: { background: boolean; pinned?: boolean; replacePreview?: boolean },
  ) =>
    openFile(path, {
      background: opts.background,
      pinned: opts.pinned,
      replacePreview: opts.replacePreview,
    }),
  setRoot: setWorkspaceRoot,
  revealInFolder: (path: string) => {
    void filesApi.revealInFolder(path);
  },
  renameFile: (path: string, newName: string) =>
    filesApi.renamePath(path, newName),
};

const sidebarBrowser = createFileBrowser({ ...browserDeps, openOnSingleClick: true });
sidebarEl.appendChild(sidebarBrowser.el);

const SPLIT_RATIO_KEY = 'pmd:split-ratio';
const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;
const DEFAULT_RATIO = 0.4;

function clampRatio(r: number): number {
  return Math.max(MIN_RATIO, Math.min(MAX_RATIO, r));
}

function applySplitRatio(ratio: number): void {
  const clamped = clampRatio(ratio);
  mainRegion.style.setProperty('--pmd-split-ratio', String(clamped));
  splitResizer.setAttribute('aria-valuenow', String(Math.round(clamped * 100)));
}

const storedRatio = parseFloat(localStorage.getItem(SPLIT_RATIO_KEY) || '');
applySplitRatio(Number.isFinite(storedRatio) ? storedRatio : DEFAULT_RATIO);

let resizing = false;
splitResizer.addEventListener('pointerdown', (e) => {
  if (currentMode !== 'split') return;
  resizing = true;
  splitResizer.setPointerCapture(e.pointerId);
  document.body.classList.add('pmd-resizing');
  e.preventDefault();
});
splitResizer.addEventListener('pointermove', (e) => {
  if (!resizing) return;
  const rect = mainRegion.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;
  applySplitRatio(ratio);
});
function endResize(e: PointerEvent) {
  if (!resizing) return;
  resizing = false;
  splitResizer.releasePointerCapture(e.pointerId);
  document.body.classList.remove('pmd-resizing');
  const ratio = parseFloat(mainRegion.style.getPropertyValue('--pmd-split-ratio') || '0.5');
  localStorage.setItem(SPLIT_RATIO_KEY, String(ratio));
}
splitResizer.addEventListener('pointerup', endResize);
splitResizer.addEventListener('pointercancel', endResize);
splitResizer.addEventListener('dblclick', () => {
  applySplitRatio(DEFAULT_RATIO);
  localStorage.setItem(SPLIT_RATIO_KEY, String(DEFAULT_RATIO));
});
splitResizer.addEventListener('keydown', (e) => {
  if (currentMode !== 'split') return;
  const current = parseFloat(
    mainRegion.style.getPropertyValue('--pmd-split-ratio') || String(DEFAULT_RATIO)
  );
  let next = current;
  if (e.key === 'ArrowLeft') next = current - 0.02;
  else if (e.key === 'ArrowRight') next = current + 0.02;
  else if (e.key === 'Home') next = MIN_RATIO;
  else if (e.key === 'End') next = MAX_RATIO;
  else if (e.key === 'Enter' || e.key === ' ') next = DEFAULT_RATIO;
  else return;
  e.preventDefault();
  applySplitRatio(next);
  localStorage.setItem(SPLIT_RATIO_KEY, String(clampRatio(next)));
});

// ---------------------------------------------------------------------------
// Chrome + tab bar + tab store.
// ---------------------------------------------------------------------------

const chrome = createChrome(document.body);

const findController = createFindController({
  getEditor: () => editor,
  previewContent,
  getMode: () => currentMode,
});
mainRegion.appendChild(findController.element);

const store = createTabStore();
const tabBar: TabBarInstance = createTabBar(store, {
  onSelect: (id) => store.setActive(id),
  onClose: (id) => closeTab(id),
  onNewTab: (shift) => {
    void newFile({ background: shift });
  },
  onRevealInFolder: (path) => {
    void filesApi.revealInFolder(path).catch((e) => showError(`Reveal failed: ${String(e)}`));
  },
  onCopyPath: (path) => {
    void copyToClipboard(path, 'path');
  },
  onReRootToGit: (gitRoot, filePath) => {
    void reRootWorkspaceToGit(gitRoot, filePath);
  },
});
// Tab strip lives inside `.pmd-chrome`, below the toolbar.
chrome.el.appendChild(tabBar.el);

const factsStore = createDocumentFactsStore();
const outlinePanel = createOutlinePanel({
  onJump(blockId) {
    jumpEditorToBlock(blockId);
    previewContent
      .querySelector<HTMLElement>(blockSelector(blockId))
      ?.scrollIntoView({ block: 'start' });
    editor?.focus();
  },
  restoreFocus() {
    editor?.focus();
  },
});
document.body.append(outlinePanel.element);

let outlineObserver: IntersectionObserver | null = null;
let outlineScrollFrame = 0;
let outlineTrackingInterval = 0;

const diagnosticsSettings: DiagnosticsSettings = {
  inlineDetail: true,
  panelExpanded: false,
};

const diagnosticsPanel = createDiagnosticsPanel({
  onToggleExpanded: () => {
    toggleDiagnosticsPanel();
  },
  onToggleInlineDetail: () => {
    diagnosticsSettings.inlineDetail = !diagnosticsSettings.inlineDetail;
    rerenderCurrentDiagnostics();
  },
  onPrimaryAction: (action) => {
    void runDiagnosticPrimaryAction(action);
  },
  canRunPrimaryAction: (action) => isImplementedDiagnosticAction(action),
});
const trustPolicyPanel = createTrustPolicyPanel();
document.body.append(diagnosticsPanel.element, trustPolicyPanel.element);
trustPolicyPanel.setHandlers({
  trustRepositoryRoot: async (root) => {
    await trustRepositoryRoot(root);
  },
  declineRepositoryRoot: async (root) => {
    await declineRepositoryRoot(root);
  },
  revokeGrant: async (grantId) => {
    await revokeAssetGrant(grantId);
  },
});

// Declared before the toolbar block below assigns it (a later `let` would
// otherwise re-initialise it to null after assignment).
let insertMenu: InsertMenuInstance | null = null;
let settingsMenu: ReturnType<typeof createSettingsMenu> | null = null;

// Settings dropdown: appends its own trigger into the toolbar.
const toolbarEl = chrome.el.querySelector('.pmd-toolbar');
if (toolbarEl instanceof HTMLElement) {
  settingsMenu = createSettingsMenu(toolbarEl, {
    getSettings: () => settingsApi.getSettings(),
    setAutosaveMode: (m) => settingsApi.setAutosaveMode(m),
    setAutoreloadMode: (m) => settingsApi.setAutoreloadMode(m),
    setMergeStrategy: (m) => settingsApi.setMergeStrategy(m),
    setGistEnabled: (e) => settingsApi.setGistEnabled(e),
    setDiffMode: (m) => settingsApi.setDiffMode(m),
    pickBaseDir: () => filesApi.pickBaseDir(),
    getDefaultHandlerStatus: () => settingsApi.defaultHandlerStatus().then((r) => r.status),
    setAsDefaultHandler: () => settingsApi.setAsDefaultHandler(),
    setMonoFont: (f) => settingsApi.setMonoFont(f),
    setShowFullPath: (enabled) => setPathDisplayFull(enabled),
    listTrustRoots,
    forgetTrustRoot: forgetTrustRootFromSettings,
    onAutosaveChange: (m) => {
      autosaveMode = m;
    },
    onAutoreloadChange: (m) => {
      autoreloadMode = m;
    },
    onBaseDirChange: (dir) => {
      browserBaseDir = dir;
      saveSession();
      // Single source of truth: the picker just granted+persisted this folder,
      // so re-root the shared workspace model. The sidebar and folder tab both
      // render from it and update immediately (no restart needed).
      void setWorkspaceRoot(dir);
    },
    onGistChange: (e) => {
      gistEnabled = e;
      applyGistVisibility();
    },
    onDiffModeChange: (m) => {
      diffMode = m;
      applyDiffMode();
    },
    onMonoFontChange: (f) => applyMonoFont(f),
    onShowFullPathChange: (enabled) => {
      // setPathDisplayFull already updates chrome + persisted setting; keep the
      // local mirror in sync when the Settings toggle fires the change callback
      // after its own setter (which is also setPathDisplayFull).
      showFullPath = enabled;
    },
  });
  insertMenu = createInsertMenu(toolbarEl, {
    insertAlert,
    insertFootnote,
  });
  insertMenu.setEnabled(false);

  // "Copy + Open Gist": GitHub exposes no URL param to prefill gist content, so
  // we copy the document to the clipboard and open the new-gist page.
  gistBtn = document.createElement('button');
  gistBtn.className = 'pmd-btn pmd-btn-ghost pmd-btn-sm';
  gistBtn.type = 'button';
  gistBtn.textContent = 'Gist';
  gistBtn.title = 'Copy the document and open gist.github.com to paste it';
  gistBtn.style.display = 'none';
  gistBtn.addEventListener('click', () => openGist());
  toolbarEl.appendChild(gistBtn);

  // Split-view scroll-lock toggle. Visible only while a document tab is in
  // split mode; the [data-active] flag reflects the current on/off state.
  // The CSS animates the show/hide via max-width + padding (zero-reflow, same
  // pattern as .pmd-reload-btn / .pmd-merge-btn) so toggling mode does not
  // shove the surrounding toolbar buttons around.
  splitLockBtn = document.createElement('button');
  splitLockBtn.className = 'pmd-btn pmd-btn-ghost pmd-btn-sm pmd-split-lock-btn';
  splitLockBtn.type = 'button';
  splitLockBtn.textContent = '\u21F5';
  splitLockBtn.title = 'Lock split scroll (off)';
  splitLockBtn.setAttribute('aria-label', 'Toggle split-view scroll lock');
  splitLockBtn.setAttribute('aria-pressed', 'false');
  splitLockBtn.addEventListener('click', () => {
    void setSplitScrollLock(!splitScrollLocked);
  });
  toolbarEl.appendChild(splitLockBtn);

  const sidebarToggleBtn = document.createElement('button');
  sidebarToggleBtn.className = 'pmd-btn pmd-btn-ghost pmd-btn-sm';
  sidebarToggleBtn.type = 'button';
  sidebarToggleBtn.textContent = '▌';
  sidebarToggleBtn.title = 'Toggle sidebar (Ctrl+B)';
  sidebarToggleBtn.addEventListener('click', () => {
    void actionRegistry.runAction('view.toggleSidebar');
  });
  // Sidebar lives on the left, so its toggle sits at the far left of the
  // toolbar (before the File menu) rather than trailing on the right.
  toolbarEl.prepend(sidebarToggleBtn);
}

function applyGistVisibility(): void {
  if (gistBtn) gistBtn.style.display = gistEnabled ? '' : 'none';
}

/** Show/hide the lock button (split mode + doc tab) and reflect on/off state
 *  via `data-active` and `aria-pressed`. */
function applySplitLockVisibility(): void {
  if (!splitLockBtn) return;
  const visible = currentMode === 'split' && store.activeDoc() !== undefined;
  if (visible) splitLockBtn.setAttribute('data-visible', '');
  else splitLockBtn.removeAttribute('data-visible');
  if (splitScrollLocked) splitLockBtn.setAttribute('data-active', '');
  else splitLockBtn.removeAttribute('data-active');
  splitLockBtn.title = splitScrollLocked
    ? 'Unlock split scroll (on)'
    : 'Lock split scroll (off)';
  splitLockBtn.setAttribute('aria-pressed', splitScrollLocked ? 'true' : 'false');
}

async function setSplitScrollLock(enabled: boolean): Promise<void> {
  splitScrollLocked = enabled;
  applySplitLockVisibility();
  // When enabling the lock, immediately align the panes so they snap into
  // sync instead of waiting for the next user scroll.
  if (enabled) scrollMirror?.alignNow();
  try {
    await settingsApi.setSplitScrollLocked(enabled);
  } catch (e) {
    console.error('set_split_scroll_locked failed:', e);
  }
}

async function setPathDisplayFull(enabled: boolean): Promise<void> {
  showFullPath = enabled;
  chrome.setShowFullPath(enabled);
  try {
    await settingsApi.setShowFullPath(enabled);
  } catch (e) {
    console.error('set_show_full_path failed:', e);
  }
}

function setZoom(value: number): void {
  zoom = Math.max(0.5, Math.min(2, value));
  previewContent.style.fontSize = `${zoom}rem`;
  document.documentElement.style.setProperty('--pmd-editor-font-size', `${zoom * 14}px`);
}

/** Drive the editor/mono font CSS var from a chosen family (any installed font,
 *  e.g. a system-installed Nerd Font). */
function applyMonoFont(font: string | null): void {
  const value = font ? `"${font}", "JetBrains Mono", monospace` : '"JetBrains Mono", monospace';
  document.documentElement.style.setProperty('--pmd-font-mono', value);
}

async function openGist(): Promise<void> {
  const content = editor && store.activeDoc() ? editor.getValue() : '';
  try {
    await navigator.clipboard.writeText(content);
    await windowsApi.openUrl('https://gist.github.com/');
    chrome.setStatus('Copied — paste the document into the new gist');
  } catch (e) {
    showError(`Gist failed: ${String(e)}`);
  }
}

/** Apply the current diff mode to the editor (baseline = the active tab's
 *  last-loaded/saved content). */
function applyDiffMode(): void {
  if (!editor) return;
  const tab = store.activeDoc();
  editor.setDiff(diffMode, tab ? tab.baseContent : '');
}

let editor: EditorHandle | null = null;
let scrollSync: ScrollSyncHandle | null = null;
let scrollMirror: ScrollMirrorHandle | null = null;
let fileBrowser: FileBrowserInstance | null = null;
let currentMode: Mode = 'split';
let autosaveMode: AutosaveMode = 'off';
let autoreloadMode: AutoreloadMode = 'when_clean';
let browserBaseDir: string | null = null;
let gistEnabled = false;
let diffMode: DiffMode = 'none';
let gistBtn: HTMLButtonElement | null = null;
let splitLockBtn: HTMLButtonElement | null = null;
let shortcutOverrides: ShortcutOverrides = {};
let zoom = 1;
let splitScrollLocked = false;
/** Top-bar path label: full path vs compressed. Persisted as `show_full_path`. */
let showFullPath = false;

function enabledActionIds(): Set<ActionId> {
  return new Set(defaultActionSpecs.map((action) => action.id));
}

function recordActionForE2e(actionId: ActionId): boolean {
  if (!window.__pmdE2e) return false;
  window.__pmdE2eActions = window.__pmdE2eActions ?? [];
  window.__pmdE2eActions.push(actionId);
  return actionId === 'app.quit';
}

async function runAction(id: ActionId): Promise<void> {
  if (recordActionForE2e(id)) return;
  if (runOutlineAction(id)) return;
  if (runDiagnosticsAction(id)) return;
  switch (id) {
    case 'file.new':
      await newFile();
      return;
    case 'file.open':
      await openFileDialog();
      return;
    case 'file.save':
      await saveCurrentDoc();
      return;
    case 'file.saveAs':
      await saveCurrentDocAs();
      return;
    case 'file.closeTab': {
      const id = store.activeId();
      if (id !== null) await closeTab(id);
      return;
    }
    case 'window.new':
      await windowsApi.newWindow();
      return;
    case 'window.reopenLastClosed':
      await reopenLastClosedWindow();
      return;
    case 'window.closeAll':
    case 'app.quit': {
      if (!(await confirmCloseWindow())) return;
      // Intentional quit: tell the backend so the close transaction preserves
      // every window (whole workspace restored next launch), then close them all.
      try {
        await windowsApi.beginQuit();
      } catch (e) {
        console.error('begin_quit failed:', e);
      }
      const { getAllWindows } = await import('@tauri-apps/api/window');
      for (const w of await getAllWindows()) await w.close();
      return;
    }
    case 'view.zoomIn':
      setZoom(zoom + 0.1);
      return;
    case 'view.zoomOut':
      setZoom(zoom - 0.1);
      return;
    case 'view.zoomReset':
      setZoom(1);
      return;
    case 'view.cycleMode':
      cycleMode();
      return;
    case 'view.toggleWordWrap':
      toggleWordWrap();
      return;
    case 'view.toggleSidebar': {
      const next = document.body.dataset.sidebar !== 'on';
      applySidebarVisible(next);
      localStorage.setItem(SIDEBAR_VISIBLE_KEY, next ? '1' : '0');
      return;
    }
    case 'view.refreshSidebar':
      await workspace.refresh();
      return;
    case 'navigate.commandOverlay':
      commandOverlay.open();
      return;
    case 'help.shortcuts':
      shortcutEditor.open();
      return;
    case 'theme.pick':
      await showThemePicker();
      return;
    case 'settings.open':
      await settingsMenu?.open();
      return;
    case 'menu.focus':
      chrome.focusMenu();
      return;
    case 'file.copyPath': {
      const p = activeFilePath();
      if (p) await copyToClipboard(p, 'path');
      return;
    }
    case 'file.copyFilename': {
      const p = activeFilePath();
      if (p) await copyToClipboard(basename(p), 'filename');
      return;
    }
    case 'file.copyFileUrl': {
      const p = activeFilePath();
      if (p) await copyToClipboard(`file://${p}`, 'file URL');
      return;
    }
    case 'file.revealInFolder': {
      const p = activeFilePath();
      if (p) await filesApi.revealInFolder(p).catch((e) => showError(`Reveal failed: ${String(e)}`));
      return;
    }
    case 'file.openDefaultApp': {
      const p = activeFilePath();
      if (p) await filesApi.openInDefaultApp(p).catch((e) => showError(`Open failed: ${String(e)}`));
      return;
    }
    case 'file.clearRecent':
      await recentApi.clearRecentFiles();
      chrome.setRecentFiles([]);
      return;
    case 'history.clearRecentlyClosed':
      await clearRecentlyClosed();
      return;
    case 'document.reloadFromDisk':
      await doReload();
      return;
    case 'document.mergeDiskChanges':
      await doMerge();
      return;
    case 'document.editFrontmatter': {
      const rect = document.querySelector('.pmd-status-frontmatter')?.getBoundingClientRect();
      openFrontmatterInspector(rect?.left ?? 80, rect?.top ?? 80);
      return;
    }
    case 'document.export.pdf':
      exportToPdf();
      return;
    case 'document.export.html':
      await exportToHtml();
      return;
    case 'navigate.fileBrowser':
      store.addBrowser();
      return;
    case 'share.openGist':
    case 'share.copyGistMarkdown':
      await openGist();
      return;
    case 'edit.find':
      findController.open();
      return;
    case 'edit.replace':
      findController.openReplace();
      return;
    case 'edit.pasteAsMarkdown':
      await pasteHtmlAsMarkdownAtCursor();
      return;
    case 'edit.findNext':
      findController.next();
      return;
    case 'edit.findPrevious':
      findController.previous();
      return;
    case 'view.setDiffMode':
    case 'settings.pickBaseFolder':
    case 'settings.selectMonoFont':
    case 'settings.setDefaultHandler':
    case 'navigate.outline':
    case 'diagnostics.togglePanel':
      toggleDiagnosticsPanel();
      return;
    case 'asset.grantFolder':
      await grantAssetFolder();
      return;
    case 'asset.trustRepositoryRoot':
      await trustRepositoryRoot();
      return;
    case 'asset.declineRepositoryRoot':
      await declineRepositoryRoot();
      return;
    case 'asset.revokeGrant':
    case 'settings.removeTrustRoot':
      chrome.setStatus(defaultActionSpecs.find((action) => action.id === id)?.label ?? id);
      return;
    case 'navigate.tabNext':
    case 'navigate.tabPrevious': {
      const tabs = store.list();
      if (tabs.length < 2) return;
      const currentIdx = tabs.findIndex((t) => t.id === store.activeId());
      if (currentIdx < 0) return;
      const dir = id === 'navigate.tabNext' ? 1 : -1;
      const nextIdx = (currentIdx + dir + tabs.length) % tabs.length;
      store.setActive(tabs[nextIdx].id);
      return;
    }
    default:
      assertNever(id);
  }
}

const actionRegistry = createActionRegistry(defaultActionSpecs, {
  run: runAction,
  isEnabled: isActionAvailable,
  isVisible: isActionAvailable,
});

const commandOverlay = createCommandOverlay(defaultActionSpecs, actionRegistry, {
  isVisible: isActionAvailable,
});
const shortcutEditor = createShortcutEditor({
  actions: defaultActionSpecs,
  loadOverrides: () => shortcutOverrides,
  saveOverrides: async (overrides) => {
    const settings = await settingsApi.setShortcutOverrides(overrides);
    shortcutOverrides = settings.shortcut_overrides ?? {};
  },
  enabledActionIds,
});
document.body.append(commandOverlay.element, shortcutEditor.element);

installActionHotkeys({
  actions: defaultActionSpecs,
  registry: actionRegistry,
  getOverrides: () => shortcutOverrides,
  isEnabled: isActionAvailable,
});

appContainer.addEventListener('wheel', (e: WheelEvent) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if ((e.target as HTMLElement).closest('.pmd-mermaid-overlay')) return;
  e.preventDefault();
  setZoom(zoom + (e.deltaY < 0 ? 0.1 : -0.1));
}, { passive: false });

function basename(p: string): string {
  return p.split('/').pop() || p;
}

function showError(message: string): void {
  chrome.setStatus(message);
  console.error(message);
}

let unlistenDiagnostics: (() => void) | null = null;

function activeDiagnostics(): DocumentDiagnostics | null {
  const active = store.activeDoc();
  if (!active) return null;
  return factsStore.current(active.docId)?.diagnostics ?? null;
}

function rerenderCurrentDiagnostics(): void {
  const diagnostics = activeDiagnostics();
  if (!diagnostics) {
    diagnosticsPanel.clear();
    trustPolicyPanel.clear();
    renderInlineIssues(previewContent, []);
    return;
  }
  applyDocumentDiagnostics(diagnostics);
}

function toggleDiagnosticsPanel(): void {
  diagnosticsSettings.panelExpanded = !diagnosticsSettings.panelExpanded;
  rerenderCurrentDiagnostics();
}

function runDiagnosticsAction(id: ActionId): boolean {
  if (id !== 'diagnostics.togglePanel') return false;
  toggleDiagnosticsPanel();
  return true;
}

async function runDiagnosticPrimaryAction(action: string): Promise<void> {
  if (action === 'Edit frontmatter') {
    await runAction('document.editFrontmatter');
    return;
  }
  const spec = defaultActionSpecs.find((item) => item.id === action);
  if (!spec || !isImplementedDiagnosticAction(action)) {
    chrome.setStatus(action);
    return;
  }
  await runAction(spec.id);
}

function isImplementedDiagnosticAction(action: string): boolean {
  if (action === 'Edit frontmatter') return true;
  return defaultActionSpecs.some((item) => item.id === action);
}

function applyDocumentDiagnostics(diagnostics: DocumentDiagnostics): void {
  const presentation = deriveDiagnosticsPresentation(diagnostics, diagnosticsSettings);
  diagnosticsPanel.render(presentation);
  renderInlineIssues(previewContent, presentation.inlineIssues);
  trustPolicyPanel.render({
    status: deriveTrustStatus(diagnostics.resources, diagnostics.issues),
    report: diagnostics.resources,
    issues: diagnostics.issues,
  });
}

function clearDocumentIntelligenceUi(): void {
  diagnosticsPanel.clear();
  trustPolicyPanel.clear();
  chrome.setFrontmatterState({ present: false, malformed: false });
  renderInlineIssues(previewContent, []);
}

function docTabByDocId(docId: number): DocTab | undefined {
  return store.list().find((t): t is DocTab => t.kind === 'doc' && t.docId === docId);
}

/** Live buffer text for a doc tab: the mounted editor for the active tab, or
 *  the tab's stashed CodeMirror state for an inactive tab. */
function tabBuffer(tab: DocTab): string {
  if (editor && store.activeId() === tab.id) return editor.getValue();
  return tab.editorState ? tab.editorState.doc.toString() : tab.baseContent;
}

function currentPreviewDoc(): { doc_id: number; version: number } | null {
  const tab = store.activeDoc();
  const version = coordinator.appliedVersion();
  if (!tab || !version) return null;
  return { doc_id: tab.docId, version };
}

function activePromptRoot(): string | null {
  const context = store.activeDoc()?.trustContext;
  return context?.should_prompt_for_repo_root ? context.git_root : null;
}

function isActionAvailable(id: ActionId): boolean {
  switch (id) {
    case 'asset.revokeGrant':
    case 'settings.removeTrustRoot':
      return false;
    case 'asset.trustRepositoryRoot':
    case 'asset.declineRepositoryRoot':
      return activePromptRoot() !== null;
    default:
      return true;
  }
}

function updateOpenTrustContexts(
  canonicalRoot: string,
  state: DocumentTrustContext['git_root_state'],
): void {
  const shouldPrompt = state === 'unknown';
  for (const tab of store.list()) {
    if (tab.kind !== 'doc' || tab.trustContext?.git_root !== canonicalRoot) continue;
    tab.trustContext = {
      ...tab.trustContext,
      git_root_state: state,
      should_prompt_for_repo_root: shouldPrompt,
    };
  }
  const active = store.activeDoc();
  if (active?.trustContext?.git_root === canonicalRoot) {
    trustPolicyPanel.setTrustContext(active.trustContext);
  }
}

async function refreshActiveAssetGrants(): Promise<void> {
  const tab = store.activeDoc();
  if (!tab) {
    trustPolicyPanel.setActiveGrants([]);
    return;
  }
  try {
    const grants = await listAssetGrants(tab.docId);
    trustPolicyPanel.setActiveGrants(grants);
    rerenderCurrentDiagnostics();
  } catch (e) {
    console.warn('Could not list asset grants', e);
  }
}

async function grantAssetFolder(): Promise<void> {
  const current = currentPreviewDoc();
  if (!current) return;
  const blocked = activeDiagnostics()?.resources.decisions.find((decision) => decision.placeholder_id);
  await grantAssetFolderForBlockedImage({
    docId: current.doc_id,
    version: current.version,
    placeholderId: blocked?.placeholder_id ?? '',
  });
  await refreshActiveAssetGrants();
  await coordinator.schedule();
}

async function trustRepositoryRoot(root?: string): Promise<void> {
  const current = currentPreviewDoc();
  const canonicalRoot = root ?? store.activeDoc()?.trustContext?.git_root ?? null;
  if (!current || !canonicalRoot) return;
  await grantRecommendedRoot({
    docId: current.doc_id,
    version: current.version,
    canonicalRoot,
  });
  updateOpenTrustContexts(canonicalRoot, 'trusted');
  await refreshActiveAssetGrants();
  await coordinator.schedule();
}

async function declineRepositoryRoot(root?: string): Promise<void> {
  const canonicalRoot = root ?? store.activeDoc()?.trustContext?.git_root ?? null;
  if (!canonicalRoot) return;
  await rememberDeclinedRoot(canonicalRoot);
  updateOpenTrustContexts(canonicalRoot, 'declined');
  rerenderCurrentDiagnostics();
}

async function forgetTrustRootFromSettings(canonicalRoot: string): Promise<void> {
  await forgetTrustRoot(canonicalRoot);
  updateOpenTrustContexts(canonicalRoot, 'unknown');
  await refreshActiveAssetGrants();
  await coordinator.schedule();
}

async function revokeAssetGrant(grantId?: number): Promise<void> {
  const active = store.activeDoc();
  if (!active || grantId === undefined) return;
  await revokeAssetGrantForDocument({ docId: active.docId, grantId });
  await refreshActiveAssetGrants();
  await coordinator.schedule();
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}

function blockSelector(blockId: string): string {
  return `[data-pmd-block-id="${cssEscape(blockId)}"]`;
}

function scrollPreviewToBlock(blockId: string): void {
  const escaped = cssEscape(blockId);
  const target = previewContent.querySelector(`#${escaped}, [data-pmd-block-id="${escaped}"]`);
  if (target instanceof HTMLElement) target.scrollIntoView({ block: 'center' });
}

function jumpEditorToBlock(blockId: string): void {
  const active = store.activeDoc();
  if (!active || !editor) return;
  const snapshot = factsStore.current(active.docId);
  const heading = snapshot?.headings.find((item) => item.block_id === blockId);
  if (!heading) return;
  const lineNumber = Math.max(1, Math.min(editor.view.state.doc.lines, heading.line_start));
  const line = editor.view.state.doc.line(lineNumber);
  editor.view.dispatch({
    selection: { anchor: line.from },
    scrollIntoView: true,
  });
}

function applyFrontmatterChange(change: FmChange | null): void {
  if (!change || !editor) return;
  const max = editor.view.state.doc.length;
  if (change.from > max || change.to > max) return;
  editor.view.dispatch({
    changes: { from: change.from, to: change.to, insert: change.insert },
  });
}

function activeFrontmatter(): FrontmatterFact | null {
  const active = store.activeDoc();
  if (!active) return null;
  return factsStore.current(active.docId)?.facts?.frontmatter ?? null;
}

function starterFrontmatterFact(): FrontmatterFact {
  return {
    format: 'yaml',
    line_start: 1,
    line_end: 1,
    raw: '---\n---\n',
    syntax: 'valid',
    metadata: {
      title: null,
      description: null,
      slug: null,
      sidebar_label: null,
      sidebar_position: null,
      tags: [],
      draft: null,
      unknown: {},
    },
  };
}

function activeStructureCounts(): StructureCounts | null {
  const active = store.activeDoc();
  if (!active) return null;
  return factsStore.current(active.docId)?.facts?.counts ?? null;
}

function openFrontmatterInspector(x: number, y: number): void {
  if (!editor) return;
  const doc = editor.getValue();
  let insertedStarter = false;
  if (!hasOpeningFence(doc)) {
    // Insert an EMPTY frontmatter block — no auto-seeded `title` field. The
    // user adds fields explicitly via the inspector.
    applyFrontmatterChange(insertBlockChange(doc, '', ''));
    insertedStarter = true;
  }
  openFrontmatterPanel(x, y, activeFrontmatter() ?? (insertedStarter ? starterFrontmatterFact() : null), {
    onEditValue: (key, value) => {
      if (!editor) return;
      applyFrontmatterChange(editValueChange(editor.getValue(), key, value));
    },
    onAddEntry: (key, value) => {
      if (!editor) return;
      applyFrontmatterChange(addEntryChange(editor.getValue(), key, value));
    },
  });
}

function applyOutlineRender(result: RenderResult): boolean {
  if (!factsStore.accept({
    doc_id: result.doc_id,
    version: result.version,
    headings: result.facts.headings,
    facts: result.facts,
    diagnostics: result.diagnostics,
  })) {
    return false;
  }
  outlinePanel.setHeadings(result.facts.headings);
  const fm = result.facts.frontmatter;
  chrome.setFrontmatterState({ present: fm !== null, malformed: fm?.syntax === 'malformed' });
  observePreviewHeadings(result.facts.headings);
  updateOutlineFromEditorCaret();
  applyDocumentDiagnostics(result.diagnostics);
  return true;
}

function observePreviewHeadings(headings: HeadingFact[]): void {
  outlineObserver?.disconnect();
  outlineObserver = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    const blockId = visible?.target.getAttribute('data-pmd-block-id') ?? null;
    if (blockId) outlinePanel.setActiveBlock(blockId);
  }, { root: previewPane, rootMargin: '0px 0px -70% 0px', threshold: 0.01 });
  for (const heading of headings) {
    const node = previewContent.querySelector(blockSelector(heading.block_id));
    if (node) outlineObserver.observe(node);
  }
  updateOutlineFromPreviewScroll();
}

function updateOutlineFromEditorCaret(): void {
  const active = store.activeDoc();
  if (!active || !editor) return;
  const snapshot = factsStore.current(active.docId);
  if (!snapshot) return;
  const line = editor.view.state.doc.lineAt(editor.view.state.selection.main.head).number;
  const heading = [...snapshot.headings].reverse().find((item) => item.line_start <= line);
  outlinePanel.setActiveBlock(heading?.block_id ?? null);
}

function updateOutlineFromPreviewScroll(): void {
  const active = store.activeDoc();
  if (!active) return;
  const snapshot = factsStore.current(active.docId);
  if (!snapshot) return;
  const paneRect = previewPane.getBoundingClientRect();
  const visibleHeadings: Array<{ blockId: string; top: number }> = [];
  const marker = paneRect.top + Math.min(160, paneRect.height * 0.3);
  let activeBlockId: string | null = null;
  let activeVisibleBlockId: string | null = null;
  for (const heading of snapshot.headings) {
    const node = previewContent.querySelector(blockSelector(heading.block_id));
    if (!(node instanceof HTMLElement)) continue;
    const rect = node.getBoundingClientRect();
    if (rect.bottom >= paneRect.top && rect.top <= paneRect.bottom) {
      visibleHeadings.push({ blockId: heading.block_id, top: rect.top });
      if (rect.top <= marker) activeVisibleBlockId = heading.block_id;
    }
    if (rect.top <= marker) activeBlockId = heading.block_id;
  }
  visibleHeadings.sort((a, b) => a.top - b.top);
  outlinePanel.setActiveBlock(
    activeVisibleBlockId ?? visibleHeadings[0]?.blockId ?? activeBlockId ?? snapshot.headings[0]?.block_id ?? null
  );
}

function scheduleOutlineScrollUpdate(): void {
  if (outlineScrollFrame) return;
  outlineScrollFrame = window.requestAnimationFrame(() => {
    outlineScrollFrame = 0;
    updateOutlineFromPreviewScroll();
  });
}

function startOutlineTrackingLoop(): void {
  if (outlineTrackingInterval) return;
  outlineTrackingInterval = window.setInterval(() => {
    if (outlinePanel.element.hidden) {
      window.clearInterval(outlineTrackingInterval);
      outlineTrackingInterval = 0;
      return;
    }
    updateOutlineFromPreviewScroll();
  }, 100);
}

previewPane.addEventListener('scroll', scheduleOutlineScrollUpdate, { passive: true });
document.addEventListener('scroll', scheduleOutlineScrollUpdate, { passive: true, capture: true });

let outlineCaretListenersInstalled = false;

function installOutlineCaretListeners(): void {
  if (!editor || outlineCaretListenersInstalled) return;
  editor.view.dom.addEventListener('keyup', updateOutlineFromEditorCaret);
  editor.view.dom.addEventListener('mouseup', updateOutlineFromEditorCaret);
  outlineCaretListenersInstalled = true;
}

function runOutlineAction(id: ActionId): boolean {
  if (id !== 'navigate.outline') return false;
  outlinePanel.setMode('overlay');
  outlinePanel.focusSearch();
  startOutlineTrackingLoop();
  return true;
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || outlinePanel.element.hidden) return;
  event.preventDefault();
  outlinePanel.setMode('collapsed');
  editor?.focus();
}, { capture: true });

async function adoptOpenedDocumentFromLink(documentFromBackend: OpenedDocumentFromLink): Promise<void> {
  const doc: OpenedDoc = {
    doc_id: documentFromBackend.doc_id,
    path: documentFromBackend.path,
    contents: documentFromBackend.contents,
    state: documentFromBackend.state as FileState,
    trust_context: (documentFromBackend.trust_context ?? null) as DocumentTrustContext | null,
  };
  const existing = store.findDocByPath(doc.path);
  if (existing) {
    docsApi.dropDoc(doc.doc_id).catch(() => {});
    store.setActive(existing.id);
    return;
  }
  await addDocTab(doc, { background: false });
  loadRecentFiles();
  chrome.setStatus('Ready');
}

attachPreviewLinkActivation(previewContent, {
  currentDoc: currentPreviewDoc,
  invoke: linkActivationInvoke,
  handleResponse: (response, doc) =>
    handleLinkActivationResponse({
      response,
      docId: doc.doc_id,
      version: doc.version,
      invoke: linkActivationInvoke,
      scrollToBlock: scrollPreviewToBlock,
      openDocument: adoptOpenedDocumentFromLink,
      showMessage: (message) => chrome.setStatus(message),
      externalConfirmation,
    }).catch((error) => showError(`Link failed: ${String(error)}`)),
});

// ---------------------------------------------------------------------------
// Image paste / drag-and-drop embed (#5).
// ---------------------------------------------------------------------------

// Per-session counter to disambiguate clipboard-image names (pasted-1, …).
let pastedImageCounter = 0;

/**
 * Embed `bytes` (a pasted/dropped image named `fileName`) into the active saved
 * document: copy them into `images/<doc-stem>/` via the backend, extend the
 * asset grant, and insert a relative `![](…)` at the cursor.
 *
 * An UNSAVED buffer (no path) is refused with a prompt to save first. The first
 * write into a not-yet-created image folder asks for confirmation; subsequent
 * writes into an already-granted folder proceed silently.
 */
async function embedImageBytes(fileName: string, bytes: Uint8Array): Promise<void> {
  const active = store.activeDoc();
  if (!active) return;
  if (!active.filePath) {
    showError('Save the document before embedding images');
    return;
  }
  try {
    // First attempt without confirming a new folder; the backend returns null
    // if the per-document image folder does not exist yet.
    let result = await importImageAsset({
      docId: active.docId,
      fileName,
      bytes,
      confirmNewFolder: false,
    });
    if (!result) {
      const ok = window.confirm(
        `Create an images folder next to “${basename(active.filePath)}” and copy this image into it?`
      );
      if (!ok) {
        chrome.setStatus('Image embed cancelled');
        return;
      }
      result = await importImageAsset({
        docId: active.docId,
        fileName,
        bytes,
        confirmNewFolder: true,
      });
    }
    if (!result) return;
    if (editor) {
      insertAtCursor(editor.view, buildImageMarkdown(result.relative_path));
    }
    chrome.setStatus(`Embedded ${basename(result.relative_path)}`);
  } catch (err) {
    showError(`Embed failed: ${String(err)}`);
  }
}

async function embedImageFile(file: File): Promise<void> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const name =
    file.name && classifyDroppedFile(file.name, file.type) === 'embed'
      ? file.name
      : clipboardImageName(file.type || 'image/png', ++pastedImageCounter);
  await embedImageBytes(name, buf);
}

// ---------------------------------------------------------------------------
// Drag & drop.
// ---------------------------------------------------------------------------

installDragOverlay({
  onOpenFiles: (paths) => {
    paths.forEach((path, i) => {
      void openFile(path, { background: i > 0 });
    });
  },
  onOpenBlob: async (name, contents) => {
    const reg = await docsApi.registerDoc({
      path: null,
      contents,
    });
    await addDocTab(
      { doc_id: reg.doc_id, path: '', contents, state: reg.state },
      { background: false, title: name }
    );
  },
  onEmbedImage: embedImageFile,
  showError,
});

// ---------------------------------------------------------------------------
// Theme + recents + hotkeys (largely unchanged from before).
// ---------------------------------------------------------------------------

let cachedThemes: ThemeInfo[] = [];
async function loadThemes(): Promise<ThemeInfo[]> {
  if (cachedThemes.length > 0) return cachedThemes;
  try {
    cachedThemes = await themeApi.listThemes();
  } catch (e) {
    console.error('loadThemes failed:', e);
    cachedThemes = [];
  }
  return cachedThemes;
}

async function showThemePicker(): Promise<void> {
  if (isPickerOpen()) {
    closeThemePicker();
    return;
  }
  const themes = await loadThemes();
  openThemePicker(themes, async (slug, mode) => {
    if (mode) {
      const payload: Record<string, string> = {};
      if (mode === 'light') payload.light = slug;
      else if (mode === 'dark') payload.dark = slug;
      await themeApi.setThemePair(payload);
      await themeApi.setAutoSwitch(true);
    }
    await applyTheme(slug);
  });
}

chrome.onThemePickerClick(() => showThemePicker());
chrome.onReloadClick(() => doReload());
chrome.onSaveClick(() => saveCurrentDoc());
chrome.onMergeClick(() => doMerge());
chrome.onPathDisplayToggle(() => {
  void setPathDisplayFull(!showFullPath);
});
chrome.onFrontmatterClick(() => {
  const rect = document.querySelector('.pmd-status-frontmatter')?.getBoundingClientRect();
  openFrontmatterInspector(rect?.left ?? 80, rect?.top ?? 80);
});
chrome.onCountsClick(() => {
  const rect = document.querySelector('.pmd-status-counts')?.getBoundingClientRect();
  openStatsPopover(rect?.left ?? 80, (rect?.top ?? 80) - 8, activeStructureCounts());
});

// Quick file ops (File menu). Operate on the active document's path.
function activeFilePath(): string | null {
  const t = store.activeDoc();
  return t ? t.filePath : null;
}

// --- Export (PDF print + self-contained HTML) ------------------------------

/** The active theme's emitted CSS, so an HTML export styles like the app. */
function activeThemeCss(): string {
  return (document.getElementById('pmd-theme-styles') as HTMLStyleElement | null)?.textContent ?? '';
}

/** Best-effort document title: first rendered H1, else the filename stem. */
function exportTitle(): string {
  const h1 = previewContent.querySelector('h1')?.textContent?.trim();
  if (h1) return h1;
  const path = activeFilePath();
  return path ? (path.split('/').pop() ?? '') : '';
}

/**
 * PDF export (#1): switch the preview into print mode and invoke the WebKitGTK
 * print path (`window.print()`), which offers "Save as PDF". `print.css`
 * (gated under `@media print`) strips chrome, expands collapsed blocks and
 * paginates; the `print-export` body class is a JS-set hook around the call.
 * Force preview mode first so the rendered document is what gets laid out.
 */
function exportToPdf(): void {
  if (currentMode !== 'preview') applyMode('preview');
  document.body.classList.add('print-export');
  let cleanupTimer: number | undefined;
  const cleanup = () => {
    if (cleanupTimer !== undefined) {
      clearTimeout(cleanupTimer);
      cleanupTimer = undefined;
    }
    document.body.classList.remove('print-export');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  try {
    window.print();
  } catch (e) {
    cleanup();
    showError(`Print failed: ${String(e)}`);
    return;
  }
  // WebKitGTK does not always emit `afterprint`; remove the class shortly after
  // so the app does not stay in print-export state.
  cleanupTimer = window.setTimeout(cleanup, 1000);
}

/**
 * HTML export (#7): serialize the *already-sanitized* preview DOM (with
 * pre-rendered Mermaid/KaTeX and scoped data-URI images), pair it with the
 * active theme CSS, and hand it to the backend `export_html` command, which
 * re-sanitizes, inlines the CSS, and writes via the OS save dialog.
 */
async function exportToHtml(): Promise<void> {
  const payload: HtmlExportPayload = buildHtmlExportPayload({
    bodyHtml: previewContent.innerHTML,
    themeCss: activeThemeCss(),
    title: exportTitle(),
    docPath: activeFilePath(),
  });
  try {
    const saved = await docsApi.exportHtml({
      payload,
      suggestedName: suggestedExportName(activeFilePath()),
    });
    chrome.setStatus(saved ? `Exported to ${basename(saved)}` : 'Export cancelled');
  } catch (e) {
    showError(`HTML export failed: ${String(e)}`);
  }
}
async function copyToClipboard(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    chrome.setStatus(`Copied ${label}`);
  } catch {
    showError('Clipboard unavailable');
  }
}
function updateFileOps(): void {
  chrome.setFileOpsEnabled(activeFilePath() !== null);
}
chrome.onCloseWindow(() => {
  void getCurrentWindow().close();
});
chrome.onCloseAllWindows(() => {
  void runAction('window.closeAll');
});
chrome.onCopyPath(() => {
  const p = activeFilePath();
  if (p) copyToClipboard(p, 'path');
});
chrome.onCopyFilename(() => {
  const p = activeFilePath();
  if (p) copyToClipboard(basename(p), 'filename');
});
chrome.onCopyUrl(() => {
  const p = activeFilePath();
  if (p) copyToClipboard(`file://${p}`, 'file URL');
});
chrome.onRevealInFolder(() => {
  const p = activeFilePath();
  if (p) filesApi.revealInFolder(p).catch((e) => showError(`Reveal failed: ${String(e)}`));
});
chrome.onOpenInApp(() => {
  const p = activeFilePath();
  if (p) filesApi.openInDefaultApp(p).catch((e) => showError(`Open failed: ${String(e)}`));
});
chrome.onExportPdf(() => exportToPdf());
chrome.onExportHtml(() => exportToHtml());
chrome.setFileOpsEnabled(false);

async function loadRecentFiles(): Promise<void> {
  try {
    const files = await recentApi.getRecentFiles();
    chrome.setRecentFiles(files);
  } catch (e) {
    console.error('loadRecentFiles failed:', e);
  }
}

chrome.onRecentFileSelect((path: string) => openFile(path));
chrome.onClearRecentFiles(async () => {
  await recentApi.clearRecentFiles();
  chrome.setRecentFiles([]);
});

async function loadRecentlyClosedWindows(): Promise<void> {
  try {
    const windows = await sessionApi.getRecentlyClosedWindows();
    chrome.setRecentlyClosedWindows(windows);
  } catch (e) {
    console.error('loadRecentlyClosedWindows failed:', e);
  }
}

async function reopenLastClosedWindow(): Promise<void> {
  try {
    const count = (await sessionApi.getRecentlyClosedWindows()).length;
    if (count === 0) {
      chrome.setStatus('No recently closed windows');
      return;
    }
    // index = count - 1 => most recently closed (top of stack).
    await sessionApi.restoreRecentlyClosedWindow(count - 1);
  } catch (e) {
    showError(`Reopen failed: ${String(e)}`);
  }
}

async function restoreClosedWindowAt(index: number): Promise<void> {
  try {
    await sessionApi.restoreRecentlyClosedWindow(index);
  } catch (e) {
    showError(`Restore failed: ${String(e)}`);
  }
}

async function clearRecentlyClosed(): Promise<void> {
  try {
    await sessionApi.clearRecentlyClosedWindows();
    chrome.setRecentlyClosedWindows([]);
  } catch (e) {
    showError(`Clear failed: ${String(e)}`);
  }
}

chrome.onHistoryMenuOpen(() => {
  void loadRecentlyClosedWindows();
});
chrome.onReopenLastClosed(() => {
  void reopenLastClosedWindow();
});
chrome.onRestoreClosedWindow((index) => {
  void restoreClosedWindowAt(index);
});
chrome.onClearRecentlyClosed(() => {
  void clearRecentlyClosed();
});

async function applyTheme(slug: string) {
  try {
    const bundle = await themeApi.setTheme(slug);
    try {
      await themeApi.setActiveTheme(slug);
    } catch (e) {
      console.error('set_active_theme failed:', e);
    }
    if (bundle.warnings && bundle.warnings.length > 0) {
      bundle.warnings.forEach((w: string) => console.warn(`[btr-md] Theme "${slug}": ${w}`));
    }
    let style = document.getElementById('pmd-theme-styles') as HTMLStyleElement;
    if (!style) {
      style = document.createElement('style');
      style.id = 'pmd-theme-styles';
      document.head.appendChild(style);
    }
    style.textContent = bundle.css;
    if (bundle.mode === 'light' || bundle.mode === 'dark') {
      document.documentElement.dataset.theme = bundle.mode;
    }
    setMermaidTheme(bundle.mermaid_vars);
    requestAnimationFrame(() => rerenderForThemeChange(previewContent, { vars: bundle.mermaid_vars }, coordinator.appliedNonce()));
  } catch (e) {
    console.error('applyTheme failed:', e);
  }
}

function isMode(value: unknown): value is Mode {
  return value === 'source' || value === 'split' || value === 'preview';
}

function applyMode(mode: Mode): void {
  chrome.setMode(mode);
  currentMode = mode;
  const t = store.activeDoc();
  if (t) store.updateDoc(t.id, { mode });
  applySplitLockVisibility();
}

function cycleMode(): void {
  const modes: Mode[] = ['source', 'split', 'preview'];
  const idx = modes.indexOf(currentMode);
  const next = modes[(idx + 1) % modes.length];
  applyMode(next);
  document.body.dispatchEvent(new CustomEvent('mode-change', { detail: { mode: next } }));
}

function toggleWordWrap(): void {
  if (!editor) return;
  const wrap = editor.toggleWrap();
  chrome.setStatus(wrap ? 'Word wrap on' : 'Word wrap off');
}

const systemColorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');

async function loadSettings(): Promise<Settings | null> {
  try {
    return await settingsApi.getSettings();
  } catch (e) {
    console.error('get_settings failed:', e);
    return null;
  }
}

async function applyAutoSwitchTheme(settings?: Settings): Promise<boolean> {
  const currentSettings = settings ?? (await loadSettings());
  if (!currentSettings?.auto_switch) return false;
  const themeSlug = systemColorSchemeQuery.matches ? currentSettings.dark_theme : currentSettings.light_theme;
  if (!themeSlug) return false;
  await applyTheme(themeSlug);
  return true;
}

function handleSystemThemeChange(): void {
  applyAutoSwitchTheme().catch((e) => console.error('Auto-switch failed:', e));
}
systemColorSchemeQuery.addEventListener('change', handleSystemThemeChange);

chrome.onModeChange((mode) => applyMode(mode));

document.body.addEventListener('mode-change', (event) => {
  const mode = (event as CustomEvent<{ mode?: unknown }>).detail?.mode;
  if (!isMode(mode)) return;
  themeApi.setDefaultMode(mode).catch((e) => console.error('set_default_mode failed:', e));
});

// ---------------------------------------------------------------------------
// Tab-aware rendering is owned by the render coordinator. Each render carries
// {tabId, seq, docId, version}; a result is painted only if it is still the
// latest render for the tab that is still active (the 4-part staleness gate).
// The coordinator owns the render queue, the `rendering` serialization gate,
// the monotonic version, and the reconcile→full-replace fallback. main.ts
// injects the backend render, the DOM decoration pipeline (`decorators`, run on
// the whole root for a full replace or on each changed node after a reconcile),
// the low-level DOM writes (`dom`), and the once-per-applied-render subscribers.
const coordinator = createRenderCoordinator({
  render: (req) => docsApi.renderCmd(req),
  root: previewContent,
  decorators: [
    (node, nonce) => markAllNodes(node, nonce),
    (node, nonce) => renderMermaidNodes(node, nonce),
    (node, nonce) => renderMathNodes(node, nonce),
    (node) => decorateCodeBlocks(node),
    (node) => decorateTables(node, () => editor?.getValue() ?? ''),
  ],
  dom: {
    fullReplace: (root, html) => { root.innerHTML = html; },
    reconcile: (root, html, blocks) => {
      const frag = document.createElement('div');
      frag.innerHTML = html;
      return reconcileBlocks(root, frag, blocks);
    },
    // Refresh the nonce on all kept (unchanged) nodes so that a later theme
    // change (rerenderForThemeChange) does not skip them — it filters by the
    // current root nonce.
    refreshKeptNonces: (root, nonce) => {
      root.querySelectorAll<HTMLElement>('[data-pmd-nonce]')
        .forEach((el) => { el.dataset.pmdNonce = nonce; });
    },
    // A desync (or any reconcile failure) must never wedge the preview: the
    // coordinator rebuilds the whole thing from scratch so updates keep flowing.
    isDesyncError: (err) => err instanceof ReconcileDesyncError,
    onReconcileError: (err) => console.error('reconcile failed:', err),
  },
  activeDoc: () => store.activeDoc() ?? null,
  getValue: () => (editor ? editor.getValue() : null),
  getTab: (id) => store.get(id) ?? null,
  activeId: () => store.activeId(),
});

// Once-per-applied-render fan-out, in registration order (matches the former
// inline post-render hook):
//   1. refresh the preview-find overlay against the new DOM (never throws on
//      stale ranges);
//   2. accept outline/frontmatter/diagnostics facts;
//   3. refresh the active doc's asset grants;
//   4. if this render followed a user edit to this same doc in split mode,
//      recentre the preview on the edited block. Keyed on (doc id, version) so
//      only a render newer than the edit settles it.
coordinator.onApplied(() => findController.refreshPreview());
coordinator.onApplied((result) => { applyOutlineRender(result); });
coordinator.onApplied(() => { void refreshActiveAssetGrants(); });
coordinator.onApplied((result) => scrollSync?.flushPendingEditCenter(result.doc_id, result.version));
// Trusted HTML document styles: prompt once per tab; re-render on accept.
coordinator.onApplied((result) => {
  if (!editor || !result.document_kind) return;
  const kind = result.document_kind;
  if (kind === 'markdown' || kind === 'html' || kind === 'json' || kind === 'yaml' || kind === 'toml' || kind === 'ini') {
    editor.setLanguage(kind);
  }
});
coordinator.onApplied((result) => {
  if (!result.document_styles_available) return;
  const tab = store.activeDoc();
  if (!tab || tab.documentStylesChoice !== 'unknown') return;
  const name = tab.filePath ? basename(tab.filePath) : tab.title;
  const ok = window.confirm(
    `“${name}” includes document styles. Apply them to the preview?\n\n` +
      'Styles are sanitized (no @import, url(), or scripts). You can keep the unstyled body by choosing Cancel.',
  );
  store.updateDoc(tab.id, { documentStylesChoice: ok ? 'allow' : 'deny' });
  if (ok) void coordinator.schedule();
});


// ---------------------------------------------------------------------------
// Editor + per-tab edit handling.
// ---------------------------------------------------------------------------

async function ensureEditor(): Promise<void> {
  if (editor) return;
  editor = await mountEditor(editorPane, () => onActiveEdit());
  setMermaidGotoLine((line) => editor?.gotoEditorLine(line));
  scrollSync = attachScrollSync({
    view: editor.view,
    previewPane,
    previewContent,
    getMode: () => currentMode,
    onBeforeClick: () => scrollMirror?.suspendForMs(),
    onBeforePreviewCenter: () => scrollMirror?.suspendForMs(),
  });
  // Continuous split-view scroll coupling (block-anchored mirror). Listeners
  // are always installed; the gate inside `attachScrollMirror` checks
  // `isEnabled()` and `getMode()` on every scroll event, so a mode change or
  // a toggle of the setting takes effect immediately without re-attaching.
  scrollMirror = attachScrollMirror({
    view: editor.view,
    previewPane,
    previewContent,
    getMode: () => currentMode,
    isEnabled: () => splitScrollLocked,
  });
  installOutlineCaretListeners();
  installEditorPasteHandlers(editor.view.dom);
}

// Clipboard handling on the editor: an image on the clipboard is embedded into
// the saved document (#5); Ctrl+Shift+V converts clipboard HTML to Markdown
// (#6). Both pre-empt CodeMirror's default paste when they apply.
function installEditorPasteHandlers(dom: HTMLElement): void {
  // Plain image paste → embed. (Ctrl+Shift+V HTML→Markdown is a separate
  // keydown handler so it does not interfere with normal image paste.)
  dom.addEventListener('paste', (event) => {
    const e = event as ClipboardEvent;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file' && isImageMime(item.type)) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          void embedImageFile(file);
          return;
        }
      }
    }
    // List paste (todo #5): a list copied as HTML loses its bullet markers in
    // the plain-text flavour CodeMirror would otherwise insert. Convert the
    // HTML to Markdown so the markers survive. Only triggers on real list HTML;
    // plain-text clipboards fall through to the normal paste.
    const html = e.clipboardData?.getData('text/html');
    if (htmlContainsList(html) && editor) {
      e.preventDefault();
      void (async () => {
        try {
          const markdown = await pasteHtmlAsMarkdown(html as string);
          insertAtCursor(editor.view, markdown.replace(/\s+$/, ''));
        } catch (err) {
          showError(`Paste failed: ${String(err)}`);
        }
      })();
    }
  });
}

// Ctrl+Shift+V: convert clipboard HTML to Markdown (sanitized backend-side) and
// insert at the cursor; plain-text clipboard falls through to a normal paste.
// We read the clipboard via the async API on keydown because a synthetic paste
// of the same key would otherwise loop.
async function pasteHtmlAsMarkdownAtCursor(): Promise<void> {
  if (!editor) return;
  try {
    const items = await navigator.clipboard.read();
    let html: string | null = null;
    for (const item of items) {
      if (item.types.includes('text/html')) {
        html = await (await item.getType('text/html')).text();
        break;
      }
    }
    if (html) {
      const markdown = await pasteHtmlAsMarkdown(html);
      insertAtCursor(editor.view, markdown);
      return;
    }
    // No HTML on the clipboard → plain-text paste.
    const text = await navigator.clipboard.readText();
    if (text) insertAtCursor(editor.view, text);
  } catch (err) {
    showError(`Paste failed: ${String(err)}`);
  }
}

// Coalescing keystroke bursts into a single render is owned by the coordinator
// (its internal debounce; default 80ms). Each render re-parses the whole
// document (Rust) and rebuilds the preview DOM (JS main thread); firing one per
// keystroke on a large file pins the main thread and makes typing lag.
// Tab-switch / reload / merge paths call coordinator.schedule() directly so the
// preview updates immediately on those non-typing actions.

function onActiveEdit(): void {
  const tab = store.activeDoc();
  if (!tab || !editor) return;
  if (!tab.pinned) {
    store.updateDoc(tab.id, { pinned: true });
  }
  // baseVersion = latest version scheduled before this edit; the edit's own
  // (debounced) render will be strictly newer, which is how the scroll-sync
  // gate distinguishes it from an in-flight pre-edit render. currentVersion()
  // MUST be read synchronously here, before scheduleDebounced() — the debounced
  // render does not advance the version until it actually fires, so notifyEdit
  // records the pre-edit version.
  scrollSync?.notifyEdit(tab.docId, coordinator.currentVersion());
  coordinator.scheduleDebounced();
  sendDocEdited(tab.docId, editor.getValue());
  scheduleIdleAutosave();
  scheduleCounts();
  // Capture dirty buffers as they change (debounced) so unsaved edits persist.
  saveSession();
}

const scheduleCounts = debounce(() => {
  const tab = store.activeDoc();
  chrome.setCounts(tab && editor ? computeCounts(editor.getValue()) : null);
}, 200);

const sendDocEdited = debounce((docId: number, md: string) => {
  docsApi.docEdited(docId, md)
    .then((state) => setStateByDocId(docId, state))
    .catch((e) => console.error('doc_edited failed:', e));
}, 180);

// ---------------------------------------------------------------------------
// Lifecycle-state application (per active doc tab).
// ---------------------------------------------------------------------------

function refreshChrome(state: FileState): void {
  const ui = uiForState(state);
  chrome.setSaveEnabled(ui.saveEnabled);
  chrome.setModified(ui.modified);
  chrome.setReloadVisible(ui.showReload);
  chrome.setMergeVisible(ui.showMerge);
  chrome.setStatus(ui.status);
  updateTitle();
}

function setStateByDocId(docId: number, state: FileState): void {
  const tab = docTabByDocId(docId);
  if (!tab) return;
  store.updateDoc(tab.id, { fileState: state });
  if (store.activeId() === tab.id) refreshChrome(state);
}

function updateTitle(): void {
  const tab = store.activeDoc();
  // "btr-md — <filename>" when a doc is open, "btr-md — better markdown" otherwise.
  const suffix = tab ? (tab.filePath ? basename(tab.filePath) : 'Untitled') : 'better markdown';
  const modified = tab ? uiForState(tab.fileState).modified : false;
  windowsApi.setWindowTitle(
    modified ? `btr-md — ● ${suffix}` : `btr-md — ${suffix}`,
  ).catch(() => {});
}

// ---------------------------------------------------------------------------
// Autosave / autoreload.
// ---------------------------------------------------------------------------

const scheduleIdleAutosave = debounce(() => {
  if (autosaveMode === 'on_idle') maybeAutosave();
}, 1500);

function maybeAutosave(): void {
  const tab = store.activeDoc();
  if (!tab || tab.fileState.kind !== 'dirty') return;
  saveCurrentDoc().catch(() => {});
}

/** Eligibility snapshot for on_defocus (window blur or leaving a doc tab). */
function defocusEligible(tab: DocTab): boolean {
  return shouldAutosaveOnDefocus({
    mode: autosaveMode,
    filePath: tab.filePath,
    stateKind: tab.fileState.kind,
    bufferDiffersFromBase: tabBuffer(tab) !== tab.baseContent,
  });
}

/** Per-doc trailing coalescer: rapid tab switches must not stampede saves. */
const defocusAutosave = createDefocusSaveCoalescer({
  delayMs: DEFOCUS_AUTOSAVE_DEBOUNCE_MS,
  stillEligible: (docId) => {
    const tab = docTabByDocId(docId);
    return tab ? defocusEligible(tab) : false;
  },
  save: async (docId) => {
    const tab = docTabByDocId(docId);
    if (!tab || !defocusEligible(tab)) return;
    await saveTab(tab);
  },
});

function scheduleDefocusAutosaveForTab(tab: DocTab): void {
  if (!defocusEligible(tab)) return;
  defocusAutosave.schedule(tab.docId);
}

// Window focus loss (alt-tab, other app, OS workspace switch).
window.addEventListener('blur', () => {
  const tab = store.activeDoc();
  if (tab) scheduleDefocusAutosaveForTab(tab);
});
window.setInterval(() => {
  if (autosaveMode === 'on_interval') maybeAutosave();
}, 30_000);

function maybeAutoreload(state: FileState): void {
  if (state.kind === 'disk_changed_clean') {
    if (autoreloadMode === 'when_clean' || autoreloadMode === 'always') doReload();
  } else if (state.kind === 'disk_changed_dirty') {
    if (autoreloadMode === 'always') doReload();
  }
}

// ---------------------------------------------------------------------------
// Tab activation + non-document bodies.
// ---------------------------------------------------------------------------

store.onActivate((prev, next) => {
  if (prev && prev.kind === 'doc' && editor) {
    prev.editorState = editor.snapshot();
    prev.scrollEditor = editor.view.scrollDOM.scrollTop;
    prev.scrollPreview = previewPane.scrollTop;
  }
  // Document focus loss: switching tabs never fires window `blur`, so
  // on_defocus must save the *previous* dirty doc here (after snapshot so
  // tabBuffer can read the stashed editor state).
  if (prev && prev.kind === 'doc') {
    scheduleDefocusAutosaveForTab(prev);
  }
  // A non-doc tab (empty/browser) hides the lock button; a doc tab in split
  // mode shows it. Mode/active-tab changes also need the lock button
  // visibility refreshed (it is also refreshed from `applyMode`).
  applySplitLockVisibility();
  if (!next) {
    document.body.dataset.tabkind = 'empty';
    factsStore.setActiveDoc(null);
    outlinePanel.setHeadings([]);
    outlinePanel.setMode('collapsed');
    clearDocumentIntelligenceUi();
    workspace.setActiveFile(null);
    renderEmptyBody();
    return;
  }
  document.body.dataset.tabkind = next.kind;
  insertMenu?.setEnabled(next.kind === 'doc');
  updateFileOps();
  switch (next.kind) {
    case 'doc':
      activateDocTab(next);
      if (next.filePath) void revealActiveFile(next.filePath);
      else workspace.setActiveFile(null);
      break;
    case 'empty':
      workspace.setActiveFile(null);
      chrome.setCounts(null);
      factsStore.setActiveDoc(null);
      outlinePanel.setHeadings([]);
      outlinePanel.setMode('collapsed');
      clearDocumentIntelligenceUi();
      renderEmptyBody();
      break;
    case 'browser':
      workspace.setActiveFile(null);
      chrome.setCounts(null);
      factsStore.setActiveDoc(null);
      outlinePanel.setHeadings([]);
      outlinePanel.setMode('collapsed');
      clearDocumentIntelligenceUi();
      renderBrowserBody();
      break;
    default:
      assertNever(next);
  }
  saveSession();
});

async function activateDocTab(tab: DocTab): Promise<void> {
  await ensureEditor();
  if (!editor) return;
  if (tab.editorState) editor.activateState(tab.editorState);
  factsStore.setActiveDoc(tab.docId);
  clearDocumentIntelligenceUi();
  trustPolicyPanel.setTrustContext(tab.trustContext);
  void refreshActiveAssetGrants();
  docsApi.setActiveDoc(tab.docId).catch(() => {});
  chrome.setFilename(tab.filePath ? basename(tab.filePath) : 'Untitled', tab.filePath);
  applyMode(tab.mode);
  refreshChrome(tab.fileState);
  await coordinator.schedule();
  chrome.setCounts(computeCounts(editor.getValue()));
  applyDiffMode();
  // Suspend the mirror briefly so the two programmatic scrollTop writes
  // below do not loop the mirror back and rewrite the restored positions.
  scrollMirror?.suspendForMs();
  editor.view.scrollDOM.scrollTop = tab.scrollEditor;
  previewPane.scrollTop = tab.scrollPreview;
  editor.focus();
}

function renderEmptyBody(): void {
  tabBodyEl.replaceChildren();
  const welcome = document.createElement('div');
  welcome.id = 'pmd-welcome';
  welcome.className = 'pmd-welcome';
  welcome.innerHTML = `
    <h1>btr.md</h1>
    <p>better markdown — best-in-class markdown for Linux</p>
    <div class="pmd-welcome-actions">
      <button id="pmd-welcome-open" class="pmd-welcome-btn">Open File</button>
      <button id="pmd-welcome-new" class="pmd-welcome-btn">New File</button>
      <button id="pmd-welcome-browse" class="pmd-welcome-btn">Browse Files</button>
    </div>
    <p class="pmd-welcome-hint">or press Ctrl+O to open, Ctrl+N to create</p>
  `;
  tabBodyEl.appendChild(welcome);
  document.getElementById('pmd-welcome-open')?.addEventListener('click', () => openFileDialog());
  document.getElementById('pmd-welcome-new')?.addEventListener('click', () => newFile());
  document.getElementById('pmd-welcome-browse')?.addEventListener('click', () => store.addBrowser());
}

function renderBrowserBody(): void {
  if (!fileBrowser) {
    fileBrowser = createFileBrowser(browserDeps);
  }
  tabBodyEl.replaceChildren(fileBrowser.el);
}

// ---------------------------------------------------------------------------
// File operations.
// ---------------------------------------------------------------------------

async function addDocTab(
  doc: OpenedDoc,
  opts: { background: boolean; title?: string; baseContent?: string; pinned?: boolean }
): Promise<DocTab> {
  await ensureEditor();
  const filePath = doc.path || null;
  const editorState = editor!.createState(doc.contents, detectDocumentKind(filePath, doc.contents));
  const tab = store.addDoc(
    {
      docId: doc.doc_id,
      filePath,
      title: opts.title ?? (filePath ? basename(filePath) : 'Untitled'),
      mode: currentMode,
      fileState: doc.state,
      // Diff-view baseline: the merge ancestor. Defaults to the loaded contents
      // (clean opens), but a restored dirty doc passes the real baseline.
      baseContent: opts.baseContent ?? doc.contents,
      editorState,
      trustContext: doc.trust_context,
    },
    { background: opts.background, pinned: opts.pinned }
  );
  saveSession();
  return tab;
}

async function newFile(opts: { background?: boolean } = {}): Promise<DocTab | null> {
  try {
    const reg = await docsApi.registerDoc({
      path: null,
      contents: '',
    });
    const background = opts.background ?? false;
    const tab = await addDocTab(
      { doc_id: reg.doc_id, path: '', contents: '', state: reg.state, trust_context: reg.trust_context },
      { background, pinned: true },
    );
    if (background) tabBar.triggerHighlight(tab.id);
    chrome.setStatus('Ready');
    return tab;
  } catch (e) {
    showError(`New file failed: ${String(e)}`);
    return null;
  }
}

async function openFileDialog(): Promise<void> {
  try {
    const doc = await recentApi.openDialog();
    if (doc) {
      const existing = store.findDocByPath(doc.path);
      if (existing) {
        docsApi.dropDoc(doc.doc_id).catch(() => {});
        store.setActive(existing.id);
      } else {
        await addDocTab(doc, { background: false });
      }
      loadRecentFiles();
      chrome.setStatus('Ready');
    }
  } catch (e) {
    showError(`Open dialog failed: ${String(e)}`);
  }
}

function previewTabCandidate(): DocTab | null {
  return store.list().find((tab): tab is DocTab => tab.kind === 'doc' && !tab.pinned) ?? null;
}

async function replacePreviewTab(tab: DocTab, doc: OpenedDoc, pinned: boolean): Promise<DocTab> {
  await ensureEditor();
  const oldDocId = tab.docId;
  const filePath = doc.path || null;
  const patch: Partial<DocTab> = {
    docId: doc.doc_id,
    filePath,
    title: filePath ? basename(filePath) : 'Untitled',
    mode: currentMode,
    fileState: doc.state,
    baseContent: doc.contents,
    editorState: editor!.createState(doc.contents, detectDocumentKind(doc.path || null, doc.contents)),
    cachedHtml: null,
    documentStylesChoice: 'unknown',
    scrollEditor: 0,
    scrollPreview: 0,
    renderSeq: 0,
    reloadPending: false,
    trustContext: doc.trust_context,
    pinned,
  };
  store.updateDoc(tab.id, patch);
  const updated = store.get(tab.id);
  if (!updated || updated.kind !== 'doc') return tab;
  if (store.activeId() === updated.id) {
    await activateDocTab(updated);
    if (updated.filePath) void revealActiveFile(updated.filePath);
  } else {
    store.setActive(updated.id);
  }
  docsApi.dropDoc(oldDocId).catch(() => {});
  saveSession();
  return updated;
}

async function openFile(
  path: string,
  opts: { background?: boolean; pinned?: boolean; replacePreview?: boolean } = {},
): Promise<void> {
  const background = opts.background ?? false;
  const pinned = opts.pinned ?? true;
  const existing = store.findDocByPath(path);
  if (existing) {
    if (pinned && !existing.pinned) store.updateDoc(existing.id, { pinned: true });
    if (background) tabBar.triggerHighlight(existing.id);
    else store.setActive(existing.id);
    return;
  }
  try {
    const doc = await docsApi.requestOpenFile({ path, background: background || false });
    const existing2 = store.findDocByPath(doc.path);
    if (existing2) {
      docsApi.dropDoc(doc.doc_id).catch(() => {});
      if (pinned && !existing2.pinned) store.updateDoc(existing2.id, { pinned: true });
      if (background) tabBar.triggerHighlight(existing2.id);
      else store.setActive(existing2.id);
      return;
    }
    const preview = opts.replacePreview ? previewTabCandidate() : null;
    const tab = preview
      ? await replacePreviewTab(preview, doc, pinned)
      : await addDocTab(doc, { background, pinned });
    if (background) tabBar.triggerHighlight(tab.id);
    loadRecentFiles();
    chrome.setStatus('Ready');
  } catch (e) {
    showError(`Open failed: ${String(e)}`);
  }
}

if (window.__pmdE2e !== undefined) {
  window.__pmdOpenPathForTest = (path: string) => openFile(path);
}

async function saveCurrentDocAs(): Promise<void> {
  const tab = store.activeDoc();
  if (tab) await saveTab(tab, true);
}

async function saveCurrentDoc(): Promise<void> {
  const tab = store.activeDoc();
  if (tab) await saveTab(tab);
}

/** Save a specific document tab. Works even when `tab` is not the active UI tab.
 *  Temporarily shifts backend save-authority to the target doc and restores the
 *  previously-active doc before returning, so the UI/backend active-doc state
 *  stays consistent. Returns the new `FileState` or `null` if the user cancelled
 *  or the save failed. */
async function saveTab(tab: DocTab, forceSaveAs = false): Promise<FileState | null> {
  const activeBefore = store.activeDoc();
  const activeDocIdBefore = activeBefore?.docId;
  let restored = false;

  async function restoreActive(): Promise<void> {
    if (restored) return;
    restored = true;
    if (activeDocIdBefore !== undefined && activeDocIdBefore !== tab.docId) {
      await docsApi.setActiveDoc(activeDocIdBefore).catch(() => {});
    }
  }

  try {
    // Move backend save-authority to the target doc.
    await docsApi.setActiveDoc(tab.docId);

    let path: string | null = null;
    if (forceSaveAs || !tab.filePath) {
      const buffer = tabBuffer(tab);
      const suggested = buffer.split('\n')[0].slice(0, 50) || 'Untitled';
      const picked = await recentApi.saveDialog(suggested + '.md');
      if (!picked) {
        await restoreActive();
        return null;
      }
      path = picked;
    }

    const contents = tabBuffer(tab);
    const state = await docsApi.saveDoc({ docId: tab.docId, contents, path });

    if (path) {
      store.updateDoc(tab.id, { filePath: path, title: basename(path) });
      if (store.activeId() === tab.id) {
        chrome.setFilename(basename(path), path);
        updateFileOps();
        void revealActiveFile(path);
      }
      saveSession();
    }
    store.updateDoc(tab.id, { fileState: state, baseContent: contents });
    if (store.activeId() === tab.id) {
      refreshChrome(state);
      chrome.setStatus('Saved');
    }
    loadRecentFiles();
    await restoreActive();
    return state;
  } catch (e) {
    await restoreActive();
    showError(`Save failed: ${String(e)}`);
    return null;
  }
}

async function doReload(): Promise<void> {
  const tab = store.activeDoc();
  if (!tab || !editor) return;
  try {
    const res = await docsApi.pullFromDisk(tab.docId);
    const cursor = editor.view.state.selection.main.head;
    editor.setValueProgrammatic(res.contents);
    const max = editor.view.state.doc.length;
    editor.view.dispatch({ selection: { anchor: Math.min(cursor, max) } });
    store.updateDoc(tab.id, { fileState: res.state, baseContent: res.contents });
    refreshChrome(res.state);
    await coordinator.schedule();
    applyDiffMode();
    chrome.setStatus('Reloaded from disk');
  } catch (e) {
    showError(`Reload failed: ${String(e)}`);
  }
}

async function doMerge(): Promise<void> {
  const tab = store.activeDoc();
  if (!tab || !editor) return;
  const diskDigestSeen = 'disk' in tab.fileState ? tab.fileState.disk : '';
  try {
    const res = await docsApi.resolveDiskChange({
      docId: tab.docId,
      oursText: editor.getValue(),
      diskDigestSeen,
    });
    editor.setValueProgrammatic(res.merged);
    store.updateDoc(tab.id, { fileState: res.state });
    refreshChrome(res.state);
    await coordinator.schedule();
    chrome.setStatus(
      res.conflicted
        ? 'Merged with conflicts — resolve the markers, then save'
        : 'Merged disk changes into the editor'
    );
  } catch (e) {
    showError(`Merge failed: ${String(e)}`);
  }
}

/** Insert a GitHub alert blockquote at the cursor, body placeholder selected. */
function insertAlert(type: AlertType): void {
  if (!editor || !store.activeDoc()) return;
  const view = editor.view;
  const sel = view.state.selection.main;
  const atLineStart = sel.from === 0 || view.state.doc.sliceString(sel.from - 1, sel.from) === '\n';
  const prefix = atLineStart ? '' : '\n';
  const body = 'Your text here';
  const text = `${prefix}> [!${type.toUpperCase()}]\n> ${body}\n`;
  const start = text.indexOf(body);
  insertAtCursor(view, text, { start, end: start + body.length });
}

/** Insert a footnote: a `[^N]` ref at the cursor + a `[^N]: TODO` definition
 *  appended at the end, with the TODO placeholder selected. */
function insertFootnote(): void {
  if (!editor || !store.activeDoc()) return;
  const view = editor.view;
  const plan = planFootnoteInsertion(view.state.doc.toString());
  const sel = view.state.selection.main;
  const docLen = view.state.doc.length;

  if (sel.to >= docLen) {
    // Cursor at the document end: the def would append right where the ref goes
    // (two changes at the same position overlap), so emit one combined insert.
    const combined = plan.refText + plan.defText;
    const base = plan.refText.length;
    insertAtCursor(view, combined, {
      start: base + plan.placeholder.start,
      end: base + plan.placeholder.end,
    });
    return;
  }

  // Ref at the cursor, definition appended at the end (non-overlapping changes).
  const shift = plan.refText.length - (sel.to - sel.from);
  const anchor = docLen + shift + plan.placeholder.start;
  const head = docLen + shift + plan.placeholder.end;
  dispatchInsert(
    view,
    [
      { from: sel.from, to: sel.to, insert: plan.refText },
      { from: docLen, insert: plan.defText },
    ],
    { anchor, head }
  );
}

/** Whether closing this document tab should prompt the user to save. */
function tabNeedsSaveConfirmation(tab: DocTab): boolean {
  if (uiForState(tab.fileState).modified) return true;
  // Untitled buffers stay `Untitled` regardless of edits, so we detect pending
  // work by comparing the live buffer to the initial empty seed.
  if (tab.fileState.kind === 'untitled') {
    return tabBuffer(tab).trim().length > 0;
  }
  return false;
}

function doCloseTab(id: number): void {
  const tab = store.get(id);
  if (tab && tab.kind === 'doc') {
    defocusAutosave.cancel(tab.docId);
    docsApi.dropDoc(tab.docId).catch(() => {});
  }
  store.close(id);
  if (store.list().length === 0) {
    store.addEmpty();
  }
  saveSession();
}

async function closeTab(id: number): Promise<void> {
  const tab = store.get(id);
  if (!tab) return;
  if (tab.kind !== 'doc' || !tabNeedsSaveConfirmation(tab)) {
    doCloseTab(id);
    return;
  }

  const choice = await showConfirmCloseDialog({ title: tab.title, count: 1 });
  if (choice === 'cancel') return;
  if (choice === 'discard') {
    doCloseTab(id);
    return;
  }

  const state = await saveTab(tab);

  // The user may cancel the save-as dialog or the save may fail; in that case
  // the tab still needs saving, so abort the close instead of discarding.
  if (!state) return;
  const updated = store.get(id);
  if (updated && updated.kind === 'doc' && tabNeedsSaveConfirmation(updated)) {
    return;
  }
  doCloseTab(id);
}

/** Check every document tab in the current window and, if any need saving,
 *  prompt once with Save All / Don't Save All / Cancel. On **Save** the dirty
 *  tabs are saved but left open; on **Discard** they are closed without saving.
 *  Returns `true` if the close should proceed, `false` if the user cancelled.
 *  Limitation: only checks the current window; other open windows are not
 *  consulted before `closeAll` / `quit`. */
async function confirmCloseWindow(): Promise<boolean> {
  const dirtyTabs = store
    .list()
    .filter((t): t is DocTab => t.kind === 'doc' && tabNeedsSaveConfirmation(t));
  if (dirtyTabs.length === 0) return true;

  const choice = await showConfirmCloseDialog({
    title: dirtyTabs.length === 1 ? dirtyTabs[0].title : `${dirtyTabs.length} documents`,
    count: dirtyTabs.length,
  });
  if (choice === 'cancel') return false;

  if (choice === 'save') {
    for (const tab of dirtyTabs) {
      const state = await saveTab(tab);
      if (!state) {
        // Save was cancelled or failed — abort the whole close.
        return false;
      }
    }
    return true;
  }

  // choice === 'discard': close every dirty tab so the session flush does not
  // resurrect discarded buffers on the next launch.
  for (const tab of dirtyTabs) {
    doCloseTab(tab.id);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Event listeners (typed via backend/events.ts EventMap + subscribe).
// ---------------------------------------------------------------------------

subscribe('open-file', (path) => openFile(path)).catch(() => {});

subscribe('activate-doc', (path) => {
  const tab = store.findDocByPath(path);
  if (tab) store.setActive(tab.id);
  else void openFile(path);
}).catch(() => {});

subscribe('doc_state_changed', ({ doc_id, state }) => {
  setStateByDocId(doc_id, state);
  const active = store.activeDoc();
  if (active && active.docId === doc_id) maybeAutoreload(state);
}).catch(() => {});

// Backend recursive watcher on the workspace root coalesces create/rename/delete
// bursts into `workspace_tree_changed`. Debounce again on the UI so stacked
// emits (e.g. high-churn dirs) collapse into a single listing refresh.
const scheduleWorkspaceTreeRefresh = debounce(() => {
  void workspace.refresh();
}, 150);
subscribe('workspace_tree_changed', () => {
  scheduleWorkspaceTreeRefresh();
}).catch(() => {});

subscribe('pmd://diagnostics-enriched', (payload) => {
  if (!factsStore.acceptDiagnostics(payload)) return;
  applyDocumentDiagnostics(payload);
})
  .then((unlisten) => {
    unlistenDiagnostics = unlisten;
  })
  .catch((error) => {
    console.error('Failed to listen for enriched diagnostics', error);
  });

subscribe('pmd://download-denied', (url) => {
  document.dispatchEvent(new CustomEvent('pmd-download-denied', {
    detail: { url },
  }));
}).catch(() => {});

window.addEventListener('beforeunload', () => {
  unlistenDiagnostics?.();
});

subscribe('system_theme_changed', () => {
  handleSystemThemeChange();
}).catch(() => {});

subscribe('mode-change', (mode) => {
  if (isMode(mode)) applyMode(mode);
}).catch(() => {});

// ---------------------------------------------------------------------------
// Session persistence (extracted into session_manager.ts; backend-authoritative).
// ---------------------------------------------------------------------------

const sessionManager = createSessionManager({
  store,
  tabBuffer,
  addDocTab,
  openFile,
  onBeforeClose: confirmCloseWindow,
});
const saveSession = sessionManager.saveSession;

// ---------------------------------------------------------------------------
// Bootstrap.
// ---------------------------------------------------------------------------

function showDefaultHandlerBanner(): void {
  if (document.getElementById('pmd-default-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'pmd-default-banner';
  banner.className = 'pmd-banner';
  const msg = document.createElement('span');
  msg.className = 'pmd-banner-msg';
  msg.textContent = 'Make btr.md your default markdown app?';
  const setBtn = document.createElement('button');
  setBtn.className = 'pmd-btn pmd-btn-primary pmd-btn-sm';
  setBtn.type = 'button';
  setBtn.textContent = 'Set as default';
  setBtn.addEventListener('click', async () => {
    try {
      await settingsApi.setAsDefaultHandler();
      chrome.setStatus('Set as default markdown app');
    } catch (e) {
      showError(`Set default failed: ${String(e)}`);
    }
    banner.remove();
  });
  const noBtn = document.createElement('button');
  noBtn.className = 'pmd-btn pmd-btn-ghost pmd-btn-sm';
  noBtn.type = 'button';
  noBtn.textContent = "Don't ask again";
  noBtn.addEventListener('click', () => {
    settingsApi.setDontAskDefaultHandler(true).catch(() => {});
    banner.remove();
  });
  const dismiss = document.createElement('button');
  dismiss.className = 'pmd-btn pmd-btn-ghost pmd-btn-sm';
  dismiss.type = 'button';
  dismiss.textContent = '×';
  dismiss.title = 'Dismiss';
  dismiss.addEventListener('click', () => banner.remove());
  banner.append(msg, setBtn, noBtn, dismiss);
  document.body.appendChild(banner);
}

async function bootstrap(): Promise<void> {
  sessionManager.clearStaleSession();
  sessionManager.installCloseFlush();

  const settings = await loadSettings();
  if (settings) {
    if (isMode(settings.default_mode)) currentMode = settings.default_mode;
    if (settings.autosave_mode) autosaveMode = settings.autosave_mode;
    if (settings.autoreload_mode) autoreloadMode = settings.autoreload_mode;
    if (settings.browser_base_dir) {
      browserBaseDir = settings.browser_base_dir;
      // Await so the sticky root is established BEFORE bootstrap opens the
      // initial file/session. Otherwise the doc-activate handler would see a
      // null root and re-root to the opened file's parent, silently moving the
      // persisted workspace root.
      await setWorkspaceRoot(settings.browser_base_dir);
    }
    gistEnabled = settings.gist_enabled === true;
    if (settings.diff_mode) diffMode = settings.diff_mode;
    shortcutOverrides = settings.shortcut_overrides ?? {};
    splitScrollLocked = settings.split_scroll_locked === true;
    showFullPath = settings.show_full_path === true;
    chrome.setShowFullPath(showFullPath);
    applyGistVisibility();
    applySplitLockVisibility();
    if (settings.mono_font) applyMonoFont(settings.mono_font);
    if (settings.active_theme) await applyTheme(settings.active_theme);
    await applyAutoSwitchTheme(settings);
    // Offer to become the default markdown handler (once, unless silenced).
    if (!settings.dont_ask_default_handler) {
      settingsApi.defaultHandlerStatus()
        .then((r) => {
          if (r.status === 'not_default') showDefaultHandlerBanner();
        })
        .catch(() => {});
    }
  }
  loadRecentFiles();
  loadRecentlyClosedWindows();

  // Restore this window's persisted session FIRST. A window that has a session
  // slice is a restored window and must never consume the global launch intent
  // (the initial path / open-dialog flag) — otherwise xdg-opening a file while
  // a workspace is being restored would hijack a restored window. Only a
  // window with NO session slice (a clean `main`, or the extra window the
  // backend mints for a launch file) falls through to the launch intent below.
  let hadSession = false;
  try {
    const label = getCurrentWindow().label;
    const w = await sessionApi.getWindowSession(label);
    if (w) {
      hadSession = true;
      await sessionManager.restoreSession({
        version: 2,
        docs: w.docs,
        active: w.active,
        browser_tab: w.browser_tab,
      });
    }
  } catch (e) {
    console.error('Window session restore failed:', e);
  }

  if (hadSession) {
    // Restored window: never touch the launch intent. Guarantee at least one
    // tab if the session restored nothing usable.
    if (store.list().length === 0) store.addEmpty();
    return;
  }

  // Fresh window (no session slice): honour the launch intent.
  let openDialogOnStart = false;
  try {
    openDialogOnStart = await settingsApi.getOpenDialogOnStart();
  } catch (e) {
    console.error('Failed to get open-dialog startup flag:', e);
  }

  let initialPath: string | null = null;
  try {
    initialPath = await docsApi.getInitialPath();
  } catch (e) {
    console.error('Failed to get initial path:', e);
  }

  if (initialPath) {
    await openFile(initialPath);
    return;
  }

  // First run / empty session: a single empty (welcome) tab.
  store.addEmpty();
  if (openDialogOnStart) setTimeout(() => openFileDialog(), 0);
}

chrome.setStatus('Ready');
bootstrap().catch((e) => {
  console.error('Startup failed:', e);
  if (store.list().length === 0) store.addEmpty();
});

export {};
