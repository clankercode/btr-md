import { mountEditor } from './editor.js';
import { createChrome, type Mode } from './chrome.js';
import { createHotkeyHandler, createOverlay } from './hotkeys.js';
import { attachScrollSync } from './scroll_sync.js';

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

async function openFile(path: string) {
  try {
    const file = await invoke<{ contents: string; path: string }>('open_file', { path });
    currentFilePath = path;
    isModified = false;
    chrome.setFilename(path.split('/').pop() || path);
    chrome.setModified(false);

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
        await invoke('set_theme', { slug: themeSlug });
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

invoke<string | null>('get_initial_path').then((path) => {
  if (path) {
    openFile(path);
  }
});

export {};
