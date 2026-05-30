import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { mountEditor } from './editor.js';
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
  type FileState,
  type DocStateChanged,
  type AutosaveMode,
  type AutoreloadMode,
} from './doc_state.js';

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
}

/** What an open/register command returns. */
interface OpenedDoc {
  doc_id: number;
  path: string;
  contents: string;
  state: FileState;
}

let renderQueue: Array<{ markdown: string; resolve: () => void; reject: (e: unknown) => void }> = [];
let rendering = false;
let currentVersion = 0;

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

const appContainer = document.createElement('div');
appContainer.id = 'app-container';
appContainer.appendChild(editorPane);
appContainer.appendChild(splitResizer);
appContainer.appendChild(previewPane);
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
  const ratio = parseFloat(
    appContainer.style.getPropertyValue('--pmd-split-ratio') || '0.5'
  );
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

const chrome = createChrome(document.body);
const hotkeyOverlay = createOverlay();
hotkeyOverlay.style.display = 'none';
document.body.appendChild(hotkeyOverlay);

document.body.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
});

const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd'];

function isMarkdownFileName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = name.slice(dot + 1).toLowerCase();
  return MARKDOWN_EXTENSIONS.includes(ext);
}

function basename(p: string): string {
  return p.split('/').pop() || p;
}

function showError(message: string): void {
  chrome.setStatus(message);
  console.error(message);
}

// --- document lifecycle state (replaces the old `isModified` boolean) -------

let editor: Awaited<ReturnType<typeof mountEditor>> | null = null;
let currentDocId: number | null = null;
let currentFilePath: string | null = null;
let currentFileState: FileState | null = null;
let currentMode: Mode = 'split';

// Lifecycle policy (loaded from settings; updated by the Phase 3 settings menu).
let autosaveMode: AutosaveMode = 'off';
let autoreloadMode: AutoreloadMode = 'when_clean';

// When true, a programmatic `editor.setValue` (open / reload / merge) is in
// flight: the change listener must NOT treat it as a user edit (no `doc_edited`,
// no dirty mark), though it still re-renders the preview.
let suppressEdits = false;

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
    // No filesystem path (e.g. dropped from a browser): adopt as an untitled
    // buffer holding the dropped text.
    const contents = await file.text();
    try {
      const reg = await invoke<{ doc_id: number; state: FileState }>('register_doc', {
        path: null,
        contents,
      });
      await adoptDoc(reg.doc_id, null, reg.state, contents);
      chrome.setFilename(file.name);
    } catch (err) {
      showError(`Open failed: ${String(err)}`);
    }
  }
});

function updateTitle() {
  const name = currentFilePath ? basename(currentFilePath) : 'Untitled';
  const modified = currentFileState ? uiForState(currentFileState).modified : false;
  const title = modified ? `● ${name} — preview-md` : `${name} — preview-md`;
  invoke('set_window_title', { title }).catch(() => {});
}

chrome.onModeChange((mode) => {
  currentMode = mode;
});

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

chrome.onThemePickerClick(() => {
  showThemePicker();
});

// Lifecycle button wiring.
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

loadRecentFiles();

chrome.onRecentFileSelect((path: string) => {
  openFile(path);
});
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
    requestAnimationFrame(() => {
      rerenderForThemeChange(previewContent, { vars: bundle.mermaid_vars });
    });
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
  const currentSettings = settings ?? await loadSettings();
  if (!currentSettings?.auto_switch) return false;

  const themeSlug = systemColorSchemeQuery.matches
    ? currentSettings.dark_theme
    : currentSettings.light_theme;
  if (!themeSlug) return false;

  await applyTheme(themeSlug);
  return true;
}

function handleSystemThemeChange(): void {
  applyAutoSwitchTheme().catch((e) => {
    console.error('Auto-switch failed:', e);
  });
}

systemColorSchemeQuery.addEventListener('change', handleSystemThemeChange);

function showOverlay() {
  hotkeyOverlay.style.display = 'flex';
}

