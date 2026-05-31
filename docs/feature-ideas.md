# preview-md — Feature Ideas

> Generated: 2026-05-30. All ideas assume the v1 baseline described in
> `docs/superpowers/specs/2026-05-24-preview-md-design.md`. Features already
> existing or explicitly planned (multi-tab, folder browser, diff view, gist
> export, Nerd Fonts, autosave/3-way-merge, scroll sync, theme picker, alerts,
> footnotes, table/code-block copy, hotkey overlay, status bar) are **not**
> reproposed here.

---

## Top 10 Quick Wins

Ideas with High value and Low-to-Medium effort — best candidates for the next
development slice.

**Status audited 2026-05-31** against the codebase. Legend: ✅ shipped · 🟡 partial · ⬜ not started.

| # | Name | Value | Effort | Section | Status |
|---|------|-------|--------|---------|--------|
| 1 | **Sandboxed Link Handling** | High | Low | Security | ✅ `link_activation.ts` + `cmd/reveal.rs` |
| 2 | **Smart List Continuation** | High | Low | Authoring | ⬜ |
| 3 | **Dependency Integrity Pinning** | High | Low | Security | 🟡 no `checksums.toml` / `verify-vendor` |
| 4 | **Ammonia Allowlist Regression Tests** | High | Med | Security | ✅ `pmd-core/tests/security.rs` |
| 5 | **PDF Export** | High | Low | Rendering | ⬜ no print CSS / `window.print()` |
| 6 | **Crash Recovery / Draft Autosave** | High | Med | Security | 🟡 autosave + session restore ✅; crash-recovery dir/UI ❌ |
| 7 | **Strict Image URL Validation** | High | Low | Security | ✅ `preview/resource_policy.rs` |
| 8 | **Find-and-Replace with Regex** | High | Med | Authoring | 🟡 find (incl. regex) ✅; **replace** ❌ |
| 9 | **CLI Flags for Headless Render** | High | Med | Power-user | 🟡 `--list-themes`/`--open-dialog` ✅; `--render`/`--output` ❌ |
| 10 | **Paste-as-Markdown from HTML** | High | Med | Authoring | ⬜ |

> Also shipped since this backlog was written (not in the table above): Document
> Outline/TOC, Reading-Time Estimate, Command Palette, Session Restore,
> Keyboard-Navigable Theme Picker, Mermaid Diagram Caching, Frontmatter editor,
> CSP hardening. See per-section notes below and `synthesis.md` for the v1 push.

---

## 1. Authoring / Editing Ergonomics

| Name | Value | Effort | Status |
|------|-------|--------|--------|
| Find-and-Replace with Regex | High | Med | 🟡 find ✅, replace ❌ |
| Paste-as-Markdown from HTML | High | Med | ⬜ |
| Image Paste / Drag-and-Drop Embed | High | Med | 🟡 drag-to-open ✅, image embed ❌ |
| Document Outline / TOC Panel | High | Med | ✅ `outline_panel.ts` |
| Snippet Library | High | Med | ⬜ |
| Smart List Continuation | High | Low | ⬜ |
| Markdown Formatting Shortcuts | High | Low | ⬜ |
| Visual Table Editor | Med | High | ⬜ |
| Bracket / Quote Auto-Close | Med | Low | ⬜ |
| Focus / Distraction-Free Mode | Med | Low | ⬜ |
| Typewriter Scroll | Med | Low | ⬜ |
| Spell-Check Underlines | Med | Med | ⬜ |
| Link Autocomplete from Headings | Med | Med | ⬜ |
| Syntax Autocomplete (LaTeX / Markdown) | Med | Med | ⬜ |
| Show Invisible Characters | Med | Low | ⬜ |
| Reading-Time Estimate | Low | Low | ✅ `stats_popover.ts` |
| Writing Goal / Daily Target | Low | Low | ⬜ |
| Scroll Past End | Low | Low | ⬜ |
| RTL Writing Direction | Low | Low | ⬜ |

### Find-and-Replace with Regex
**Description:** In-editor find/replace panel (Ctrl+H) supporting plain text and regex, with live match highlighting in both source and preview panes.
**Value:** High
**Effort:** Med
**Notes:** CodeMirror 6 has a built-in search extension; wrapping it is low-risk. Preview-side highlighting needs source-map cross-referencing.

