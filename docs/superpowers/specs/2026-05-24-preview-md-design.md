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
open_file(path: PathBuf) -> FileBuffer        // dialog-selected or recent-list path only
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

### 3.3 Security boundary

Markdown is treated as untrusted. The boundary is layered:

- **Content Security Policy** (`ui/index.html` `<meta http-equiv="Content-Security-Policy">`):
  - `default-src 'self'`
  - `script-src 'self' 'wasm-unsafe-eval'` — no inline scripts, no `eval`. (Mermaid's use of the `Function` constructor is sandboxed via mermaid's own `securityLevel`.)
  - `style-src 'self' 'unsafe-inline'` — themes inject CSS, and KaTeX uses inline styles.
  - `img-src 'self' data: file:` — local images and KaTeX SVG data URIs only. No network image loading in v1.
  - `connect-src 'none'` — no fetches from the preview.
  - `object-src 'none'`, `frame-src 'none'`, `base-uri 'self'`.
- **Tauri command scopes:** all file commands restrict paths to the union of (a) paths returned by Tauri's native open/save dialogs in the current session and (b) the user's recent-files list. No raw arbitrary-path file ops are exposed.
- **Mermaid:** `mermaid.initialize({ securityLevel: 'strict', ... })`. This disables HTML in nodes, `<foreignObject>` HTML rendering, and link click interception.
- **KaTeX:** `katex.render(src, el, { trust: false, strict: 'warn' })`. Disables `\href`, `\url`, and other macros that emit URLs.
- **Sanitization order** (the canonical pipeline):
  1. `pulldown-cmark` parses markdown into events.
  2. HTML emitter produces a string with `data-src-start` / `data-src-end` attributes and class hooks.
  3. **`ammonia` sanitizes the emitted HTML** with an explicit allowlist (Slice 2 pins the full list; minimum: standard markdown tags + `class`, `id`, `data-src-start`, `data-src-end` data attributes; `style` rejected except on KaTeX-emitted elements which are processed *after* sanitization).
  4. Webview swaps innerHTML.
  5. Webview runs KaTeX on already-sanitized `<span class="math">` nodes; KaTeX output is trusted (the library is pinned, vendored, and runs with `trust: false`).
  6. Webview runs mermaid on already-sanitized `<pre><code class="language-mermaid">` nodes; mermaid output is trusted (pinned, vendored, `securityLevel: 'strict'`).

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
- `preview-md a.md b.md c.md` opens **three** windows, one per path (matches the "one process per window" rule by spawning child processes from the first invocation for additional paths, then exiting the parent if the parent had no work).
- `.desktop` `Exec=preview-md %F` therefore handles multi-file selections cleanly (open many files from the file manager → many windows).

## 6. Multi-instance and launcher integration

- **One process per window.** Each window is its own OS process with its own webview. No singleton, no DBus consolidation, no implicit tab-stealing.
- **Per-window identity:**
  - **Window title:** `<filename> — preview-md` (or `Untitled — preview-md`), prefixed with a 6 px modified dot when the buffer is dirty.
  - **App ID:** a single, consistent reverse-DNS string `dev.previewmd.App` (no hyphen; chosen for GNOME convention compatibility; final value parked in §17, but the spec uses this string everywhere a placeholder appears so an implementer copy-pasting any section gets a working result).
  - **Wayland `xdg-toplevel app_id`, X11 `WM_CLASS` (both instance and class), and `.desktop` `StartupWMClass`** are all set to the same value (`dev.previewmd.App`). Slice 7 has an acceptance test that `swaymsg -t get_tree` / `xprop` reports the expected id.
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

**Schema posture:** the schema is **forward-compatible with a required core**. Themes that omit *required* keys are rejected at load time with a clear error pinpointing the missing keys. Themes that include *unknown* keys are accepted; the unknown keys are ignored. (This is open/forward-compatible, not "closed" — the earlier draft used the wrong term.)

