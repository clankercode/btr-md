import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { mountEditor, type EditorHandle } from './editor.js';
import { createChrome, type Mode } from './chrome.js';
import { createHotkeyHandler, createOverlay } from './hotkeys.js';
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
} from './doc_state.js';
import { createTabStore, type Tab, type DocTab } from './tabs.js';
import { createTabBar, type TabBarInstance } from './tabbar.js';
import { createFileBrowser, type FileBrowserInstance } from './file_browser.js';

interface RenderResult {
  html: string;
  version: number;
  render_nonce: string;
}

interface Settings {
  active_theme: string | null;
  light_theme: string | null;
  dark_theme: string | null;
  auto_switch: boolean;
  default_mode: string | null;
  autosave_mode: AutosaveMode;
  autoreload_mode: AutoreloadMode;
  browser_base_dir: string | null;
}

interface OpenedDoc {
  doc_id: number;
  path: string;
  contents: string;
  state: FileState;
}

// ---------------------------------------------------------------------------
// Layout: editor/preview panes for document tabs + a separate body for
// empty/browser tabs. `body[data-tabkind]` toggles which is visible (CSS).
// ---------------------------------------------------------------------------

const previewPane = document.getElementById('preview-pane') as HTMLElement;
const previewContent = document.getElementById('pmd-content') as HTMLElement;
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

const appContainer = document.createElement('div');
appContainer.id = 'app-container';
appContainer.appendChild(editorPane);
appContainer.appendChild(splitResizer);
appContainer.appendChild(previewPane);
appContainer.appendChild(tabBodyEl);
document.body.appendChild(appContainer);

const SPLIT_RATIO_KEY = 'pmd:split-ratio';
const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;
const DEFAULT_RATIO = 0.4;

function clampRatio(r: number): number {
  return Math.max(MIN_RATIO, Math.min(MAX_RATIO, r));
}

function applySplitRatio(ratio: number): void {
  const clamped = clampRatio(ratio);
  appContainer.style.setProperty('--pmd-split-ratio', String(clamped));
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
  const rect = appContainer.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;
  applySplitRatio(ratio);
});
function endResize(e: PointerEvent) {
  if (!resizing) return;
  resizing = false;
  splitResizer.releasePointerCapture(e.pointerId);
  document.body.classList.remove('pmd-resizing');
  const ratio = parseFloat(appContainer.style.getPropertyValue('--pmd-split-ratio') || '0.5');
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
    appContainer.style.getPropertyValue('--pmd-split-ratio') || String(DEFAULT_RATIO)
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
const hotkeyOverlay = createOverlay();
hotkeyOverlay.style.display = 'none';
document.body.appendChild(hotkeyOverlay);

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

let editor: EditorHandle | null = null;
let fileBrowser: FileBrowserInstance | null = null;
let currentMode: Mode = 'split';
let autosaveMode: AutosaveMode = 'off';
let autoreloadMode: AutoreloadMode = 'when_clean';
let browserBaseDir: string | null = null;

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

function docTabByDocId(docId: number): DocTab | undefined {
  return store.list().find((t): t is DocTab => t.kind === 'doc' && t.docId === docId);
}

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

document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.ctrlKey && e.key === 't') {
    e.preventDefault();
    showThemePicker();
  }
  if (e.ctrlKey && e.key === 'n') {
    e.preventDefault();
    newFile();
  }
  if (e.ctrlKey && e.key === 'o') {
    e.preventDefault();
    openFileDialog();
  }
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    saveCurrentDoc();
  }
  if (e.ctrlKey && e.key === 'w') {
    e.preventDefault();
    const id = store.activeId();
    if (id !== null) closeTab(id);
  }
  if (e.altKey && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    if (editor) {
      const wrap = editor.toggleWrap();
      chrome.setStatus(wrap ? 'Word wrap on' : 'Word wrap off');
    }
  }
});

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
      bundle.warnings.forEach((w: string) => console.warn(`[preview-md] Theme "${slug}": ${w}`));
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

const setupHotkeys = createHotkeyHandler(
  () => currentMode,
  (mode) => applyMode(mode),
  () => {
    hotkeyOverlay.style.display = 'flex';
  }
);
setupHotkeys();

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
  seq: number;
  resolve: () => void;
  reject: (e: unknown) => void;
}