const setupHotkeys = createHotkeyHandler(
  () => currentMode,
  (mode) => {
    chrome.setMode(mode);
    currentMode = mode;
  },
  showOverlay
);
setupHotkeys();

document.body.addEventListener('mode-change', (event) => {
  const mode = (event as CustomEvent<{ mode?: unknown }>).detail?.mode;
  if (!isMode(mode)) return;
  invoke('set_default_mode', { mode }).catch((e) => {
    console.error('set_default_mode failed:', e);
  });
});

async function processRenderQueue() {
  if (rendering || renderQueue.length === 0) return;
  rendering = true;
  const item = renderQueue.shift()!;
  try {
    currentVersion++;
    const result = await invoke<RenderResult>('render_cmd', {
      version: currentVersion,
      markdown: item.markdown,
    });
    previewContent.innerHTML = result.html;
    previewContent.dataset.versionApplied = String(result.version);
    previewContent.dataset.pmdNonce = result.render_nonce;
    markAllNodes(previewContent, result.render_nonce);
    await renderMermaidNodes(previewContent, result.render_nonce);
    await renderMathNodes(previewContent, result.render_nonce);
    decorateCodeBlocks(previewContent);
    item.resolve();
  } catch (e) {
    item.reject(e);
  } finally {
    rendering = false;
    processRenderQueue();
  }
}

function renderMarkdown(markdown: string): Promise<void> {
  return new Promise((resolve, reject) => {
    renderQueue.push({ markdown, resolve, reject });
    processRenderQueue();
  });
}

function getCurrentMarkdown(): string {
  return editor ? editor.getValue() : '';
}

// --- editor mount + programmatic-set suppression ---------------------------

async function ensureEditor(): Promise<void> {
  if (editor) return;
  editor = await mountEditor(editorPane, (md) => {
    // Programmatic sets (open / reload / merge) render explicitly at the call
    // site exactly once — skip here so we neither double-render nor miss the
    // empty-buffer case (an empty->empty `setValue` fires no change at all).
    if (suppressEdits) return;
    // Preview tracks user edits immediately; backend notify is debounced.
    renderMarkdown(md);
    if (currentDocId === null) return;
    scheduleDocEdited(md);
    scheduleIdleAutosave();
  });
  attachScrollSync(editor.view, previewPane);
}

/** Set the editor text programmatically without marking the buffer dirty. */
function setEditorValue(md: string): void {
  if (!editor) return;
  suppressEdits = true;
  try {
    editor.setValue(md);
  } finally {
    suppressEdits = false;
  }
}

const scheduleDocEdited = debounce((md: string) => {
  const id = currentDocId;
  if (id === null) return;
  invoke<FileState>('doc_edited', { docId: id, contents: md })
    .then((state) => applyDocState(state))
    .catch((e) => console.error('doc_edited failed:', e));
}, 180);

// --- lifecycle state application -------------------------------------------

function applyDocState(state: FileState): void {
  currentFileState = state;
  const ui = uiForState(state);
  chrome.setSaveEnabled(ui.saveEnabled);
  chrome.setModified(ui.modified);
  chrome.setReloadVisible(ui.showReload);
  chrome.setMergeVisible(ui.showMerge);
  chrome.setStatus(ui.status);
  updateTitle();
}

/** Adopt a freshly opened/registered document as the single active document. */
async function adoptDoc(
  docId: number,
  path: string | null,
  state: FileState,
  contents: string
): Promise<void> {
  // Phase 1 is single-document: drop the previous registry entry + watcher.
  if (currentDocId !== null && currentDocId !== docId) {
    invoke('drop_doc', { docId: currentDocId }).catch(() => {});
  }
  hideWelcomeScreen();
  currentDocId = docId;
  currentFilePath = path;
  await ensureEditor();
  setEditorValue(contents);
  chrome.setFilename(path ? basename(path) : 'Untitled');
  applyDocState(state);
  await renderMarkdown(contents);
  editor?.focus();
}