**Required vs optional matrix** lives in `crates/pmd-core/src/theme/schema.rs` as the canonical source of truth.

### 7.2 How a theme is applied

`pmd-app` resolves and applies the active theme on startup and on `set_theme`:

1. **Discovery** (`pmd-app`): scan bundled `themes/` and user `~/.config/preview-md/themes/`.
2. **Parse + validate** (`pmd-core::theme`): pure functions, unit-testable, no I/O. `parse_manifest(s: &str) -> Result<Theme, ThemeError>`; `validate(t: &Theme) -> Result<(), ValidationError>` (checks required keys, contrast floor — see below).
3. **CSS assembly** (`pmd-app::theme`): generate a `:root { … }` block setting one CSS custom property per palette key (`--pmd-bg`, `--pmd-mermaid-primary`, etc.); concatenate the theme's `theme.css` file.
4. **Inject** (`pmd-app::theme` via Tauri command): replace the active theme `<style id="pmd-theme">` node in the webview.
5. **Re-run renderers on existing DOM**: the webview's theme-change handler walks all existing math and mermaid nodes and **re-renders them in place** so already-drawn diagrams pick up the new palette. (Mermaid is also re-initialised with `themeVariables` so any *future* renders use the new palette too.)
6. **Auto-switch**: if `auto_switch=true` and a `(light, dark)` pair is configured, the active theme follows `system_theme_changed` events; otherwise the explicit `active_theme` is always used.

`base.css` defines the structural layout and references **only** `var(--pmd-…)` — never hard-coded colours. CI runs a `theme-completeness` test (§8) that fails if any required CSS variable is unreferenced or any required palette key is omitted by a bundled theme.

**Mermaid stylistic baseline** (pinned for v1, applied via `mermaid-theme.css`):

- 8 px corner radius on nodes
- 1.5 px stroke
- no drop-shadows
- node font inherits `--pmd-ui-font` and `font-size: 0.95em`
- edge labels rendered as 4 px-padded chips in `--pmd-mermaid-edge-label-bg`
- sequence-diagram lifelines: 1 px dashed in `--pmd-mermaid-line`

Themes may override colours via the palette but **may not override geometry** unless they declare `[mermaid.geometry]` explicitly (parked for v2; not in v1).

**Contrast floor:** validation runs WCAG AA contrast checks on `fg` vs `bg` and `link` vs `bg`. Failures emit a non-fatal warning in dev builds and a hard validation error in CI's `theme-validate` step (a §12 just target).

### 7.3 Bundled themes (v1)

**Popular / familiar (8):**

1. GitHub Light
2. GitHub Dark
3. Solarized Light
4. Solarized Dark
5. Dracula
6. Nord
7. Tokyo Night
8. **Rosé Pine Dawn** (light) — swapped in to balance the bundle's dark / light ratio (previously 8/0 → now 6/2 dark/light when combined with the GitHub and Solarized pairs).

**Original — inspired by *Sousou no Frieren* (3):**

9. **Twilight Mage** (dark, inspired by Frieren). Dominant: warm-grey paper-tint bg (`#1a1a22`); foreground: silver; accent: violet only on links, headings, focus ring. Trap to avoid: generic dark-mode blue.
10. **Sky Hero** (light, inspired by Himmel). Dominant: pale-gold bg (`#fbf6e6`); accent: sky-blue; foreground: warm dark grey. Headings use Source Serif to read heroic. Trap: looking like default light unless the gold tint is real, not `#fffdf5`.
11. **Lavender Forest** (light, inspired by Fern). Dominant: lavender paper bg; accent: forest green on links and headings; body fg: soft brown. Trap: too-saturated greens that read as Solarized.

**Original — inspired by *Final Fantasy X* (3):**

