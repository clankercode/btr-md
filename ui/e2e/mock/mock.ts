// Typed e2e backend mock — the compile-time contract for the Tauri seam.
//
// `MockHandlers` is an EXHAUSTIVE mapped type over `CommandMap`: every command
// the UI can `invoke` MUST have a handler here whose argument and result shapes
// match `CommandMap`. A missing command, a typo'd name, or a wrong return shape
// is a `tsc` error (this file is in `ui/tsconfig.json`'s `include` allow-list),
// so mock drift can no longer silently return `null` at runtime.
//
// This module imports ONLY types from `src/` — esbuild (`vendor/build-mock.mjs`)
// strips them, so the compiled `dist/mock.js` IIFE is self-contained and carries
// no `src/` runtime dependency. It reads its per-test configuration from
// `window.__pmdMockConfig` (set by `helpers.cjs` in a prior init script) and then
// installs `window.__TAURI_INTERNALS__`.
//
// NOTE: this is still a STUB backend. `render_cmd`'s HTML is an <h1>+<p> stub, not
// the real renderer output — table/code/mermaid/KaTeX DOM decoration cannot be
// exercised here; verify those on a real `just run`. See AGENTS.md / CLAUDE.md.

import type {
  CommandMap,
  Settings,
  ThemeBundle,
  OpenedDoc,
  RegisteredDoc,
} from '../../src/backend/commands.js';
import type { EventMap } from '../../src/backend/event_map.js';
import type { DirListing } from '../../src/file_browser.js';
import type { ThemeInfo } from '../../src/picker.js';
import type { ShortcutOverrides } from '../../src/keybindings.js';
import type { FileState } from '../../src/doc_state.js';
import type { OpenedDocResult } from '../../src/session.js';
import type {
  AssetGrant,
  DocumentDiagnostics,
  DocumentFacts,
  DocumentIssue,
  DocumentTrustContext,
  AnchorFact,
  HeadingFact,
  LinkValidationSummary,
  ResourceDecision,
  ResourcePolicyReport,
  RenderResult,
  TrustRootDecision,
  TrustRootState,
} from '../../src/document_contracts.js';

// ---------------------------------------------------------------------------
// The exhaustive handler contract.
// ---------------------------------------------------------------------------

type MockHandlers = {
  [K in keyof CommandMap]: (
    args: CommandMap[K]['args'],
  ) => CommandMap[K]['result'] | Promise<CommandMap[K]['result']>;
};

// ---------------------------------------------------------------------------
// Per-test configuration (set by helpers.cjs onto `window.__pmdMockConfig`).
// ---------------------------------------------------------------------------

/** Theme fixture: the mock's `set_theme` reads a nested `preview` colour block
 *  that the prod `ThemeInfo` type does not carry, so the fixtures extend it. */
interface MockTheme extends ThemeInfo {
  preview: {
    bg: string;
    bg_elevated: string;
    fg: string;
    fg_muted: string;
    accent: string;
    border: string;
  };
}

interface MockConfig {
  initialPath: string | null;
  themes: MockTheme[];
  renderHtml: string | null;
  renderDocId: number | null;
  renderVersion: number | null;
  renderFacts: Partial<DocumentFacts> | null;
  renderDiagnostics: DocumentDiagnostics | null;
  files: Record<string, string> | null;
  gitRoots: string[];
  trustRoots: TrustRootDecision[];
  settings: Partial<Settings> | null;
  dirListings: Record<string, DirListing> | null;
}

// ---------------------------------------------------------------------------
// Window augmentation for the e2e globals this mock owns.
// ---------------------------------------------------------------------------

type TauriCallback = (payload: unknown) => unknown;

interface TauriInternals {
  callbacks: Map<number, TauriCallback>;
  transformCallback(callback: TauriCallback, once?: boolean): number;
  unregisterCallback(id: number): void;
  runCallback(id: number, payload: unknown): void;
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
}

declare global {
  interface Window {
    __pmdMockConfig?: Partial<MockConfig>;
    __pmdInvocations?: Array<{ cmd: string; args: Record<string, unknown> }>;
    __pmdE2eActions?: string[];
    __pmdNextGrantFolder?: string | null;
    /** Emit a backend event to `subscribe()`/`listen()` handlers (typed EventMap). */
    __pmdEmitEvent?: <K extends keyof EventMap>(
      name: K,
      payload: EventMap[K],
    ) => void;
    __TAURI_INTERNALS__?: TauriInternals;
    // Required + shape must match `@tauri-apps/api/event`'s global (events.ts
    // is typechecked in the same project, so the declarations merge).
    __TAURI_EVENT_PLUGIN_INTERNALS__: {
      unregisterListener: (event: string, eventId: number) => void;
    };
    __TAURI__?: unknown;
  }
}

