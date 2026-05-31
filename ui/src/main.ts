import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { mountEditor, type EditorHandle } from './editor.js';
import { createChrome, type Mode } from './chrome.js';
import { attachScrollSync } from './scroll_sync.js';
import { markAllNodes, rerenderForThemeChange } from './theme_apply.js';
import { renderMermaidNodes, setMermaidTheme } from './mermaid_runner.js';
import { renderMathNodes } from './katex_runner.js';
import { decorateCodeBlocks } from './code_blocks.js';
import { openThemePicker, isPickerOpen, closeThemePicker, type ThemeInfo } from './picker.js';
import { debounce } from './debounce.js';
import {
  uiForState,
  assertNever,
  type FileState,
  type DocStateChanged,
  type AutosaveMode,
  type AutoreloadMode,
  type DiffMode,
} from './doc_state.js';
import { createTabStore, type Tab, type DocTab } from './tabs.js';
import { createTabBar, type TabBarInstance } from './tabbar.js';
import { createFileBrowser, type FileBrowserInstance, type DirListing } from './file_browser.js';
import { createWorkspaceModel, parentOf } from './workspace.js';
import { createSettingsMenu, type SettingsSnapshot, type HandlerStatus } from './settings_menu.js';
import { computeCounts } from './counts.js';
import { createInsertMenu, type AlertType, type InsertMenuInstance } from './insert_menu.js';
import { planFootnoteInsertion } from './footnotes.js';
import { insertAtCursor, dispatchInsert } from './editor_insert.js';
import { decorateTables } from './table_copy.js';
import { reconcileBlocks, type BlockRef } from './block_reconcile.js';
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
import { createShortcutEditor } from './shortcut_editor.js';
import {
  attachPreviewLinkActivation,
  createExternalConfirmationDialog,
  handleLinkActivationResponse,
  type OpenedDocumentFromLink,
} from './link_activation.js';
import {
  type DocumentDiagnostics,
  type AssetGrant,
  type DocumentTrustContext,
  type HeadingFact,
  type RenderResult,
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
  listAssetGrants,
  revokeAssetGrantForDocument,
} from './local_asset_grants.js';
import {
  forgetTrustRoot,
  grantRecommendedRoot,
  listTrustRoots,
  rememberDeclinedRoot,
} from './trust_roots.js';

interface Settings {
  active_theme: string | null;
  light_theme: string | null;
  dark_theme: string | null;
  auto_switch: boolean;
  default_mode: string | null;
  autosave_mode: AutosaveMode;
  autoreload_mode: AutoreloadMode;
  browser_base_dir: string | null;
  gist_enabled: boolean;
  diff_mode: DiffMode;
  dont_ask_default_handler: boolean;
  mono_font: string | null;
  shortcut_overrides: ShortcutOverrides;
}

declare global {
  interface Window {
    __pmdE2e?: boolean;
    __pmdE2eActions?: string[];
    __pmdOpenPathForTest?: (path: string) => Promise<void>;
  }
}

interface OpenedDoc {
  doc_id: number;
  path: string;
  contents: string;
  state: FileState;
  trust_context: DocumentTrustContext | null;
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
  appContainer.style.setProperty('--pmd-sidebar-w', `${clamped}px`);
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
  const w = appContainer.style.getPropertyValue('--pmd-sidebar-w').replace('px', '');
  localStorage.setItem(SIDEBAR_WIDTH_KEY, w || '260');
};
sidebarResizer.addEventListener('pointerup', endSidebarResize);
sidebarResizer.addEventListener('pointercancel', endSidebarResize);

appContainer.appendChild(sidebarEl);
appContainer.appendChild(sidebarResizer);
appContainer.appendChild(mainRegion);
document.body.appendChild(appContainer);

const workspace = createWorkspaceModel({
  listDir: (dir) => invoke<DirListing>('list_dir', { dir }),
});

async function setWorkspaceRoot(path: string): Promise<boolean> {
  try {
    const canon = await invoke<string>('set_workspace_root', { path });
    await workspace.setRoot(canon);
    return true;
  } catch (e) {
    console.warn('set_workspace_root rejected:', e);
    return false;
  }
}

