import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { mountEditor } from './editor.js';
import { createChrome, type Mode } from './chrome.js';
import { createHotkeyHandler, createOverlay } from './hotkeys.js';
import { attachScrollSync } from './scroll_sync.js';
import { markAllNodes, rerenderForThemeChange } from './theme_apply.js';
import { renderMermaidNodes } from './mermaid_runner.js';
import { renderMathNodes } from './katex_runner.js';
import { openThemePicker, isPickerOpen, closeThemePicker, type ThemeInfo } from './picker.js';

interface RenderResult {
  html: string;
}

let renderQueue: Array<{ markdown: string; resolve: () => void; reject: (e: unknown) => void }> = [];
let rendering = false;
let currentVersion = 0;

const previewPane = document.getElementById('preview-pane') as HTMLElement;
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
const DEFAULT_RATIO = 0.5;

function clampRatio(r: number): number {
  return Math.max(MIN_RATIO, Math.min(MAX_RATIO, r));
}

function applySplitRatio(ratio: number): void {
  const clamped = clampRatio(ratio);
  appContainer.style.setProperty('--pmd-split-ratio', String(clamped));
  splitResizer.setAttribute('aria-valuenow', String(Math.round(clamped * 100)));
}

const storedRatio = parseFloat(localStorage.getItem(SPLIT_RATIO_KEY) || '');
applySplitRatio(Number.isFinite(storedRatio) ? storedRatio : 0.5);

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

document.body.addEventListener('drop', async (e) => {
  e.preventDefault();
  e.stopPropagation();

  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;

  const file = files[0];
  if (!file.name.endsWith('.md') && !file.name.endsWith('.markdown')) {
    console.log('Not a markdown file:', file.name);
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
    requestAnimationFrame(() => {
      rerenderForThemeChange(previewPane, { vars: bundle.mermaid_vars });
    });
  } catch (e) {
    console.error('applyTheme failed:', e);
  }
}

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
    previewPane.innerHTML = result.html;
    markAllNodes(previewPane);
    await renderMermaidNodes(previewPane);
    await renderMathNodes(previewPane);
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
  currentFilePath = null;
  isModified = false;
  chrome.setFilename('Untitled');
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
  editor.setValue('');
  await renderMarkdown('');
  editor.focus();
}

async function openFileDialog(): Promise<void> {
  try {
    const result = await invoke<{ contents: string; path: string } | null>('open_dialog');
    if (result) {
      hideWelcomeScreen();
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
    }
  } catch (e) {
    console.error('Open dialog failed:', e);
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
  } catch (e) {
    console.error('Save failed:', e);
  }
}

async function openFile(path: string) {
  hideWelcomeScreen();

  try {
    // `request_open_file` admits the path to the scope before reading; we
    // use it from every UI entry point (drag/drop, recents, welcome buttons,
    // the open-file Tauri event) because some of those (drag/drop, recents)
    // can hit paths that aren't yet scope-allowed.
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

    invoke('add_recent_file', { path: openedPath }).catch(() => {});
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
  } catch (e) {
    // Backend errors can include user-controlled paths; build the node via
    // textContent so the string is rendered as text, never parsed as HTML.
    previewPane.textContent = '';
    const pre = document.createElement('pre');
    pre.textContent = `Error: ${String(e)}`;
    previewPane.appendChild(pre);
  }
}

function getCurrentMarkdown(): string {
  return editor ? editor.getValue() : '';
}

listen<string>('open-file', (event) => {
  openFile(event.payload);
}).catch(() => {});

listen('system_theme_changed', async () => {
  try {
    const settings = await invoke<{
      auto_switch: boolean;
      light_theme: string | null;
      dark_theme: string | null;
    }>('get_settings');
    if (settings.auto_switch && (settings.light_theme || settings.dark_theme)) {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const themeSlug = isDark ? settings.dark_theme : settings.light_theme;
      if (themeSlug) {
        await applyTheme(themeSlug);
      }
    }
  } catch (e) {
    console.error('Auto-switch failed:', e);
  }
}).catch(() => {});

listen<string>('mode-change', (event) => {
  const mode = event.payload as Mode;
  chrome.setMode(mode);
  currentMode = mode;
}).catch(() => {});

document.body.dataset.mode = 'split';
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

invoke<string | null>('get_initial_path').then((path) => {
  if (path) {
    openFile(path);
  } else {
    showWelcomeScreen();
  }
}).catch((e) => {
  console.error('Failed to get initial path:', e);
  showWelcomeScreen();
});

export {};
