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

async function installTauriMock(page, options = {}) {
  await page.addInitScript(({ initialPath, themes }) => {
    let callbackId = 1;
    const callbacks = new Map();
    const files = {
      '/work/tests/corpus/hello.md': '# Hello\n\nThis file was opened by the test harness.',
    };

    const renderMarkdown = (markdown) => {
      const escaped = String(markdown)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
      return `<article class="pmd-preview"><h1>${escaped.split('\n')[0].replace(/^#\s*/, '') || 'Untitled'}</h1><p>${escaped}</p></article>`;
    };

    window.__pmdInvocations = [];
    delete window.__TAURI__;

    window.__TAURI_INTERNALS__ = {
      callbacks,
      transformCallback(callback, once = false) {
        const id = callbackId++;
        callbacks.set(id, (payload) => {
          if (once) callbacks.delete(id);
          return callback(payload);
        });
        return id;
      },
      unregisterCallback(id) {
        callbacks.delete(id);
      },
      runCallback(id, payload) {
        callbacks.get(id)?.(payload);
      },
      async invoke(cmd, args = {}) {
        window.__pmdInvocations.push({ cmd, args });
        if (cmd === 'plugin:event|listen') return args.handler;
        if (cmd === 'plugin:event|unlisten') return null;
        if (cmd === 'get_recent_files') return [];
        if (cmd === 'get_initial_path') return initialPath ?? null;
        if (cmd === 'list_themes') return themes;
        if (cmd === 'set_theme') {
          const theme = themes.find((item) => item.slug === args.slug) ?? themes[0];
          const p = theme.preview;
          return {
            css: `:root { --pmd-bg: ${p.bg}; --pmd-bg-elevated: ${p.bg_elevated}; --pmd-fg: ${p.fg}; --pmd-fg-muted: ${p.fg_muted}; --pmd-accent: ${p.accent}; --pmd-border: ${p.border}; }`,
            mermaid_vars: {},
            warnings: [],
          };
        }
        if (cmd === 'render_cmd') return { html: renderMarkdown(args.markdown ?? '') };
        if (cmd === 'open_file') {
          return { path: args.path, contents: files[args.path] ?? '# Missing fixture' };
        }
        return null;
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener(_event, id) {
        callbacks.delete(id);
      },
    };
  }, {
    initialPath: options.initialPath ?? null,
    themes: options.themes ?? themes,
  });
}

module.exports = {
  appUrl,
  installTauriMock,
  screenshotPath,
  themes,
};