### Paste-as-Markdown from HTML
**Description:** When the clipboard contains HTML (from a browser or rich-text app), Ctrl+Shift+V converts it to clean Markdown before inserting, using a Rust-side HTML-to-MD transform.
**Value:** High
**Effort:** Med
**Notes:** The HTML must be sanitized before conversion — treat clipboard HTML as untrusted; run through ammonia before passing to the converter.

### Image Paste / Drag-and-Drop Embed
**Description:** Drag an image file onto the editor or paste an image from clipboard; the app saves it relative to the current file (e.g., `./assets/`) and inserts the Markdown image syntax.
**Value:** High
**Effort:** Med
**Notes:** Requires extending the asset-scope policy so the new assets/ subdirectory is granted at write time; user approval dialog recommended for first paste.

### Document Outline / TOC Panel
**Description:** A collapsible left panel showing the live heading tree (H1–H6); clicking a heading jumps both editor and preview to that section.
**Value:** High
**Effort:** Med
**Notes:** Headings already parsed server-side; the outline can be derived from the render source-map without extra IPC.

### Snippet Library
**Description:** User-defined named snippets (e.g., `!warn` → GitHub alert block) invoked via a trigger prefix in the editor; snippets stored in `~/.config/preview-md/snippets.toml`.
**Value:** High
**Effort:** Med
**Notes:** Snippet content is inert Markdown text; no sanitization needed at insert time since the render pipeline already sanitizes.

### Smart List Continuation
**Description:** Pressing Enter at the end of a list item inserts the next bullet/number automatically; pressing Enter on an empty list item exits the list.
**Value:** High
**Effort:** Low
**Notes:** CodeMirror 6 has a `markdownKeymap` in `@codemirror/lang-markdown`; enabling it covers this with minimal new code.

### Visual Table Editor
**Description:** Double-click a GFM table in the preview to open a spreadsheet-style grid editor; edits write back as valid Markdown table syntax.
**Value:** Med
**Effort:** High
**Notes:** Complex round-trip formatting; a pure-frontend approach (CodeMirror table widget) avoids extra IPC.

### Bracket / Quote Auto-Close
**Description:** Typing `(`, `[`, `*`, `_`, or `"` inserts the matching closing character with cursor placed inside.
**Value:** Med
**Effort:** Low
**Notes:** Available via `@codemirror/autocomplete` `closeBrackets`; add Markdown-specific pairs (`**`, `_`).

### Focus / Distraction-Free Mode
**Description:** A full-screen mode (F11 or toolbar button) that hides all chrome (toolbar, status bar, tab bar) and centers the text column at a comfortable reading width.
**Value:** Med
**Effort:** Low
**Notes:** Pure CSS/Tauri fullscreen; no backend changes; width cap (~72ch) improves readability.

### Typewriter Scroll
**Description:** Optional mode where the active line stays vertically centered in the editor viewport instead of scrolling to the bottom.
**Value:** Med
**Effort:** Low
**Notes:** CodeMirror `scrollIntoView` + CSS approach; toggleable in settings.