let renderQueue: RenderItem[] = [];
let rendering = false;
let currentVersion = 0;

function scheduleRender(): Promise<void> {
  const tab = store.activeDoc();
  if (!tab || !editor) return Promise.resolve();
  tab.renderSeq++;
  const item: Omit<RenderItem, 'resolve' | 'reject'> = {
    md: editor.getValue(),
    tabId: tab.id,
    seq: tab.renderSeq,
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
    currentVersion++;
    const result = await invoke<RenderResult>('render_cmd', {
      version: currentVersion,
      markdown: item.md,
    });
    const tab = store.get(item.tabId);
    const stillCurrent =
      tab && tab.kind === 'doc' && tab.renderSeq === item.seq && store.activeId() === item.tabId;
    if (stillCurrent) {
      previewContent.innerHTML = result.html;
      previewContent.dataset.versionApplied = String(result.version);
      previewContent.dataset.pmdNonce = result.render_nonce;
      markAllNodes(previewContent, result.render_nonce);
      await renderMermaidNodes(previewContent, result.render_nonce);
      await renderMathNodes(previewContent, result.render_nonce);
      decorateCodeBlocks(previewContent);
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
}

function onActiveEdit(): void {
  const tab = store.activeDoc();
  if (!tab || !editor) return;
  scheduleRender();
  sendDocEdited(tab.docId, editor.getValue());
  scheduleIdleAutosave();
}

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
  const name = tab ? (tab.filePath ? basename(tab.filePath) : 'Untitled') : 'preview-md';
  const modified = tab ? uiForState(tab.fileState).modified : false;
  invoke('set_window_title', {
    title: modified ? `● ${name} — preview-md` : `${name} — preview-md`,
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
    renderEmptyBody();
    return;
  }
  document.body.dataset.tabkind = next.kind;
  switch (next.kind) {
    case 'doc':
      activateDocTab(next);
      break;
    case 'empty':
      renderEmptyBody();
      break;
    case 'browser':
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
  invoke('set_active_doc', { docId: tab.docId }).catch(() => {});
  chrome.setFilename(tab.filePath ? basename(tab.filePath) : 'Untitled');
  applyMode(tab.mode);
  refreshChrome(tab.fileState);
  await scheduleRender();
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
    <h1>preview-md</h1>
    <p>Best-in-class markdown preview for Linux</p>
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
    fileBrowser = createFileBrowser({
      initialBaseDir: browserBaseDir,
      listDir: (dir) => invoke('list_dir', { dir }),
      pickBaseDir: () => invoke<string | null>('pick_base_dir'),
      onOpenFile: (path, opts) => openFile(path, opts),
      onBaseDirChange: (dir) => {
        browserBaseDir = dir;
        saveSession();
      },
    });
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
      editorState,
    },
    { background: opts.background }
  );
  saveSession();
  return tab;
}

async function newFile(): Promise<void> {
  try {
    const reg = await invoke<{ doc_id: number; state: FileState }>('register_doc', {
      path: null,
      contents: '',
    });
    await addDocTab({ doc_id: reg.doc_id, path: '', contents: '', state: reg.state }, { background: false });
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

async function saveCurrentDoc(): Promise<void> {
  const tab = store.activeDoc();
  if (!tab || !editor) return;
  try {
    let path: string | null = null;
    if (!tab.filePath) {
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
      saveSession();
    }
    store.updateDoc(tab.id, { fileState: state });
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
    store.updateDoc(tab.id, { fileState: res.state });
    refreshChrome(res.state);
    await scheduleRender();
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

async function bootstrap(): Promise<void> {
  const settings = await loadSettings();
  if (settings) {
    if (isMode(settings.default_mode)) currentMode = settings.default_mode;
    if (settings.autosave_mode) autosaveMode = settings.autosave_mode;
    if (settings.autoreload_mode) autoreloadMode = settings.autoreload_mode;
    if (settings.browser_base_dir) browserBaseDir = settings.browser_base_dir;
    if (settings.active_theme) await applyTheme(settings.active_theme);
    await applyAutoSwitchTheme(settings);
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