// Keep the workspace's active-file highlight mirroring the active document.
// Cold-start only: when no sticky root exists yet, default it to the file's
// parent folder. Once a root exists it is sticky — opening files never moves
// it; we just reveal/clear the active-file highlight against the current root.
async function revealActiveFile(filePath: string): Promise<void> {
  if (!workspace.root()) {
    const parent = parentOf(filePath);
    if (parent) await setWorkspaceRoot(parent);
  }
  await workspace.revealFile(filePath);
}

const browserDeps = {
  model: workspace,
  pickBaseDir: () => invoke<string | null>('pick_base_dir'),
  onOpenFile: (path: string, opts: { background: boolean }) =>
    openFile(path, { background: opts.background }),
  setRoot: setWorkspaceRoot,
  revealInFolder: (path: string) => {
    void invoke('reveal_in_folder', { path });
  },
};

const sidebarBrowser = createFileBrowser(browserDeps);
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

const store = createTabStore();
const tabBar: TabBarInstance = createTabBar(store, {
  onSelect: (id) => store.setActive(id),
  onClose: (id) => closeTab(id),
  onNewTab: (shift) => {
    if (shift) {
      const t = store.addEmpty({ background: true });
      tabBar.triggerHighlight(t.id);
    } else {
      store.addEmpty();
    }
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
    getSettings: () => invoke<SettingsSnapshot>('get_settings'),
    setAutosaveMode: (m) => invoke('set_autosave_mode', { mode: m }).then(() => {}),
    setAutoreloadMode: (m) => invoke('set_autoreload_mode', { mode: m }).then(() => {}),
    setMergeStrategy: (m) => invoke('set_merge_strategy', { strategy: m }).then(() => {}),
    setGistEnabled: (e) => invoke('set_gist_enabled', { enabled: e }).then(() => {}),
    setDiffMode: (m) => invoke('set_diff_mode', { mode: m }).then(() => {}),
    pickBaseDir: () => invoke<string | null>('pick_base_dir'),
    getDefaultHandlerStatus: () =>
      invoke<{ status: HandlerStatus; platform: string }>('default_handler_status').then(
        (r) => r.status
    ),
    setAsDefaultHandler: () => invoke('set_as_default_handler').then(() => {}),
    setMonoFont: (f) => invoke('set_mono_font', { font: f }).then(() => {}),
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

  const sidebarToggleBtn = document.createElement('button');
  sidebarToggleBtn.className = 'pmd-btn pmd-btn-ghost pmd-btn-sm';
  sidebarToggleBtn.type = 'button';
  sidebarToggleBtn.textContent = '▌';
  sidebarToggleBtn.title = 'Toggle sidebar (Ctrl+B)';
  sidebarToggleBtn.addEventListener('click', () => {
    void actionRegistry.runAction('view.toggleSidebar');
  });
  toolbarEl.appendChild(sidebarToggleBtn);
}

function applyGistVisibility(): void {
  if (gistBtn) gistBtn.style.display = gistEnabled ? '' : 'none';
}

function setPreviewZoom(value: number): void {
  previewZoom = Math.max(0.5, Math.min(2, value));
  previewContent.style.fontSize = `${previewZoom}rem`;
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
    await invoke('open_url', { url: 'https://gist.github.com/' });
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
let fileBrowser: FileBrowserInstance | null = null;
let currentMode: Mode = 'split';
let autosaveMode: AutosaveMode = 'off';
let autoreloadMode: AutoreloadMode = 'when_clean';
let browserBaseDir: string | null = null;
let gistEnabled = false;
let diffMode: DiffMode = 'none';
let gistBtn: HTMLButtonElement | null = null;
let shortcutOverrides: ShortcutOverrides = {};
let previewZoom = 1;

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
      if (id !== null) closeTab(id);
      return;
    }
    case 'app.quit':
      await getCurrentWindow().close();
      return;
    case 'view.zoomIn':
      setPreviewZoom(previewZoom + 0.1);
      return;
    case 'view.zoomOut':
      setPreviewZoom(previewZoom - 0.1);
      return;
    case 'view.zoomReset':
      setPreviewZoom(1);
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
      if (p) await invoke('reveal_in_folder', { path: p }).catch((e) => showError(`Reveal failed: ${String(e)}`));
      return;
    }
    case 'file.openDefaultApp': {
      const p = activeFilePath();
      if (p) await invoke('open_in_default_app', { path: p }).catch((e) => showError(`Open failed: ${String(e)}`));
      return;
    }
    case 'file.clearRecent':
      await invoke('clear_recent_files');
      chrome.setRecentFiles([]);
      return;
    case 'document.reloadFromDisk':
      await doReload();
      return;
    case 'document.mergeDiskChanges':
      await doMerge();
      return;
    case 'navigate.fileBrowser':
      store.addBrowser();
      return;
    case 'share.openGist':
    case 'share.copyGistMarkdown':
      await openGist();
      return;
    case 'edit.find':
    case 'edit.findNext':
    case 'edit.findPrevious':
      editor?.focus();
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
    const settings = await invoke<Settings>('set_shortcut_overrides', { overrides });
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

const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd'];

function isMarkdownFileName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return MARKDOWN_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase());
}

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
  const spec = defaultActionSpecs.find((item) => item.id === action);
  if (!spec || !isImplementedDiagnosticAction(action)) {
    chrome.setStatus(action);
    return;
  }
  await runAction(spec.id);
}

