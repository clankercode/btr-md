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

async function installTauriMock(page, options = {}) {
  await page.addInitScript(({ initialPath, themes, renderHtml, renderDocId, renderVersion, renderFacts, renderDiagnostics }) => {
    let callbackId = 1;
    let nextDocId = 1;
    let shortcutOverrides = {};
    const callbacks = new Map();
    const files = {
      '/work/tests/corpus/hello.md': '# Hello\n\nThis file was opened by the test harness.',
    };

    const emptyLinkSummary = () => ({
      checked: 0,
      errors: 0,
      warnings: 0,
      unchecked_external: 0,
      pending_async: 0,
    });

    function issue(id, severity, category, message, detail = null, primary_action = null) {
      return {
        id,
        severity,
        category,
        line_start: 1,
        line_end: 1,
        block_id: null,
        message,
        detail,
        primary_action,
      };
    }

    function slugify(value) {
      return String(value)
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-');
    }

    function factsForMarkdown(markdown, docId, version) {
      const headings = Array.from(String(markdown).matchAll(/^#{1,6}\s+(.+)$/gm)).map((match, index) => {
        const line = String(markdown).slice(0, match.index).split('\n').length;
        return {
          level: match[0].match(/^#+/)?.[0].length ?? 1,
          text: match[1],
          slug: slugify(match[1]),
          duplicate_index: 0,
          line_start: line,
          line_end: line,
          block_id: `block-${index}`,
        };
      });
      const facts = {
        doc_id: docId,
        version,
        headings,
        anchors: headings.map((heading) => ({
          slug: heading.slug,
          line_start: heading.line_start,
          line_end: heading.line_end,
          block_id: heading.block_id,
          source: 'heading',
        })),
        links: [],
        reference_definitions: [],
        images: [],
        frontmatter: null,
        blocks: [],
        embedded: {
          code_blocks: [],
          mermaid_blocks: [],
          math_spans: [],
          math_blocks: [],
        },
        counts: {
          words: String(markdown).trim().split(/\s+/).filter(Boolean).length,
          bytes: String(markdown).length,
          sentences: 0,
          paragraphs: String(markdown).trim() ? 1 : 0,
          headings: headings.length,
          links: 0,
          images: 0,
          code_blocks: 0,
          mermaid_blocks: 0,
          math_spans: 0,
          math_blocks: 0,
        },
      };
      if (!renderFacts) return facts;
      const merged = { ...facts, ...renderFacts };
      merged.doc_id = docId;
      merged.version = version;
      merged.headings = renderFacts.headings ?? facts.headings;
      merged.anchors = renderFacts.anchors ?? merged.headings.map((heading) => ({
        slug: heading.slug,
        line_start: heading.line_start,
        line_end: heading.line_end,
        block_id: heading.block_id,
        source: 'heading',
      }));
      merged.counts = {
        ...facts.counts,
        ...(renderFacts.counts ?? {}),
        headings: merged.headings.length,
      };
      return merged;
    }

    function diagnosticsForMarkdown(markdown, docId, version) {
      if (renderDiagnostics) {
        return {
          ...structuredClone(renderDiagnostics),
          doc_id: docId,
          version,
        };
      }
      const source = String(markdown);
      const issues = [];
      const decisions = [];
      const linkSummary = emptyLinkSummary();
      if (source.startsWith('---\ntitle: [unterminated')) {
        issues.push(issue(
          'frontmatter:1',
          'warning',
          'frontmatter',
          'Frontmatter could not be parsed',
          'Fix the YAML/TOML frontmatter syntax.'
        ));
      }
      if (/!\[[^\]]*\]\(https?:\/\//.test(source)) {
        issues.push(issue(
          'remote-image:1',
          'blocked',
          'resource_policy',
          'Remote image blocked: use a local file or open the URL outside the preview.'
        ));
        decisions.push({
          source_target: 'https://example.com/image.png',
          normalized_target: null,
          line_start: 1,
          line_end: 1,
          kind: 'image',
          decision: 'blocked',
          reason: 'remote_blocked',
          safe_url: null,
          placeholder_id: 'image-0',
          alt_text: 'remote',
        });
      }
      if (/!\[[^\]]+\]\(missing\.png\)/.test(source)) {
        issues.push(issue(
          'missing-image:1',
          'error',
          'image',
          'Image missing: fix the path or move the file next to the document.',
          'missing.png'
        ));
        decisions.push({
          source_target: 'missing.png',
          normalized_target: 'missing.png',
          line_start: 1,
          line_end: 1,
          kind: 'image',
          decision: 'missing',
          reason: 'missing_file',
          safe_url: null,
          placeholder_id: 'image-0',
          alt_text: 'missing',
        });
      }
      if (/\[[^\]]+\]\(missing\.md\)/.test(source)) {
        issues.push(issue(
          'missing-md:1',
          'error',
          'link',
          'Linked Markdown file not found: missing.md',
          'missing.md'
        ));
      }
      if (/!\[[^\]]+\]\(\.\.\/assets\/outside\.png\)/.test(source)) {
        issues.push(issue(
          'blocked-image:1',
          'blocked',
          'resource_policy',
          'Image blocked: grant the containing folder or move it under the document folder.',
          null,
          'asset.grantFolder'
        ));
        decisions.push({
          source_target: '../assets/outside.png',
          normalized_target: '../assets/outside.png',
          line_start: 1,
          line_end: 1,
          kind: 'image',
          decision: 'blocked',
          reason: 'outside_allowed_roots',
          safe_url: null,
          placeholder_id: 'image-0',
          alt_text: 'outside',
        });
      }
      if (/\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(source)) {
        linkSummary.unchecked_external = 1;
      }
      return {
        doc_id: docId,
        version,
        phase: 'initial',
        issues,
        resources: { doc_id: docId, version, allowed_roots: [], loaded_resources: [], decisions },
        link_summary: linkSummary,
      };
    }

    const escapeHtml = (value) => String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');

    const renderMarkdown = (markdown, diagnostics) => {
      const withoutFrontmatter = String(markdown).replace(/^---[\s\S]*?---\n/, '');
      const heading = withoutFrontmatter.match(/^#\s+(.+)$/m)?.[1] ?? 'Untitled';
      const escaped = escapeHtml(withoutFrontmatter);
      const externalLink = withoutFrontmatter.match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
      const linkHtml = externalLink
        ? `<p><a data-pmd-link-id="link-0" href="${escapeHtml(externalLink[2])}" role="link" tabindex="0">${escapeHtml(externalLink[1])}</a></p>`
        : '';
      const blocked = diagnostics.issues.some((item) => item.category === 'resource_policy')
        ? '<span class="pmd-image-placeholder">Image blocked<span>Content Blocked</span></span>'
        : diagnostics.issues.some((item) => item.category === 'image')
          ? '<span class="pmd-image-placeholder" data-pmd-resource-state="missing">Image missing</span>'
          : '';
      return `<article class="pmd-preview"><h1>${escapeHtml(heading)}</h1><p>${escaped}</p>${linkHtml}${blocked}</article>`;
    };

    window.__pmdInvocations = [];
    window.__pmdE2e = true;
    window.__pmdE2eActions = [];
    delete window.__TAURI__;

    function settingsPayload() {
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
        shortcut_overrides: shortcutOverrides,
      };
    }

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
        if (cmd === 'get_settings') return settingsPayload();
        if (cmd === 'set_shortcut_overrides') {
          shortcutOverrides = structuredClone(args.overrides ?? {});
          return settingsPayload();
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
        if (cmd === 'render_cmd') {
          const version = renderVersion ?? args.version ?? 0;
          const docId = renderDocId ?? args.docId ?? args.doc_id ?? 1;
          const markdown = args.markdown ?? '';
          const diagnostics = diagnosticsForMarkdown(markdown, docId, version);
          return {
            doc_id: docId,
            html: renderHtml ?? renderMarkdown(markdown, diagnostics),
            version,
            source_map: [],
            render_nonce: '',
            facts: factsForMarkdown(markdown, docId, version),
            diagnostics,
          };
        }
        if (cmd === 'prepare_link_activation') {
          return {
            kind: 'external_confirmation',
            normalized_url: 'https://example.com/report',
            scheme: 'https',
            host: 'example.com',
            label_text: 'external report',
            action_token: 'external-token-1',
          };
        }
        if (cmd === 'confirm_external_open') {
          return { opened: true };
        }
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
    renderDocId: options.renderDocId ?? null,
    renderVersion: options.renderVersion ?? null,
    renderFacts: options.renderFacts ?? null,
    renderDiagnostics: options.renderDiagnostics ?? null,
  });
}

module.exports = {
  appUrl,
  installTauriMock,
  openMarkdown,
  screenshotPath,
  themes,
};
