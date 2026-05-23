---
title: preview-md — design spec
date: 2026-05-24
status: draft (pending review)
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
│   ├── pmd-core/                  (parser, AST, render to HTML, theming, sanitization)
│   ├── pmd-app/                   (Tauri shell, IPC handlers, file I/O, window/state)
│   └── pmd-e2e/                   (e2e harness: webdriver client, screenshot capture, diff)
├── ui/                            (web assets served to the webview)
│   ├── index.html
│   ├── src/                       (TypeScript: CodeMirror wiring, mermaid init, scroll sync)
│   ├── styles/
│   │   ├── base.css               (shared structure + CSS variable schema)
│   │   └── mermaid-theme.css      (mermaid override layer keyed off CSS variables)
│   └── vendor/                    (mermaid, katex pinned versions)
├── themes/                        (single source of truth for themes; one folder per bundled theme: manifest.toml + theme.css + screenshot.png. Loaded at runtime by pmd-app and injected into the webview — not statically bundled into ui/.)
├── tests/
│   ├── golden/                    (fixture .md → expected HTML/SVG/screenshots)
│   └── corpus/                    (markdown sample set: GFM spec, mermaid samples, edge cases)
├── docker/
│   └── e2e/                       (Dockerfile: cage + webkit2gtk + tauri-driver + the built binary)
├── packaging/
│   ├── linux/                     (preview-md.desktop, icons, MIME XML, AppStream metainfo)
│   ├── appimage/                  (AppImage recipe)
│   └── flatpak/                   (Flatpak manifest)
└── .github/workflows/             (CI: build, test, e2e, package AppImage/Flatpak)
```

**Process boundary:**

- **Rust process owns:** file I/O, markdown parsing, HTML emission (with embedded source-map metadata), syntax highlighting (tree-sitter, pre-rendered to spans with semantic classes), settings persistence, theme resolution, file watching, window/process identity.
- **Webview owns:** rendering the emitted HTML, CodeMirror 6 source editor, client-side mermaid rendering, KaTeX rendering, scroll and cursor sync, theme CSS application.
- **IPC:** typed Tauri commands. The full surface at v1 is small and explicit:
  - `render(markdown: String) -> RenderResult { html, source_map }`
  - `open_file(path: PathBuf) -> FileBuffer`
  - `save_file(path: PathBuf, contents: String) -> ()`
  - `watch_file(path: PathBuf) -> ()` (emits an event on external change)
  - `list_themes() -> Vec<ThemeInfo>`
  - `set_theme(name: String) -> ()`
  - `set_mode(mode: Mode) -> ()`
  - `get_state() -> AppState`
- **Events (Rust → webview):** `file_changed_on_disk`, `theme_changed`, `system_theme_changed`, `mode_changed`.

**Data flow in split mode:**

1. Keystroke in CodeMirror → debounced (≈16 ms).
2. Debounced content sent over `render` IPC.
3. `pmd-core` parses → sanitizes → emits HTML with `data-src-line` attributes on block-level elements.
4. Preview pane swaps innerHTML using a small DOM diff (morphdom-style) so only changed nodes are touched.
5. New nodes inserted into the preview run through the mermaid and KaTeX post-processors.
6. Scroll-sync handler matches caret line in the editor to the nearest `data-src-line` element in the preview and adjusts scroll position with `requestAnimationFrame` smoothing.

## 4. Markdown pipeline (in `pmd-core`)

- **Parser:** `pulldown-cmark` with GFM features enabled. The event stream is converted to a typed AST owned by `pmd-core`.
- **HTML emitter:** we own the emitter so we can attach source-map data attributes (`data-src-line="N"`) on every block-level node and class hooks (`pmd-block-quote`, `pmd-task-item`, `pmd-code`, etc.) that themes can target.
- **GFM coverage:** tables, task lists, strikethrough, autolinks, footnotes, fenced code with info strings. Features added only when a fixture in `tests/corpus/` exercises them:
  - Math (`$…$`, `$$…$$`) → routed to KaTeX in the webview.
  - Mermaid (` ```mermaid `) → routed to mermaid in the webview.
  - Admonitions (`> [!NOTE]`-style, matching GitHub) → emitted with `pmd-admonition` classes.