function isImplementedDiagnosticAction(action: string): boolean {
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
  renderInlineIssues(previewContent, []);
}

function docTabByDocId(docId: number): DocTab | undefined {
  return store.list().find((t): t is DocTab => t.kind === 'doc' && t.docId === docId);
}

function currentPreviewDoc(): { doc_id: number; version: number } | null {
  const tab = store.activeDoc();
  const version = Number(previewContent.dataset.versionApplied || '0');
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
  await scheduleRender();
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
  await scheduleRender();
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
  await scheduleRender();
}

async function revokeAssetGrant(grantId?: number): Promise<void> {
  const active = store.activeDoc();
  if (!active || grantId === undefined) return;
  await revokeAssetGrantForDocument({ docId: active.docId, grantId });
  await refreshActiveAssetGrants();
  await scheduleRender();
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
    invoke('drop_doc', { docId: doc.doc_id }).catch(() => {});
    store.setActive(existing.id);
    return;
  }
  await addDocTab(doc, { background: false });
  loadRecentFiles();
  chrome.setStatus('Ready');
}

attachPreviewLinkActivation(previewContent, {
  currentDoc: currentPreviewDoc,
  invoke,
  handleResponse: (response, doc) =>
    handleLinkActivationResponse({
      response,
      docId: doc.doc_id,
      version: doc.version,
      invoke,
      scrollToBlock: scrollPreviewToBlock,
      openDocument: adoptOpenedDocumentFromLink,
      showMessage: (message) => chrome.setStatus(message),
      externalConfirmation,
    }).catch((error) => showError(`Link failed: ${String(error)}`)),
});

// ---------------------------------------------------------------------------
// Drag & drop.
// ---------------------------------------------------------------------------

document.body.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
});

