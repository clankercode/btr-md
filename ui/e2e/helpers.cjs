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
  await page.addInitScript(({ initialPath, themes, renderHtml }) => {
    let callbackId = 1;
    let nextDocId = 1;
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
        if (cmd === 'get_settings') {
          return {
            active_theme: null,
            light_theme: null,
            dark_theme: null,
            auto_switch: false,
            default_mode: null,
            autosave_mode: 'off',
            autoreload_mode: 'when_clean',
            merge_strategy: 'raise_conflict',
            browser_base_dir: null,
            gist_enabled: false,
            diff_mode: 'none',
            dont_ask_default_handler: true,
            mono_font: null,
          };
        }
        if (cmd === 'default_handler_status') return { status: 'unknown', platform: 'linux' };
        if (cmd === 'get_initial_path') return initialPath ?? null;
        if (cmd === 'get_open_dialog_on_start') return false;
        if (cmd === 'list_themes') return themes;
        if (cmd === 'set_theme') {
          const theme = themes.find((item) => item.slug === args.slug) ?? themes[0];
          const p = theme.preview;
          return {
            css: `:root { --pmd-bg: ${p.bg}; --pmd-bg-elevated: ${p.bg_elevated}; --pmd-fg: ${p.fg}; --pmd-fg-muted: ${p.fg_muted}; --pmd-accent: ${p.accent}; --pmd-border: ${p.border}; }`,
            mermaid_vars: {},
            mode: theme.mode,
            warnings: [],
          };
        }
        if (cmd === 'render_cmd') return {
          // Tests can pin a fixed HTML payload (e.g. a real code block) via the
          // `renderHtml` option; otherwise fall back to the escaped echo render.
          html: renderHtml ?? renderMarkdown(args.markdown ?? ''),
          version: args.version ?? 0,
          render_nonce: '',
        };
        if (cmd === 'open_file' || cmd === 'request_open_file') {
          return {
            doc_id: nextDocId++,
            path: args.path,
            contents: files[args.path] ?? '# Missing fixture',
            state: { kind: 'clean', base: '00' },
          };
        }
        if (cmd === 'register_doc') {
          return {
            doc_id: nextDocId++,
            state: args.path ? { kind: 'clean', base: '00' } : { kind: 'untitled' },
          };
        }
        if (cmd === 'doc_edited') return { kind: 'dirty', base: '00', mem: 'ff' };
        if (cmd === 'save_doc') return { kind: 'clean', base: '00' };
        if (cmd === 'pull_from_disk') {
          return { contents: files[args.path] ?? '', state: { kind: 'clean', base: '00' } };
        }
        if (cmd === 'resolve_disk_change') {
          return { merged: '', state: { kind: 'clean', base: '00' }, conflicted: false };
        }
        // set_active_doc / drop_doc / set_*_mode and friends: no return value.
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
    renderHtml: options.renderHtml ?? null,
  });
}

module.exports = {
  appUrl,
  installTauriMock,
  screenshotPath,
  themes,
};
