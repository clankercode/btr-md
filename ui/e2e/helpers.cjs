const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const screenshotDir = path.join(__dirname, '..', '..', 'tests', 'screenshots', 'playwright');

const themes = [
  {
    slug: 'github-light',
    name: 'GitHub Light',
    mode: 'light',
    inspired_by: 'GitHub',
    preview_bg: '#ffffff',
    preview_bg_elevated: '#f6f8fa',
    preview_fg: '#1f2328',
    preview_accent: '#0969da',
    preview: {
      bg: '#ffffff',
      bg_elevated: '#f6f8fa',
      fg: '#1f2328',
      fg_muted: '#656d76',
      accent: '#0969da',
      border: '#6e7781',
    },
  },
  {
    slug: 'dracula',
    name: 'Dracula',
    mode: 'dark',
    inspired_by: 'Dracula Theme',
    preview_bg: '#282a36',
    preview_bg_elevated: '#383a4a',
    preview_fg: '#f8f8f2',
    preview_accent: '#bd93f9',
    preview: {
      bg: '#282a36',
      bg_elevated: '#383a4a',
      fg: '#f8f8f2',
      fg_muted: '#6272a4',
      accent: '#bd93f9',
      border: '#44475a',
    },
  },
  {
    slug: 'nord',
    name: 'Nord',
    mode: 'dark',
    inspired_by: 'Arctic',
    preview_bg: '#2e3440',
    preview_bg_elevated: '#3b4252',
    preview_fg: '#eceff4',
    preview_accent: '#88c0d0',
    preview: {
      bg: '#2e3440',
      bg_elevated: '#3b4252',
      fg: '#eceff4',
      fg_muted: '#4c566a',
      accent: '#88c0d0',
      border: '#434c5e',
    },
  },
  {
    slug: 'github-dark',
    name: 'GitHub Dark',
    mode: 'dark',
    inspired_by: 'GitHub',
    preview_bg: '#0d1117',
    preview_bg_elevated: '#161b22',
    preview_fg: '#e6edf3',
    preview_accent: '#2f81f7',
    preview: {
      bg: '#0d1117',
      bg_elevated: '#161b22',
      fg: '#e6edf3',
      fg_muted: '#7d8590',
      accent: '#2f81f7',
      border: '#30363d',
    },
  },
];

function appUrl() {
  return '/index.html';
}

function screenshotPath(name) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  return path.join(screenshotDir, name);
}

async function openMarkdown(page, markdown, options = {}) {
  await installTauriMock(page, options);
  await page.goto(appUrl());
  await page.getByRole('button', { name: 'New File' }).click();
  const editor = page.locator('.cm-content');
  await editor.waitFor({ state: 'visible' });
  await editor.click();
  await page.keyboard.insertText(markdown);
  await page.waitForFunction((source) => {
    const firstLine = String(source).split('\n')[0] ?? '';
    return document.querySelector('.cm-content')?.textContent?.includes(firstLine) ?? false;
  }, markdown);
  await page.waitForTimeout(250);
}

async function openSavedMarkdown(page, filePath, markdown, options = {}) {
  const files = { ...(options.files ?? {}), [filePath]: markdown };
  await installTauriMock(page, { ...options, files, initialPath: filePath });
  await page.goto(appUrl());
  await page.evaluate((path) => window.__pmdOpenPathForTest(path), filePath);
  await page.waitForFunction((source) => {
    const firstLine = String(source).split('\n')[0] ?? '';
    return document.querySelector('.cm-content')?.textContent?.includes(firstLine) ?? false;
  }, markdown);
  await page.waitForTimeout(250);
}

async function grantFolderInMockBackend(page, canonicalRoot) {
  await page.evaluate((root) => {
    window.__pmdNextGrantFolder = root;
  }, canonicalRoot);
}

// The Tauri backend mock is authored in TypeScript (e2e/mock/mock.ts), typed
// exhaustively against the seam's CommandMap, and compiled to a self-contained
// IIFE (e2e/mock/dist/mock.js) by `npm run build:mock`. We inject it in two
// init scripts: first publish this test's config on window.__pmdMockConfig,
// then inject the compiled mock, which reads that config and installs
// window.__TAURI_INTERNALS__. Keeping the config plumbing here preserves every
// spec's `installTauriMock(page, options)` call unchanged.
async function installTauriMock(page, options = {}) {
  await page.addInitScript((config) => {
    window.__pmdMockConfig = config;
  }, {
    initialPath: options.initialPath ?? null,
    themes: options.themes ?? themes,
    renderHtml: options.renderHtml ?? null,
    renderDocId: options.renderDocId ?? null,
    renderVersion: options.renderVersion ?? null,
    renderFacts: options.renderFacts ?? null,
    renderDiagnostics: options.renderDiagnostics ?? null,
    files: options.files ?? null,
    gitRoots: options.gitRoots ?? [],
    trustRoots: options.trustRoots ?? [],
    settings: options.settings ?? {},
    dirListings: options.dirListings ?? {},
  });
  await page.addInitScript({ path: path.join(__dirname, 'mock', 'dist', 'mock.js') });
}


module.exports = {
  appUrl,
  grantFolderInMockBackend,
  installTauriMock,
  openMarkdown,
  openSavedMarkdown,
  screenshotPath,
  themes,
};