document.body.addEventListener('drop', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  const file = files[0];
  if (!isMarkdownFileName(file.name)) {
    showError(`Not a markdown file: ${file.name}`);
    return;
  }
  const path = (file as any).path;
  if (path) {
    openFile(path);
  } else {
    const contents = await file.text();
    try {
      const reg = await invoke<{ doc_id: number; state: FileState }>('register_doc', {
        path: null,
        contents,
      });
      await addDocTab(
        { doc_id: reg.doc_id, path: '', contents, state: reg.state },
        { background: false, title: file.name }
      );
    } catch (err) {
      showError(`Open failed: ${String(err)}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Theme + recents + hotkeys (largely unchanged from before).
// ---------------------------------------------------------------------------

let cachedThemes: ThemeInfo[] = [];
async function loadThemes(): Promise<ThemeInfo[]> {
  if (cachedThemes.length > 0) return cachedThemes;
  try {
    cachedThemes = await invoke<ThemeInfo[]>('list_themes');
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
      await invoke('set_theme_pair', payload);
      await invoke('set_auto_switch', { autoSwitch: true });
    }
    await applyTheme(slug);
  });
}

chrome.onThemePickerClick(() => showThemePicker());
chrome.onReloadClick(() => doReload());
chrome.onSaveClick(() => saveCurrentDoc());
chrome.onMergeClick(() => doMerge());

// Quick file ops (File menu). Operate on the active document's path.
function activeFilePath(): string | null {
  const t = store.activeDoc();
  return t ? t.filePath : null;
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
  if (p) invoke('reveal_in_folder', { path: p }).catch((e) => showError(`Reveal failed: ${String(e)}`));
});
chrome.onOpenInApp(() => {
  const p = activeFilePath();
  if (p) invoke('open_in_default_app', { path: p }).catch((e) => showError(`Open failed: ${String(e)}`));
});
chrome.setFileOpsEnabled(false);

async function loadRecentFiles(): Promise<void> {
  try {
    const files = await invoke<string[]>('get_recent_files');
    chrome.setRecentFiles(files);
  } catch (e) {
    console.error('loadRecentFiles failed:', e);
  }
}

chrome.onRecentFileSelect((path: string) => openFile(path));
chrome.onClearRecentFiles(async () => {
  await invoke('clear_recent_files');
  chrome.setRecentFiles([]);
});

async function applyTheme(slug: string) {
  try {
    const bundle = await invoke<{ css: string; mermaid_vars: Record<string, string>; mode: string; warnings?: string[] }>('set_theme', { slug });
    try {
      await invoke('set_active_theme', { slug });
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
    requestAnimationFrame(() => rerenderForThemeChange(previewContent, { vars: bundle.mermaid_vars }));
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
    return await invoke<Settings>('get_settings');
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
  invoke('set_default_mode', { mode }).catch((e) => console.error('set_default_mode failed:', e));
});

// ---------------------------------------------------------------------------
// Tab-aware rendering: each render carries {tabId, seq}; a result is painted
// only if it is still the latest render for the tab that is still active.
// ---------------------------------------------------------------------------

interface RenderItem {
  md: string;
  tabId: number;
  docId: number;
  seq: number;
  version: number;
  resolve: () => void;
  reject: (e: unknown) => void;
}

let renderQueue: RenderItem[] = [];
let rendering = false;
let currentVersion = 0;

function scheduleRender(): Promise<void> {
  // Drop any pending debounced edit-render: this render supersedes it (covers
  // immediate tab-switch/reload/merge renders, and the debounced fire itself).
  scheduleRenderDebounced.cancel();
  const tab = store.activeDoc();
  if (!tab || !editor) return Promise.resolve();
  tab.renderSeq++;
  const version = ++currentVersion;
  const item: Omit<RenderItem, 'resolve' | 'reject'> = {
    md: editor.getValue(),
    tabId: tab.id,
    docId: tab.docId,
    seq: tab.renderSeq,
    version,
  };
  return new Promise<void>((resolve, reject) => {
    renderQueue.push({ ...item, resolve, reject });
    processRenderQueue();
  });
}

async function processRenderQueue(): Promise<void> {
  if (rendering || renderQueue.length === 0) return;
  rendering = true;
  const item = renderQueue.shift()!;
  try {
    const result = await invoke<RenderResult>('render_cmd', {
      docId: item.docId,
      version: item.version,
      markdown: item.md,
    });
    const tab = store.get(item.tabId);
    const stillCurrent =
      tab &&
      tab.kind === 'doc' &&
      tab.renderSeq === item.seq &&
      tab.docId === result.doc_id &&
      result.version === item.version &&
      store.activeId() === item.tabId;
    if (stillCurrent) {
      previewContent.dataset.versionApplied = String(result.version);
      previewContent.dataset.pmdNonce = result.render_nonce;
      if (result.blocks && result.blocks.length > 0) {
        const frag = document.createElement('div');
        frag.innerHTML = result.html;
        const changed = reconcileBlocks(previewContent, frag, result.blocks);
        for (const node of changed) {
          markAllNodes(node, result.render_nonce);
          await renderMermaidNodes(node, result.render_nonce);
          await renderMathNodes(node, result.render_nonce);
          decorateCodeBlocks(node);
          decorateTables(node, () => editor?.getValue() ?? '');
        }
        // Refresh the nonce on all kept (unchanged) nodes so that a later
        // theme change (rerenderForThemeChange) does not skip them — it
        // filters by the current root nonce.
        previewContent.querySelectorAll<HTMLElement>('[data-pmd-nonce]')
          .forEach((el) => { el.dataset.pmdNonce = result.render_nonce; });
      } else {
        previewContent.innerHTML = result.html;
        markAllNodes(previewContent, result.render_nonce);
        await renderMermaidNodes(previewContent, result.render_nonce);
        await renderMathNodes(previewContent, result.render_nonce);
        decorateCodeBlocks(previewContent);
        decorateTables(previewContent, () => editor?.getValue() ?? '');
      }
      applyOutlineRender(result);
      void refreshActiveAssetGrants();
    }
    item.resolve();
  } catch (e) {
    item.reject(e);
  } finally {
    rendering = false;
    processRenderQueue();
  }
}

// ---------------------------------------------------------------------------
// Editor + per-tab edit handling.
// ---------------------------------------------------------------------------

async function ensureEditor(): Promise<void> {
  if (editor) return;
  editor = await mountEditor(editorPane, () => onActiveEdit());
  attachScrollSync(editor.view, previewPane);
  installOutlineCaretListeners();
}

// Coalesce keystroke bursts into a single render. Each render re-parses the
// whole document (Rust) and rebuilds the preview DOM (JS main thread); firing
// one per keystroke on a large file pins the main thread and makes typing lag.
// Tab-switch / reload / merge paths still call scheduleRender() directly so the
// preview updates immediately on those non-typing actions.
const scheduleRenderDebounced = debounce(() => {
  scheduleRender();
}, 80);

function onActiveEdit(): void {
  const tab = store.activeDoc();
  if (!tab || !editor) return;
  scheduleRenderDebounced();
  sendDocEdited(tab.docId, editor.getValue());
  scheduleIdleAutosave();
  scheduleCounts();
}

const scheduleCounts = debounce(() => {
  const tab = store.activeDoc();
  chrome.setCounts(tab && editor ? computeCounts(editor.getValue()) : null);
}, 200);

const sendDocEdited = debounce((docId: number, md: string) => {
  invoke<FileState>('doc_edited', { docId, contents: md })
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
  invoke('set_window_title', {
    title: modified ? `btr-md — ● ${suffix}` : `btr-md — ${suffix}`,
  }).catch(() => {});
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

window.addEventListener('blur', () => {
  if (autosaveMode === 'on_defocus') maybeAutosave();
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
  invoke('set_active_doc', { docId: tab.docId }).catch(() => {});
  chrome.setFilename(tab.filePath ? basename(tab.filePath) : 'Untitled');
  applyMode(tab.mode);
  refreshChrome(tab.fileState);
  await scheduleRender();
  chrome.setCounts(computeCounts(editor.getValue()));
  applyDiffMode();
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
  opts: { background: boolean; title?: string }
): Promise<DocTab> {
  await ensureEditor();
  const editorState = editor!.createState(doc.contents);
  const filePath = doc.path || null;
  const tab = store.addDoc(
    {
      docId: doc.doc_id,
      filePath,
      title: opts.title ?? (filePath ? basename(filePath) : 'Untitled'),
      mode: currentMode,
      fileState: doc.state,
      baseContent: doc.contents,
      editorState,
      trustContext: doc.trust_context,
    },
    { background: opts.background }
  );
  saveSession();
  return tab;
}

async function newFile(): Promise<void> {
  try {
    const reg = await invoke<{ doc_id: number; state: FileState; trust_context: DocumentTrustContext | null }>('register_doc', {
      path: null,
      contents: '',
    });
    await addDocTab({ doc_id: reg.doc_id, path: '', contents: '', state: reg.state, trust_context: reg.trust_context }, { background: false });
    chrome.setStatus('Ready');
  } catch (e) {
    showError(`New file failed: ${String(e)}`);
  }
}

async function openFileDialog(): Promise<void> {
  try {
    const doc = await invoke<OpenedDoc | null>('open_dialog');
    if (doc) {
      const existing = store.findDocByPath(doc.path);
      if (existing) {
        invoke('drop_doc', { docId: doc.doc_id }).catch(() => {});
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

async function openFile(path: string, opts: { background?: boolean } = {}): Promise<void> {
  const background = opts.background ?? false;
  const existing = store.findDocByPath(path);
  if (existing) {
    if (background) tabBar.triggerHighlight(existing.id);
    else store.setActive(existing.id);
    return;
  }
  try {
    const doc = await invoke<OpenedDoc>('request_open_file', { path, background: background || false });
    const existing2 = store.findDocByPath(doc.path);
    if (existing2) {
      invoke('drop_doc', { docId: doc.doc_id }).catch(() => {});
      if (background) tabBar.triggerHighlight(existing2.id);
      else store.setActive(existing2.id);
      return;
    }
    const tab = await addDocTab(doc, { background });
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
  await saveCurrentDoc(true);
}

async function saveCurrentDoc(forceSaveAs = false): Promise<void> {
  const tab = store.activeDoc();
  if (!tab || !editor) return;
  try {
    let path: string | null = null;
    if (forceSaveAs || !tab.filePath) {
      const suggested = editor.getValue().split('\n')[0].slice(0, 50) || 'Untitled';
      const picked = await invoke<string | null>('save_dialog', { suggestedName: suggested + '.md' });
      if (!picked) return;
      path = picked;
    }
    const contents = editor.getValue();
    const state = await invoke<FileState>('save_doc', { docId: tab.docId, contents, path });
    if (path) {
      store.updateDoc(tab.id, { filePath: path, title: basename(path) });
      chrome.setFilename(basename(path));
      updateFileOps();
      saveSession();
      // Keep the workspace active-file highlight in sync with the new path.
      void revealActiveFile(path);
    }
    store.updateDoc(tab.id, { fileState: state, baseContent: contents });
    refreshChrome(state);
    chrome.setStatus('Saved');
    loadRecentFiles();
  } catch (e) {
    showError(`Save failed: ${String(e)}`);
  }
}

async function doReload(): Promise<void> {
  const tab = store.activeDoc();
  if (!tab || !editor) return;
  try {
    const res = await invoke<{ contents: string; state: FileState }>('pull_from_disk', {
      docId: tab.docId,
    });
    const cursor = editor.view.state.selection.main.head;
    editor.setValueProgrammatic(res.contents);
    const max = editor.view.state.doc.length;
    editor.view.dispatch({ selection: { anchor: Math.min(cursor, max) } });
    store.updateDoc(tab.id, { fileState: res.state, baseContent: res.contents });
    refreshChrome(res.state);
    await scheduleRender();
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
    const res = await invoke<{ merged: string; state: FileState; conflicted: boolean }>(
      'resolve_disk_change',
      { docId: tab.docId, oursText: editor.getValue(), diskDigestSeen }
    );
    editor.setValueProgrammatic(res.merged);
    store.updateDoc(tab.id, { fileState: res.state });
    refreshChrome(res.state);
    await scheduleRender();
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

function closeTab(id: number): void {
  const tab = store.get(id);
  if (tab && tab.kind === 'doc') {
    invoke('drop_doc', { docId: tab.docId }).catch(() => {});
  }
  store.close(id);
  if (store.list().length === 0) {
    store.addEmpty();
  }
  saveSession();
}

// ---------------------------------------------------------------------------
// Event listeners.
// ---------------------------------------------------------------------------

listen<string>('open-file', (event) => openFile(event.payload)).catch(() => {});

listen<DocStateChanged>('doc_state_changed', (event) => {
  const { doc_id, state } = event.payload;
  setStateByDocId(doc_id, state);
  const active = store.activeDoc();
  if (active && active.docId === doc_id) maybeAutoreload(state);
}).catch(() => {});

listen<DocumentDiagnostics>('pmd://diagnostics-enriched', (event) => {
  if (!factsStore.acceptDiagnostics(event.payload)) return;
  applyDocumentDiagnostics(event.payload);
})
  .then((unlisten) => {
    unlistenDiagnostics = unlisten;
  })
  .catch((error) => {
    console.error('Failed to listen for enriched diagnostics', error);
  });

window.addEventListener('beforeunload', () => {
  unlistenDiagnostics?.();
});

listen('system_theme_changed', handleSystemThemeChange).catch(() => {});

listen<string>('mode-change', (event) => {
  const mode = event.payload as Mode;
  if (isMode(mode)) applyMode(mode);
}).catch(() => {});

// ---------------------------------------------------------------------------
// Session persistence (open doc paths + per-tab mode + browser tab).
// ---------------------------------------------------------------------------

const SESSION_KEY = 'pmd:session';

interface SessionDoc {
  path: string;
  mode: Mode;
}
interface SessionData {
  docs: SessionDoc[];
  browser: boolean;
  activePath: string | null;
  activeKind: Tab['kind'] | null;
}

const saveSession = debounce(() => {
  const docs: SessionDoc[] = [];
  let browser = false;
  for (const tab of store.list()) {
    if (tab.kind === 'doc' && tab.filePath) docs.push({ path: tab.filePath, mode: tab.mode });
    else if (tab.kind === 'browser') browser = true;
  }
  const active = store.active();
  const data: SessionData = {
    docs,
    browser,
    activePath: active && active.kind === 'doc' ? active.filePath : null,
    activeKind: active ? active.kind : null,
  };
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}, 300);

function readSession(): SessionData | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

async function restoreSession(session: SessionData): Promise<boolean> {
  let opened = 0;
  for (const d of session.docs) {
    try {
      await openFile(d.path, { background: true });
      const tab = store.findDocByPath(d.path);
      if (tab) {
        store.updateDoc(tab.id, { mode: d.mode });
        opened++;
      }
    } catch {
      /* path no longer admissible — skip */
    }
  }
  if (session.browser) store.addBrowser({ background: true });
  // Restore the active tab.
  if (session.activeKind === 'doc' && session.activePath) {
    const t = store.findDocByPath(session.activePath);
    if (t) store.setActive(t.id);
  } else if (session.activeKind === 'browser') {
    store.addBrowser();
  }
  return opened > 0 || session.browser;
}

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
      await invoke('set_as_default_handler');
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
    invoke('set_dont_ask_default_handler', { value: true }).catch(() => {});
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
    applyGistVisibility();
    if (settings.mono_font) applyMonoFont(settings.mono_font);
    if (settings.active_theme) await applyTheme(settings.active_theme);
    await applyAutoSwitchTheme(settings);
    // Offer to become the default markdown handler (once, unless silenced).
    if (!settings.dont_ask_default_handler) {
      invoke<{ status: HandlerStatus }>('default_handler_status')
        .then((r) => {
          if (r.status === 'not_default') showDefaultHandlerBanner();
        })
        .catch(() => {});
    }
  }
  loadRecentFiles();

  let openDialogOnStart = false;
  try {
    openDialogOnStart = await invoke<boolean>('get_open_dialog_on_start');
  } catch (e) {
    console.error('Failed to get open-dialog startup flag:', e);
  }

  let initialPath: string | null = null;
  try {
    initialPath = await invoke<string | null>('get_initial_path');
  } catch (e) {
    console.error('Failed to get initial path:', e);
  }

  if (initialPath) {
    await openFile(initialPath);
    return;
  }

  // No CLI file: try to restore the previous session.
  const session = readSession();
  let restored = false;
  if (session) {
    try {
      restored = await restoreSession(session);
    } catch (e) {
      console.error('Session restore failed:', e);
    }
  }

  if (!restored) {
    // First run / empty session: a single empty (welcome) tab.
    store.addEmpty();
    if (openDialogOnStart) setTimeout(() => openFileDialog(), 0);
  }
}

chrome.setStatus('Ready');
bootstrap().catch((e) => {
  console.error('Startup failed:', e);
  if (store.list().length === 0) store.addEmpty();
});

export {};