### Spell-Check Underlines
**Description:** Integrate the OS spell-check provider (WebKitGTK's built-in spellcheck attribute) or a bundled Hunspell dictionary to underline misspelled words in the source editor.
**Value:** Med
**Effort:** Med
**Notes:** WebKitGTK supports `spellcheck` attribute natively; scope to editor pane only to avoid false positives in code blocks.

### Link Autocomplete from Headings
**Description:** Typing `[#` in the editor triggers an autocomplete dropdown of document headings as anchor link targets (e.g., `[#introduction](#introduction)`).
**Value:** Med
**Effort:** Med
**Notes:** Requires a CodeMirror completion source that reads the live heading list derived from the current render result.

### Reading-Time Estimate
**Description:** Status bar shows estimated reading time (words ÷ 200 wpm) alongside the existing word count.
**Value:** Low
**Effort:** Low
**Notes:** Computed client-side from existing word count; no backend change.

### Writing Goal / Daily Target
**Description:** Configurable word-count target (e.g., 500 words/day) shown as a progress indicator in the status bar; resets at midnight.
**Value:** Low
**Effort:** Low
**Notes:** Stored in `state.toml`; progress is local and private by default.

> The following five entries were added 2026-05-31 after reviewing the Pine
> macOS Markdown editor (<https://lukakerr.github.io/Pine/>). Pine's JavaScript
> preview-plugin system was deliberately excluded as it conflicts with the
> visible-trust / strict-sanitization posture; auto-pairing of Markdown tags is
> already captured by *Bracket / Quote Auto-Close* above.

### Markdown Formatting Shortcuts
**Description:** Standard editor shortcuts that wrap or toggle the selection — `Ctrl+B` bold, `Ctrl+I` italic, `` Ctrl+` `` inline code, `Ctrl+K` link, plus heading and list toggles — mirroring the existing toolbar actions.
**Value:** High
**Effort:** Low
**Notes:** Pure CodeMirror 6 keymap over selection transforms; table-stakes ergonomics Pine ships. Should share the same command implementations as any formatting toolbar buttons to avoid divergence.

### Syntax Autocomplete (LaTeX / Markdown)
**Description:** Completion popups for LaTeX/KaTeX commands (`\alpha`, `\frac`, …) inside math spans and for common Markdown constructs (fences, alert types, task items), complementing the heading-anchor completion already proposed.
**Value:** Med
**Effort:** Med
**Notes:** CodeMirror `autocompletion` with static, offline completion sources; LaTeX command list is a bundled table (no network). Builds on *Link Autocomplete from Headings*; scope math completions to within `$`/`$$` regions to avoid noise in prose.

### Show Invisible Characters
**Description:** A toggle that renders whitespace glyphs — spaces, tabs, trailing whitespace, and line breaks — in the source editor for precise control over Markdown's whitespace-sensitive constructs (hard breaks, list indentation, code fences).
**Value:** Med
**Effort:** Low
**Notes:** CodeMirror `highlightTrailingWhitespace` plus a whitespace-rendering decoration; toggleable in settings. On-brand for "see exactly what's in the file." No backend changes.

### Scroll Past End
**Description:** Allow the editor to scroll past the final line so the last lines can sit mid-viewport instead of pinned to the bottom edge.
**Value:** Low
**Effort:** Low
**Notes:** Bottom padding on the CodeMirror scroller (or `scrollPastEnd`-style extension); toggleable. Pairs naturally with *Typewriter Scroll*. No backend changes.

### RTL Writing Direction
**Description:** A per-document toggle for right-to-left writing direction in the editor and preview, for authoring in RTL scripts (Arabic, Hebrew).
**Value:** Low
**Effort:** Low
**Notes:** Sets `dir="rtl"` on the editor and preview containers; CodeMirror supports bidi text natively. Persisted per-file in `state.toml`; an i18n/accessibility nicety.

---

## 2. Navigation & Organization

| Name | Value | Effort | Status |
|------|-------|--------|--------|
| Reverse Scroll Sync (Preview → Editor) | High | Med | ⬜ forward sync only |
| Search Across Open Files | High | Med | ⬜ single-doc find only |
| Wiki-Link / Backlink Support | High | High | ⬜ |
| Recent Workspaces / Pinned Directories | Med | Low | ⬜ recent files only |
| Split Panes (Horizontal Layout) | Med | Low | ⬜ vertical split only |
| Jump-to-Definition for References | Med | Med | ⬜ |
| Document History / File Timeline | Med | High | ⬜ |
| Heading-Level Promote / Demote | Med | Low | ⬜ |
| Pinned Tabs | Low | Low | ⬜ |
| Bookmark / Annotation Panel | Low | Med | ⬜ |

### Reverse Scroll Sync (Preview → Editor)
**Description:** Clicking or scrolling in the preview pane moves the editor caret to the corresponding source line via the source-map, completing bi-directional sync.
**Value:** High
**Effort:** Med
**Notes:** The spec explicitly YAGNI'd this for v1 but listed it for v2; source-map data already exists so implementation is additive.

### Search Across Open Files
**Description:** A global search bar (Ctrl+Shift+F) that searches across all open tabs, showing matching excerpts with line numbers.
**Value:** High
**Effort:** Med
**Notes:** Search is purely in-memory over open buffers; no filesystem crawling required.

### Wiki-Link / Backlink Support
**Description:** Support `[[Page Name]]` wiki-link syntax; links resolve to same-directory `.md` files; a Backlinks panel shows which files link to the current document.
**Value:** High
**Effort:** High
**Notes:** Requires a lazy, cached index of all `.md` files in the open folder; no network access needed.

### Recent Workspaces / Pinned Directories
**Description:** Beyond recent files, remember recently opened root directories as "workspaces"; a Workspaces entry in the File menu lets users switch project contexts in one click.
**Value:** Med
**Effort:** Low
**Notes:** Stored as a short list in `recents.toml` alongside file recents; no new file-access policy needed.

### Split Panes (Horizontal Layout)
**Description:** Optional horizontal (stacked) split layout in split mode — editor on top, preview below — for portrait screens or ultra-wide monitors.
**Value:** Med
**Effort:** Low
**Notes:** Pure CSS flexbox direction toggle; split ratio and direction stored per-window in memory.

### Jump-to-Definition for References
**Description:** Ctrl+Click on a footnote reference `[^1]` or image path in the preview jumps to the corresponding definition line in the source editor.
**Value:** Med
**Effort:** Med
**Notes:** Leverages existing source-map; requires click-event delegation in the preview pane routing back through IPC.

### Document History / File Timeline
**Description:** A Timeline sidebar showing dated autosave snapshots of the current file; clicking a snapshot opens it in a read-only diff view against the current version.
**Value:** Med
**Effort:** High
**Notes:** Snapshots stored under `~/.local/share/preview-md/history/<file-hash>/`; max retention configurable; no cloud required.

### Heading-Level Promote / Demote
**Description:** Keyboard shortcuts (e.g., Alt+Left/Right) promote or demote the heading level of the line under the cursor, adjusting the `#` count.
**Value:** Med
**Effort:** Low
**Notes:** Pure editor-side transformation; no render pipeline involvement needed.

### Pinned Tabs
**Description:** Right-click a tab to pin it; pinned tabs stay at the left of the tab bar and cannot be accidentally closed.
**Value:** Low
**Effort:** Low
**Notes:** Pure UI state; persisted to `state.toml` per-file path.

### Bookmark / Annotation Panel
**Description:** Users can mark source lines with named bookmarks (stored in a sidecar `.pmd-bookmarks.json`); a Bookmarks panel lists them and double-click jumps to the line.
**Value:** Low
**Effort:** Med
**Notes:** Sidecar file uses hidden-dot convention; excluded from file-browser display by default.

---

## 3. Rendering & Export

| Name | Value | Effort | Status |
|------|-------|--------|--------|
| PDF Export | High | Low | ⬜ |
| HTML Export (Self-Contained) | High | Med | ⬜ |
| Presentation / Slides Mode | Med | Med | ⬜ |
| Frontmatter Rendering in Preview | Med | Med | ⬜ inspector panel ✅, preview card ❌ |
| Syntax-Highlight Theme Decoupling | Med | Med | ⬜ |
| Print-Preview Mode | Med | Low | ⬜ |
| Diagram Export (SVG/PNG) | Med | Med | 🟡 SVG via zoom overlay ✅, PNG + right-click ❌ |
| Mermaid Diagram Caching / Pre-render | Med | Med | ✅ `mermaid_runner.ts` |
| Math Macro Library | Med | Low | ⬜ |
| Custom CSS per File or Workspace | Med | Med | ⬜ |
| Pandoc Export Pipeline | Med | Low | ⬜ |
| Export to EPUB | Low | High | ⬜ |
| Share as Image (Social Card) | Low | Med | ⬜ |

### PDF Export
**Description:** Export the current document to PDF using WebKit's print API (`window.print()` with a print-specific CSS) triggered from a menu item or toolbar button.
**Value:** High
**Effort:** Low
**Notes:** The spec listed this as trivial to add later (§15); print CSS needs a separate stylesheet to strip chrome and paginate correctly.

### HTML Export (Self-Contained)
**Description:** Export the current document as a single HTML file with inlined CSS (theme included), inlined images as data URIs, and KaTeX/mermaid rendered at export time.
**Value:** High
**Effort:** Med
**Notes:** Image inlining reads local files through the already-scoped asset access path — no new security policy needed.

### Presentation / Slides Mode
**Description:** Treat horizontal rules (`---`) as slide boundaries and render the document as a fullscreen slide deck, one slide per screen with keyboard navigation (←/→).
**Value:** Med
**Effort:** Med
**Notes:** Pure frontend: a CSS + JS layout toggle; no backend changes; slides use the same sanitized HTML as preview.

### Frontmatter Rendering in Preview
**Description:** Parse YAML/TOML frontmatter (`---` block) and render it as a styled metadata card at the top of the preview (title, date, tags, author).
**Value:** Med
**Effort:** Med
**Notes:** Frontmatter stripped from rendered body today; the metadata card is a separate DOM element prepended before the sanitized HTML.

### Syntax-Highlight Theme Decoupling
**Description:** Allow choosing a syntax-highlight color scheme independently of the UI theme (e.g., "Frieren" UI theme with "Monokai" code highlighting).
**Value:** Med
**Effort:** Med
**Notes:** Syntax tokens already use `hl-*` CSS classes; a separate `syntax_theme` key in settings pointing to a CSS-variable override file achieves this cleanly.

### Print-Preview Mode
**Description:** A dedicated print-preview rendering that shows the document paginated as it will appear on paper, using the print CSS, before committing to PDF export.
**Value:** Med
**Effort:** Low
**Notes:** WebKit print API supports `matchMedia('print')`; a toggle class on `<body>` activates print styles in-window.

### Diagram Export (SVG/PNG)
**Description:** Right-click a mermaid diagram in the preview to save it as an SVG or PNG file via the native save dialog.
**Value:** Med
**Effort:** Med
**Notes:** Mermaid already produces SVG in the DOM; PNG conversion uses the Canvas API; no arbitrary path writes.

### Mermaid Diagram Caching / Pre-render
**Description:** Cache rendered mermaid SVGs keyed on diagram source hash; serve the cached SVG instantly on reload while async re-render completes in the background.
**Value:** Med
**Effort:** Med
**Notes:** In-memory cache per session for v1; disk cache is a v2 enhancement; entries invalidated on theme change since colors are theme-dependent.

### Math Macro Library
**Description:** User-defined KaTeX macros stored in `~/.config/preview-md/katex-macros.toml` and passed to KaTeX's `macros` option at init time.
**Value:** Med
**Effort:** Low
**Notes:** KaTeX `macros` is a plain JS object; macros are strings only (no code execution); safe to load from config file.

### Custom CSS per File or Workspace
**Description:** A `.pmd.css` file co-located with the Markdown file is auto-loaded and applied as a user-override layer on top of the active theme.
**Value:** Med
**Effort:** Med
**Notes:** The CSS file must be loaded via the restricted asset scope and injected as a `<style>` element — no `@import url()` allowed to prevent SSRF.

### Pandoc Export Pipeline
**Description:** Pass the current Markdown through a user-installed Pandoc binary to export to DOCX, LaTeX, RST, or any Pandoc-supported format from an export dialog.
**Value:** Med
**Effort:** Low
**Notes:** Pandoc invoked as `Command::new("pandoc")` with the file path; user must have Pandoc installed; no bundling needed.

### Export to EPUB
**Description:** Bundle the document (and linked images) into a minimal EPUB 3 archive using a Rust-side crate (e.g., `epub-builder`).
**Value:** Low
**Effort:** High
**Notes:** EPUB requires spine, toc, and manifest XML; the rendered HTML is already available — packaging is the effort, not rendering.

### Share as Image (Social Card)
**Description:** Render the first screenful of the preview to a PNG at 1200×630 px and copy it to the clipboard or save it, ready for social media sharing.
**Value:** Low
**Effort:** Med
**Notes:** Uses WebKit's offscreen rendering or Canvas screenshot; dimensions fixed for OG-card compatibility; user confirms before clipboard write.

---

## 4. Collaboration / Sharing & Integrations

| Name | Value | Effort | Status |
|------|-------|--------|--------|
| Pandoc Export Pipeline | Med | Low | ⬜ |
| Git Commit / Stage from Editor | Med | Med | ⬜ git-root detection only |
| Frontmatter / Metadata Editor | Med | Med | ✅ `frontmatter_panel.ts` |
| Publish to Static Site (Hugo / Jekyll / Zola) | Med | Med | ⬜ |
| Obsidian Vault Import | Med | High | ⬜ |
| Watch-and-Sync (External Renderer) | Low | Low | ⬜ |
| Snippet / Template Sharing via URL | Low | Med | ⬜ |
| Mastodon / DEV.to Publish | Low | High | ⬜ |
| Remote File Open (SFTP/SSH) | Low | High | ⬜ |
| Share as Image (Social Card) | Low | Med | ⬜ |

> Note: Pandoc Export and Share as Image also appear in §3 (Rendering); listed here for discoverability.

### Git Commit / Stage from Editor
**Description:** A Git panel (or status bar indicator) shows the file's git status (modified/staged/untracked); one-click commit with a message dialog for single-file commits.
**Value:** Med
**Effort:** Med
**Notes:** Uses `git2` crate (libgit2 bindings); scoped to the file's repository only; no credential storage in v1.

### Frontmatter / Metadata Editor
**Description:** A structured form UI that reads and writes YAML frontmatter (title, date, tags, author, custom keys) without requiring hand-editing raw YAML.
**Value:** Med
**Effort:** Med
**Notes:** Frontmatter parsed Rust-side with `serde_yaml`; the form is a webview panel; schema is open/extensible.

### Publish to Static Site (Hugo / Jekyll / Zola)
**Description:** A "Publish" button copies or moves the file to a configured static-site content directory and triggers a configured build command (e.g., `hugo`) as a sidecar process.
**Value:** Med
**Effort:** Med
**Notes:** Build command user-configured in settings; runs via Tauri's `shell` API with an explicit allowlist — no arbitrary shell injection.

### Obsidian Vault Import
**Description:** "Open Vault" opens an Obsidian-compatible directory, auto-enabling wiki-link resolution, reading the attachment folder config, and organizing the file browser accordingly.
**Value:** Med
**Effort:** High
**Notes:** Does not replicate Obsidian's plugin ecosystem; read-only vault browsing is feasible without reverse-engineering proprietary formats.

### Watch-and-Sync (External Renderer)
**Description:** Write the rendered HTML to a configurable output path whenever the document saves, enabling integration with external pipelines (pandoc post-processors, watch scripts).
**Value:** Low
**Effort:** Low
**Notes:** Output path must be within the file's directory or a user-approved path; no network writes; triggered on save, not every keystroke.

### Snippet / Template Sharing via URL
**Description:** Export a snippet or document template as a signed URL fragment that can be pasted into any preview-md instance to import it.
**Value:** Low
**Effort:** Med
**Notes:** Must validate and sanitize imported content through the full render pipeline; no arbitrary file writes from import.

### Mastodon / DEV.to Publish
**Description:** "Publish to …" menu entries authenticate via OAuth2 and post the rendered Markdown or frontmatter-extracted content to configured social/blogging platforms.
**Value:** Low
**Effort:** High
**Notes:** Requires network access (currently disallowed); needs explicit opt-in in CSP and secure token storage via Tauri's keychain API.

### Remote File Open (SFTP/SSH)
**Description:** Open a file from a remote server via SFTP; edits are buffered locally and synced on save; file watcher watches the local copy.
**Value:** Low
**Effort:** High
**Notes:** SSH keys handled by OS keychain; local temp copy lives in `~/.local/share/preview-md/remote-cache/`; outside v1 security scope.

---

## 5. Power-User & Platform

| Name | Value | Effort | Status |
|------|-------|--------|--------|
| Command Palette | High | Med | ✅ `command_overlay.ts` |
| Vim Keybindings Mode | High | Med | ⬜ |
| Session Restore | High | Med | ✅ `session_manager.ts` |
| CLI Flags for Headless Render | High | Med | 🟡 `--list-themes`/`--open-dialog` ✅, `--render` ❌ |
| Large-File Performance Mode | Med | Low | ⬜ |
| Per-File Settings Override | Med | Low | ⬜ |
| Workspace / Project Settings File | Med | Med | ⬜ |
| Accessibility: Screen Reader Landmarks | Med | Low | 🟡 partial ARIA, no full audit |
| Keyboard-Navigable Theme Picker | Med | Low | ✅ `picker.ts` |
| Custom Protocol Handler (`preview-md://`) | Med | Med | ⬜ |
| Emacs Keybindings Mode | Low | Low | ⬜ |
| Performance Profiling Mode (Dev) | Low | Low | ⬜ |

### Command Palette
**Description:** A fuzzy-search command palette (Ctrl+P or Ctrl+Shift+P) listing all commands, recent files, and settings toggles; replaces hunting through menus.
**Value:** High
**Effort:** Med
**Notes:** Pure frontend; commands are a static registry with labels and keybindings; fuzzy match via a lightweight JS library (no network).

### Vim Keybindings Mode
**Description:** An opt-in Vim emulation layer in CodeMirror (using `@replit/codemirror-vim`) providing Normal/Insert/Visual modes, `:w` to save, and common motions.
**Value:** High
**Effort:** Med
**Notes:** The spec explicitly YAGNI'd this for v1 and listed it for v2; the CodeMirror Vim extension is well-maintained and drop-in.

### Session Restore
**Description:** On restart, reopen the same files, tabs, cursor positions, and scroll positions that were active when the app last closed.
**Value:** High
**Effort:** Med
**Notes:** Explicitly YAGNI'd for v1; per-window state serialized to `~/.local/share/preview-md/sessions/`; multi-instance safe with per-PID session files.

### CLI Flags for Headless Render
**Description:** `preview-md --render input.md --output output.html` invokes `pmd-core` in headless mode (no Tauri window) and writes sanitized HTML to stdout or a file.
**Value:** High
**Effort:** Med
**Notes:** `pmd-core` is already a pure library; a thin binary wrapper adds zero new dependencies; useful for CI pipelines and static-site generators.

### Large-File Performance Mode
**Description:** For files over a configurable size threshold (default 500 KB), disable live render and switch to manual-refresh-only mode with increased debounce (1 s).
**Value:** Med
**Effort:** Low
**Notes:** Threshold configurable in settings; status bar shows "Large file — manual render" warning.

### Per-File Settings Override
**Description:** A `<!-- pmd: mode=preview wrap=80 -->` comment at the top of a file sets rendering options for that file only, overriding globals.
**Value:** Med
**Effort:** Low
**Notes:** Parsed in `pmd-core` as a pre-scan step before the main parse; no user-facing UI needed beyond documentation.

### Workspace / Project Settings File
**Description:** A `.pmd.toml` file at the root of a directory defines project-level defaults (theme, default mode, KaTeX macros, snippet library path) applied to all files under it.
**Value:** Med
**Effort:** Med
**Notes:** Discovered by walking up the directory tree from the opened file; read-only in v1 (no editor UI for it).

### Accessibility: Screen Reader Landmarks
**Description:** Add ARIA landmarks (`role="main"`, `role="complementary"`, `aria-label`) to the preview pane, toolbar, and status bar so screen readers announce document structure.
**Value:** Med
**Effort:** Low
**Notes:** No backend changes; pure HTML/ARIA attribute additions; test with Orca on Linux.

### Keyboard-Navigable Theme Picker
**Description:** The theme picker is fully keyboard-navigable (arrow keys, Enter to select, Escape to dismiss) with visible focus rings and screen-reader announcements.
**Value:** Med
**Effort:** Low
**Notes:** ARIA `listbox`/`option` roles; focus trap within the picker while open; aligns with the WCAG AA goal already in the spec.

### Custom Protocol Handler (`preview-md://`)
**Description:** Register `preview-md://open?path=...` as a URL protocol so other apps (terminal, browser, file manager) can open files in preview-md by URL.
**Value:** Med
**Effort:** Med
**Notes:** Explicitly YAGNI'd for v1 but listed; path parameter must be validated against the file-access policy before opening.

### Emacs Keybindings Mode
**Description:** An opt-in Emacs emulation layer in CodeMirror providing basic movement (Ctrl+A/E/F/B/N/P/K/Y, mark/region) for users who prefer Emacs navigation.
**Value:** Low
**Effort:** Low
**Notes:** CodeMirror ships `@codemirror/commands` with Emacs-compatible bindings; thin config layer.

### Performance Profiling Mode (Dev)
**Description:** A hidden dev mode (`--dev-perf` flag) that logs render latency (parse, emit, sanitize, IPC round-trip) to stderr in JSON-lines format for benchmarking.
**Value:** Low
**Effort:** Low
**Notes:** Uses `std::time::Instant` spans already present in the pipeline; formatted as JSON lines for flamegraph tool ingestion.

---

## 6. Security & Robustness

| Name | Value | Effort | Status |
|------|-------|--------|--------|
| Sandboxed Link Handling | High | Low | ✅ `link_activation.ts` |
| Strict Image URL Validation | High | Low | ✅ `resource_policy.rs` |
| Dependency Integrity Pinning | High | Low | 🟡 no `checksums.toml` / `verify-vendor` |
| Ammonia Allowlist Regression Tests | High | Med | ✅ `pmd-core/tests/security.rs` |
| Crash Recovery / Draft Autosave | High | Med | 🟡 autosave/session ✅, crash-recovery dir ❌ |
| Mermaid `securityLevel: sandbox` | Med | High | ⬜ (parked v2) |
| Content-Security-Policy Audit Tooling | Med | Low | 🟡 CSP hardcoded ✅, audit tooling ❌ |
| Untrusted-Mode for Received Files | Med | Med | ⬜ |
| Safe Paste Guard | Med | Low | ⬜ |
| Audit Log for File Operations | Low | Low | ⬜ |
| Clipboard Write Guard | Low | Low | ⬜ |

### Sandboxed Link Handling
**Description:** Clicking a hyperlink in the preview opens it in the default browser via `xdg-open` rather than navigating the WebView; all `<a>` clicks are intercepted and the href is validated before dispatch.
**Value:** High
**Effort:** Low
**Notes:** Prevents the WebView from loading arbitrary URLs; href validation must reject `javascript:`, `file://`, `data:text/html`, and other dangerous schemes before passing to `xdg-open`.

### Strict Image URL Validation
**Description:** Extend the existing image URL sanitizer to also reject `data:text/html`, `data:application/javascript`, and any data URI whose MIME type is not in an explicit image allowlist.
**Value:** High
**Effort:** Low
**Notes:** Current policy rejects absolute `file://` and `http(s)://`; this closes the remaining data-URI gap for non-image MIME types.

### Dependency Integrity Pinning
**Description:** All vendored JS bundles (CodeMirror, mermaid, KaTeX) have their SHA-256 hashes recorded in `ui/vendor/checksums.toml`; a `just verify-vendor` command recomputes and compares them.
**Value:** High
**Effort:** Low
**Notes:** Detects accidental or malicious tampering with vendored files; run in CI as a pre-build step; fail-fast on mismatch.

### Ammonia Allowlist Regression Tests
**Description:** A dedicated test suite that attempts to inject known XSS vectors (polyglot payloads, SVG event handlers, CSS injection, mXSS) through the render pipeline and asserts they are stripped.
**Value:** High
**Effort:** Med
**Notes:** Tests live in `pmd-core/tests/security/`; updated with each CVE affecting ammonia, pulldown-cmark, or mermaid; run in CI.

### Crash Recovery / Draft Autosave
**Description:** Beyond the existing autosave-on-change, write a crash-recovery draft to `~/.local/share/preview-md/crash-recovery/` on every save; on next launch, offer to restore unsaved drafts from crashed sessions.
**Value:** High
**Effort:** Med
**Notes:** Recovery files keyed by file path hash; presented as a non-blocking notification on startup; cleaned up after successful normal save or explicit dismissal.

### Mermaid `securityLevel: sandbox` (Iframe Isolation)
**Description:** Run mermaid rendering in a sandboxed `<iframe>` (`sandbox="allow-scripts"`) so mermaid-generated HTML is fully isolated from the main document DOM.
**Value:** Med
**Effort:** High
**Notes:** The spec explicitly parked this for v2; main blocker is cross-frame communication for sizing/theming since CSS variables don't cross iframe boundaries.

### Content-Security-Policy Audit Tooling
**Description:** A dev-mode command (`just audit-csp`) that parses the app's CSP header, compares it against a known-safe allowlist, and fails CI if any directive has been weakened.
**Value:** Med
**Effort:** Low
**Notes:** Implemented as a shell/Rust script reading `tauri.conf.json` and checking the synthesized header from the running app; run in CI alongside existing tests.

### Untrusted-Mode for Received Files
**Description:** Files opened from paths outside the user's home directory (e.g., `/tmp/`, downloaded files) are flagged as "untrusted"; raw HTML is force-disabled and a banner warns the user.
**Value:** Med
**Effort:** Med
**Notes:** Path heuristic is conservative (home-dir check); banner is dismissible and the decision is remembered per-path hash; complements the existing file-access policy.

### Safe Paste Guard
**Description:** When pasting large text (>50 KB) or text containing suspicious patterns (very long lines with no whitespace, binary content), show a confirmation dialog before inserting.
**Value:** Med
**Effort:** Low
**Notes:** Guards against accidental paste of binary or adversarially crafted content that could degrade render performance; threshold configurable.

### Audit Log for File Operations
**Description:** Write a rotating audit log of all file open/save/watch events to `~/.local/share/preview-md/audit.log` in JSON-lines format for security-conscious users.
**Value:** Low
**Effort:** Low
**Notes:** Log entries include timestamp, operation, and file path hash (not plaintext path) by default; full-path logging is opt-in.

### Clipboard Write Guard
**Description:** Emit a one-time toast notification (not a blocking dialog) when the app writes to the clipboard (code-block copy, table copy) so users are always aware of clipboard state.
**Value:** Low
**Effort:** Low
**Notes:** Tauri's clipboard API wrapped to emit a toast; the guard is opt-out in settings.

---

## Idea Count Summary

| Section | Ideas |
|---------|-------|
| Authoring / Editing Ergonomics | 19 |
| Navigation & Organization | 10 |
| Rendering & Export | 13 |
| Collaboration / Sharing & Integrations | 10 |
| Power-User & Platform | 12 |
| Security & Robustness | 11 |
| **Total** | **75** |

> Ideas that naturally span two sections (e.g., Pandoc Export, Share as Image) are
> counted once in their primary section and cross-referenced in the secondary.
> Effective unique idea count: **73**.
