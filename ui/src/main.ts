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
}

let renderQueue: Array<{ markdown: string; resolve: () => void; reject: (e: unknown) => void }> = [];
let rendering = false;
let currentVersion = 0;

const previewPane = document.getElementById('preview-pane') as HTMLElement;
// `#preview-pane` is the scroll container; `#pmd-content` is the inner reading
// column that receives all rendered markdown. Content writes (innerHTML, nonce
// datasets, post-render passes) target the inner wrapper; scroll-sync stays on
// the scroll container.
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

// Markdown extensions we accept on drag/drop. Kept in sync with the backend
// allowlist in `crates/pmd-app/src/cmd/file.rs::MARKDOWN_EXTENSIONS` so the
// renderer doesn't reject paths the backend would have accepted. Comparison
// is case-insensitive on the file's extension.
const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd'];

function isMarkdownFileName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = name.slice(dot + 1).toLowerCase();
  return MARKDOWN_EXTENSIONS.includes(ext);
}

function showError(message: string): void {
  // Route user-facing open/save failures through the status bar instead of
  // hijacking the preview pane (the prior behaviour). The preview should
  // continue showing the last-rendered document; errors live in chrome.
  chrome.setStatus(message);
  console.error(message);
}

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
    hideWelcomeScreen();
    const contents = await file.text();
    currentFilePath = null;
    isModified = true;
    chrome.setFilename(file.name);
    chrome.setModified(true);
    updateTitle();

    if (!editor) {
      editor = await mountEditor(editorPane, (md) => {
        isModified = true;
        chrome.setModified(true);
        updateTitle();
        renderMarkdown(md);
      });
      attachScrollSync(editor.view, previewPane);
    }
    editor.setValue(contents);
    await renderMarkdown(contents);
    editor.focus();
  }
});

let editor: Awaited<ReturnType<typeof mountEditor>> | null = null;
let currentFilePath: string | null = null;
let isModified = false;
let currentMode: Mode = 'split';