// --- autosave / autoreload --------------------------------------------------

const scheduleIdleAutosave = debounce(() => {
  if (autosaveMode === 'on_idle') maybeAutosave();
}, 1500);

/** Autosave only a plainly-dirty, file-backed buffer — never an untitled,
 *  conflicted, removed, or in-flight document. */
function maybeAutosave(): void {
  if (!currentFileState || currentFileState.kind !== 'dirty') return;
  saveCurrentDoc().catch(() => {});
}

window.addEventListener('blur', () => {
  if (autosaveMode === 'on_defocus') maybeAutosave();
});

window.setInterval(() => {
  if (autosaveMode === 'on_interval') maybeAutosave();
}, 30_000);

function maybeAutoreload(state: FileState): void {
  if (currentDocId === null) return;
  if (state.kind === 'disk_changed_clean') {
    if (autoreloadMode === 'when_clean' || autoreloadMode === 'always') doReload();
  } else if (state.kind === 'disk_changed_dirty') {
    // Only auto-discard local edits under the explicit `always` policy;
    // otherwise leave the Reload + Merge buttons for the user to decide.
    if (autoreloadMode === 'always') doReload();
  }
}

// --- file operations --------------------------------------------------------

async function newFile(): Promise<void> {
  try {
    const reg = await invoke<{ doc_id: number; state: FileState }>('register_doc', {
      path: null,
      contents: '',
    });
    await adoptDoc(reg.doc_id, null, reg.state, '');
    chrome.setStatus('Ready');
  } catch (e) {
    showError(`New file failed: ${String(e)}`);
  }
}

async function openFileDialog(): Promise<void> {
  try {
    const doc = await invoke<OpenedDoc | null>('open_dialog');
    if (doc) {
      await adoptDoc(doc.doc_id, doc.path, doc.state, doc.contents);
      loadRecentFiles();
      chrome.setStatus('Ready');
    }
  } catch (e) {
    showError(`Open dialog failed: ${String(e)}`);
  }
}

async function openFile(path: string): Promise<void> {
  try {
    const doc = await invoke<OpenedDoc>('request_open_file', { path });
    await adoptDoc(doc.doc_id, doc.path, doc.state, doc.contents);
    loadRecentFiles();
    chrome.setStatus('Ready');
  } catch (e) {
    showError(`Open failed: ${String(e)}`);
  }
}

async function saveCurrentDoc(): Promise<void> {
  const id = currentDocId;
  if (id === null) return;
  try {
    let path: string | null = null;
    if (!currentFilePath) {
      const suggested = editor ? editor.getValue().split('\n')[0].slice(0, 50) || 'Untitled' : 'Untitled';
      const picked = await invoke<string | null>('save_dialog', { suggestedName: suggested + '.md' });
      if (!picked) return;
      path = picked;
    }
    const contents = getCurrentMarkdown();
    const state = await invoke<FileState>('save_doc', { docId: id, contents, path });
    if (path) {
      currentFilePath = path;
      chrome.setFilename(basename(path));
    }
    applyDocState(state);
    chrome.setStatus('Saved');
    loadRecentFiles();
  } catch (e) {
    showError(`Save failed: ${String(e)}`);
  }
}

/** Reload the document from disk (discarding local edits), preserving cursor. */
async function doReload(): Promise<void> {
  const id = currentDocId;
  if (id === null) return;
  try {
    const res = await invoke<{ contents: string; state: FileState }>('pull_from_disk', { docId: id });
    const cursor = editor ? editor.view.state.selection.main.head : 0;
    setEditorValue(res.contents);
    if (editor) {
      const max = editor.view.state.doc.length;
      editor.view.dispatch({ selection: { anchor: Math.min(cursor, max) } });
    }
    applyDocState(res.state);
    await renderMarkdown(res.contents);
    chrome.setStatus('Reloaded from disk');
  } catch (e) {
    showError(`Reload failed: ${String(e)}`);
  }
}