- **Syntax highlighting:** tree-sitter via `tree-sitter-highlight`, pre-rendered server-side into `<span class="hl-…">` tokens with stable, theme-agnostic class names. The active theme defines the actual colours via CSS variables.
- **Sanitization:** `ammonia` with an allowlist that permits mermaid and KaTeX output attributes and the `data-src-line` data attribute. Raw inline HTML in markdown is **off by default** (matches GitHub.com's render), with an opt-in setting per buffer.
- **Source-map:** the emitter records (block-start-line, block-end-line) ranges and emits them as `data-src-line` on block elements. This is the only contract the scroll-sync needs.

## 5. UI modes

A single window per process. State is split into two scopes:

- **Global state** (`~/.config/preview-md/state.toml`, XDG-compliant): active theme, theme-mode pair for auto-switching, default startup mode, recent files. Written by any instance; on conflict, last-writer-wins, guarded by an advisory `flock` so concurrent writes don't tear the file.
- **Per-window state** (in-memory only at v1): current file path, scroll position, cursor location, active mode. Not persisted across restarts in v1; the YAGNI fence covers full session restore.

- **Source mode (monospace):** CodeMirror fills the window; no preview pane.
- **Split mode:** CodeMirror on the left, preview on the right, scroll-synced via the source-map.
- **Preview mode (read-only):** preview fills the window; editor hidden.

Mode toggle is a single hotkey cycle (`Ctrl+\`) and a button in the toolbar. Modes share one document buffer so switching is instant (no re-parse).

## 6. Multi-instance and launcher integration

- **One process per window.** Each `preview-md` invocation opens its own OS process with its own webview. No singleton, no DBus consolidation, no implicit tab-stealing.
- **Per-window identity:**
  - **Window title:** `<filename> — preview-md` (or `Untitled — preview-md` for a new buffer).
  - **App ID:** set via Tauri to a stable reverse-DNS constant (working name `dev.previewmd.App`; final form parked in §17 since hyphenated forms work on some compositors but not all). This is what Wayland compositors use to group windows in the taskbar under one icon.
  - **`StartupWMClass`:** matches the App ID, so KDE Plasma's task manager pairs launcher icons with running windows correctly.
- **Linux desktop integration files** (live in `packaging/linux/`):
  - `preview-md.desktop` with `Exec=preview-md %F`, `StartupWMClass=dev.preview-md.app`, `MimeType=text/markdown;text/x-markdown;`, and a jumplist entry for "Open recent" (populated from state).
  - SVG + PNG icons at 16/24/32/48/64/128/256 px.
  - `preview-md.metainfo.xml` (AppStream) so the app shows up in software centres with screenshots and release notes.
  - MIME XML so `xdg-mime` can register `.md` and `.markdown` extensions.
- **Cross-platform structure** (Linux-only at v1, but the seams are real):
  - `crates/pmd-app/src/platform/mod.rs` defines a `PlatformHooks` trait covering: launcher identity, recent-files exposure, system theme detection, file-watcher backend, and process-singleton policy.
  - `linux.rs` implements all of the above. `windows.rs` and `macos.rs` are stubs (`unimplemented!`) behind `#[cfg(target_os = …)]`. CI only builds `linux.rs`; the others exist to prevent "the abstraction was never tested" syndrome from setting in.
- **Recent files / jumplist:** Linux exposes recents via the `.desktop` actions field, refreshed by the app on each successful file open. (Cross-platform expansion later: Windows jumplist via the platform hook, macOS dock menu likewise.)

## 7. Theming

Theming is a **first-class subsystem**, not a CSS afterthought.

### 7.1 Theme schema

Each theme is a folder under `themes/<theme-name>/`:

- `manifest.toml`
- `theme.css`
- `screenshot.png` (used by the in-app theme picker and the AppStream metadata)

`manifest.toml`:

```toml
[meta]
name        = "Frieren"            # display name
slug        = "frieren"            # filesystem-safe id
author      = "preview-md"
mode        = "dark"               # "light" | "dark"
inspired_by = "Sousou no Frieren — Frieren"
version     = "1.0.0"

[palette]
# Required keys. Hex; alpha allowed.
bg              = "#0e0f1a"
bg_elevated     = "#161829"
fg              = "#e8e6f3"
fg_muted        = "#9b97b8"
accent          = "#a899d4"
link            = "#9ec5ff"
selection       = "#3a3760"
border          = "#262640"

# Markdown surfaces
code_bg         = "#181a2c"
code_fg         = "#e8e6f3"
blockquote_bar  = "#a899d4"
blockquote_fg   = "#cfcce0"
admonition_note = "#9ec5ff"
admonition_warn = "#e7c878"
admonition_tip  = "#a8dac0"

# Mermaid (consumed by mermaid-theme.css and the mermaid.initialize call)
mermaid_primary       = "#a899d4"
mermaid_primary_text  = "#1a1828"
mermaid_secondary     = "#4d4a6e"
mermaid_tertiary      = "#262640"
mermaid_line          = "#7a78a0"

# Syntax highlighting (keys map 1:1 to tree-sitter highlight names)
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

[fonts]
ui     = "Inter"
mono   = "JetBrains Mono"
serif  = "Source Serif Pro"        # used in reading mode for prose
```

The schema is **closed at v1** — themes that add unknown keys are accepted but the unknown keys are ignored. Themes that omit required palette keys are rejected at load time with a clear error. `[fonts]` is optional; any unset font falls back to the app default (Inter / JetBrains Mono / Source Serif Pro).

**Auto light/dark switching.** Settings store an optional `(light_theme, dark_theme)` pair. When set, the app follows the system theme (via Tauri's `theme` event) and swaps between the two; when unset, the explicit `active_theme` is always used. This costs one settings field and zero runtime complexity beyond the existing `set_theme` path.

### 7.2 How a theme is applied

`pmd-app` resolves the active theme on startup and on `set_theme`:

1. Read the manifest.
2. Validate against the schema.
3. Generate a `:root { … }` CSS block setting one CSS custom property per palette key (`--pmd-bg`, `--pmd-mermaid-primary`, etc.).
4. Inject that block plus the theme's `theme.css` into the webview.
5. Re-initialise mermaid with `themeVariables` derived from the same palette so SVG output matches the page.

`base.css` defines the structural layout and references only `var(--pmd-…)` — never hard-coded colours. This invariant is enforced in CI by a small grep test.

### 7.3 Bundled themes (v1)

**Popular / familiar (8):**

1. GitHub Light
2. GitHub Dark
3. Solarized Light
4. Solarized Dark
5. Dracula
6. Nord
7. Tokyo Night
8. Catppuccin Mocha

**Original — *Sousou no Frieren* (3):**

9. **Frieren** (dark) — silver/violet/twilight; cool blues; subtle.
10. **Himmel** (light) — pale gold + sky blue; warm and heroic.
11. **Fern** (light) — lavender + forest green; soft and earthy.

**Original — *Final Fantasy X* (3):**

12. **Tidus** (light) — sun yellow + sea blue; high-contrast and bright.
13. **Lulu** (dark) — deep purple + black + crimson; high-drama.
14. **Auron** (dark) — rust red + ink black + parchment; restrained and weighty.

**Original — *Clair Obscur: Expedition 33* (3):**

15. **Gustave** (light) — sepia + canvas + iron; painterly and warm.
16. **Maelle** (dark) — rose + somber violet + atelier black; melancholic.
17. **Verso** (dark) — cobalt + bone + raw umber; surreal and quiet.

Total at v1: **17 themes**. Each original theme ships with a one-paragraph "why this character → these colours" note in its manifest so the choices read intentional, not random.

### 7.4 User themes

Themes placed in `~/.config/preview-md/themes/<slug>/` are loaded with the same loader as bundled themes and appear alongside them in the picker. There is no theme API — themes are pure data (manifest + CSS), so theming is forward-compatible across minor releases.

## 8. Testing strategy

Each layer fires during a TDD cycle, fastest first. **No layer is optional.**

| Layer                       | Tool                                                       | Scope                                                                                         | Lives in                              |
| --------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------- |
| Unit                        | `cargo test`                                               | parser, AST, emitter, sanitizer, source-map, theme loader                                     | `crates/pmd-core/src/**`              |
| Property                    | `proptest`                                                 | "any UTF-8 markdown ⇒ sanitizer never emits a script tag"; "render→parse-html is well-formed"; "source-map line ranges are contiguous and monotonic" | `crates/pmd-core/tests/prop_*.rs`     |
| Golden (regression)         | custom harness                                             | fixture `.md` → expected normalized HTML; CI rejects any unexpected diff                      | `tests/golden/`                       |
| Functional (IPC)            | `cargo test`                                               | hits Tauri commands directly via in-process `invoke` — no webview                             | `crates/pmd-app/tests/`               |
| E2E GUI                     | `tauri-driver` + `fantoccini` (Rust webdriver client), running inside `cage` + WebKitGTK in Docker | full app: open file, edit, switch modes, switch themes                                       | `crates/pmd-e2e/tests/`               |
| Screenshot diff             | `pixelmatch`-equivalent + perceptual diff threshold        | feature scenarios × **smoke theme set** (GitHub Light, GitHub Dark, Frieren) × {source, split, preview}; plus a single **theme-gallery scenario** that covers all 17 bundled themes in split mode | `tests/screenshots/baselines/`        |
| Dual-model visual review    | parallel Agent dispatch (Opus 4.7 + GPT-5.5)               | screenshots routed to two subagents for aesthetic and regression critique; results aggregated | `scripts/visual-review.sh` + `crates/pmd-e2e/` |

**TDD discipline.** Every feature starts as a failing golden test plus a failing unit test; implementation follows until both pass. The `test-driven-development` skill is loaded at the top of each slice.

**Verification gate.** Every slice ends with the `verification-before-completion` skill: run `just check`, run the relevant e2e subset, dispatch the dual-model visual review, fix all Blockers and Majors, then commit.

## 9. E2E driver setup

The e2e harness runs in Docker so it is reproducible on any developer machine and in CI.

- **`docker/e2e/Dockerfile`:** Debian slim + `cage` (kiosk Wayland compositor) + `webkit2gtk-4.1` + `tauri-driver` + the just-built `preview-md` binary.
- **Entry:** `cage -- preview-md --webdriver-port 4444` exposes the WebKit Inspector over WebDriver; the e2e suite on the host (or in another container) connects via `fantoccini` from `crates/pmd-e2e`.
- **Why cage and not Xvfb:** Wayland is the actual target environment (KDE Plasma on the developer machine is Wayland), and `cage` gives a deterministic, single-window, undecorated compositor — perfect for screenshot stability.
- **Just targets:** `just e2e` and `just e2e-update-baselines` wrap the Docker invocation so the human and agent paths are identical.

## 10. Dual-model visual review loop

Triggered after every e2e screenshot batch. Implements the `review-and-fix` skill, using `dispatching-parallel-agents` for the dual-model leg.

1. E2E suite writes new screenshots to `tests/screenshots/run-<sha>/`.
2. `scripts/visual-review.sh` builds a review bundle per scenario: `{ baseline.png, actual.png, diff.png, scenario.md }`.
3. Dispatch two subagents in parallel (one `Agent` tool call per agent, sent in the same message):
   - **Opus 4.7 review:** `subagent_type=general-purpose`, model `opus`.
   - **GPT-5.5 review:** if a native GPT-5.5 `subagent_type` exists at run time, use it; otherwise, dispatch a `general-purpose` subagent and have it load the `ccc-review-cx` skill (which routes to a GPT-class reviewer).
   - Both subagents receive the same prompt: aesthetic critique plus regression flagging, with structured JSON output (`severity`, `location`, `suggestion`).
4. Aggregator merges both reports to `tests/reviews/<sha>/aggregate.md`.
5. Main agent applies `review-and-fix`: triage → fix → re-run e2e → re-review.
6. Loop terminates when both subagents return "no blocking issues" or the per-slice loop budget (3 iterations by default) is exhausted, at which point the agent escalates to the user instead of merging.

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
test-ipc:               cargo test -p pmd-app
e2e:                    ./scripts/e2e.sh
e2e-update-baselines:   ./scripts/e2e.sh --update
visual-review:          ./scripts/visual-review.sh
review-and-fix:         ./scripts/review-and-fix.sh   # e2e + visual-review + aggregate

# themes
theme-list:             cargo run -p pmd-app -- --list-themes
theme-validate:         ./scripts/theme-validate.sh   # schema-check every bundled theme

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
check:                  just fmt && just lint && just test
```

Every command longer than ~5 lines lives under `scripts/` rather than being inlined.

## 13. CI

`.github/workflows/ci.yml`:

- Matrix: stable Rust, Linux only.
- Jobs: `check`, `test`, `e2e` (Docker), `package-appimage`, `package-flatpak`. All parallelizable.
- Caches: `Swatinem/rust-cache`.
- Artifacts on tag: AppImage, Flatpak, source tarball.
- `cargo publish` for `pmd-core` on tag; `pmd-app` is not published (Tauri's build deps make `cargo install` user experience poor).

## 14. Distribution

- **Local:** `just build-release && just package-appimage` produces a single-file AppImage. `just install-desktop` installs the `.desktop`, icons, and MIME registrations into `~/.local/share/`.
- **CI on tag:** Flatpak (manifest pulls source from the tag) and AppImage are produced and uploaded as release artifacts.
- **`cargo install`:** `cargo install --path crates/pmd-app` works locally for contributors. We do not publish `pmd-app` to crates.io because Tauri's build dependencies make the `cargo install` path fragile for end users.

## 15. YAGNI fence — explicit out-of-scope for v1

- Multi-tab / multi-document UI inside a single window. (Multi-instance covers the multi-document use case.)
- Notebook-style execution / runnable code blocks.
- Plugin system beyond the data-only theme loader.
- Cloud sync / collaboration.
- Windows / macOS builds (platform seams exist; implementations do not).
- Print / export to PDF (WebKit print API is trivial to add when needed).
- Vim / Emacs keybindings inside CodeMirror (available as CodeMirror packages; add on demand).
- Custom protocol handlers (`preview-md://…`).

## 16. Implementation slicing (handed to `writing-plans` next)

Roughly seven PR-sized increments, each with its own TDD → e2e → visual review → `ccc-review-cx` → commit cycle:

1. **Scaffold:** cargo workspace, justfile, CI skeleton, Docker e2e harness, smoke e2e that opens an empty Tauri window and screenshots it through `cage`.
2. **`pmd-core` core pipeline:** parser → HTML emitter → sanitizer → source-map → theme loader. Unit tests, property tests, golden tests. No UI yet.
3. **`pmd-app` shell + read-only preview mode + GitHub Light/Dark themes + file open/save + Linux desktop integration files.** First user-visible milestone.
4. **Monospace mode** with CodeMirror 6 + theme switching + state persistence + `Ctrl+\` mode cycling.
5. **Split mode** with scroll sync via `data-src-line` source-map. The centrepiece feature.
6. **Mermaid + KaTeX + syntax highlighting + custom mermaid theme override** (lifts the aesthetic ceiling). All 17 bundled themes shipped and screenshot-tested.
7. **Packaging + multi-instance polish:** AppImage, Flatpak, AppStream metainfo, MIME associations, `StartupWMClass` verification, recent-files jumplist, final full-corpus `review-and-fix` pass.

Each slice ends with: TDD → e2e → dual-model visual review → `ccc-review-cx` → fix Blockers and Majors → commit → `postcommit-status-and-continue`.

## 17. Open questions deferred to the plan stage

These are small enough that they belong to the slice that introduces them, not to this spec:

- Exact webdriver client (likely `fantoccini`; alternatively `thirtyfour`).
- Whether to ship CodeMirror 6 via an npm-driven build step or pinned vendored files. (Leaning vendored.)
- Whether `cargo-tauri-bundle`, `cargo-appimage`, or a hand-rolled `linuxdeploy` script wins on simplicity.
- Whether mermaid is bundled vendored or pulled at build time.
- Final App ID form: `dev.previewmd.App` (no hyphen, GNOME-conventional) vs `dev.preview-md.App` (matches the project slug). KDE Plasma and Sway accept both; Flatpak accepts both since v1.10. Decided in the packaging slice.

---

## Summary

- **What it is.** A Linux-first Rust + Tauri markdown preview app with three modes (monospace source, split, read-only preview), GFM + mermaid + KaTeX + syntax highlighting, 17 bundled themes (popular + Frieren/FFX/E33-inspired), multi-instance with first-class taskbar integration, distributed as AppImage + Flatpak (CI) and `cargo install` (local).
- **Architecture.** Cargo workspace: `pmd-core` (parser, render, sanitize, source-map, theme loader), `pmd-app` (Tauri shell, IPC, state, platform hooks), `pmd-e2e` (webdriver harness). Webview owns CodeMirror 6, mermaid, KaTeX. Node only as a dev-time sidecar for golden mermaid SVGs.
- **Theming.** Themes are pure data — `manifest.toml` + `theme.css` — driven through a closed CSS-variable schema. 17 bundled themes at v1, 8 popular and 9 original (3 each from *Frieren*, *FFX*, and *Clair Obscur: Expedition 33*). User themes drop into `~/.config/preview-md/themes/<slug>/`.
- **Multi-instance.** One process per window, stable App ID and `StartupWMClass`, full `.desktop` + AppStream + MIME files. Platform-hook trait carves a seam for future Windows / macOS implementations without architectural changes.
- **Testing.** TDD-first, seven layers: unit → property → golden → IPC functional → e2e in `cage` + WebKitGTK Docker → screenshot diff → dual-model visual review (parallel Opus 4.7 + GPT-5.5 subagents). All wrapped in `review-and-fix` loops; `ccc-review-cx` gates every commit; `verification-before-completion` runs before every PR.
- **Workflow.** `writing-plans` produces the implementation plan; slices delegated via `subagent-driven-development`; each slice ends with `review-and-fix`, `ccc-review-cx`, and finally **"load `postcommit-status-and-continue` and continue."**
- **Repo norms.** `justfile` is the index, long commands shelled out to `scripts/`. Single binary distribution: AppImage + Flatpak from CI, `cargo install` from source locally.
- **YAGNI'd.** Multi-tab, plugins, non-Linux builds, cloud, PDF export, runnable code blocks, custom protocol handlers.
- **Open questions parked for the plan stage.** Webdriver client choice; CodeMirror vendoring strategy; AppImage tooling choice; mermaid bundling strategy. Each is small and slice-local.
