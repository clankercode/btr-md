---
title: preview-md — design spec
date: 2026-05-24
status: draft (post-review-1 revision)
target_platforms: Linux (primary), with multiplatform-aware structure
---

# preview-md — design spec

## 1. Goal

A Rust application whose sole goal is to be the **best markdown preview renderer on Linux**. "Best" means:

- Exceptional design and aesthetics, including custom mermaid theming and rendering polish.
- Three first-class modes: monospace source editing, split source + live preview, and read-only preview.
- GitHub-Flavored Markdown is the baseline flavor; other extensions added case-by-case as the test corpus demands them.
- First-class light and dark themes, with a packaged set of popular themes plus original themes inspired by characters from *Sousou no Frieren*, *Final Fantasy X*, and *Clair Obscur: Expedition 33*.
- First-class syntax highlighting for code blocks.
- Multiple instances run side-by-side cleanly; each window integrates well with launchers and taskbars (KDE Plasma, Windows-style bars, etc.).
- Linux is the only currently-supported platform, but code is structured so a future Windows or macOS port is mechanical, not architectural.

YAGNI is applied ruthlessly to anything not directly in service of the above.

## 2. Approach

**Chosen stack:** Tauri shell + Rust core renderer + WebKitGTK preview pane + CodeMirror 6 source editor inside the webview. A small Node sidecar is used **only** at development time to generate golden mermaid SVGs for regression tests; it does not ship with the application.

**Rejected alternative:** pure-Rust GUI (egui / iced / slint) with hand-rolled markdown widgets. Forces reimplementing HTML/CSS layout, mermaid, and KaTeX from scratch, with a ceiling on visual polish that is incompatible with the "best on Linux" goal.

**Why this fits:**

- The webview gives us the full modern CSS toolbox: typography, animations, theming via CSS variables, transparent compositing for mermaid and KaTeX.
- Rust core gives us speed, correctness, and a clean, testable parsing pipeline isolated from the rendering surface.
- CodeMirror 6 in the webview gives a top-tier source editor without rebuilding one.
- Tauri abstracts over WebKitGTK on Linux, WebView2 on Windows, and WKWebView on macOS, which keeps the door open for future ports without changing application code.

## 3. Architecture

```
preview-md/                        (cargo workspace root)
├── Cargo.toml                     (workspace)
├── justfile                       (top-level index of all commands)
├── scripts/                       (anything >5 lines becomes a script)
├── crates/
│   ├── pmd-core/                  (parser, AST, render to HTML, sanitize, source-map, theme parse+validate)
│   ├── pmd-app/                   (Tauri shell, IPC handlers, file I/O, theme injection, state, platform hooks)
│   └── pmd-e2e/                   (e2e harness: webdriver client, screenshot capture, diff)
├── ui/                            (web assets served to the webview)
│   ├── index.html
│   ├── src/                       (TypeScript: CodeMirror wiring, mermaid init, scroll sync, theme reapply)
│   ├── styles/
│   │   ├── base.css               (shared structure + consumes every CSS variable)
│   │   └── mermaid-theme.css      (mermaid override layer keyed off CSS variables)
│   └── vendor/                    (mermaid, katex pinned versions)
├── themes/                        (single source of truth: one folder per bundled theme — manifest.toml + theme.css + screenshot.png. Loaded at runtime by pmd-app and injected into the webview.)
├── tests/
│   ├── golden/                    (fixture .md → expected normalized HTML)
│   ├── corpus/                    (markdown sample set: GFM spec, mermaid samples, edge cases)
│   └── screenshots/baselines/     (captured inside the e2e container only)
├── docker/
│   └── e2e/                       (Dockerfile: cage + webkit2gtk + tauri-driver + the built binary + pinned fonts)
├── packaging/
│   ├── linux/                     (preview-md.desktop, icons, MIME XML, AppStream metainfo)
│   ├── appimage/                  (AppImage recipe)
│   └── flatpak/                   (Flatpak manifest)
└── .github/workflows/             (CI: build, test, e2e, package AppImage/Flatpak)
```

**Process boundary:**

- **Rust process owns:** file I/O, markdown parsing, HTML emission, sanitization (ammonia), source-map metadata, syntax highlighting (tree-sitter), theme manifest parsing + schema validation, theme file discovery, theme CSS assembly, settings persistence, file watching, window/process identity.
- **Webview owns:** rendering the sanitized HTML, CodeMirror 6 source editor, client-side mermaid rendering, KaTeX rendering, scroll and cursor sync, applying CSS theme injection, re-running mermaid/KaTeX on theme change.

### 3.1 Typed Tauri commands (full v1 surface)

```rust
// Render
render(version: u64, markdown: String) -> RenderResult { version, html, source_map }

// Files (paths restricted — see §3.3)
open_file(path: PathBuf) -> FileBuffer        // dialog-selected, recent-list, or CLI-argv path only
save_file(path: PathBuf, contents: String) -> ()
watch_file(path: PathBuf) -> ()               // emits file_changed_on_disk

// Themes
list_themes() -> Vec<ThemeInfo>
set_theme(name: String) -> ThemeBundle        // returns CSS string + mermaid theme vars
get_active_theme() -> ThemeInfo

// State (persistent settings, not per-window)
get_settings() -> Settings
set_default_mode(mode: Mode) -> ()
set_theme_pair(light: Option<String>, dark: Option<String>) -> ()
set_auto_switch(enabled: bool) -> ()
get_recent_files() -> Vec<PathBuf>
add_recent_file(path: PathBuf) -> ()
```

`set_mode` is **not** an IPC command — mode switching is webview-local (it shares one document buffer), instant, and emits no IPC. The persistent *default* mode is the only piece that touches Rust state, via `set_default_mode`.

**Events (Rust → webview):** `file_changed_on_disk`, `theme_changed`, `system_theme_changed`.

### 3.2 Render IPC versioning and back-pressure

Render is request/response but back-pressured to avoid the webview applying a stale render over a fresh one:

- `pmd-app` keeps an in-flight render counter and a monotonic `version: u64` (incremented per dispatched render).
- Max in-flight renders = 1. While one is pending, new edits **enqueue at most one** pending request; further edits coalesce into that single pending request (newest-wins).
- The webview drops any `RenderResult` whose `version` is less than the highest `version` it has already dispatched.
- v1 does **full-document render**, not block-level dirtying. Block-level dirtying is parked behind a YAGNI fence and revisited only if the v1 latency budget (≤16 ms median, ≤50 ms p99 on a 100 KB doc) is missed.
- **In-flight renders are not cancelled.** The latency budget above is load-bearing: it makes cancellation unnecessary. If the budget is missed in practice, in-flight cancellation is unparked from §15 and a `CancellationToken` is threaded through `pmd-core`.

### 3.3 Security boundary

Markdown is treated as untrusted. The boundary is layered:

- **Content Security Policy** (configured via Tauri's `app.security.csp` field, not via inline `<meta>` — Tauri synthesizes a final CSP that includes its own IPC scheme so client-server IPC keeps working). Starting point, pinned in slice 1:
  - `default-src 'self'`
  - `script-src 'self' 'wasm-unsafe-eval'` — no inline scripts, no `eval`. (Mermaid's use of the `Function` constructor stays inside mermaid's own scope, gated by `securityLevel: 'strict'`.)
  - `style-src 'self' 'unsafe-inline'` — themes inject CSS, and KaTeX uses inline styles. See post-render trust note below.
  - `img-src 'self' data: asset: http://asset.localhost` — local images via Tauri's `asset:` protocol (scoped — see asset policy below) and KaTeX SVG data URIs only. No network image loading in v1; `file://` absolute URLs in markdown are rejected.
  - `connect-src 'self' ipc: http://ipc.localhost` — explicitly allow Tauri's IPC transport while denying arbitrary fetches.
  - `object-src 'none'`, `frame-src 'none'`, `base-uri 'self'`.
  - The Tauri-synthesised final CSP is verified in slice 1's smoke e2e via the response header on `index.html`.
- **Asset / image path policy.** Markdown image URLs are normalised as follows:
  - **Static config** (compile-time): `app.security.assetProtocol.enable = true` and `app.security.assetProtocol.scope = []` in `tauri.conf.json`. The `enable` flag is required for the asset protocol to load anything at all; the empty scope means v1 bakes no directories into the manifest and relies entirely on the runtime scope grant below.
  - **Dynamic scope** (runtime): when a file is opened, `pmd-app` calls `app.asset_protocol_scope().allow_directory(dir, recursive=false)` on (a) the file's parent directory and (b) the parent directory's `images/` subdirectory (if it exists). Paths are canonicalised via `std::fs::canonicalize` first so symlinks resolve to their target and `..` traversal segments are eliminated; symlinks that escape the parent directory are rejected. The scope grant for a given directory is released when the last window referencing a file in that directory closes.
  - Relative paths in markdown (`./img.png`, `images/x.svg`) are resolved against the opened file's directory, canonicalised, checked against the active scope, and converted to a Tauri asset-protocol URL via `convertFileSrc()`. Relative paths that resolve outside the active scope (e.g. `../shared/img.png`) are rejected and styled via the `pmd-broken-image` class.
  - Absolute `file://` URLs are always rejected (same `pmd-broken-image` fallback).
  - `http://` and `https://` URLs are not loaded (image-src disallows them in v1).
  - Data URIs are allowed for KaTeX and inline SVG.
- **Tauri command scopes:** all file commands restrict paths to the union of (a) paths returned by Tauri's native open/save dialogs in the current session, (b) the user's recent-files list, and (c) paths passed as command-line arguments at startup. No raw arbitrary-path file ops are exposed.
- **Mermaid:** `mermaid.initialize({ securityLevel: 'strict', ... })`. This disables HTML in nodes, `<foreignObject>` HTML rendering, and link click interception.
- **KaTeX:** `katex.render(src, el, { trust: false, strict: 'warn' })`. Disables `\href`, `\url`, and other macros that emit URLs.
- **Sanitization order** (the canonical pipeline):
  1. `pulldown-cmark` parses markdown into events.
  2. HTML emitter produces a string with `data-src-start` / `data-src-end` attributes and class hooks.
  3. **`ammonia` sanitizes the emitted HTML** with an explicit allowlist (Slice 2 pins the full list; minimum: standard markdown tags + `class`, `id`, `data-src-start`, `data-src-end` data attributes; `style` rejected except on KaTeX-emitted elements which are processed *after* sanitization).
  4. Webview swaps innerHTML.
  5. Webview runs KaTeX on already-sanitized `<span class="math">` nodes; KaTeX output is trusted (the library is pinned, vendored, and runs with `trust: false`).
  6. Webview runs mermaid on already-sanitized `<pre><code class="language-mermaid">` nodes; mermaid output is trusted (pinned, vendored, `securityLevel: 'strict'`).

  **Trust-boundary note.** Steps 5–6 mean ammonia is **bypassed** for the DOM subtrees rendered by KaTeX and mermaid. The only defences for those subtrees are: (i) vendored, version-pinned libraries; (ii) KaTeX `trust: false, strict: 'warn'`; (iii) mermaid `securityLevel: 'strict'` (which HTML-encodes node text and disables click handlers). Loosening any of (i)–(iii) is a security-review item. Mermaid `securityLevel: 'sandbox'` (iframe isolation — stronger than `strict`) is parked at §15 as a v2 hardening upgrade if we ever open the app to truly untrusted input (e.g., a paste-from-URL feature).

### 3.4 Data flow (split mode)

1. Keystroke in CodeMirror → debounced ~16 ms.
2. Debounced content + new `version` sent over `render` IPC (coalesced per §3.2).
3. `pmd-core` parses → emits HTML with `data-src-start` / `data-src-end` attributes → ammonia sanitizes → returns to webview.
4. Preview pane swaps innerHTML using a small DOM diff (morphdom-style); only changed nodes are touched.
5. New nodes are scanned for math and mermaid blocks; KaTeX and mermaid run on them in place.
6. Scroll-sync: editor caret line → nearest block whose `data-src-start ≤ line ≤ data-src-end` → adjusted with `requestAnimationFrame` smoothing. **Forward only** (editor → preview); preview → editor sync is YAGNI'd for v1 and listed in §15.

## 4. Markdown pipeline (in `pmd-core`)

- **Parser:** `pulldown-cmark` with GFM features enabled. The event stream is converted to a typed AST owned by `pmd-core`.
- **HTML emitter:** we own the emitter so we can attach `data-src-start="N" data-src-end="M"` on every block-level node and stable class hooks (`pmd-blockquote`, `pmd-task-item`, `pmd-code`, etc.) that themes target via CSS.
- **GFM coverage:** tables, task lists, strikethrough, autolinks, footnotes, fenced code with info strings. Plus, gated by test-corpus presence:
  - Math (`$…$`, `$$…$$`) → emits `<span class="math">` / `<div class="math math-display">` for client-side KaTeX.
  - Mermaid (` ```mermaid `) → emits `<pre><code class="language-mermaid">` for client-side mermaid.
  - Admonitions (`> [!NOTE]`-style, matching GitHub) → emitted with `pmd-admonition` classes.
- **Syntax highlighting:** tree-sitter via `tree-sitter-highlight`, pre-rendered server-side into `<span class="hl-…">` tokens with stable, theme-agnostic class names. The active theme defines the actual colours via CSS variables.
- **Raw HTML in markdown:** v1 default is **off** (raw HTML stripped pre-sanitization). GFM/GitHub.com *sanitizes* raw HTML rather than stripping; we have chosen the stricter posture for v1 to simplify the security boundary. A per-buffer "allow raw HTML (sanitized)" toggle is on the v2 roadmap and listed in §15.
- **Sanitization:** `ammonia`. Allowlist pinned in slice 2 and lives in `pmd-core/src/sanitize/allowlist.rs`. KaTeX and mermaid output bypass this stage because they run *after* sanitization on already-sanitized DOM nodes; the libraries themselves are trusted (vendored, version-pinned).
- **Source-map:** the emitter records `(block_start_line, block_end_line)` ranges and emits them as `data-src-start` + `data-src-end` on every block-level element. Inline elements (math, autolinks, emphasis) do not get source-map attributes — they inherit from their parent block. Caret-on-inline-position falls back to the parent block's start line.

## 5. UI modes

A single window per process. Three modes share one document buffer; switching is a webview-local CSS/visibility toggle, instant, no IPC, no re-parse.

- **Source mode (monospace):** CodeMirror fills the window; no preview pane.
- **Split mode:** CodeMirror on the left, preview on the right, scroll-synced via the source-map (forward only).
- **Preview mode (read-only):** preview fills the window; editor hidden.

Mode toggle: `Ctrl+\` cycles, and a toolbar segmented control is always visible.

### 5.1 Mode chrome and small UX details

- **Toolbar:** 36 px tall, lives at the top of the window. Right-aligned: a 3-icon segmented control for `source / split / preview` with the active mode highlighted using `--pmd-accent`. Left-aligned: the filename. Centre: empty.
- **Modified indicator:** a 6 px dot rendered in `--pmd-accent` directly before the filename in the toolbar AND in the OS window title.
- **Status bar:** 22 px tall, bottom of the window. Shows `Ln:Col · words · path` in `--pmd-fg-muted`. Toggleable via View menu; on by default.
- **Mode transition:** 120 ms ease-out crossfade between source / split / preview using `opacity`. No layout slide.
- **Split divider:** 4 px draggable, default 50/50 ratio, 280 px minimum per pane. Divider position is per-window (memory only at v1; not persisted across restarts).
- **Hotkey discoverability:** the toolbar mode buttons have native tooltips showing the hotkey. A `?` overlay (`Ctrl+/`) lists all hotkeys.
- **Scroll position on mode switch:** preserved by snapping to the same `data-src-start` line, so switching modes does not jump the reader's place.

### 5.2 Persistent state

State is split into two scopes:

- **Global state** (`~/.config/preview-md/state.toml`, XDG-compliant): active theme, optional `(light_theme, dark_theme)` pair, `auto_switch: bool`, default startup mode. Written debounced 500 ms after a setting changes. Multi-instance write protocol: `flock(LOCK_EX)` → re-read file → merge our delta → write → unlock. This avoids the read-modify-write race where instance A clobbers instance B's recent change.
- **Recent files** (`~/.config/preview-md/recents.toml`): separate file, append-only writes under flock, capped at 20 entries with LRU eviction on read. Separating recents from state.toml means the high-churn surface doesn't risk corrupting low-churn settings.
- **Per-window state** (in-memory only at v1): current file path, scroll position, cursor location, active mode. Session restore is YAGNI'd for v1 (§15).

### 5.3 CLI and file-association behaviour

- `preview-md` (no args) opens one untitled window.
- `preview-md path/to/file.md` opens one window with that file.
- `preview-md a.md b.md c.md` opens **three** windows, one per path. Implementation: the original invocation `fork+exec`s a fresh `preview-md <path>` for **every** path argument (including the first), then exits immediately. All resulting windows are sibling processes with no parent-child relationship — SIGTERM on one window does not cascade to the others.
- `.desktop` `Exec=preview-md %F` therefore handles multi-file selections cleanly (open many files from the file manager → many windows).

## 6. Multi-instance and launcher integration

- **One process per window.** Each window is its own OS process with its own webview. No singleton, no DBus consolidation, no implicit tab-stealing.
- **Per-window identity:**
  - **Window title:** `<filename> — preview-md` (or `Untitled — preview-md`), prefixed with a 6 px modified dot when the buffer is dirty.
  - **App ID:** a single, consistent reverse-DNS string `dev.previewmd.App` (no hyphen; chosen for GNOME convention compatibility; final value parked in §17, but the spec uses this string everywhere a placeholder appears so an implementer copy-pasting any section gets a working result).
  - **Wayland `xdg-toplevel app_id`, X11 `WM_CLASS` (both instance and class), and `.desktop` `StartupWMClass`** are all set to the same value (`dev.previewmd.App`). Slice 8 has an acceptance test that `swaymsg -t get_tree` / `xprop` reports the expected id.
- **`.desktop` file** (`packaging/linux/dev.previewmd.App.desktop`):
  - `Exec=preview-md %F`
  - `StartupWMClass=dev.previewmd.App`
  - `MimeType=text/markdown;text/x-markdown;`
  - Static actions: `New Window`, `Open File` (these are fixed `[Desktop Action ...]` groups, which is the only thing the freedesktop spec supports).
  - **Recent files do *not* live in the `.desktop` actions** (the spec only allows static actions). Recents are exposed via the in-app File menu / command palette, populated from `recents.toml`. The earlier draft's "dynamic jumplist via .desktop actions" claim was wrong and is removed.
- **AppStream metainfo** (`packaging/linux/dev.previewmd.App.metainfo.xml`): so the app shows up correctly in software centres with screenshots and release notes.
- **MIME XML** (`packaging/linux/dev.previewmd.App.mime.xml`): registers `.md` and `.markdown` extensions on install via `xdg-mime`.
- **Icons:** SVG + PNG at 16 / 24 / 32 / 48 / 64 / 128 / 256 px in `packaging/linux/icons/`.

### 6.1 Cross-platform structure

- `crates/pmd-app/src/platform/mod.rs` defines a `PlatformHooks` trait covering: launcher identity, system theme detection, file-watcher backend.
- `linux.rs` implements all of the above. `windows.rs` and `macos.rs` are documentation-only stubs (`unimplemented!()`) behind `#[cfg(target_os = …)]`.
- **Soft claim, not enforcement:** these stubs are *documentation* of where future code lives, not a working abstraction. CI builds only Linux; the abstraction's true correctness for non-Linux targets will only be known when those targets are actually implemented. Stated openly so a future Windows / macOS porter knows the trait may need refactoring.

### 6.2 File-watcher contract

Backed by the `notify` crate (which handles atomic-rename-replace via inotify `IN_MOVE_SELF` / `IN_DELETE_SELF` re-watch).

- Contract: "notify on content change at this path, surviving atomic rename-replace (vim / VS Code save patterns)."
- Polling fallback is **explicitly disabled** in v1 — only the native inotify backend is used. A polling toggle is on the v2 roadmap for network-mounted paths.
- **Non-local filesystem warning.** At file-open time the app calls `statfs` on the parent directory and, if the magic number indicates NFS / CIFS / SSHFS / FUSE, logs a one-time `WARN` per path noting that external changes to that file may not generate inotify events. Surfaced in the status bar as a small badge while the warning is active.

## 7. Theming

Theming is a **first-class subsystem**, not a CSS afterthought.

### 7.1 Theme schema

Each theme is a folder under `themes/<theme-slug>/` (bundled) or `~/.config/preview-md/themes/<theme-slug>/` (user):

- `manifest.toml`
- `theme.css`
- `screenshot.png` (640 × 400 PNG, generated by the e2e screenshot pass using the same canonical sample document for every theme — never hand-captured)

`manifest.toml`:

```toml
[meta]
name    = "Twilight Mage"           # display name
slug    = "twilight-mage"           # filesystem-safe id
author  = "preview-md"
mode    = "dark"                    # "light" | "dark"
version = "1.0.0"

[meta.inspired_by]                  # structured; optional. Picker can render "From: <work> — <character>".
work      = "Sousou no Frieren"
character = "Frieren"

[meta.notes]                        # two-bullet rationale, rendered in the picker on hover.
rationale = """
Silver hair against twilight violet. The violet is an *accent*, not the background — the bg is a warm-grey paper tint to escape the dead-blue trap of generic dark mode.
"""

[palette]
# Core surfaces — REQUIRED
bg              = "#1a1a22"
bg_elevated     = "#22222e"
fg              = "#e8e6f3"
fg_muted        = "#9b97b8"
accent          = "#a899d4"
link            = "#9ec5ff"
border          = "#262640"

# Headings — OPTIONAL; default = fg
h1 = "#cdb4ff"
h2 = "#cdb4ff"
h3 = "#e8e6f3"
# h4..h6 default to fg

# Editor / interactive — REQUIRED
selection_bg = "#3a3760"
selection_fg = "#ffffff"
focus_ring   = "#a899d4"
caret        = "#a899d4"
scrollbar_thumb = "#3a3760"
scrollbar_track = "#1a1a22"

# Markdown surfaces — REQUIRED
inline_code_bg  = "#22222e"
inline_code_fg  = "#cdb4ff"
code_block_bg   = "#181a2c"
code_block_fg   = "#e8e6f3"
code_block_border = "#262640"
blockquote_bar  = "#a899d4"
blockquote_fg   = "#cfcce0"
hr              = "#3a3760"
table_header_bg = "#22222e"
table_row_alt   = "#1d1d28"
table_border    = "#262640"
admonition_note = "#9ec5ff"
admonition_warn = "#e7c878"
admonition_tip  = "#a8dac0"
kbd_bg          = "#22222e"
kbd_fg          = "#cdb4ff"
kbd_border      = "#3a3760"
link_hover      = "#bcd3ff"
link_visited    = "#7da7e8"
image_caption   = "#9b97b8"

# Mermaid — REQUIRED (themes may omit non-core keys; loader derives them by mixing with bg/fg per §7.3)
mermaid_primary       = "#a899d4"
mermaid_primary_text  = "#1a1828"
mermaid_secondary     = "#4d4a6e"
mermaid_tertiary      = "#262640"
mermaid_line          = "#7a78a0"
# Mermaid — OPTIONAL (with derivation rule)
mermaid_edge_label_bg = "#22222e"
mermaid_cluster_bg    = "#1d1d28"
mermaid_note_bg       = "#262640"
mermaid_note_border   = "#a899d4"
mermaid_actor_bg      = "#3a3760"
mermaid_error         = "#e77878"

# Syntax highlighting — REQUIRED (keys map 1:1 to tree-sitter highlight names)
[palette.syntax]
keyword     = "#cdb4ff"
string      = "#a8dac0"
number      = "#e7c878"
function    = "#9ec5ff"
type        = "#cdb4ff"
comment     = "#6f6c8c"
operator    = "#e8e6f3"
punctuation = "#9b97b8"
variable    = "#e8e6f3"
constant    = "#e7c878"

[fonts]                             # OPTIONAL — any missing slot falls back to app default
ui      = "Inter"
mono    = "JetBrains Mono"
serif   = "Source Serif Pro"
heading = "Inter"                   # if unset, headings use `ui`
body    = "ui"                      # "ui" | "serif" — body prose in preview mode

[fonts.fallback]                    # Linux fallback chains, in order
ui    = ["Inter", "Cantarell", "Noto Sans", "DejaVu Sans"]
mono  = ["JetBrains Mono", "Fira Code", "DejaVu Sans Mono"]
serif = ["Source Serif Pro", "Noto Serif", "DejaVu Serif"]

[fonts.features]
ligatures_mono = false              # programming ligatures off by default; opt-in per theme
```

**Required vs optional palette keys** (canonical source: `crates/pmd-core/src/theme/schema.rs`):

| Group       | Required                                                                                                                                                                                                                                                                                                                  | Optional                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------| ------------------------------------------------------------------------------------------------------------------------------ |
| Surfaces    | `bg`, `bg_elevated`, `fg`, `fg_muted`, `accent`, `link`, `border`                                                                                                                                                                                                                                                          | —                                                                                                                              |
| Editor      | `selection_bg`, `selection_fg`, `focus_ring`, `caret`, `scrollbar_thumb`, `scrollbar_track`                                                                                                                                                                                                                                | —                                                                                                                              |
| Headings    | —                                                                                                                                                                                                                                                                                                                          | `h1`, `h2`, `h3`, `h4`, `h5`, `h6` (each falls back to `fg`)                                                                  |
| Markdown    | `inline_code_bg`, `inline_code_fg`, `code_block_bg`, `code_block_fg`, `code_block_border`, `blockquote_bar`, `blockquote_fg`, `hr`, `table_header_bg`, `table_row_alt`, `table_border`, `admonition_note`, `admonition_warn`, `admonition_tip`, `kbd_bg`, `kbd_fg`, `kbd_border`, `link_hover`, `link_visited`, `image_caption` | —                                                                                                                              |
| Mermaid     | `mermaid_primary`, `mermaid_primary_text`, `mermaid_secondary`, `mermaid_tertiary`, `mermaid_line`                                                                                                                                                                                                                         | `mermaid_edge_label_bg`, `mermaid_cluster_bg`, `mermaid_note_bg`, `mermaid_note_border`, `mermaid_actor_bg`, `mermaid_error` (derived per §7.2.1 if absent) |
| Syntax      | all 10 keys under `[palette.syntax]`: `keyword`, `string`, `number`, `function`, `type`, `comment`, `operator`, `punctuation`, `variable`, `constant`                                                                                                                                                                       | —                                                                                                                              |
| Fonts       | —                                                                                                                                                                                                                                                                                                                          | all `[fonts]` keys (each falls back to the app default)                                                                       |

Total: **48 required** + **~19 optional** keys (canonical source: `schema.rs`).

**Schema posture:** the schema is **forward-compatible with a required core**. Themes that omit *required* keys are rejected at load time with a clear error pinpointing the missing keys. Themes that include *unknown* keys are accepted; the unknown keys are ignored. (This is open/forward-compatible, not "closed" — the earlier draft used the wrong term.)

**Required vs optional matrix** lives in `crates/pmd-core/src/theme/schema.rs` as the canonical source of truth.

### 7.2 How a theme is applied

`pmd-app` resolves and applies the active theme on startup and on `set_theme`:

1. **Discovery** (`pmd-app`): scan bundled `themes/` and user `~/.config/preview-md/themes/`.
2. **Parse + validate** (`pmd-core::theme`): pure functions, unit-testable, no I/O. `parse_manifest(s: &str) -> Result<Theme, ThemeError>`; `validate(t: &Theme) -> Result<(), ValidationError>` (checks required keys, contrast floor — see below).
3. **CSS assembly** (`pmd-app::theme`): generate a `:root { … }` block setting one CSS custom property per palette key (`--pmd-bg`, `--pmd-mermaid-primary`, etc.); concatenate the theme's `theme.css` file.
4. **Inject** (`pmd-app::theme` via Tauri command): replace the active theme `<style id="pmd-theme">` node in the webview.
5. **Re-run renderers on existing DOM**: the webview's theme-change handler walks all existing math and mermaid nodes and **re-renders them in place** so already-drawn diagrams pick up the new palette. Re-renders are **yielded across `requestAnimationFrame` ticks** (one diagram per frame) so theme-switch on a mermaid-heavy document never freezes the UI. Mermaid is also re-initialised with new `themeVariables` so any *future* renders use the new palette.
6. **Auto-switch**: if `auto_switch=true` and a `(light, dark)` pair is configured, the active theme follows `system_theme_changed` events; otherwise the explicit `active_theme` is always used.

### 7.2.1 Mermaid optional-key derivation

When a theme omits any optional mermaid key, the loader derives it as follows. `mix(a, b, t%)` is **sRGB component-wise linear interpolation** at `t%` between colours `a` and `b` — operating on 8-bit channels (not linear-light) and rounding to the nearest integer per channel. This is pinned so the loader, the validator, and any external tooling all agree on derived values byte-for-byte.

- `mermaid_edge_label_bg = bg_elevated`
- `mermaid_cluster_bg    = mix(bg, fg, 4%)`
- `mermaid_note_bg       = bg_elevated`
- `mermaid_note_border   = accent`
- `mermaid_actor_bg      = mix(accent, bg, 30%)`
- `mermaid_error         = #e77878`  (fixed fallback; themes overriding the error colour pick something distinguishable from `accent` and `link`)

`base.css` defines the structural layout and references **only** `var(--pmd-…)` — never hard-coded colours. CI runs a `theme-completeness` test (§8) that fails if any required CSS variable is unreferenced or any required palette key is omitted by a bundled theme.

**Mermaid stylistic baseline** (pinned for v1, applied via `mermaid-theme.css`):

- 8 px corner radius on nodes
- 1.5 px stroke
- no drop-shadows
- node font inherits `--pmd-ui-font` and `font-size: 0.95em`
- edge labels rendered as 4 px-padded chips in `--pmd-mermaid-edge-label-bg`
- sequence-diagram lifelines: 1 px dashed in `--pmd-mermaid-line`

Themes may override colours via the palette but **may not override geometry** unless they declare `[mermaid.geometry]` explicitly (parked for v2; not in v1).

**Contrast floor:** validation runs the following contrast checks. Failures emit a non-fatal warning in dev builds and a hard validation error in CI's `theme-validate` step (a §12 just target).

- **Text 4.5 : 1** (WCAG AA): `fg` vs `bg`; `link` vs `bg`; `fg_muted` vs `bg`; `inline_code_fg` vs `inline_code_bg`; `code_block_fg` vs `code_block_bg`; `selection_fg` vs `selection_bg` (selected text legibility).
- **Non-text 3 : 1** (WCAG AA non-text): `accent` vs `bg` (used by the modified-indicator dot and the segmented-control highlight); `focus_ring` vs `bg`; `selection_bg` vs `bg`; `border` vs `bg`.

The non-text floor on `accent` and `focus_ring` is what guarantees the §5.1 modified dot and the keyboard-focus ring stay glanceable on every theme.

### 7.3 Bundled themes (v1)

**Popular / familiar (8):**

1. GitHub Light
2. GitHub Dark
3. Solarized Light
4. Solarized Dark
5. Dracula
6. Nord
7. Tokyo Night
8. **Rosé Pine Dawn** (light) — swapped in to balance the bundle's dark / light ratio (popular set is now 5 dark / 3 light — Dracula, Nord, Tokyo Night, GitHub Dark, Solarized Dark vs GitHub Light, Solarized Light, Rosé Pine Dawn — instead of 6 dark / 2 light).

**Original — inspired by *Sousou no Frieren* (3):**

9. **Twilight Mage** (dark, inspired by Frieren). Dominant: warm-grey paper-tint bg (`#1a1a22`); foreground: silver; accent: violet only on links, headings, focus ring. Trap to avoid: generic dark-mode blue.
10. **Sky Hero** (light, inspired by Himmel). Dominant: pale-gold bg (`#fbf6e6`); accent: sky-blue; foreground: warm dark grey. Headings use Source Serif to read heroic. Trap: looking like default light unless the gold tint is real, not `#fffdf5`.
11. **Lavender Forest** (light, inspired by Fern). Dominant: lavender paper bg; accent: forest green on links and headings; body fg: soft brown. Trap: too-saturated greens that read as Solarized.

**Original — inspired by *Final Fantasy X* (3):**

12. **Sun and Sea** (light, inspired by Tidus). Bg is sea-blue cream; accents are sunburst orange; sun-yellow appears only as a top divider strip. High-contrast for outdoor readability. Trap: pure yellow bg is unreadable for prose.
13. **Onyx Sorcerer** (dark, inspired by Lulu). Near-black bg (`#0a0610`); deep purple panels via `bg_elevated`; crimson is accent only on links and h1. Serif headings. Trap: crimson everywhere reads as error-state.
14. **Rust Warden** (dark, inspired by Auron). Ink-black bg; rust-red accent pushed toward brown (not pink, to avoid Dracula collision); parchment fg (`#e8dcc0`). Heavier mono font weight (500+). Trap: pink-rust drift.

**Original — inspired by *Clair Obscur: Expedition 33* (3):**

15. **Sepia Atelier** (light, inspired by Gustave). Sepia paper bg; iron-grey fg; raw-canvas accents on headings; serif body. Adds a 2% noise overlay via `theme.css` for painterly texture. Trap: looking like Solarized Light without the texture.
16. **Rose Melancholy** (dark, inspired by Maelle). Deep rose-tinted black bg (`#1a1014`); somber violet accents; atelier-charcoal `bg_elevated`. h2/h3 italic to feel melancholic. Trap: pink overload — keep rose subliminal in the bg only.
17. **Cobalt Bone** (dark, inspired by Verso). Cobalt-blue dark bg; bone-white fg; raw-umber on code blocks and tables — the umber on code is the distinguishing move. Trap: pure blue reads as a Nord knockoff without the umber.

Total at v1: **17 themes** (8 popular, 9 originals).

**IP / naming policy.** Original theme *names* use descriptive archetypes (e.g., "Twilight Mage", not "Frieren"), so the names themselves are original. The structured `[meta.inspired_by]` field names the source work and character as **nominative attribution** — analogous to liner notes that read "inspired by Beethoven". The bundle contains only:

- colour palettes (uncopyrightable arrangements of colour values);
- short original design-rationale prose in `[meta.notes]`;
- structured attribution metadata in `[meta.inspired_by]` naming the work and character.

No artwork, logos, or other trade dress from the source works is bundled. If a rights-holder objects to a specific homage, the affected theme's `inspired_by` field is cleared and the theme retained under its archetype name alone; the colours stay.

### 7.4 User themes

User themes placed in `~/.config/preview-md/themes/<slug>/` are loaded with the same loader and appear alongside bundled themes in the picker. There is no theme API beyond the file format — themes are pure data (manifest + CSS), so theming is forward-compatible across minor releases.

### 7.5 Theme picker UX

- The picker is a grid of theme cards: `screenshot.png` + name + work/character (from `inspired_by` if present).
- A pinned top row shows `Auto (light: X, dark: Y)` with an enabled / disabled toggle. When auto is on, the currently *resolved* theme card gets a subtle ring; the configured-pair cards each show a small "L" or "D" badge.
- On hover, each card shows the `inspired_by` work + character and the `meta.notes` rationale.
- A "Set as light" / "Set as dark" mini-action appears on hover.
- **Keyboard navigation:** arrow keys move focus across the grid; `/` focuses a filter input that fuzzy-matches against name, `inspired_by.work`, and `inspired_by.character`; `Enter` applies the focused theme; `Esc` exits the picker.

## 8. Testing strategy

Each layer fires during a TDD cycle, fastest first. **No layer is optional at the CI level.** (The dual-model visual review in §10 is a *dev-time* author loop, not a CI gate — see that section.)

| Layer                       | Tool                                                       | Scope                                                                                          | Lives in                              |
| --------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------- |
| Unit                        | `cargo test`                                               | parser, AST, emitter, sanitizer, source-map, theme parse + validate                            | `crates/pmd-core/src/**`              |
| Property                    | `proptest`                                                 | "any UTF-8 markdown ⇒ sanitizer never emits a script tag"; "render→parse-html is well-formed"; "source-map ranges are contiguous, monotonic, non-overlapping for siblings, well-nested for parent/child" | `crates/pmd-core/tests/prop_*.rs`     |
| Golden                      | custom harness                                             | fixture `.md` → expected normalized HTML (incl. source-map attributes)                         | `tests/golden/`                       |
| Theme completeness          | `cargo test`                                               | every required palette key declared by every bundled theme; every required CSS variable referenced by `base.css` or emitted classes; WCAG AA contrast floor passes | `crates/pmd-core/tests/theme_*.rs`    |
| Functional (IPC)            | `cargo test`                                               | hits Tauri commands directly via in-process `invoke` — no webview                              | `crates/pmd-app/tests/`               |
| E2E GUI                     | `tauri-driver` + `fantoccini` (Rust webdriver client) — see §9 for invocation pattern | full app: open file, edit, switch modes, switch themes, multi-file CLI                        | `crates/pmd-e2e/tests/`               |
| Screenshot diff             | `pixelmatch`-equivalent at `threshold=0.10`, fail if `>0.5%` of pixels differ | feature scenarios × **all 17 themes** × `{source, split, preview}` (51 combinations per feature scenario at worst, deduplicated where rendering is identical) | `tests/screenshots/baselines/`        |

**TDD discipline.** Every feature starts as a failing golden test plus a failing unit test; implementation follows until both pass. The `test-driven-development` skill is loaded at the top of each slice.

**Verification gate.** Every slice ends with the `verification-before-completion` skill: `just check` and the relevant e2e subset. The **dev-time dual-model visual review (§10) and `/ccc-review-cx` step are owner-driven** — they run before owner commits but are optional for external contributors, who pass on CI's layered tests plus manual PR review (see §16). Blockers and Majors from any review path must clear before commit regardless of authorship.

## 9. E2E driver setup

The e2e harness runs in Docker so it is reproducible on any developer machine and in CI.

- **`docker/e2e/Dockerfile`** installs: Debian slim base + `cage` (kiosk Wayland compositor) + `webkit2gtk-4.1` + Rust toolchain + `tauri-driver` + pinned fonts (Inter, JetBrains Mono, Source Serif Pro, plus fallback families Noto Sans / Noto Serif / DejaVu) + a pinned `fontconfig` config (no hinting, fixed antialias mode, RGB subpixel order disabled) + the built `preview-md` binary.
- **Determinism env vars:** `WEBKIT_DISABLE_COMPOSITING_MODE=1` (force software compositing inside the container so antialiasing matches the dev-time baselines), `LIBGL_ALWAYS_SOFTWARE=1` (llvmpipe).
- **Invocation pattern** (correct Tauri model):
  1. `cage -- tauri-driver --port 4444` starts inside the container.
  2. The Docker container is launched with `--network=host` so the host's WebDriver client reaches `localhost:4444` directly. (If host networking is undesirable — e.g., when CI runs in a restricted environment — fall back to `-p 4444:4444` and connect to the mapped port.) The choice is wired through `scripts/e2e.sh` with `PMD_E2E_NETWORK=host|bridge` (default `host`).
  3. The test creates a session with `tauri:options` capabilities — `{"application": "/usr/local/bin/preview-md", "args": ["..."]}` — and `tauri-driver` spawns the app, attaches the WebDriver session to its webview.
  4. The app does **not** expose its own `--webdriver-port` flag; tauri-driver handles that.
- **Why cage, not Xvfb:** the dev machine is KDE Plasma on Wayland; cage gives a deterministic, single-window, undecorated Wayland compositor — closer environment parity for screenshot stability.
- **Baseline capture rule:** Playwright screenshot baselines are updated deliberately with `playwright test --update-snapshots`; the Docker e2e harness writes review screenshots but does not own baseline updates.
- **Just targets:** `just e2e` verifies the Docker WebDriver harness; `just visual-review` writes review screenshots for author-side inspection.

## 10. Dev-time dual-model visual review (not a CI gate)

CI gates on the layered tests in §8 — unit, property, golden, theme-completeness, IPC functional, e2e, screenshot pixel diff. **CI does not depend on AI subagents.** The pixel-diff threshold is the merge gate; subagents are an author-side polish loop.

The dual-model visual review is a **dev-time loop** the author runs after big visual changes (a slice that adds a theme, a slice that changes mode chrome, etc.). It implements the `review-and-fix` skill, using `dispatching-parallel-agents` for the dual-model leg.

1. E2E suite writes new screenshots to `tests/screenshots/run-<sha>/` (the same files the pixel-diff layer just compared).
2. `scripts/visual-review.sh` builds a review bundle per scenario: `{ baseline.png, actual.png, diff.png, scenario.md }`.
3. Dispatch two subagents in parallel:
   - **Opus 4.7 review:** `subagent_type=general-purpose`, model `opus`.
   - **GPT-class review** via `ccc-review-cx` skill. (We pin `ccc-review-cx` rather than a runtime check for native GPT-5.5 subagent type — picking one reliable route avoids non-determinism in the loop.)
   - Both subagents receive the same prompt: aesthetic critique plus regression flagging, structured JSON output (`severity`, `location`, `suggestion`).
4. Aggregator merges both reports to `tests/reviews/<sha>/aggregate.md`.
5. The author applies `review-and-fix`: triage → fix → re-run e2e → re-review.
6. Loop terminates when both subagents return "no blocking issues" or the per-slice loop budget (3 iterations by default) is exhausted, at which point the author escalates (does not merge the slice).

Contributors who do not have access to those subagents can still ship slices — they just rely on CI's pixel-diff gate and the manual review of their PR.

## 11. Workflow and skill orchestration

The agent executing the implementation plan loads, in order:

- `writing-plans` — produces the implementation plan after this spec is approved.
- `subagent-driven-development` (or `use-subagents-impl` / `ultra-implementing-team` if installed) — slice implementation is delegated to subagents; the main agent reviews and integrates.
- `test-driven-development` — per slice.
- `verification-before-completion` — per slice, before commit.
- `review-and-fix` — after every screenshot batch and after every PR-sized slice.
- `dispatching-parallel-agents` — inside `review-and-fix` for the dual-model visual leg.
- `ccc-review-cx` — invoked per phase against the diff (`PASS` / `MINOR_ISSUES_ONLY` / `NEEDS_FIXES`); Blockers and Majors must clear before commit.
- **The plan's final instruction is literally:** _"run the `postcommit-status-and-continue` skill and continue."_

## 12. Justfile (the discoverability index)

```just
default:                @just --list

# dev
run:                    cargo run -p pmd-app
watch:                  cargo watch -x 'run -p pmd-app'

# tests (layered, fastest first)
test:                   cargo test --workspace
test-unit:              cargo test -p pmd-core --lib
test-prop:              cargo test -p pmd-core --test 'prop_*'
test-golden:            cargo test -p pmd-core --test golden
test-theme:             cargo test -p pmd-core --test 'theme_*'
test-ipc:               cargo test -p pmd-app
e2e:                    ./scripts/e2e.sh
visual-review:          ./scripts/visual-review.sh        # dev-time only
review-and-fix:         ./scripts/review-and-fix.sh       # e2e + visual-review + aggregate

# themes
theme-list:             cargo run -p pmd-app -- --list-themes
theme-validate:         ./scripts/theme-validate.sh       # schema + contrast check; CI runs this

# packaging
build-release:          cargo build --release -p pmd-app
package-appimage:       ./scripts/package-appimage.sh
package-flatpak:        ./scripts/package-flatpak.sh
package-all:            just package-appimage && just package-flatpak

# install (local desktop integration)
install-desktop:        ./scripts/install-desktop-files.sh

# lint / format / pre-PR
fmt:                    cargo fmt --all
lint:                   cargo clippy --workspace --all-targets -- -D warnings
check:                  just fmt && just lint && just test && just theme-validate
```

Every command longer than ~5 lines lives under `scripts/` rather than being inlined.

## 13. CI

`.github/workflows/ci.yml`:

- Matrix: stable Rust, Linux only.
- Jobs: `check`, `test`, `theme-validate`, `e2e` (Docker), `package-appimage`, `package-flatpak`. All parallelizable.
- Caches: `Swatinem/rust-cache`.
- Artifacts on tag: AppImage, Flatpak, source tarball.

`pmd-core` is **not** published to crates.io at v1 — its public API surface is not stabilized and nothing outside this app consumes it. Listed in §17 as an open question revisited later. `pmd-app` is similarly not published (Tauri build deps make `cargo install` user experience poor).

## 14. Distribution

- **Local:** `just build-release && just package-appimage` produces a single-file AppImage. `just install-desktop` installs the `.desktop`, icons, MIME registrations, and AppStream metainfo into `~/.local/share/`.
- **CI on tag:** Flatpak (manifest pulls source from the tag) and AppImage are produced and uploaded as release artifacts.
- **`cargo install`:** `cargo install --path crates/pmd-app` works locally for contributors. Not published to crates.io for the reasons above.

## 15. YAGNI fence — explicit out-of-scope for v1

- Multi-tab / multi-document UI inside a single window. (Multi-instance covers this.)
- Notebook-style execution / runnable code blocks.
- Plugin system beyond the data-only theme loader.
- Cloud sync / collaboration.
- Windows / macOS builds (platform seams exist; implementations do not).
- Print / export to PDF (WebKit print API trivial to add later).
- Vim / Emacs keybindings inside CodeMirror.
- Custom protocol handlers (`preview-md://…`).
- Per-buffer "allow raw HTML (sanitized)" toggle.
- Preview → editor reverse scroll sync.
- Session restore (per-window state surviving restarts).
- `[mermaid.geometry]` per-theme geometry overrides.
- Polling fallback for the file watcher.
- Block-level incremental render.
- In-flight render cancellation (added if §3.2's latency budget is missed in practice).
- Mermaid `securityLevel: 'sandbox'` (iframe isolation) — v2 hardening upgrade if paste-from-URL or other untrusted-input surfaces are added.

## 16. Implementation slicing (handed to `writing-plans` next)

Nine PR-sized increments, each with its own TDD → e2e → CI pixel-diff gate → commit cycle. The dev-time dual-model visual review and `ccc-review-cx` step are **owner-driven**: when the project owner authors a slice, both run before the commit. External contributors merge on the CI gate plus manual PR review; the AI-subagent steps are optional for them.

1. **Scaffold:** cargo workspace, justfile, CI skeleton, Docker e2e harness (with pinned fonts and determinism env), smoke e2e that opens an empty Tauri window through tauri-driver and screenshots it. Includes pinning the final CSP in `tauri.conf.json` and verifying it in the smoke test.
2. **`pmd-core` core pipeline:** parser → HTML emitter (with `data-src-start` / `data-src-end`) → ammonia sanitizer (allowlist pinned in this slice) → source-map → theme manifest parse + validate + contrast check + theme-completeness test. Unit, property, golden, theme tests. No UI yet.
3. **`pmd-app` shell, read-only preview mode, GitHub Light / Dark themes, file open / save with restricted path scopes (dialog + recents + CLI argv), render-IPC versioning + back-pressure, asset-path normalisation.** First user-visible milestone. (Linux desktop integration files deferred to slice 9.)
4. **Monospace mode** with CodeMirror 6 + mode chrome (toolbar segmented control, modified dot, status bar, hotkey overlay) + theme switching + state persistence (debounced flock RMW; recents in a separate file) + auto-switch follow.
5a. **Render integration:** full split-mode layout with the version-coalescing render path and morphdom-style DOM diff. No scroll sync yet. Tests cover full-document render correctness and version-drop staleness.
5b. **Scroll sync** via `data-src-start` / `data-src-end` source-map (forward only). Includes goldens for lists, tables, nested blockquotes, fenced code with multi-line info strings.
6a. **Mermaid + KaTeX + syntax highlighting + custom mermaid theme override + mermaid stylistic baseline** (8 px corner radius / 1.5 px stroke / no shadows / inherited font / chip edge labels). One theme exercises mermaid end-to-end; broader theme bundle deferred to 6b.
6b. **Theme bundle delivery:** all 17 bundled themes shipped with full `meta.notes` rationales, theme-completeness CI test passing for all, theme-switch re-render (rAF-chunked) integrated, `[meta.inspired_by]` rendered in picker.
7. **Theme polish slice:** picker UX (Auto row, hover rationales, "Set as light/dark" mini-actions, keyboard nav + filter), screenshot regeneration for all 17 themes, palette completeness for the optional keys, WCAG contrast warnings surfaced in dev builds.
8. (renumbered from prior slice 8) **Packaging + multi-instance polish:** `.desktop`, MIME XML, AppStream metainfo, icons at all sizes, AppImage recipe, Flatpak manifest, `xdg-mime` install scripts, multi-file CLI (`%F` → multiple windows via fork+exec → parent exits), `StartupWMClass` / Wayland `app_id` / X11 `WM_CLASS` verification test, recent-files in the File menu, final full-corpus `review-and-fix` pass.

Each owner-authored slice ends with: TDD → e2e → dev-time dual-model visual review → `ccc-review-cx` → fix Blockers and Majors → commit → `postcommit-status-and-continue`. Each contributor-authored slice ends with: TDD → e2e → manual PR review → fix Blockers and Majors → commit.

## 17. Open questions parked to the plan / slice stage

- Exact webdriver client: `fantoccini` (leaning) vs `thirtyfour`. Decided in slice 1.
- CodeMirror 6 packaging: pinned vendored files (leaning) vs npm-driven build step. Decided in slice 4.
- AppImage tooling: `cargo-tauri-bundle` vs `cargo-appimage` vs hand-rolled `linuxdeploy`. Decided in slice 8.
- Mermaid + KaTeX vendoring: pinned local copies (leaning) vs build-time pull. Decided in slice 6.
- Final App ID form: `dev.previewmd.App` (spec default) vs `dev.preview-md.App` (matches the project slug). Both accepted by KDE / Sway / Flatpak ≥ 1.10. Decided in slice 8.
- Whether to publish `pmd-core` to crates.io post-v1 (with an API-surface review). Revisited after v1 ships.

---

## Summary

- **What it is.** A Linux-first Rust + Tauri markdown preview app with three modes (monospace source, split, read-only preview), GFM + mermaid + KaTeX + syntax highlighting, 17 bundled themes (8 popular + 9 originals inspired by *Frieren*, *FFX*, and *Clair Obscur: Expedition 33*), multi-instance with first-class taskbar integration, distributed as AppImage + Flatpak (CI) and `cargo install` (local).
- **Architecture.** Cargo workspace: `pmd-core` (parser, emit, sanitize, source-map, theme parse+validate — pure), `pmd-app` (Tauri shell, IPC, theme discovery+injection, state, platform hooks — impure), `pmd-e2e` (webdriver harness). Webview owns CodeMirror 6, mermaid, KaTeX, and theme reapplication. Node only as a dev-time sidecar for golden mermaid SVGs.
- **IPC + security.** Render IPC is versioned with newest-wins coalescing (max 1 in flight). Strict CSP, scoped file commands, mermaid `securityLevel: strict`, KaTeX `trust: false`. Sanitization is `parse → emit → sanitize` (corrected from the earlier draft); mermaid/KaTeX run client-side on already-sanitized nodes.
- **Source-map.** Block-level `data-src-start` + `data-src-end` attributes (matching the prose). Forward editor → preview sync only at v1; reverse direction YAGNI'd.
- **Multi-instance.** One process per window, single consistent App ID (`dev.previewmd.App`) wired through Wayland `app_id`, X11 `WM_CLASS`, and `.desktop` `StartupWMClass`. Multi-file CLI opens one window per path. State writes are `flock`-protected read-modify-write merges; recents in a separate file.
- **Theming.** Pure data (`manifest.toml` + `theme.css` + screenshot). Schema is open / forward-compatible with required core keys; **48 required + ~19 optional** palette keys covering markdown surfaces, mermaid (with sRGB-rounded derivation rule for optional keys), syntax (1:1 tree-sitter names), editor chrome (selection_bg/fg, focus_ring, caret, scrollbar), and typography (UI/mono/serif/heading + fallback chains + ligatures-off). Pinned mermaid stylistic baseline (8 px / 1.5 px / no shadows). WCAG AA contrast floor enforced at load time (text 4.5:1 and non-text 3:1, covering selection legibility and focus ring). 17 bundled themes; originals use descriptive archetype names with structured `inspired_by` homage and full 3-5 line design rationales.
- **Testing.** TDD-first, layered: unit → property → golden → theme-completeness → IPC functional → e2e in `cage` + WebKitGTK Docker (with pinned fonts and software compositing) → screenshot pixel diff at threshold `0.10`, fail `>0.5%`. All 17 themes × 3 modes covered for feature scenarios. CI gates on these alone — **the dual-model visual review is a dev-time author loop, not a CI gate** — keeping the project shippable by contributors without AI access.
- **Workflow.** `writing-plans` next; slices delegated via `subagent-driven-development`; each slice ends with `review-and-fix`, `ccc-review-cx`, and finally **"run the `postcommit-status-and-continue` skill and continue."**
- **Repo norms.** `justfile` is the index, long commands in `scripts/`. Single binary distribution: AppImage + Flatpak from CI, `cargo install` locally.
- **YAGNI'd.** Multi-tab, plugins, non-Linux builds, cloud, PDF export, runnable code blocks, custom protocol handlers, raw-HTML toggle, reverse scroll sync, session restore, mermaid geometry overrides, polling watcher fallback, block-level incremental render.