/** 3-way merge the on-disk changes into the buffer (in memory only). */
async function doMerge(): Promise<void> {
  const id = currentDocId;
  if (id === null || !currentFileState) return;
  const diskDigestSeen = 'disk' in currentFileState ? currentFileState.disk : '';
  try {
    const res = await invoke<{ merged: string; state: FileState; conflicted: boolean }>(
      'resolve_disk_change',
      { docId: id, oursText: getCurrentMarkdown(), diskDigestSeen }
    );
    setEditorValue(res.merged);
    applyDocState(res.state);
    await renderMarkdown(res.merged);
    chrome.setStatus(
      res.conflicted
        ? 'Merged with conflicts — resolve the markers, then save'
        : 'Merged disk changes into the editor'
    );
  } catch (e) {
    showError(`Merge failed: ${String(e)}`);
  }
}

// --- event listeners --------------------------------------------------------

listen<string>('open-file', (event) => {
  openFile(event.payload);
}).catch(() => {});

// Single structured lifecycle event from the content-aware watcher.
listen<DocStateChanged>('doc_state_changed', (event) => {
  const { doc_id, state } = event.payload;
  if (doc_id !== currentDocId) return;
  applyDocState(state);
  maybeAutoreload(state);
}).catch(() => {});

listen('system_theme_changed', handleSystemThemeChange).catch(() => {});

listen<string>('mode-change', (event) => {
  const mode = event.payload as Mode;
  if (isMode(mode)) {
    applyMode(mode);
  }
}).catch(() => {});

chrome.setStatus('Ready');

function showWelcomeScreen(): void {
  hideWelcomeScreen();
  const welcome = document.createElement('div');
  welcome.id = 'pmd-welcome';
  welcome.className = 'pmd-welcome';
  welcome.innerHTML = `
    <h1>preview-md</h1>
    <p>Best-in-class markdown preview for Linux</p>
    <div class="pmd-welcome-actions">
      <button id="pmd-welcome-open" class="pmd-welcome-btn">Open File</button>
      <button id="pmd-welcome-new" class="pmd-welcome-btn">New File</button>
    </div>
    <p class="pmd-welcome-hint">or press Ctrl+O to open, Ctrl+N to create</p>
  `;
  appContainer.appendChild(welcome);
  document.body.dataset.state = 'welcome';
  document.getElementById('pmd-welcome-open')?.addEventListener('click', () => openFileDialog());
  document.getElementById('pmd-welcome-new')?.addEventListener('click', () => newFile());
}

function hideWelcomeScreen(): void {
  document.getElementById('pmd-welcome')?.remove();
  if (document.body.dataset.state === 'welcome') {
    delete document.body.dataset.state;
  }
}

async function bootstrap(): Promise<void> {
  const settings = await loadSettings();
  if (settings) {
    if (isMode(settings.default_mode)) {
      applyMode(settings.default_mode);
    }
    if (settings.autosave_mode) autosaveMode = settings.autosave_mode;
    if (settings.autoreload_mode) autoreloadMode = settings.autoreload_mode;
    if (settings.active_theme) {
      await applyTheme(settings.active_theme);
    }
    await applyAutoSwitchTheme(settings);
  }

  let openDialogOnStart = false;
  try {
    openDialogOnStart = await invoke<boolean>('get_open_dialog_on_start');
  } catch (e) {
    console.error('Failed to get open-dialog startup flag:', e);
  }

  try {
    const path = await invoke<string | null>('get_initial_path');
    if (path) {
      openFile(path);
    } else {
      showWelcomeScreen();
      if (openDialogOnStart) {
        setTimeout(() => {
          openFileDialog();
        }, 0);
      }
    }
  } catch (e) {
    console.error('Failed to get initial path:', e);
    showWelcomeScreen();
    if (openDialogOnStart) {
      setTimeout(() => {
        openFileDialog();
      }, 0);
    }
  }
}

bootstrap().catch((e) => {
  console.error('Startup failed:', e);
  showWelcomeScreen();
});

export {};