12. **Sun and Sea** (light, inspired by Tidus). Bg is sea-blue cream; accents are sunburst orange; sun-yellow appears only as a top divider strip. High-contrast for outdoor readability. Trap: pure yellow bg is unreadable for prose.
13. **Black Mage** (dark, inspired by Lulu). Near-black bg (`#0a0610`); deep purple panels via `bg_elevated`; crimson is accent only on links and h1. Serif headings. Trap: crimson everywhere reads as error-state.
14. **Red Guardian** (dark, inspired by Auron). Ink-black bg; rust-red accent pushed toward brown (not pink, to avoid Dracula collision); parchment fg (`#e8dcc0`). Heavier mono font weight (500+). Trap: pink-rust drift.

**Original — inspired by *Clair Obscur: Expedition 33* (3):**

15. **Sepia Atelier** (light, inspired by Gustave). Sepia paper bg; iron-grey fg; raw-canvas accents on headings; serif body. Adds a 2% noise overlay via `theme.css` for painterly texture. Trap: looking like Solarized Light without the texture.
16. **Rose Melancholy** (dark, inspired by Maelle). Deep rose-tinted black bg (`#1a1014`); somber violet accents; atelier-charcoal `bg_elevated`. h2/h3 italic to feel melancholic. Trap: pink overload — keep rose subliminal in the bg only.
17. **Cobalt Bone** (dark, inspired by Verso). Cobalt-blue dark bg; bone-white fg; raw-umber on code blocks and tables — the umber on code is the distinguishing move. Trap: pure blue reads as a Nord knockoff without the umber.

Total at v1: **17 themes** (7 popular, 10 originals).

**IP / naming policy.** Original themes are **named with descriptive archetypes**, not with the proper names of characters from copyrighted works. The structured `[meta.inspired_by]` field documents the homage. The bundle contains only colour palettes (uncopyrightable) and one-paragraph design rationales (original prose). No artwork, logos, or proper names from the source works are bundled. This policy is conservative for AppStream / Flatpak distribution. If a rights-holder objects to a specific homage, the affected theme is renamed (or dropped); the colours stay.

### 7.4 User themes

User themes placed in `~/.config/preview-md/themes/<slug>/` are loaded with the same loader and appear alongside bundled themes in the picker. There is no theme API beyond the file format — themes are pure data (manifest + CSS), so theming is forward-compatible across minor releases.

### 7.5 Theme picker UX

- The picker is a grid of theme cards: `screenshot.png` + name + work/character (from `inspired_by` if present).
- A pinned top row shows `Auto (light: X, dark: Y)` with an enabled / disabled toggle. When auto is on, the currently *resolved* theme card gets a subtle ring; the configured-pair cards each show a small "L" or "D" badge.
- On hover, each card shows the `inspired_by` work + character and the `meta.notes` rationale.
- A "Set as light" / "Set as dark" mini-action appears on hover.

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

**Verification gate.** Every slice ends with the `verification-before-completion` skill: `just check`, the relevant e2e subset, the dev-time dual-model visual review (§10), fix all Blockers and Majors, then commit.

## 9. E2E driver setup

The e2e harness runs in Docker so it is reproducible on any developer machine and in CI.

- **`docker/e2e/Dockerfile`** installs: Debian slim base + `cage` (kiosk Wayland compositor) + `webkit2gtk-4.1` + Rust toolchain + `tauri-driver` + pinned fonts (Inter, JetBrains Mono, Source Serif Pro, plus fallback families Noto Sans / Noto Serif / DejaVu) + a pinned `fontconfig` config (no hinting, fixed antialias mode, RGB subpixel order disabled) + the built `preview-md` binary.
- **Determinism env vars:** `WEBKIT_DISABLE_COMPOSITING_MODE=1` (force software compositing inside the container so antialiasing matches the dev-time baselines), `LIBGL_ALWAYS_SOFTWARE=1` (llvmpipe).
- **Invocation pattern** (correct Tauri model):
  1. `cage -- tauri-driver --port 4444` starts inside the container.
  2. The test on the host (or another container) connects WebDriver to `localhost:4444`.
  3. The test creates a session with `tauri:options` capabilities — `{"application": "/usr/local/bin/preview-md", "args": ["..."]}` — and `tauri-driver` spawns the app, attaches the WebDriver session to its webview.
  4. The app does **not** expose its own `--webdriver-port` flag; tauri-driver handles that.