// ---------------------------------------------------------------------------
// Install.
// ---------------------------------------------------------------------------

function installMock(config: MockConfig): void {
  let callbackId = 1;
  let nextDocId = 1;
  let nextGrantId = 1;
  let shortcutOverrides: ShortcutOverrides = {};
  const callbacks = new Map<number, TauriCallback>();
  // event name -> registered callback ids (for the `listen()`/emit path).
  const eventListeners = new Map<string, Set<number>>();
  const files: Record<string, string> = {
    '/work/tests/corpus/hello.md': '# Hello\n\nThis file was opened by the test harness.',
    ...(config.files ?? {}),
  };
  let browserBaseDir: string | null = config.settings?.browser_base_dir ?? null;
  const assetGrants: AssetGrant[] = [];
  const trustRootDecisions: TrustRootDecision[] = [...config.trustRoots];

  const emptyLinkSummary = (): LinkValidationSummary => ({
    checked: 0,
    errors: 0,
    warnings: 0,
    unchecked_external: 0,
    pending_async: 0,
  });

  function issue(
    id: string,
    severity: DocumentIssue['severity'],
    category: DocumentIssue['category'],
    message: string,
    detail: string | null = null,
    primary_action: string | null = null,
  ): DocumentIssue {
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

  function slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');
  }

  function anchorForHeading(heading: HeadingFact): AnchorFact {
    return {
      slug: heading.slug,
      line_start: heading.line_start,
      line_end: heading.line_end,
      block_id: heading.block_id,
      source: 'heading',
    };
  }

  function factsForMarkdown(markdown: string, docId: number, version: number): DocumentFacts {
    const headings: HeadingFact[] = Array.from(
      markdown.matchAll(/^#{1,6}\s+(.+)$/gm),
    ).map((match, index): HeadingFact => {
      const line = markdown.slice(0, match.index).split('\n').length;
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
    const facts: DocumentFacts = {
      doc_id: docId,
      version,
      headings,
      anchors: headings.map(anchorForHeading),
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
        words: markdown.trim().split(/\s+/).filter(Boolean).length,
        bytes: markdown.length,
        sentences: 0,
        paragraphs: markdown.trim() ? 1 : 0,
        headings: headings.length,
        links: 0,
        images: 0,
        code_blocks: 0,
        mermaid_blocks: 0,
        math_spans: 0,
        math_blocks: 0,
      },
    };
    const rf = config.renderFacts;
    if (!rf) return facts;
    const merged: DocumentFacts = { ...facts, ...rf, doc_id: docId, version };
    merged.headings = rf.headings ?? facts.headings;
    merged.anchors = rf.anchors ?? merged.headings.map(anchorForHeading);
    merged.counts = {
      ...facts.counts,
      ...(rf.counts ?? {}),
      headings: merged.headings.length,
    };
    return merged;
  }

  function dirname(filePath: string): string {
    const index = filePath.lastIndexOf('/');
    return index > 0 ? filePath.slice(0, index) : '/';
  }

  function trustContextForPath(filePath: string): DocumentTrustContext {
    const docDir = dirname(filePath);
    const gitRoot = config.gitRoots.find((root) => filePath.startsWith(`${root}/`)) ?? null;
    const state: TrustRootState =
      trustRootDecisions.find((decision) => decision.canonical_root === gitRoot)?.state ?? 'unknown';
    return {
      doc_dir: docDir,
      git_root: gitRoot,
      git_root_state: state,
      should_prompt_for_repo_root: Boolean(gitRoot && state === 'unknown'),
    };
  }

  function diagnosticsForMarkdown(
    markdown: string,
    docId: number,
    version: number,
  ): DocumentDiagnostics {
    if (config.renderDiagnostics) {
      return {
        ...structuredClone(config.renderDiagnostics),
        doc_id: docId,
        version,
      };
    }
    const issues: DocumentIssue[] = [];
    const decisions: ResourceDecision[] = [];
    const linkSummary = emptyLinkSummary();
    if (markdown.startsWith('---\ntitle: [unterminated')) {
      issues.push(
        issue(
          'frontmatter:1',
          'warning',
          'frontmatter',
          'Frontmatter could not be parsed',
          'Fix the YAML/TOML frontmatter syntax.',
        ),
      );
    }
    if (/!\[[^\]]*\]\(https?:\/\//.test(markdown)) {
      issues.push(
        issue(
          'remote-image:1',
          'blocked',
          'image',
          'Remote image blocked: use a local file or open the URL outside the preview.',
        ),
      );
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
    if (/!\[[^\]]+\]\(missing\.png\)/.test(markdown)) {
      issues.push(
        issue(
          'missing-image:1',
          'error',
          'image',
          'Image missing: fix the path or move the file next to the document.',
          'missing.png',
        ),
      );
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
    if (/\[[^\]]+\]\(missing\.md\)/.test(markdown)) {
      issues.push(
        issue(
          'missing-md:1',
          'error',
          'link',
          'Linked Markdown file not found: missing.md',
          'missing.md',
        ),
      );
    }
    if (/!\[[^\]]+\]\(\.\.\/assets\/outside\.png\)/.test(markdown)) {
      issues.push(
        issue(
          'blocked-image:1',
          'blocked',
          'image',
          'Image blocked: grant the containing folder or move it under the document folder.',
          null,
          'asset.grantFolder',
        ),
      );
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
    if (/\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(markdown)) {
      linkSummary.unchecked_external = 1;
    }
    const resources: ResourcePolicyReport = {
      doc_id: docId,
      version,
      allowed_roots: [],
      loaded_resources: [],
      decisions,
    };
    return {
      doc_id: docId,
      version,
      phase: 'initial',
      issues,
      resources,
      link_summary: linkSummary,
    };
  }

  function hasOutsideAssetGrant(docId: number): boolean {
    return assetGrants.some((grant) => {
      if (grant.doc_id !== docId) return false;
      return (
        grant.canonical_root === '../assets' ||
        grant.canonical_root === '/work/repo' ||
        grant.canonical_root === '/work/repo/assets'
      );
    });
  }

  function grantAwareDiagnosticsForMarkdown(
    markdown: string,
    docId: number,
    version: number,
  ): DocumentDiagnostics {
    const diagnostics = diagnosticsForMarkdown(markdown, docId, version);
    if (markdown.includes('../assets/outside.png') && hasOutsideAssetGrant(docId)) {
      diagnostics.issues = diagnostics.issues.filter((item) => item.id !== 'blocked-image:1');
      diagnostics.resources.decisions = [
        {
          source_target: '../assets/outside.png',
          normalized_target: '../assets/outside.png',
          line_start: 1,
          line_end: 1,
          kind: 'image',
          decision: 'allowed',
          reason: 'allowed_local_scope',
          safe_url: 'asset://localhost/outside.png',
          placeholder_id: 'image-0',
          alt_text: 'outside',
        },
      ];
      diagnostics.resources.loaded_resources = ['../assets/outside.png'];
      diagnostics.resources.allowed_roots = assetGrants
        .filter((grant) => grant.doc_id === docId)
        .map((grant) => grant.canonical_root);
    }
    return diagnostics;
  }

  const escapeHtml = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // STUB renderer — emits <h1> + <p> (+ a link/image placeholder), never real
  // <table>/code/mermaid/KaTeX. See the module header.
  const renderMarkdown = (markdown: string, diagnostics: DocumentDiagnostics): string => {
    const withoutFrontmatter = markdown.replace(/^---[\s\S]*?---\n/, '');
    const heading = withoutFrontmatter.match(/^#\s+(.+)$/m)?.[1] ?? 'Untitled';
    const escaped = escapeHtml(withoutFrontmatter);
    const externalLink = withoutFrontmatter.match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
    const linkHtml = externalLink
      ? `<p><a data-pmd-link-id="link-0" href="${escapeHtml(externalLink[2])}" role="link" tabindex="0">${escapeHtml(externalLink[1])}</a></p>`
      : '';
    if (
      diagnostics.resources.decisions.some(
        (decision) => decision.decision === 'allowed' && decision.alt_text === 'outside',
      )
    ) {
      return `<article class="pmd-preview"><h1>${escapeHtml(heading)}</h1><p>${escaped}</p><img src="asset://localhost/outside.png" alt="outside"></article>`;
    }
    const blocked = diagnostics.issues.some((item) => item.category === 'resource_policy')
      ? '<span class="pmd-image-placeholder">Image blocked<span>Content Blocked</span></span>'
      : diagnostics.issues.some((item) => item.category === 'image')
        ? '<span class="pmd-image-placeholder" data-pmd-resource-state="missing">Image missing</span>'
        : '';
    return `<article class="pmd-preview"><h1>${escapeHtml(heading)}</h1><p>${escaped}</p>${linkHtml}${blocked}</article>`;
  };

  let showFullPath = config.settings?.show_full_path === true;
  let showHiddenFiles = config.settings?.show_hidden_files === true;

  function settingsPayload(): Settings {
    return {
      active_theme: null,
      light_theme: null,
      dark_theme: null,
      auto_switch: false,
      default_mode: null,
      autosave_mode: 'off',
      autoreload_mode: 'when_clean',
      merge_strategy: 'raise_conflict',
      browser_base_dir: browserBaseDir,
      gist_enabled: false,
      diff_mode: 'none',
      dont_ask_default_handler: true,
      mono_font: null,
      shortcut_overrides: shortcutOverrides,
      split_scroll_locked: false,
      show_full_path: showFullPath,
      show_hidden_files: showHiddenFiles,
    };
  }

  // -------------------------------------------------------------------------
  // The exhaustive handler table. Each handler's arg/result shape is checked
  // against `CommandMap` by `MockHandlers`. Genuinely-unit commands return
  // `undefined` (void); only commands a spec reads carry a real payload.
  // -------------------------------------------------------------------------
  const handlers: MockHandlers = {
    // --- files ---
    list_dir: (args) => {
      const listing = config.dirListings?.[args.dir];
      return listing ? structuredClone(listing) : { dir: args.dir, entries: [] };
    },
    set_workspace_root: (args) => {
      browserBaseDir = args.path;
      return args.path;
    },
    // Prefer the document's parent when under the configured browser base;
    // otherwise fall back to parent (matches "listable" base without real git).
    resolve_document_workspace_root: (args) => {
      const path = args.path;
      const base = browserBaseDir ?? config.settings?.browser_base_dir ?? null;
      if (base && (path === base || path.startsWith(base.endsWith('/') ? base : `${base}/`))) {
        return base;
      }
      const slash = path.lastIndexOf('/');
      return slash > 0 ? path.slice(0, slash) : path;
    },
    pick_base_dir: () => browserBaseDir ?? config.settings?.browser_base_dir ?? null,
    reveal_in_folder: () => undefined,
    rename_path: (args) => `${dirname(args.path)}/${args.newName}`,
    open_in_default_app: () => undefined,

    // --- settings ---
    get_settings: () => settingsPayload(),
    set_autosave_mode: () => undefined,
    set_autoreload_mode: () => undefined,
    set_merge_strategy: () => undefined,
    set_gist_enabled: () => undefined,
    set_diff_mode: () => undefined,
    default_handler_status: () => ({ status: 'unknown', platform: 'linux' }),
    set_as_default_handler: () => undefined,
    set_mono_font: () => undefined,
    set_split_scroll_locked: () => undefined,
    set_show_full_path: (args) => {
      showFullPath = args.enabled === true;
      return undefined;
    },
    set_show_hidden_files: (args) => {
      showHiddenFiles = args.enabled === true;
      return undefined;
    },
    set_shortcut_overrides: (args) => {
      shortcutOverrides = structuredClone(args.overrides ?? {});
      return settingsPayload();
    },
    set_dont_ask_default_handler: () => undefined,
    get_open_dialog_on_start: () => false,

    // --- theme ---
    list_themes: () => config.themes,
    set_theme_pair: () => undefined,
    set_auto_switch: () => undefined,
    set_theme: (args) => {
      const theme = config.themes.find((item) => item.slug === args.slug) ?? config.themes[0];
      const p = theme.preview;
      const bundle: ThemeBundle = {
        css: `:root { --pmd-bg: ${p.bg}; --pmd-bg-elevated: ${p.bg_elevated}; --pmd-fg: ${p.fg}; --pmd-fg-muted: ${p.fg_muted}; --pmd-accent: ${p.accent}; --pmd-border: ${p.border}; }`,
        mermaid_vars: {},
        mode: theme.mode,
        warnings: [],
      };
      return bundle;
    },
    set_active_theme: () => undefined,
    set_default_mode: () => undefined,

    // --- docs ---
    register_doc: (args): RegisteredDoc => ({
      doc_id: nextDocId++,
      state: args.path ? { kind: 'clean', base: '00' } : { kind: 'untitled' },
      trust_context: args.path ? trustContextForPath(args.path) : null,
    }),
    render_cmd: (args): RenderResult => {
      const version = config.renderVersion ?? args.version ?? 0;
      const docId = config.renderDocId ?? args.docId ?? 1;
      const markdown = args.markdown ?? '';
      const diagnostics = grantAwareDiagnosticsForMarkdown(markdown, docId, version);
      return {
        doc_id: docId,
        html: config.renderHtml ?? renderMarkdown(markdown, diagnostics),
        version,
        source_map: [],
        render_nonce: '',
        facts: factsForMarkdown(markdown, docId, version),
        diagnostics,
      };
    },
    doc_edited: (): FileState => ({ kind: 'dirty', base: '00', mem: 'ff' }),
    save_doc: (): FileState => ({ kind: 'clean', base: '00' }),
    drop_doc: () => undefined,
    set_active_doc: () => undefined,
    // pull_from_disk carries only {docId}; the mock is keyed by path, so it has
    // no buffered contents to return here (a latent path/docId mismatch — see
    // the seam report). Returns empty contents in a clean state, matching the
    // legacy mock's effective behaviour (it read a never-present `args.path`).
    pull_from_disk: () => ({ contents: '', state: { kind: 'clean', base: '00' } }),
    resolve_disk_change: () => ({
      merged: '',
      state: { kind: 'clean', base: '00' },
      conflicted: false,
    }),
    restore_dirty_doc: (args): OpenedDocResult => ({
      doc_id: nextDocId++,
      path: args.path,
      contents: args.content,
      state: { kind: 'dirty', base: '00', mem: 'ff' },
    }),
    request_open_file: (args): OpenedDoc => {
      const docId = nextDocId++;
      const trust_context = trustContextForPath(args.path);
      if (trust_context.git_root && trust_context.git_root_state === 'trusted') {
        assetGrants.push({
          id: nextGrantId++,
          window_label: 'main',
          doc_id: docId,
          canonical_root: trust_context.git_root,
        });
      }
      return {
        doc_id: docId,
        path: args.path,
        contents: files[args.path] ?? '# Missing fixture',
        state: { kind: 'clean', base: '00' },
        trust_context,
      };
    },
    export_html: () => null,
    get_initial_path: () => config.initialPath,
    import_image_asset: () => null,
    paste_html_as_markdown: () => '',

    // --- windows ---
    open_url: () => undefined,
    new_window: () => undefined,
    begin_quit: () => undefined,
    restart_app: () => undefined,
    set_window_title: () => undefined,

    // --- session ---
    get_window_session: () => null,
    save_window_session: () => undefined,
    get_recently_closed_windows: () => [],
    restore_recently_closed_window: () => undefined,
    clear_recently_closed_windows: () => undefined,
    window_closing: () => undefined,

    // --- trust / asset grants ---
    list_asset_grants: (args) => assetGrants.filter((grant) => grant.doc_id === args.docId),
    grant_asset_folder: (args): AssetGrant => {
      const root = window.__pmdNextGrantFolder;
      if (!root) throw new Error('No mocked asset folder selected');
      window.__pmdNextGrantFolder = null;
      const grant: AssetGrant = {
        id: nextGrantId++,
        window_label: 'main',
        doc_id: args.docId,
        canonical_root: root,
      };
      assetGrants.push(grant);
      return grant;
    },
    revoke_asset_grant: (args) => {
      const index = assetGrants.findIndex(
        (grant) => grant.id === args.grantId && grant.doc_id === args.docId,
      );
      if (index >= 0) assetGrants.splice(index, 1);
    },
    grant_recommended_root: (args): AssetGrant => {
      const existing = trustRootDecisions.find(
        (decision) => decision.canonical_root === args.canonicalRoot,
      );
      if (existing) existing.state = 'trusted';
      else trustRootDecisions.push({ canonical_root: args.canonicalRoot, state: 'trusted' });
      const grant: AssetGrant = {
        id: nextGrantId++,
        window_label: 'main',
        doc_id: args.docId,
        canonical_root: args.canonicalRoot,
      };
      assetGrants.push(grant);
      return grant;
    },
    remember_declined_root: (args) => {
      const existing = trustRootDecisions.find(
        (decision) => decision.canonical_root === args.canonicalRoot,
      );
      if (existing) existing.state = 'declined';
      else trustRootDecisions.push({ canonical_root: args.canonicalRoot, state: 'declined' });
    },
    forget_trust_root: (args) => {
      const index = trustRootDecisions.findIndex(
        (decision) => decision.canonical_root === args.canonicalRoot,
      );
      if (index >= 0) trustRootDecisions.splice(index, 1);
      for (let i = assetGrants.length - 1; i >= 0; i--) {
        if (assetGrants[i].canonical_root === args.canonicalRoot) assetGrants.splice(i, 1);
      }
    },
    list_trust_roots: () => trustRootDecisions,

    // --- links ---
    prepare_link_activation: () => ({
      kind: 'external_confirmation',
      normalized_url: 'https://example.com/report',
      scheme: 'https',
      host: 'example.com',
      label_text: 'external report',
      action_token: 'external-token-1',
    }),
    confirm_external_open: () => undefined,

    // --- dialogs / recent ---
    open_dialog: () => null,
    save_dialog: () => null,
    get_recent_files: () => [],
    clear_recent_files: () => undefined,
  };

  window.__pmdInvocations = [];
  window.__pmdE2e = true;
  window.__pmdE2eActions = [];
  delete window.__TAURI__;

  const internals: TauriInternals = {
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
      for (const set of eventListeners.values()) set.delete(id);
    },
    runCallback(id, payload) {
      callbacks.get(id)?.(payload);
    },
    async invoke(cmd, args = {}) {
      window.__pmdInvocations?.push({ cmd, args });
      // Event subscription plumbing (the `open-file`/`activate-doc`/… listeners
      // go through here). `listen()` invokes `plugin:event|listen` with a
      // transformCallback id; record it so `__pmdEmitEvent` can dispatch to it.
      if (cmd === 'plugin:event|listen') {
        const event = String(args.event);
        const id = args.handler as number;
        let set = eventListeners.get(event);
        if (!set) {
          set = new Set<number>();
          eventListeners.set(event, set);
        }
        set.add(id);
        return id;
      }
      if (cmd === 'plugin:event|unlisten') return null;
      const handler = (handlers as unknown as Record<
        string,
        ((a: Record<string, unknown>) => unknown) | undefined
      >)[cmd];
      if (handler) return handler(args);
      // Unknown commands (Tauri core/window plugin internals, etc.) resolve null,
      // preserving the legacy mock's graceful fallthrough.
      return null;
    },
  };
  window.__TAURI_INTERNALS__ = internals;

  // Emit a backend event to any `subscribe()`/`listen()` handlers. This is how
  // the mock delivers `open-file` (prod only listens — it is NOT an invoke),
  // plus `activate-doc`, `doc_state_changed`, etc. Payload shape matches Tauri's
  // `{ event, id, payload }` envelope that `listen()` unwraps to `event.payload`.
  // Typed against `EventMap` so a wrong event name/payload is a tsc error at
  // call sites that import this typing (the runtime still accepts any string).
  window.__pmdEmitEvent = <K extends keyof EventMap>(
    name: K,
    payload: EventMap[K],
  ) => {
    const set = eventListeners.get(name);
    if (!set) return;
    for (const id of [...set]) {
      callbacks.get(id)?.({ event: name, id, payload });
    }
  };

  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener(_event, id) {
      callbacks.delete(id);
      for (const set of eventListeners.values()) set.delete(id);
    },
  };
}

// ---------------------------------------------------------------------------
// Entry: merge the per-test config over defaults and install.
// ---------------------------------------------------------------------------

const raw: Partial<MockConfig> = window.__pmdMockConfig ?? {};
installMock({
  initialPath: raw.initialPath ?? null,
  themes: raw.themes ?? [],
  renderHtml: raw.renderHtml ?? null,
  renderDocId: raw.renderDocId ?? null,
  renderVersion: raw.renderVersion ?? null,
  renderFacts: raw.renderFacts ?? null,
  renderDiagnostics: raw.renderDiagnostics ?? null,
  files: raw.files ?? null,
  gitRoots: raw.gitRoots ?? [],
  trustRoots: raw.trustRoots ?? [],
  settings: raw.settings ?? null,
  dirListings: raw.dirListings ?? null,
});
