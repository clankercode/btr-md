import { mountEditor } from './editor.js';
import { createChrome, type Mode } from './chrome.js';
import { createHotkeyHandler, createOverlay } from './hotkeys.js';
import { attachScrollSync } from './scroll_sync.js';
import { markAllNodes, rerenderForThemeChange } from './theme_apply.js';
import { openThemePicker, isPickerOpen, closeThemePicker, type ThemeInfo } from './picker.js';

import '../styles/picker.css';

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

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

const appContainer = document.createElement('div');
appContainer.id = 'app-container';
appContainer.appendChild(editorPane);
appContainer.appendChild(previewPane);
document.body.appendChild(appContainer);

const chrome = createChrome(document.body);
const hotkeyOverlay = createOverlay();
hotkeyOverlay.hidden = true;
document.body.appendChild(hotkeyOverlay);

let editor: Awaited<ReturnType<typeof mountEditor>> | null = null;
let currentFilePath: string | null = null;
let isModified = false;
let currentMode: Mode = 'split';

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
  openThemePicker(themes, async (slug) => {
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
    chrome.onRecentFileSelect((path: string) => {
      openFile(path);
    });
  } catch (e) {
    console.error('loadRecentFiles failed:', e);
  }
}

loadRecentFiles();

async function applyTheme(slug: string) {
  try {
    const bundle = await invoke<{ css: string; mermaid_vars: Record<string, string>; warnings?: string[] }>('set_theme', { slug });
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
    requestAnimationFrame(() => {
      rerenderForThemeChange(previewPane, { vars: bundle.mermaid_vars });
    });
  } catch (e) {
    console.error('applyTheme failed:', e);
  }
}

function showOverlay() {
  hotkeyOverlay.hidden = false;
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
  currentFilePath = null;
  isModified = false;
  chrome.setFilename('Untitled');
  chrome.setModified(false);

  if (!editor) {
    editor = await mountEditor(editorPane, (md) => {
      isModified = true;
      chrome.setModified(true);
      renderMarkdown(md);
    });
    attachScrollSync(editor.view, previewPane);
  }
  editor.setValue('');
  await renderMarkdown('');
}

async function openFileDialog(): Promise<void> {
  try {
    const result = await invoke<{ contents: string; path: string } | null>('open_dialog');
    if (result) {
      currentFilePath = result.path;
      isModified = false;
      chrome.setFilename(result.path.split('/').pop() || result.path);
      chrome.setModified(false);

      if (!editor) {
        editor = await mountEditor(editorPane, (md) => {
          isModified = true;
          chrome.setModified(true);
          renderMarkdown(md);
        });
        attachScrollSync(editor.view, previewPane);
      }
      editor.setValue(result.contents);
      await renderMarkdown(result.contents);
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
  } catch (e) {
    console.error('Save failed:', e);
  }
}

async function openFile(path: string) {
  const welcome = document.querySelector('.pmd-welcome');
  if (welcome) welcome.remove();

  try {
    const file = await invoke<{ contents: string; path: string }>('open_file', { path });
    currentFilePath = path;
    isModified = false;
    chrome.setFilename(path.split('/').pop() || path);
    chrome.setModified(false);

    invoke('add_recent_file', { path }).catch(() => {});
    loadRecentFiles();

    if (!editor) {
      editor = await mountEditor(editorPane, (md) => {
        isModified = true;
        chrome.setModified(true);
        renderMarkdown(md);
      });
      attachScrollSync(editor.view, previewPane);
    }
    editor.setValue(file.contents);
    await renderMarkdown(file.contents);
  } catch (e) {
    previewPane.innerHTML = `<pre>Error: ${e}</pre>`;
  }
}

function getCurrentMarkdown(): string {
  return editor ? editor.getValue() : '';
}

listen<string>('open-file', (event) => {
  openFile(event.payload);
});

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
});

listen<string>('mode-change', (event) => {
  const mode = event.payload as Mode;
  chrome.setMode(mode);
  currentMode = mode;
});

document.body.dataset.mode = 'split';
chrome.setStatus('Ready');

function showWelcomeScreen(): void {
  previewPane.innerHTML = `
    <div class="pmd-welcome">
      <h1>preview-md</h1>
      <p>Best-in-class markdown preview for Linux</p>
      <div class="pmd-welcome-actions">
        <button id="pmd-welcome-open" class="pmd-welcome-btn">Open File</button>
        <button id="pmd-welcome-new" class="pmd-welcome-btn">New File</button>
      </div>
      <p class="pmd-welcome-hint">or press Ctrl+O to open, Ctrl+N to create</p>
    </div>
  `;
  document.getElementById('pmd-welcome-open')?.addEventListener('click', () => openFileDialog());
  document.getElementById('pmd-welcome-new')?.addEventListener('click', () => newFile());
}

invoke<string | null>('get_initial_path').then((path) => {
  if (path) {
    openFile(path);
  } else {
    showWelcomeScreen();
  }
});

export {};