- **Why cage, not Xvfb:** the dev machine is KDE Plasma on Wayland; cage gives a deterministic, single-window, undecorated Wayland compositor — closer environment parity for screenshot stability.
- **Baseline capture rule:** all screenshot baselines are captured **inside the container** via `just e2e-update-baselines`. Never on the dev machine directly. This avoids font / compositor / DPI drift between dev and CI.
- **Just targets:** `just e2e` (verify) and `just e2e-update-baselines` (capture). Both wrap the Docker invocation so the human and agent paths are identical.

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
- **The plan's final instruction is literally:** _"load `postcommit-status-and-continue` and continue."_

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
e2e-update-baselines:   ./scripts/e2e.sh --update
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

## 16. Implementation slicing (handed to `writing-plans` next)

Eight PR-sized increments, each with its own TDD → e2e → visual review → `ccc-review-cx` → commit cycle:

1. **Scaffold:** cargo workspace, justfile, CI skeleton, Docker e2e harness (with pinned fonts and determinism env), smoke e2e that opens an empty Tauri window through tauri-driver and screenshots it.
2. **`pmd-core` core pipeline:** parser → HTML emitter (with `data-src-start` / `data-src-end`) → ammonia sanitizer (allowlist pinned in this slice) → source-map → theme manifest parse + validate + contrast check + theme-completeness test. Unit, property, golden, theme tests. No UI yet.
3. **`pmd-app` shell, read-only preview mode, GitHub Light / Dark themes, file open / save with restricted path scopes, render-IPC versioning + back-pressure.** First user-visible milestone. (Linux desktop integration files deferred to slice 8.)
4. **Monospace mode** with CodeMirror 6 + mode chrome (toolbar segmented control, modified dot, status bar, hotkey overlay) + theme switching + state persistence (debounced flock RMW) + auto-switch follow.
5a. **Render integration:** full split-mode layout with the version-coalescing render path and morphdom-style DOM diff. No scroll sync yet. Tests cover full-document render correctness and version-drop staleness.
5b. **Scroll sync** via `data-src-start` / `data-src-end` source-map (forward only). Includes goldens for lists, tables, nested blockquotes, fenced code with multi-line info strings.
6. **Mermaid + KaTeX + syntax highlighting + custom mermaid theme override + mermaid stylistic baseline (8 px / 1.5 px / no shadows / inherited font / chip edge labels)**. All 17 bundled themes shipped, including the 10 originals with their full `meta.notes` rationales. Theme switching re-renders existing mermaid / math nodes.
7. **Theme polish slice:** picker UX (Auto row, hover rationales, "Set as light/dark" mini-actions), screenshot regeneration for all themes, palette completeness for the optional keys (mermaid optional set, kbd, image_caption, etc.), WCAG contrast warnings surfaced in dev builds.
8. **Packaging + multi-instance polish:** `.desktop`, MIME XML, AppStream metainfo, icons at all sizes, AppImage recipe, Flatpak manifest, `xdg-mime` install scripts, multi-file CLI (`%F` → multiple windows), `StartupWMClass` verification test, recent-files in the File menu, final full-corpus `review-and-fix` pass.

Each slice ends with: TDD → e2e → dev-time dual-model visual review → `ccc-review-cx` → fix Blockers and Majors → commit → `postcommit-status-and-continue`.

## 17. Open questions parked to the plan / slice stage