function updateTitle() {
  const name = currentFilePath ? currentFilePath.split('/').pop() || currentFilePath : 'Untitled';
  const title = isModified ? `● ${name} — preview-md` : `${name} — preview-md`;
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
      // Only send the slot that's being updated; the Rust merge preserves
      // any slot whose value is `null`/omitted, so this leaves the opposite
      // slot intact.
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

// The Reload button (shown when the active file changes on disk while the
// buffer is dirty) pulls the on-disk version, discarding local edits.
chrome.onReloadClick(() => {
  if (currentFilePath) reloadActiveFromDisk(currentFilePath);
});

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
    saveCurrentFile();
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
    // Mirror the theme mode onto <html> so design-system.css selectors
    // (`[data-theme="dark"]`, `[data-theme="light"]`) pick up the right
    // variant. CSS cannot set this attribute itself.
    if (bundle.mode === 'light' || bundle.mode === 'dark') {
      document.documentElement.dataset.theme = bundle.mode;
    }
    // Make the theme's mermaid vars authoritative *synchronously*, before any
    // diagram is drawn. `bootstrap` awaits `applyTheme` before the first file
    // render, so the initial mermaid render already uses these colours; the
    // rAF below only recolours already-rendered diagrams on later switches.
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
    // Post-sanitize decoration: wrap genuine code samples (mermaid/math nodes
    // have already been converted above) with the language/copy/expand toolbar.
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

async function newFile(): Promise<void> {
  hideWelcomeScreen();
  chrome.setReloadVisible(false);
  currentFilePath = null;
  isModified = false;
  chrome.setFilename('Untitled');
  chrome.setModified(false);
  updateTitle();
  // Tell the backend we've left the previous file so its scope-relative
  // save authority and disk watcher both stop pointing at it.
  invoke('clear_active_file').catch(() => {});

  if (!editor) {
    editor = await mountEditor(editorPane, (md) => {
      isModified = true;
      chrome.setModified(true);
      updateTitle();
      renderMarkdown(md);
    });
    attachScrollSync(editor.view, previewPane);
  }
  editor.setValue('');
  await renderMarkdown('');
  editor.focus();
}

async function openFileDialog(): Promise<void> {
  try {
    const result = await invoke<{ contents: string; path: string } | null>('open_dialog');
    if (result) {
      hideWelcomeScreen();
      chrome.setReloadVisible(false);
      currentFilePath = result.path;
      isModified = false;
      chrome.setFilename(result.path.split('/').pop() || result.path);
      chrome.setModified(false);
      updateTitle();

      if (!editor) {
        editor = await mountEditor(editorPane, (md) => {
          isModified = true;
          chrome.setModified(true);
          updateTitle();
          renderMarkdown(md);
        });
        attachScrollSync(editor.view, previewPane);
      }
      editor.setValue(result.contents);
      await renderMarkdown(result.contents);
      editor.focus();
      loadRecentFiles();
      chrome.setStatus('Ready');
    }
  } catch (e) {
    showError(`Open dialog failed: ${String(e)}`);
  }
}

async function saveCurrentFile(): Promise<void> {
  try {
    let path = currentFilePath;
    if (!path) {
      const suggested = editor ? editor.getValue().split('\n')[0].slice(0, 50) || 'Untitled' : 'Untitled';
      const result = await invoke<string | null>('save_dialog', { suggestedName: suggested + '.md' });
      if (!result) return;
      path = result;
      currentFilePath = path;
      chrome.setFilename(path.split('/').pop() || path);
    }
    const content = getCurrentMarkdown();
    await invoke('save_file', { path, contents: content });
    isModified = false;
    chrome.setModified(false);
    updateTitle();
    // Our write supersedes any pending external-change prompt.
    chrome.setReloadVisible(false);
    chrome.setStatus('Saved');
  } catch (e) {
    showError(`Save failed: ${String(e)}`);
  }
}

async function openFile(path: string) {
  hideWelcomeScreen();
  chrome.setReloadVisible(false);

  try {
    // `request_open_file` admits the path to the scope before reading; we
    // use it from every UI entry point (drag/drop, recents, welcome buttons,
    // the open-file Tauri event). The backend admits only paths that are
    // already in scope or in the recents list — anything else must come
    // via `open_dialog`.
    const file = await invoke<{ contents: string; path: string }>('request_open_file', { path });
    // Track the canonical path returned by Rust, not the (possibly non-canonical
    // or symlinked) input. Saving uses currentFilePath, and `save_file` refuses
    // to write through symlinks, so storing the canonical form here keeps the
    // save round-trip consistent with the path we just admitted to the scope.
    const openedPath = file.path || path;
    currentFilePath = openedPath;
    isModified = false;
    chrome.setFilename(openedPath.split('/').pop() || openedPath);
    chrome.setModified(false);
    updateTitle();

    // Backend `request_open_file` already pushes to recents on success, so we
    // don't double-push here — just refresh the dropdown.
    loadRecentFiles();

    if (!editor) {
      editor = await mountEditor(editorPane, (md) => {
        isModified = true;
        chrome.setModified(true);
        updateTitle();
        renderMarkdown(md);
      });
      attachScrollSync(editor.view, previewPane);
    }
    editor.setValue(file.contents);
    await renderMarkdown(file.contents);
    editor.focus();
    chrome.setStatus('Ready');
  } catch (e) {
    // Route to the status bar instead of hijacking the preview pane. The
    // backend error string may include user-controlled path text; setStatus
    // uses textContent under the hood so it's never parsed as HTML.
    showError(`Open failed: ${String(e)}`);
  }
}

function getCurrentMarkdown(): string {
  return editor ? editor.getValue() : '';
}

listen<string>('open-file', (event) => {
  openFile(event.payload);
}).catch(() => {});

/// Reload the active file from disk into the editor, preserving the cursor
/// position so the user doesn't get bounced back to the top. The backend
/// re-pushes to recents inside `open_file`, which is fine here.
async function reloadActiveFromDisk(path: string): Promise<void> {
  try {
    const file = await invoke<{ contents: string; path: string }>('open_file', { path });
    if (!editor) return;
    const cursor = editor.view.state.selection.main.head;
    editor.setValue(file.contents);
    const max = editor.view.state.doc.length;
    const clamped = Math.min(cursor, max);
    editor.view.dispatch({ selection: { anchor: clamped } });
    await renderMarkdown(file.contents);
    chrome.setReloadVisible(false);
    chrome.setStatus('Reloaded from disk');
  } catch (e) {
    showError(`Reload failed: ${String(e)}`);
  }
}

// The backend watcher emits a string payload that is the canonical path of
// the file that changed. We compare it to `currentFilePath` before doing
// anything so a stale event from a previously-watched file (during a fast
// switch) cannot clobber the now-active buffer. If the buffer is clean we
// auto-reload; if dirty we just surface a status so the user can decide.
listen<string>('file_changed_on_disk', (event) => {
  const changed = event.payload;
  if (!currentFilePath || changed !== currentFilePath) return;
  if (isModified) {
    // Can't safely auto-reload over unsaved edits — surface the Reload button
    // so the user can choose to pull the on-disk version (discarding edits).
    chrome.setReloadVisible(true);
    chrome.setStatus('File changed on disk (buffer modified) — use Reload to discard edits');
    return;
  }
  reloadActiveFromDisk(currentFilePath);
}).catch(() => {});

listen<string>('file_removed_from_disk', (event) => {
  const removed = event.payload;
  if (!currentFilePath || removed !== currentFilePath) return;
  chrome.setStatus('File removed from disk');
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