- Exact webdriver client: `fantoccini` (leaning) vs `thirtyfour`. Decided in slice 1.
- CodeMirror 6 packaging: pinned vendored files (leaning) vs npm-driven build step. Decided in slice 4.
- AppImage tooling: `cargo-tauri-bundle` vs `cargo-appimage` vs hand-rolled `linuxdeploy`. Decided in slice 8.
- Mermaid + KaTeX vendoring: pinned local copies (leaning) vs build-time pull. Decided in slice 6.
- Final App ID form: `dev.previewmd.App` (spec default) vs `dev.preview-md.App` (matches the project slug). Both accepted by KDE / Sway / Flatpak ≥ 1.10. Decided in slice 8.
- Whether to publish `pmd-core` to crates.io post-v1 (with an API-surface review). Revisited after v1 ships.

---

## Summary

- **What it is.** A Linux-first Rust + Tauri markdown preview app with three modes (monospace source, split, read-only preview), GFM + mermaid + KaTeX + syntax highlighting, 17 bundled themes (7 popular + 10 originals inspired by *Frieren*, *FFX*, and *Clair Obscur: Expedition 33*), multi-instance with first-class taskbar integration, distributed as AppImage + Flatpak (CI) and `cargo install` (local).
- **Architecture.** Cargo workspace: `pmd-core` (parser, emit, sanitize, source-map, theme parse+validate — pure), `pmd-app` (Tauri shell, IPC, theme discovery+injection, state, platform hooks — impure), `pmd-e2e` (webdriver harness). Webview owns CodeMirror 6, mermaid, KaTeX, and theme reapplication. Node only as a dev-time sidecar for golden mermaid SVGs.
- **IPC + security.** Render IPC is versioned with newest-wins coalescing (max 1 in flight). Strict CSP, scoped file commands, mermaid `securityLevel: strict`, KaTeX `trust: false`. Sanitization is `parse → emit → sanitize` (corrected from the earlier draft); mermaid/KaTeX run client-side on already-sanitized nodes.
- **Source-map.** Block-level `data-src-start` + `data-src-end` attributes (matching the prose). Forward editor → preview sync only at v1; reverse direction YAGNI'd.
- **Multi-instance.** One process per window, single consistent App ID (`dev.previewmd.App`) wired through Wayland `app_id`, X11 `WM_CLASS`, and `.desktop` `StartupWMClass`. Multi-file CLI opens one window per path. State writes are `flock`-protected read-modify-write merges; recents in a separate file.
- **Theming.** Pure data (`manifest.toml` + `theme.css` + screenshot). Schema is open / forward-compatible with required core keys; ~45 palette keys covering markdown surfaces, mermaid (with derivation rule for optional keys), syntax (1:1 tree-sitter names), editor chrome (selection_bg/fg, focus_ring, caret, scrollbar), and typography (UI/mono/serif/heading + fallback chains + ligatures-off). Pinned mermaid stylistic baseline (8 px / 1.5 px / no shadows). WCAG AA contrast floor enforced at load time. 17 bundled themes; originals use descriptive archetype names with structured `inspired_by` homage and full 3-5 line design rationales.
- **Testing.** TDD-first, layered: unit → property → golden → theme-completeness → IPC functional → e2e in `cage` + WebKitGTK Docker (with pinned fonts and software compositing) → screenshot pixel diff at threshold `0.10`, fail `>0.5%`. All 17 themes × 3 modes covered for feature scenarios. CI gates on these alone — **the dual-model visual review is a dev-time author loop, not a CI gate** — keeping the project shippable by contributors without AI access.
- **Workflow.** `writing-plans` next; slices delegated via `subagent-driven-development`; each slice ends with `review-and-fix`, `ccc-review-cx`, and finally **"load `postcommit-status-and-continue` and continue."**
- **Repo norms.** `justfile` is the index, long commands in `scripts/`. Single binary distribution: AppImage + Flatpak from CI, `cargo install` locally.
- **YAGNI'd.** Multi-tab, plugins, non-Linux builds, cloud, PDF export, runnable code blocks, custom protocol handlers, raw-HTML toggle, reverse scroll sync, session restore, mermaid geometry overrides, polling watcher fallback, block-level incremental render.
