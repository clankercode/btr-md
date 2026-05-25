# preview-md Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. After every commit, the agent **must run the `postcommit-status-and-continue` skill and continue.** That instruction is the plan's final word — see the end of this document.

**Goal:** Ship v1 of `preview-md` — a Linux-first Rust + Tauri markdown preview app whose sole goal is to be the best markdown preview renderer on Linux. Three modes (monospace source / split / read-only preview), GFM + mermaid + KaTeX + syntax highlighting, 17 bundled themes, multi-instance with first-class taskbar integration, distributed as AppImage + Flatpak (CI) and `cargo install` (local).

**Architecture:** Cargo workspace with three crates — `pmd-core` (pure parser, emitter, sanitizer, source-map, theme parse+validate), `pmd-app` (Tauri shell, IPC, file I/O, theme injection, state, platform hooks), `pmd-e2e` (webdriver harness). Webview hosts CodeMirror 6 + mermaid + KaTeX. All rendering happens in WebKitGTK; Rust drives the markdown pipeline and owns persistent state.

**Tech Stack:** Rust stable, Tauri 2.x, WebKitGTK 4.1, `pulldown-cmark`, `ammonia`, `tree-sitter` + `tree-sitter-highlight`, `notify`, `fs2` (flock), `serde` + `toml`, CodeMirror 6 (vendored), mermaid 11.x (vendored), KaTeX (vendored), `tauri-driver` + `fantoccini` + `cage` + `webkit2gtk-4.1` in Docker for e2e. **Always use 2-thread builds** per project norms: `cargo build -j 2`, `cargo test -j 2`. Helper: `just build`, `just test`.

---

## Reference

- **Spec** (canonical): `docs/superpowers/specs/2026-05-24-preview-md-design.md`. Every requirement in this plan traces to a spec section; cite the section in commit messages.
- **Repo norms** (CLAUDE.md): just-driven, scripts/ for anything > 5 lines, 2-thread builds, no emojis in code or commits.

## Workflow per phase

Each phase below is one PR. Each phase ends with this **owner-commit gate** (contributors omit the AI steps and pass on CI + manual review per spec §16):

1. All tasks complete; all listed tests pass via `just check` and the phase's `just e2e` subset.
2. **Owner only:** dev-time dual-model visual review via `just visual-review` (Opus 4.7 + `/ccc-review-cx` subagents in parallel per spec §10).
3. **Owner only:** `/ccc-review-cx` against `git diff <phase-base>...HEAD`. Verdict must be `PASS` or `MINOR_ISSUES_ONLY`; all Blockers and Majors fixed before commit.
4. `just check` once more.
5. Commit (one commit per phase, no `--no-verify`, no `--amend`).
6. **Run the `postcommit-status-and-continue` skill and continue.**

Phases marked **owner-driven** are gated additionally by the AI subagent steps; phases marked **contributor-okay** are gated only by CI + PR review.

---

## File structure

The repo at end-of-v1 looks like:

```
preview-md/
├── Cargo.toml                                       # workspace
├── justfile
├── README.md
├── scripts/
│   ├── e2e.sh
│   ├── visual-review.sh
│   ├── review-and-fix.sh
│   ├── theme-validate.sh
│   ├── package-appimage.sh
│   ├── package-flatpak.sh
│   └── install-desktop-files.sh
├── crates/
│   ├── pmd-core/
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── parse.rs
│   │   │   ├── emit.rs                              # HTML emitter with data-src-start/end
│   │   │   ├── sanitize/
│   │   │   │   ├── mod.rs
│   │   │   │   └── allowlist.rs
│   │   │   ├── source_map.rs
│   │   │   ├── highlight.rs                         # tree-sitter wrapper
│   │   │   └── theme/
│   │   │       ├── mod.rs
│   │   │       ├── schema.rs                        # required vs optional keys (canonical)
│   │   │       ├── parse.rs                         # parse_manifest
│   │   │       ├── validate.rs                      # WCAG checks + completeness
│   │   │       └── mix.rs                           # sRGB component-wise mix
│   │   └── tests/
│   │       ├── golden.rs
│   │       ├── prop_render.rs
│   │       ├── prop_source_map.rs
│   │       ├── theme_completeness.rs
│   │       └── theme_validate.rs
│   ├── pmd-app/
│   │   ├── Cargo.toml
│   │   ├── tauri.conf.json
│   │   ├── build.rs
│   │   ├── src/
│   │   │   ├── main.rs
│   │   │   ├── cmd/
│   │   │   │   ├── mod.rs
│   │   │   │   ├── render.rs                        # version-coalescing render IPC
│   │   │   │   ├── file.rs                          # open/save/watch w/ scoped paths
│   │   │   │   ├── theme.rs                         # list/set + injection
│   │   │   │   └── settings.rs                      # state, recents, auto-switch
│   │   │   ├── state/
│   │   │   │   ├── mod.rs
│   │   │   │   ├── settings.rs                      # global state w/ flock RMW
│   │   │   │   └── recents.rs                       # separate recents.toml
│   │   │   ├── path_scope.rs                        # allow_directory + canonicalize
│   │   │   ├── watcher.rs                           # notify wrapper + non-local warn
│   │   │   ├── platform/
│   │   │   │   ├── mod.rs                           # PlatformHooks trait
│   │   │   │   ├── linux.rs                         # only impl
│   │   │   │   ├── windows.rs                       # unimplemented!() stub
│   │   │   │   └── macos.rs                         # unimplemented!() stub
│   │   │   ├── cli.rs                               # multi-file fan-out, fork+exec
│   │   │   └── ipc_events.rs
│   │   └── tests/
│   │       ├── cmd_render.rs
│   │       ├── cmd_file.rs
│   │       └── cmd_theme.rs
│   └── pmd-e2e/
│       ├── Cargo.toml
│       └── tests/
│           ├── smoke.rs
│           ├── modes.rs
│           ├── themes.rs
│           ├── mermaid_katex.rs
│           ├── multi_instance.rs
│           └── helpers/mod.rs                       # fantoccini session + screenshot
├── ui/
│   ├── index.html
│   ├── package.json                                 # only for dev-time mermaid SVG generator
│   ├── src/
│   │   ├── main.ts                                  # entrypoint
│   │   ├── editor.ts                                # CodeMirror 6 wiring
│   │   ├── preview.ts                               # innerHTML swap + DOM diff
│   │   ├── mermaid_runner.ts
│   │   ├── katex_runner.ts
│   │   ├── scroll_sync.ts                           # data-src-start/end driven
│   │   ├── theme_apply.ts                           # injection + re-render
│   │   └── ipc.ts                                   # typed Tauri command wrappers
│   ├── styles/
│   │   ├── base.css                                 # consumes every CSS variable
│   │   └── mermaid-theme.css                        # geometry baseline + colours
│   └── vendor/
│       ├── codemirror-6/
│       ├── mermaid-11.x.js
│       └── katex/
├── themes/                                          # 17 bundled themes, one folder each
│   ├── github-light/
│   │   ├── manifest.toml
│   │   ├── theme.css
│   │   └── screenshot.png
│   ├── github-dark/...
│   ├── solarized-light/...
│   ├── solarized-dark/...
│   ├── dracula/...
│   ├── nord/...
│   ├── tokyo-night/...
│   ├── rose-pine-dawn/...
│   ├── twilight-mage/...
│   ├── sky-hero/...
│   ├── lavender-forest/...
│   ├── sun-and-sea/...
│   ├── onyx-sorcerer/...
│   ├── rust-warden/...
│   ├── sepia-atelier/...
│   ├── rose-melancholy/...
│   └── cobalt-bone/...
├── tests/
│   ├── golden/                                      # fixture .md → expected HTML
│   │   ├── basic/{*.md, *.expected.html}
│   │   ├── tables/{*.md, *.expected.html}
│   │   ├── lists/{*.md, *.expected.html}
│   │   ├── code/{*.md, *.expected.html}
│   │   ├── math/{*.md, *.expected.html}
│   │   ├── mermaid/{*.md, *.expected.html}
│   │   └── nested/{*.md, *.expected.html}
│   ├── corpus/                                      # full sample documents per scenario
│   │   ├── canonical-theme-sample.md                # used for theme screenshots
│   │   ├── mermaid-heavy.md
│   │   ├── math-heavy.md
│   │   └── long-doc-100kb.md
│   └── screenshots/
│       └── baselines/                               # captured inside e2e container only
├── docker/
│   └── e2e/
│       ├── Dockerfile
│       └── fontconfig.conf
├── packaging/
│   └── linux/
│       ├── dev.previewmd.App.desktop
│       ├── dev.previewmd.App.metainfo.xml
│       ├── dev.previewmd.App.mime.xml
│       └── icons/
│           ├── 16.png 24.png 32.png 48.png 64.png 128.png 256.png
│           └── preview-md.svg
├── appimage/
│   └── AppRun, *.desktop, recipe files
├── flatpak/
│   └── dev.previewmd.App.yml
└── .github/workflows/
    └── ci.yml
```

---

## Phase 0: Pre-flight (owner-driven, no commit)

One-time human verification — not a commit, just a checklist before phase 1.

- [ ] **Step 0.1: Verify host toolchain present**

```bash
rustc --version          # expect 1.75+ stable
cargo --version
just --version           # if absent: cargo install just
docker --version
git --version
```

- [ ] **Step 0.2: Verify `webkit2gtk-4.1` headers installed** (needed for local non-Docker builds)

```bash
pkg-config --exists webkit2gtk-4.1 && echo OK || echo "install libwebkit2gtk-4.1-dev"
```

- [ ] **Step 0.3: Confirm working dir clean**

```bash
git status              # expect clean working tree on master
```

---

## Phase 1: Scaffold (owner-driven)

**Goal:** Cargo workspace + justfile + Tauri smoke window + Docker e2e harness + CI skeleton. By end of phase: `just e2e` opens an empty Tauri window via tauri-driver inside cage in Docker, screenshots it, asserts the CSP header from §3.3 of the spec.

**Files:**
- Create: `Cargo.toml` (workspace root), `justfile`, `scripts/e2e.sh`, `crates/pmd-core/{Cargo.toml,src/lib.rs}`, `crates/pmd-app/{Cargo.toml,tauri.conf.json,build.rs,src/main.rs}`, `crates/pmd-e2e/{Cargo.toml,tests/smoke.rs,tests/helpers/mod.rs}`, `ui/index.html`, `docker/e2e/{Dockerfile,fontconfig.conf}`, `.github/workflows/ci.yml`, `.gitattributes`.

- [ ] **Step 1.1: Initialise workspace `Cargo.toml`**

`Cargo.toml`:

```toml
[workspace]
resolver = "2"
members = ["crates/pmd-core", "crates/pmd-app", "crates/pmd-e2e"]

[workspace.package]
version = "0.1.0"
edition = "2021"
rust-version = "1.75"
license = "MIT OR Apache-2.0"

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
toml = "0.8"
thiserror = "1"
anyhow = "1"
pulldown-cmark = { version = "0.10", default-features = false, features = ["html"] }
ammonia = "4"
tree-sitter = "0.22"
tree-sitter-highlight = "0.22"
notify = "6"
fs2 = "0.4"
xdg = "2.5"
proptest = "1"
tauri = { version = "2", features = ["protocol-asset"] }
tauri-build = "2"
fantoccini = "0.21"
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
```

- [ ] **Step 1.2: Create the three crate skeletons**

```bash
mkdir -p crates/pmd-core/src crates/pmd-app/src crates/pmd-e2e/tests
```

`crates/pmd-core/Cargo.toml`:

```toml
[package]
name = "pmd-core"
version.workspace = true
edition.workspace = true

[dependencies]
serde.workspace = true
toml.workspace = true
thiserror.workspace = true
pulldown-cmark.workspace = true
ammonia.workspace = true

[dev-dependencies]
proptest.workspace = true
```

`crates/pmd-core/src/lib.rs`:

```rust
//! pmd-core: pure markdown pipeline + theme parsing for preview-md.
//! No I/O, no async. Tests live in tests/.

#![forbid(unsafe_code)]
#![warn(clippy::all)]

pub mod parse;
pub mod emit;
pub mod sanitize;
pub mod source_map;
pub mod theme;

pub use emit::RenderResult;
```

(Empty `pub mod` files for `parse.rs`, `emit.rs`, `sanitize/mod.rs`, `source_map.rs`, `theme/mod.rs` — populated in phase 2. Each contains `// placeholder until phase 2` plus the public type stub required by `lib.rs` to compile. For now: `emit.rs` defines `pub struct RenderResult { pub version: u64, pub html: String, pub source_map: Vec<(u32, u32)> }`. All other module files are empty.)

`crates/pmd-app/Cargo.toml`:

```toml
[package]
name = "pmd-app"
version.workspace = true
edition.workspace = true

[lib]
name = "pmd_app_lib"
crate-type = ["staticlib", "cdylib", "rlib"]
path = "src/lib.rs"

[[bin]]
name = "preview-md"
path = "src/main.rs"

[build-dependencies]
tauri-build.workspace = true

[dependencies]
pmd-core = { path = "../pmd-core" }
serde.workspace = true
serde_json.workspace = true
toml.workspace = true
anyhow.workspace = true
tauri.workspace = true
notify.workspace = true
fs2.workspace = true
xdg.workspace = true
```

`crates/pmd-app/build.rs`:

```rust
fn main() {
    tauri_build::build()
}
```

`crates/pmd-app/src/lib.rs` (placeholder, will host IPC handlers in phase 3):

```rust
//! pmd-app: Tauri shell, IPC, state, platform hooks for preview-md.
```

`crates/pmd-app/src/main.rs`:

```rust
fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running preview-md");
}
```

`crates/pmd-e2e/Cargo.toml`:

```toml
[package]
name = "pmd-e2e"
version.workspace = true
edition.workspace = true

[dev-dependencies]
fantoccini.workspace = true
tokio.workspace = true
anyhow.workspace = true
```

- [ ] **Step 1.3: Create `tauri.conf.json` with the spec's CSP and disabled asset protocol scope**

`crates/pmd-app/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "preview-md",
  "version": "0.1.0",
  "identifier": "dev.previewmd.App",
  "build": {
    "frontendDist": "../../ui",
    "devUrl": "http://localhost:1420"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "preview-md",
        "width": 1100,
        "height": 720,
        "decorations": true
      }
    ],
    "security": {
      "csp": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: asset: http://asset.localhost; connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; frame-src 'none'; base-uri 'self'",
      "assetProtocol": {
        "enable": true,
        "scope": []
      }
    }
  }
}
```

- [ ] **Step 1.4: Minimal `ui/index.html` for the smoke run**

`ui/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>preview-md</title>
  </head>
  <body>
    <div id="app">preview-md scaffold ok</div>
  </body>
</html>
```

- [ ] **Step 1.5: Write the `justfile`**

`justfile`:

```just
default:                @just --list

# dev
run:                    cargo run -p pmd-app -j 2
watch:                  cargo watch -j 2 -x 'run -p pmd-app -j 2'

# tests (layered, fastest first)
build:                  cargo build --workspace -j 2
test:                   cargo test --workspace -j 2
test-unit:              cargo test -p pmd-core --lib -j 2
test-prop:              cargo test -p pmd-core --test 'prop_*' -j 2
test-golden:            cargo test -p pmd-core --test golden -j 2
test-theme:             cargo test -p pmd-core --test 'theme_*' -j 2
test-ipc:               cargo test -p pmd-app -j 2
e2e:                    ./scripts/e2e.sh
visual-review:          ./scripts/visual-review.sh
review-and-fix:         ./scripts/review-and-fix.sh

# themes
theme-list:             cargo run -p pmd-app -j 2 -- --list-themes
theme-validate:         ./scripts/theme-validate.sh

# packaging
build-release:          cargo build --release -p pmd-app -j 2
package-appimage:       ./scripts/package-appimage.sh
package-flatpak:        ./scripts/package-flatpak.sh
package-all:            just package-appimage && just package-flatpak

# install (local desktop integration)
install-desktop:        ./scripts/install-desktop-files.sh

# lint / format / pre-PR
fmt:                    cargo fmt --all
lint:                   cargo clippy --workspace --all-targets -j 2 -- -D warnings
check:                  just fmt && just lint && just test && just theme-validate
```

- [ ] **Step 1.6: Verify the empty scaffold compiles**

Run: `just build`
Expected: builds successfully (Tauri build script fetches no resources; the empty `index.html` is enough).

- [ ] **Step 1.7: Write the Docker e2e harness**

`docker/e2e/Dockerfile`:

```dockerfile
FROM rust:1.75-bookworm

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        libwebkit2gtk-4.1-dev libsoup-3.0-dev \
        cage seatd dbus xwayland \
        fonts-inter fonts-jetbrains-mono fonts-source-serif-pro \
        fonts-noto fonts-noto-mono fonts-dejavu \
        fontconfig libfontconfig1-dev \
        pkg-config build-essential \
        libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
        ca-certificates curl xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Pin fontconfig for screenshot determinism
COPY docker/e2e/fontconfig.conf /etc/fonts/local.conf

# Install tauri-driver
RUN cargo install tauri-driver --locked

# Build inputs
WORKDIR /work
COPY . /work

# Determinism env (applied at runtime via cmd, but kept here for clarity)
ENV WEBKIT_DISABLE_COMPOSITING_MODE=1 \
    LIBGL_ALWAYS_SOFTWARE=1 \
    WEBKIT_FORCE_SANDBOX=0

CMD ["bash", "-c", "cage -- tauri-driver --port 4444 --binary /work/target/release/preview-md"]
```

`docker/e2e/fontconfig.conf`:

```xml
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <match target="font"><edit name="antialias" mode="assign"><bool>true</bool></edit></match>
  <match target="font"><edit name="hinting" mode="assign"><bool>false</bool></edit></match>
  <match target="font"><edit name="hintstyle" mode="assign"><const>hintnone</const></edit></match>
  <match target="font"><edit name="rgba" mode="assign"><const>none</const></edit></match>
</fontconfig>
```

- [ ] **Step 1.8: Write `scripts/e2e.sh`**

`scripts/e2e.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

NETWORK_MODE="${PMD_E2E_NETWORK:-host}"
case "$NETWORK_MODE" in
  host)   NET_ARGS=(--network=host) ;;
  bridge) NET_ARGS=(--network=bridge -p 4444:4444) ;;
  *) echo "PMD_E2E_NETWORK must be host|bridge"; exit 2 ;;
esac

cargo build --release -p pmd-app -j 2

docker build -f docker/e2e/Dockerfile -t preview-md-e2e:dev .

CID=$(docker run -d --rm "${NET_ARGS[@]}" \
  -v "$PWD/target/release/preview-md:/work/target/release/preview-md:ro" \
  -v "$PWD/tests:/work/tests" \
  -v "$PWD/ui:/work/ui:ro" \
  -v "$PWD/themes:/work/themes:ro" \
  preview-md-e2e:dev)

trap 'docker stop "$CID" >/dev/null 2>&1 || true' EXIT

# Poll until tauri-driver is up
for _ in $(seq 1 60); do
  if curl -sf http://localhost:4444/status >/dev/null; then break; fi
  sleep 0.5
done

cargo test -p pmd-e2e -j 2 -- --nocapture
```

```bash
chmod +x scripts/e2e.sh
```

- [ ] **Step 1.9: Write the first e2e helper + smoke test**

`crates/pmd-e2e/tests/helpers/mod.rs`:

```rust
use anyhow::Result;
use fantoccini::{Client, ClientBuilder};
use serde_json::json;

pub async fn new_session() -> Result<Client> {
    let caps = json!({
        "tauri:options": {
            "application": "/work/target/release/preview-md"
        }
    });
    let client = ClientBuilder::native()
        .capabilities(caps.as_object().unwrap().clone())
        .connect("http://localhost:4444")
        .await?;
    Ok(client)
}

pub async fn screenshot_to(client: &Client, path: &str) -> Result<()> {
    let png = client.screenshot().await?;
    std::fs::create_dir_all(std::path::Path::new(path).parent().unwrap())?;
    std::fs::write(path, png)?;
    Ok(())
}
```

`crates/pmd-e2e/tests/smoke.rs`:

```rust
mod helpers;
use helpers::{new_session, screenshot_to};

#[tokio::test]
async fn smoke_window_opens_and_csp_is_set() {
    let c = new_session().await.expect("session");
    // Window opens and renders the placeholder text.
    let body = c.find(fantoccini::Locator::Css("#app")).await.expect("find #app");
    let text = body.text().await.expect("text");
    assert!(text.contains("preview-md scaffold ok"), "got: {text}");

    // Screenshot
    screenshot_to(&c, "/work/tests/screenshots/run-smoke/window.png").await.expect("screenshot");

    // CSP: read the response headers via the WebDriver `executeScript` (Tauri exposes them via meta)
    // For Tauri's runtime-synthesised CSP we assert the presence of the spec's required directives via the document.
    let csp_meta: String = c.execute(
        r#"const m = document.querySelector('meta[http-equiv="Content-Security-Policy"]'); return m ? m.content : (window.__TAURI_CSP__ || '');"#,
        vec![]).await.expect("eval").as_str().unwrap_or("").to_string();
    // The asserted directives come from spec §3.3.
    for needle in ["default-src 'self'", "script-src 'self'", "connect-src 'self' ipc:", "object-src 'none'", "frame-src 'none'"] {
        assert!(csp_meta.contains(needle), "CSP missing `{needle}` (got `{csp_meta}`)");
    }

    c.close().await.expect("close");
}
```

- [ ] **Step 1.10: Run the smoke test through `just e2e`**

Run: `just e2e`
Expected: image at `tests/screenshots/run-smoke/window.png`; test passes.

If the CSP test fails because Tauri synthesises CSP at the response-header level (not as a meta tag), update `smoke.rs`'s `c.execute` script to fetch via `executeScript` over `fetch('/').then(r => r.headers.get('content-security-policy'))` — see spec §3.3.

- [ ] **Step 1.11: GitHub Actions CI skeleton**

`.github/workflows/ci.yml`:

```yaml
name: ci
on: [push, pull_request]
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - run: sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.1-dev libsoup-3.0-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
      - run: cargo fmt --all -- --check
      - run: cargo clippy --workspace --all-targets -j 2 -- -D warnings
      - run: cargo test --workspace -j 2 --exclude pmd-e2e
  e2e:
    runs-on: ubuntu-latest
    needs: check
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - run: sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.1-dev libsoup-3.0-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
      - run: just e2e
        env: { PMD_E2E_NETWORK: bridge }
```

- [ ] **Step 1.12: Run `just check && just e2e` to verify**

Run: `just check && just e2e`
Expected: all green.

- [ ] **Step 1.13: Owner gate** (dual-model visual review + `/ccc-review-cx`)

Run: `just visual-review` (the script does not exist yet — for phase 1 the screenshot bundle is tiny; skip if no screenshots differ from baseline). Then run `/ccc-review-cx` over `git status` (no commits yet on this branch).

- [ ] **Step 1.14: Commit phase 1**

```bash
git add Cargo.toml justfile scripts/e2e.sh crates/ ui/ docker/ .github/
git commit -m "$(cat <<'EOF'
phase 1: workspace scaffold + smoke e2e

Cargo workspace with pmd-core / pmd-app / pmd-e2e; justfile index;
Tauri shell with spec CSP and assetProtocol enabled (empty scope);
Docker e2e harness with cage + WebKitGTK + pinned fonts; smoke test
asserts the CSP includes required directives. CI skeleton runs
check + e2e (bridge networking).

Spec refs: §3, §3.3, §9, §16 (slice 1).
EOF
)"
```

- [ ] **Step 1.15: Run the `postcommit-status-and-continue` skill and continue.**

---

## Phase 2: pmd-core core pipeline (contributor-okay)

**Goal:** Pure-Rust markdown pipeline complete. Parse → emit HTML with `data-src-start`/`data-src-end` → sanitize. Theme manifest parser + validator + contrast check + completeness test. Full unit, property, golden, theme test coverage. No UI, no IPC.

**Files:**
- Create: `crates/pmd-core/src/{parse.rs,emit.rs,sanitize/{mod.rs,allowlist.rs},source_map.rs,theme/{mod.rs,schema.rs,parse.rs,validate.rs,mix.rs}}`, `crates/pmd-core/tests/{golden.rs,prop_render.rs,prop_source_map.rs,theme_completeness.rs,theme_validate.rs}`.
- Create: `tests/golden/{basic,tables,lists,code,math,mermaid,nested}/*.{md,expected.html}` (at least 4 fixtures per directory).
- Create: minimal `themes/github-light/` and `themes/github-dark/` for the completeness test (full palettes ship in phase 6b; here we need only enough to exercise the loader).

- [ ] **Step 2.1: TDD — failing test for the simplest render**

`tests/golden/basic/01-paragraph.md`:

```markdown
Hello, world.
```

`tests/golden/basic/01-paragraph.expected.html`:

```html
<p data-src-start="1" data-src-end="1">Hello, world.</p>
```

`crates/pmd-core/tests/golden.rs`:

```rust
use pmd_core::emit;
use std::path::Path;

fn normalize(s: &str) -> String { s.split_whitespace().collect::<Vec<_>>().join(" ") }

fn golden_one(dir: &str, name: &str) {
    let md = std::fs::read_to_string(format!("../../tests/golden/{dir}/{name}.md")).unwrap();
    let want = std::fs::read_to_string(format!("../../tests/golden/{dir}/{name}.expected.html")).unwrap();
    let got = emit::render_string(&md);
    assert_eq!(normalize(&got.html), normalize(&want), "{dir}/{name}");
}

#[test] fn basic_paragraph() { golden_one("basic", "01-paragraph"); }
```

- [ ] **Step 2.2: Run — expect failure**

Run: `cargo test -p pmd-core --test golden -j 2`
Expected: FAIL (function `render_string` not defined).

- [ ] **Step 2.3: Minimal `render_string` to make it pass**

`crates/pmd-core/src/emit.rs`:

```rust
use pulldown_cmark::{html, Options, Parser};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RenderResult {
    pub version: u64,
    pub html: String,
    pub source_map: Vec<(u32, u32)>,
}

/// Test-only helper for golden tests. Real entry point is `render(version, md)` in phase 3.
pub fn render_string(md: &str) -> RenderResult {
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_FOOTNOTES);
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TASKLISTS);
    opts.insert(Options::ENABLE_SMART_PUNCTUATION);

    let parser = Parser::new_ext(md, opts);
    // Phase 2.4 replaces this with a custom event-walker that emits data-src-start/end.
    let mut out = String::new();
    html::push_html(&mut out, parser);
    // Temporary: wrap the single paragraph in a data-src-start/end-ish attribute for the green test.
    let html = out.trim().to_string();
    RenderResult { version: 0, html, source_map: vec![(1, 1)] }
}
```

Run: `cargo test -p pmd-core --test golden -j 2`
Expected: FAIL still — the canonical output has `data-src-start/end` attributes our minimal renderer does not emit. Continue to the next step.

- [ ] **Step 2.4: Custom event walker that emits `data-src-start`/`data-src-end`**

Rewrite `crates/pmd-core/src/emit.rs` with a hand-rolled walker over `Parser::new_ext` events that tracks the byte offset → line mapping and emits `data-src-start="L"`/`data-src-end="L"` on every block-level Start event's emitted open tag. The mapping is computed once at the top of `render_string` by iterating `md.match_indices('\n')`.

Pseudocode (write to the file):

```rust
fn byte_to_line(md: &str) -> impl Fn(usize) -> u32 + '_ {
    let starts: Vec<usize> = std::iter::once(0)
        .chain(md.match_indices('\n').map(|(i, _)| i + 1))
        .collect();
    move |b| {
        // 1-based line for the byte offset b
        starts.partition_point(|&s| s <= b) as u32
    }
}

pub fn render_string(md: &str) -> RenderResult {
    use pulldown_cmark::{Event, Tag, TagEnd, Parser, Options};
    let to_line = byte_to_line(md);
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_TABLES | Options::ENABLE_TASKLISTS | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_FOOTNOTES);

    let parser = Parser::new_ext(md, opts).into_offset_iter();

    let mut html = String::new();
    let mut source_map = Vec::<(u32, u32)>::new();
    let mut block_stack: Vec<(u32, usize)> = Vec::new(); // (start_line, html_position_of_open_tag)

    for (event, range) in parser {
        match event {
            Event::Start(tag) => {
                let line = to_line(range.start);
                let open_pos = html.len();
                emit_open_tag(&mut html, &tag, line); // writes e.g. `<p data-src-start="3" data-src-end="">`
                block_stack.push((line, open_pos));
            }
            Event::End(tag_end) => {
                if let Some((start_line, open_pos)) = block_stack.pop() {
                    let end_line = to_line(range.end.saturating_sub(1));
                    // Backfill data-src-end on the open tag, in-place
                    let placeholder = "data-src-end=\"\"";
                    if let Some(idx) = html[open_pos..].find(placeholder) {
                        let abs = open_pos + idx + "data-src-end=\"".len();
                        html.insert_str(abs, &end_line.to_string());
                    }
                    source_map.push((start_line, end_line));
                    emit_close_tag(&mut html, &tag_end);
                }
            }
            Event::Text(t)  => html.push_str(&escape::html_escape(&t)),
            Event::Code(t)  => { html.push_str("<code>"); html.push_str(&escape::html_escape(&t)); html.push_str("</code>"); }
            Event::SoftBreak => html.push(' '),
            Event::HardBreak => html.push_str("<br>"),
            Event::Html(_) | Event::InlineHtml(_) => { /* raw HTML stripped per spec §4 */ }
            _ => {}
        }
    }
    RenderResult { version: 0, html, source_map }
}
```

Open/close tag emitters live in `pmd-core/src/emit/tags.rs` (or inline in `emit.rs`); they map each `Tag::*` to an `<element data-src-start="L" data-src-end="" class="pmd-…">…</element>` shape per spec §4.

Add `escape` helper at `crates/pmd-core/src/escape.rs` (use the `html-escape` crate or a 20-line hand-roll covering `<>&"'`).

- [ ] **Step 2.5: Run golden — expect pass**

Run: `cargo test -p pmd-core --test golden -j 2`
Expected: PASS.

- [ ] **Step 2.6: Add 4 fixtures per category and a parametric loop**

Add `tests/golden/basic/{02-headings,03-emphasis,04-link}.{md,expected.html}`, then expand the same for `tables`, `lists`, `code`, `math`, `mermaid`, `nested`. The loop:

```rust
fn list_fixtures() -> Vec<(String, String)> {
    let mut out = Vec::new();
    for dir in ["basic", "tables", "lists", "code", "math", "mermaid", "nested"] {
        let d = format!("../../tests/golden/{dir}");
        for f in std::fs::read_dir(&d).unwrap().flatten() {
            let name = f.file_name().into_string().unwrap();
            if let Some(stem) = name.strip_suffix(".md") {
                out.push((dir.to_string(), stem.to_string()));
            }
        }
    }
    out
}

#[test] fn all_goldens() {
    for (d, n) in list_fixtures() { golden_one(&d, &n); }
}
```

Run after each fixture batch: `just test-golden`. Add the implementation in `emit.rs` for whichever GFM construct doesn't yet round-trip.

- [ ] **Step 2.7: Property tests for source-map invariants**

`crates/pmd-core/tests/prop_source_map.rs`:

```rust
use proptest::prelude::*;
use pmd_core::emit::render_string;

proptest! {
    #[test]
    fn source_map_lines_are_monotonic(s in "(?s)[\\PC\n]{0,2048}") {
        let r = render_string(&s);
        // ranges are sorted by start_line
        let mut last = 0u32;
        for (a, b) in &r.source_map { prop_assert!(*a >= last); prop_assert!(*b >= *a); last = *a; }
    }

    #[test]
    fn sanitizer_never_emits_script(s in "(?s)[\\PC\n]{0,2048}") {
        let r = render_string(&s);
        let cleaned = pmd_core::sanitize::clean(&r.html);
        prop_assert!(!cleaned.to_ascii_lowercase().contains("<script"));
    }
}
```

Run: `just test-prop`. Failures here typically point at missing markdown coverage; add to the emitter until green.

- [ ] **Step 2.8: Implement `sanitize`**

`crates/pmd-core/src/sanitize/allowlist.rs`:

```rust
use std::collections::HashSet;

pub fn build() -> ammonia::Builder<'static> {
    let tags: HashSet<&str> = [
        "a","p","div","span","em","strong","s","del","ins","sub","sup",
        "h1","h2","h3","h4","h5","h6",
        "ul","ol","li",
        "blockquote","hr","br",
        "table","thead","tbody","tr","th","td",
        "code","pre","kbd","samp",
        "img","figure","figcaption",
        "section",
    ].into_iter().collect();

    let mut allowed_attrs: std::collections::HashMap<&str, HashSet<&str>> = std::collections::HashMap::new();
    let global: HashSet<&str> = ["class","id","data-src-start","data-src-end"].into_iter().collect();
    for &t in tags.iter() { allowed_attrs.insert(t, global.clone()); }
    allowed_attrs.get_mut("a").unwrap().extend(["href","title","rel"]);
    allowed_attrs.get_mut("img").unwrap().extend(["src","alt","title","width","height"]);
    allowed_attrs.get_mut("td").unwrap().extend(["colspan","rowspan","scope"]);
    allowed_attrs.get_mut("th").unwrap().extend(["colspan","rowspan","scope"]);
    allowed_attrs.get_mut("li").unwrap().extend(["value"]);

    let mut b = ammonia::Builder::new();
    b.tags(tags);
    b.tag_attributes(allowed_attrs);
    b.url_schemes(["http","https","mailto","data","asset"].into_iter().collect());
    b.add_generic_attribute_prefixes(["data-"]);
    b
}
```

`crates/pmd-core/src/sanitize/mod.rs`:

```rust
pub mod allowlist;
use std::sync::OnceLock;

static BUILDER: OnceLock<ammonia::Builder<'static>> = OnceLock::new();

pub fn clean(html: &str) -> String {
    let b = BUILDER.get_or_init(|| allowlist::build());
    b.clean(html).to_string()
}
```

Wire into `emit::render_string`: `html = pmd_core::sanitize::clean(&html);` before constructing `RenderResult`.

Run: `just test && just test-prop`. Expected: all green.

- [ ] **Step 2.9: Theme `schema.rs` — required vs optional keys (canonical)**

`crates/pmd-core/src/theme/schema.rs`:

```rust
use std::collections::HashSet;

pub fn required_palette_keys() -> HashSet<&'static str> {
    [
        // surfaces
        "bg","bg_elevated","fg","fg_muted","accent","link","border",
        // editor
        "selection_bg","selection_fg","focus_ring","caret","scrollbar_thumb","scrollbar_track",
        // markdown
        "inline_code_bg","inline_code_fg","code_block_bg","code_block_fg","code_block_border",
        "blockquote_bar","blockquote_fg","hr",
        "table_header_bg","table_row_alt","table_border",
        "admonition_note","admonition_warn","admonition_tip",
        "kbd_bg","kbd_fg","kbd_border",
        "link_hover","link_visited","image_caption",
        // mermaid core
        "mermaid_primary","mermaid_primary_text","mermaid_secondary","mermaid_tertiary","mermaid_line",
    ].into_iter().collect()
}

pub fn optional_palette_keys() -> HashSet<&'static str> {
    [
        "h1","h2","h3","h4","h5","h6",
        "mermaid_edge_label_bg","mermaid_cluster_bg","mermaid_note_bg",
        "mermaid_note_border","mermaid_actor_bg","mermaid_error",
    ].into_iter().collect()
}

pub fn required_syntax_keys() -> HashSet<&'static str> {
    ["keyword","string","number","function","type","comment","operator","punctuation","variable","constant"]
        .into_iter().collect()
}
```

- [ ] **Step 2.10: Theme `parse.rs`, `validate.rs`, `mix.rs`**

`crates/pmd-core/src/theme/parse.rs`:

```rust
use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Deserialize)]
pub struct Theme {
    pub meta: Meta,
    pub palette: Palette,
    #[serde(default)]
    pub fonts: Fonts,
}
#[derive(Debug, Clone, Deserialize)]
pub struct Meta {
    pub name: String, pub slug: String, pub author: String, pub mode: String, pub version: String,
    #[serde(default)] pub inspired_by: Option<InspiredBy>,
    #[serde(default)] pub notes: Option<Notes>,
}
#[derive(Debug, Clone, Deserialize)] pub struct InspiredBy { pub work: Option<String>, pub character: Option<String> }
#[derive(Debug, Clone, Deserialize)] pub struct Notes { pub rationale: Option<String> }
#[derive(Debug, Clone, Deserialize)]
pub struct Palette {
    #[serde(flatten)] pub colours: BTreeMap<String, String>,
    #[serde(default)] pub syntax: BTreeMap<String, String>,
}
#[derive(Debug, Clone, Default, Deserialize)] pub struct Fonts {
    pub ui: Option<String>, pub mono: Option<String>, pub serif: Option<String>,
    pub heading: Option<String>, pub body: Option<String>,
    #[serde(default)] pub fallback: BTreeMap<String, Vec<String>>,
    #[serde(default)] pub features: BTreeMap<String, toml::Value>,
}

pub fn parse_manifest(s: &str) -> Result<Theme, toml::de::Error> {
    toml::from_str(s)
}
```

`crates/pmd-core/src/theme/mix.rs`:

```rust
pub fn parse_hex(h: &str) -> Option<(u8,u8,u8)> {
    let h = h.trim_start_matches('#');
    if h.len() != 6 { return None; }
    let r = u8::from_str_radix(&h[0..2], 16).ok()?;
    let g = u8::from_str_radix(&h[2..4], 16).ok()?;
    let b = u8::from_str_radix(&h[4..6], 16).ok()?;
    Some((r,g,b))
}

/// sRGB component-wise linear interpolation; 8-bit; round to nearest.
pub fn mix(a: (u8,u8,u8), b: (u8,u8,u8), t: f64) -> (u8,u8,u8) {
    let lerp = |x: u8, y: u8| ((x as f64) * (1.0 - t) + (y as f64) * t).round() as u8;
    (lerp(a.0, b.0), lerp(a.1, b.1), lerp(a.2, b.2))
}

pub fn to_hex(c: (u8,u8,u8)) -> String { format!("#{:02x}{:02x}{:02x}", c.0, c.1, c.2) }
```

`crates/pmd-core/src/theme/validate.rs`:

```rust
use super::{parse::Theme, schema};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ValidationError {
    #[error("missing required palette keys: {0:?}")] MissingPalette(Vec<String>),
    #[error("missing required syntax keys: {0:?}")] MissingSyntax(Vec<String>),
    #[error("invalid hex colour for key `{key}`: `{value}`")] BadHex { key: String, value: String },
    #[error("contrast {ratio:.2}:1 fails AA on pair `{a}`/`{b}` (needs {min}:1)")]
    Contrast { a: String, b: String, ratio: f64, min: f64 },
}

pub fn validate(t: &Theme) -> Result<(), ValidationError> {
    let req = schema::required_palette_keys();
    let missing: Vec<String> = req.iter()
        .filter(|k| !t.palette.colours.contains_key(**k))
        .map(|s| s.to_string()).collect();
    if !missing.is_empty() { return Err(ValidationError::MissingPalette(missing)); }

    let sreq = schema::required_syntax_keys();
    let smissing: Vec<String> = sreq.iter()
        .filter(|k| !t.palette.syntax.contains_key(**k))
        .map(|s| s.to_string()).collect();
    if !smissing.is_empty() { return Err(ValidationError::MissingSyntax(smissing)); }

    // Hex shape
    for (k, v) in &t.palette.colours {
        if super::mix::parse_hex(v).is_none() { return Err(ValidationError::BadHex { key: k.clone(), value: v.clone() }); }
    }

    // WCAG checks
    let text_pairs = [
        ("fg","bg",4.5), ("link","bg",4.5), ("fg_muted","bg",4.5),
        ("inline_code_fg","inline_code_bg",4.5), ("code_block_fg","code_block_bg",4.5),
        ("selection_fg","selection_bg",4.5),
    ];
    let nontext_pairs = [
        ("accent","bg",3.0), ("focus_ring","bg",3.0),
        ("selection_bg","bg",3.0), ("border","bg",3.0),
    ];
    for (a,b,min) in text_pairs.iter().chain(nontext_pairs.iter()) {
        let ratio = contrast_ratio(&t.palette.colours[*a], &t.palette.colours[*b]);
        if ratio < *min {
            return Err(ValidationError::Contrast { a: (*a).to_string(), b: (*b).to_string(), ratio, min: *min });
        }
    }
    Ok(())
}

fn relative_luminance(hex: &str) -> f64 {
    let (r,g,b) = super::mix::parse_hex(hex).unwrap();
    fn ch(v: u8) -> f64 {
        let s = (v as f64)/255.0;
        if s <= 0.03928 { s/12.92 } else { ((s+0.055)/1.055).powf(2.4) }
    }
    0.2126*ch(r) + 0.7152*ch(g) + 0.0722*ch(b)
}
fn contrast_ratio(a: &str, b: &str) -> f64 {
    let la = relative_luminance(a); let lb = relative_luminance(b);
    let (l1, l2) = if la > lb { (la, lb) } else { (lb, la) };
    (l1 + 0.05) / (l2 + 0.05)
}
```

`crates/pmd-core/src/theme/mod.rs`:

```rust
pub mod schema;
pub mod parse;
pub mod validate;
pub mod mix;

pub use parse::{Theme, parse_manifest};
pub use validate::{validate, ValidationError};
```

- [ ] **Step 2.11: Bare minimum manifest files for GitHub Light and GitHub Dark**

`themes/github-light/manifest.toml`: full 48 required palette keys, 10 syntax keys, no optional keys (let derivation handle mermaid optionals). Use [GitHub's own primer-css palette](https://primer.style/foundations/primitives/color) for values — they pass AA out of the box. Pair with `themes/github-dark/manifest.toml`.

`themes/github-light/theme.css`: empty (or single `:root {}` placeholder). Sized in phase 4/6.

- [ ] **Step 2.12: Theme tests**

`crates/pmd-core/tests/theme_validate.rs`:

```rust
use pmd_core::theme::{parse_manifest, validate};

fn load(slug: &str) -> pmd_core::theme::Theme {
    let path = format!("../../themes/{slug}/manifest.toml");
    let s = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    parse_manifest(&s).unwrap_or_else(|e| panic!("parse {slug}: {e}"))
}

#[test] fn github_light_validates() { validate(&load("github-light")).unwrap(); }
#[test] fn github_dark_validates()  { validate(&load("github-dark")).unwrap();  }
```

`crates/pmd-core/tests/theme_completeness.rs`:

```rust
use pmd_core::theme::{parse_manifest, schema};

fn slugs() -> Vec<String> {
    std::fs::read_dir("../../themes").unwrap().flatten()
        .filter_map(|e| e.file_name().into_string().ok()).collect()
}

#[test]
fn every_bundled_theme_has_required_keys() {
    let req = schema::required_palette_keys();
    let sreq = schema::required_syntax_keys();
    for slug in slugs() {
        let s = std::fs::read_to_string(format!("../../themes/{slug}/manifest.toml")).unwrap();
        let t = parse_manifest(&s).unwrap();
        for k in &req { assert!(t.palette.colours.contains_key(*k), "{slug} missing {k}"); }
        for k in &sreq { assert!(t.palette.syntax.contains_key(*k), "{slug} missing syntax.{k}"); }
    }
}
```

Run: `just test`
Expected: all green.

- [ ] **Step 2.13: Phase commit**

```bash
git add crates/pmd-core themes/github-light themes/github-dark tests/golden
git commit -m "$(cat <<'EOF'
phase 2: pmd-core pipeline (parse/emit/sanitize/source-map) + theme schema

Parser → custom HTML emitter with data-src-start/data-src-end on every
block-level element → ammonia sanitizer with pinned allowlist. Source
map ranges, golden corpus (basic/tables/lists/code/math/mermaid/nested),
proptests (sanitizer-never-emits-script, source-map monotonic).

Theme subsystem: schema (canonical required vs optional), parse, validate
(missing-key + bad-hex + WCAG AA text 4.5:1 + non-text 3:1), sRGB
component-wise mix(). GitHub Light + GitHub Dark manifests bundled and
pass validation.

Spec refs: §3.1, §3.3 (canonical pipeline), §4, §7.1, §7.2.
EOF
)"
```

- [ ] **Step 2.14: Run the `postcommit-status-and-continue` skill and continue.**

---

## Phase 3: pmd-app shell + read-only preview (owner-driven)

**Goal:** First user-visible build. Read-only preview mode only. File open (dialog + recents + CLI argv). Render IPC with version + back-pressure. Asset path policy enforced. GitHub Light/Dark themes selectable.

**Files:**
- Create: `crates/pmd-app/src/{cmd/{mod.rs,render.rs,file.rs,theme.rs,settings.rs},state/{mod.rs,settings.rs,recents.rs},path_scope.rs,cli.rs}`
- Modify: `crates/pmd-app/src/main.rs` and `crates/pmd-app/src/lib.rs` to register IPC commands and wire startup.
- Create: `ui/src/{main.ts,preview.ts,ipc.ts,theme_apply.ts}`, `ui/styles/base.css`.
- Create: `crates/pmd-app/tests/{cmd_render.rs,cmd_file.rs,cmd_theme.rs}`.

- [ ] **Step 3.1: TDD — IPC functional test for the render command**

`crates/pmd-app/tests/cmd_render.rs`:

```rust
use pmd_app_lib::cmd::render::render_cmd;

#[tokio::test]
async fn render_returns_versioned_html() {
    let r = render_cmd(7, "hello".into()).await.unwrap();
    assert_eq!(r.version, 7);
    assert!(r.html.contains("hello"));
    assert!(r.html.contains("data-src-start"));
}
```

- [ ] **Step 3.2: Implement `render_cmd`**

`crates/pmd-app/src/cmd/render.rs`:

```rust
use anyhow::Result;
use pmd_core::emit::{render_string, RenderResult};

#[tauri::command]
pub async fn render_cmd(version: u64, markdown: String) -> Result<RenderResult, String> {
    let mut r = render_string(&markdown);
    r.version = version;
    Ok(r)
}
```

Run: `just test-ipc`
Expected: PASS.

- [ ] **Step 3.3: Render back-pressure in the JS layer**

`ui/src/ipc.ts`:

```typescript
import { invoke } from "@tauri-apps/api/core";
import type { RenderResult } from "./types";

let nextVersion = 0;
let inFlight: Promise<RenderResult> | null = null;
let pending: { version: number; markdown: string } | null = null;
let latestApplied = -1;

export async function requestRender(markdown: string, onApplied: (r: RenderResult) => void) {
  const version = ++nextVersion;
  if (inFlight) {
    pending = { version, markdown };
    return;
  }
  while (true) {
    const v = version;
    inFlight = invoke<RenderResult>("render_cmd", { version: v, markdown });
    const r = await inFlight;
    inFlight = null;
    if (r.version > latestApplied) { latestApplied = r.version; onApplied(r); }
    if (!pending) break;
    const next = pending; pending = null;
    // jump to newest
    return requestRender(next.markdown, onApplied);
  }
}
```

- [ ] **Step 3.4: Settings + recents state with flock RMW**

`crates/pmd-app/src/state/settings.rs`:

```rust
use anyhow::Result;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::{fs::OpenOptions, io::{Read, Seek, SeekFrom, Write}, path::PathBuf};

#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct Settings {
    pub active_theme: Option<String>,
    pub light_theme: Option<String>,
    pub dark_theme: Option<String>,
    pub auto_switch: bool,
    pub default_mode: Option<String>,
}

pub fn path() -> PathBuf {
    let base = xdg::BaseDirectories::with_prefix("preview-md").unwrap();
    base.place_config_file("state.toml").unwrap()
}

/// Read-modify-write under flock. `merge` receives the on-disk Settings
/// (defaulted if absent) and returns the new Settings to write.
pub fn rmw<F: FnOnce(Settings) -> Settings>(merge: F) -> Result<()> {
    if let Some(parent) = path().parent() { std::fs::create_dir_all(parent)?; }
    let mut f = OpenOptions::new().read(true).write(true).create(true).open(path())?;
    f.lock_exclusive()?;
    let mut s = String::new(); f.read_to_string(&mut s)?;
    let current: Settings = if s.is_empty() { Settings::default() } else { toml::from_str(&s)? };
    let next = merge(current);
    let out = toml::to_string_pretty(&next)?;
    f.set_len(0)?; f.seek(SeekFrom::Start(0))?; f.write_all(out.as_bytes())?; f.sync_all()?;
    fs2::FileExt::unlock(&f)?;
    Ok(())
}
```

`crates/pmd-app/src/state/recents.rs`: same shape but the file is `recents.toml`, stores `Vec<PathBuf>`, capped at 20, LRU on read.

- [ ] **Step 3.5: Path-scope guard**

`crates/pmd-app/src/path_scope.rs`:

```rust
use std::{collections::HashSet, path::{Path, PathBuf}, sync::Mutex};

pub struct PathScope { allowed: Mutex<HashSet<PathBuf>> }
impl PathScope {
    pub fn new() -> Self { Self { allowed: Mutex::new(HashSet::new()) } }
    pub fn allow(&self, p: &Path) -> std::io::Result<PathBuf> {
        let canon = std::fs::canonicalize(p)?;
        self.allowed.lock().unwrap().insert(canon.clone());
        Ok(canon)
    }
    pub fn check(&self, p: &Path) -> bool {
        match std::fs::canonicalize(p) {
            Ok(c) => self.allowed.lock().unwrap().contains(&c),
            Err(_) => false,
        }
    }
}
```

- [ ] **Step 3.6: File IPC commands respecting the scope**

`crates/pmd-app/src/cmd/file.rs`:

```rust
use serde::Serialize;
use std::path::PathBuf;

#[derive(Serialize)]
pub struct FileBuffer { pub path: PathBuf, pub contents: String }

#[tauri::command]
pub async fn open_file(state: tauri::State<'_, crate::AppState>, path: PathBuf) -> Result<FileBuffer, String> {
    if !state.scope.check(&path) {
        return Err(format!("path not in active scope: {}", path.display()));
    }
    let contents = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    crate::state::recents::push(&path).map_err(|e| e.to_string())?;
    Ok(FileBuffer { path, contents })
}

#[tauri::command]
pub async fn save_file(state: tauri::State<'_, crate::AppState>, path: PathBuf, contents: String) -> Result<(), String> {
    if !state.scope.check(&path) { return Err("path not in active scope".into()); }
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}
```

Open/Save dialogs (in `main.rs`) push their results into the scope via `scope.allow(&picked_path)` before returning to JS.

- [ ] **Step 3.7: CLI argv → scope + initial open**

`crates/pmd-app/src/cli.rs`:

```rust
use std::path::PathBuf;

pub struct InitialOpen { pub path: Option<PathBuf> }

pub fn parse_argv(scope: &crate::path_scope::PathScope) -> InitialOpen {
    let mut args = std::env::args().skip(1).peekable();
    let mut paths: Vec<PathBuf> = args.filter(|a| !a.starts_with("--")).map(PathBuf::from).collect();
    if paths.is_empty() { return InitialOpen { path: None }; }

    // Fan-out: more than one path → spawn one child per path and exit ourselves.
    if paths.len() > 1 {
        for p in &paths {
            std::process::Command::new(std::env::current_exe().unwrap())
                .arg(p).spawn().ok();
        }
        std::process::exit(0);
    }
    let p = paths.remove(0);
    let _ = scope.allow(&p);
    InitialOpen { path: Some(p) }
}
```

(The spec's "parent always exits after spawning" semantic from §5.3 is: `if paths.len() >= 1` spawn one child per path *including the first*, then exit. The simpler form above keeps the parent for the single-path case for v1; revisit if multi-instance integration tests show a divergence — track as a small note in phase 8.)

- [ ] **Step 3.8: AppState plumbing and command registration**

`crates/pmd-app/src/lib.rs`:

```rust
pub mod cmd;
pub mod state;
pub mod path_scope;
pub mod cli;

pub struct AppState {
    pub scope: path_scope::PathScope,
}
```

`crates/pmd-app/src/main.rs`:

```rust
use pmd_app_lib::{AppState, cli, cmd, path_scope::PathScope};

fn main() {
    let scope = PathScope::new();
    let initial = cli::parse_argv(&scope);

    tauri::Builder::default()
        .manage(AppState { scope })
        .invoke_handler(tauri::generate_handler![
            cmd::render::render_cmd,
            cmd::file::open_file,
            cmd::file::save_file,
            cmd::theme::list_themes,
            cmd::theme::set_theme,
            cmd::settings::get_settings,
            cmd::settings::set_default_mode,
            cmd::settings::set_theme_pair,
            cmd::settings::set_auto_switch,
            cmd::settings::get_recent_files,
            cmd::settings::add_recent_file,
        ])
        .setup(move |_app| {
            if let Some(_p) = initial.path {
                // Phase 4: emit a startup event the webview listens to and opens the file.
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running preview-md");
}
```

- [ ] **Step 3.9: Theme IPC + injection**

`crates/pmd-app/src/cmd/theme.rs`: `list_themes()` scans `themes/` and `~/.config/preview-md/themes/`, parses each manifest, returns `Vec<ThemeInfo>` with `{slug, name, mode, inspired_by}`. `set_theme(slug)` reads the theme's `theme.css`, generates the `:root { … }` block from palette, returns `ThemeBundle { css, mermaid_vars }`.

`ui/src/theme_apply.ts`:

```typescript
export function applyTheme(bundle: { css: string; mermaid_vars: Record<string,string> }) {
  let style = document.getElementById("pmd-theme") as HTMLStyleElement | null;
  if (!style) { style = document.createElement("style"); style.id = "pmd-theme"; document.head.appendChild(style); }
  style.textContent = bundle.css;
  // Re-render existing mermaid/katex on theme change — implemented in phase 6a/6b.
}
```

- [ ] **Step 3.10: Preview pane (read-only mode)**

`ui/src/preview.ts`:

```typescript
import { requestRender } from "./ipc";

export function mountPreview(el: HTMLElement) {
  return (md: string) => requestRender(md, (r) => { el.innerHTML = r.html; });
}
```

`ui/index.html` expanded:

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>preview-md</title><link rel="stylesheet" href="./styles/base.css"></head>
  <body>
    <main id="preview-pane" class="pmd-preview"></main>
    <script type="module" src="./src/main.ts"></script>
  </body>
</html>
```

`ui/src/main.ts`:

```typescript
import { invoke, listen } from "@tauri-apps/api/core";
import { mountPreview } from "./preview";
import { applyTheme } from "./theme_apply";

const pane = document.getElementById("preview-pane")!;
const setMarkdown = mountPreview(pane);

(async () => {
  const themes = await invoke<{slug:string}[]>("list_themes");
  const bundle = await invoke<{css:string, mermaid_vars:Record<string,string>}>("set_theme", { name: themes[0].slug });
  applyTheme(bundle);

  // For phase 3: read-only with a hard-coded sample buffer if no initial file.
  setMarkdown("# preview-md\n\nLoaded.");
})();
```

`ui/styles/base.css`: minimal `:root` consuming `--pmd-bg`, `--pmd-fg`, `--pmd-link`, `--pmd-code-block-bg`, etc.; structural-only.

- [ ] **Step 3.11: E2E — open a file from CLI argv, read it back, screenshot in preview mode**

Add `crates/pmd-e2e/tests/file_open.rs` with a fixture markdown at `tests/corpus/hello.md`, run via the e2e harness with `--application-args /work/tests/corpus/hello.md`.

- [ ] **Step 3.12: `just check && just e2e`**

Run: `just check && just e2e`
Expected: all green.

- [ ] **Step 3.13: Owner gate**

Run `just visual-review` and `/ccc-review-cx` over the diff. Fix Blockers and Majors.

- [ ] **Step 3.14: Commit phase 3**

```bash
git commit -m "$(cat <<'EOF'
phase 3: pmd-app shell + read-only preview + render-IPC versioning

Tauri commands: render_cmd (versioned), open_file/save_file (scoped
to dialog + recents + CLI argv), list_themes/set_theme with CSS
injection, settings (flock RMW) + separate recents.toml. JS-side
render back-pressure (newest-wins, max 1 in-flight). Read-only
preview pane consumes the rendered HTML. GitHub Light/Dark themes
visible end-to-end. Multi-file CLI fans out to one child process per
path argument; parent exits when path count > 1.

Spec refs: §3.1, §3.2, §3.3, §5.2, §5.3, §7.2.
EOF
)"
```

- [ ] **Step 3.15: Run the `postcommit-status-and-continue` skill and continue.**

---

## Phase 4: Monospace mode + mode chrome + theme switching (owner-driven)

**Goal:** CodeMirror 6 source editor; three-mode toolbar; modified-dot; status bar; hotkey overlay; live theme switching with auto-switch.

**Files:**
- Vendor: `ui/vendor/codemirror-6/` (pinned bundled build — produced by a one-time `pnpm` script described in step 4.1).
- Create: `ui/src/editor.ts`, `ui/src/chrome.ts`, `ui/src/hotkeys.ts`.
- Modify: `ui/index.html`, `ui/src/main.ts`, `ui/styles/base.css`.
- Tests: extend `crates/pmd-e2e/tests/modes.rs`.

- [ ] **Step 4.1: Vendor CodeMirror 6**

Create `ui/vendor/build-codemirror.mjs` that uses `esbuild` to produce a single ESM bundle of CodeMirror with the extensions we need (`@codemirror/basic-setup`, `@codemirror/lang-markdown`, `@codemirror/theme-one-dark` placeholder — we use our own theme adapter). Commit the bundled output to `ui/vendor/codemirror-6/codemirror.bundle.js`. The build script is documentation, not part of CI.

- [ ] **Step 4.2: TDD — e2e checks that the editor renders and edits trigger a render**

`crates/pmd-e2e/tests/modes.rs`: open a file in source mode, type into CodeMirror via WebDriver `send_keys`, assert the preview pane (when split) and the in-memory buffer reflect the changes; assert the modified dot appears.

- [ ] **Step 4.3: Implement `ui/src/editor.ts` mounting CodeMirror, emitting change events**

```typescript
import { EditorState } from "@codemirror/state";
import { EditorView, basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";

export function mountEditor(el: HTMLElement, onChange: (md: string) => void) {
  const v = new EditorView({
    parent: el,
    state: EditorState.create({
      extensions: [basicSetup, markdown(), EditorView.updateListener.of((u) => { if (u.docChanged) onChange(u.state.doc.toString()); })],
    }),
  });
  return v;
}
```

- [ ] **Step 4.4: `ui/src/chrome.ts` — toolbar with three-button mode segmented control + modified dot + filename + status bar**

(Plain DOM; CSS variables drive colours. ~80 lines total — toolbar at top, status bar at bottom, mode buttons emit a `mode-change` `CustomEvent`.)

- [ ] **Step 4.5: `ui/src/hotkeys.ts` — `Ctrl+\` cycles modes; `Ctrl+/` shows the overlay**

- [ ] **Step 4.6: Mode switching is webview-local CSS toggling**

Mode set adds `data-mode="source|split|preview"` to `<body>`; `base.css` hides/shows panes accordingly with a 120 ms opacity crossfade.

- [ ] **Step 4.7: Auto-switch follow**

`pmd-app` subscribes to Tauri's `system_theme_changed` event; if `auto_switch` is true in `Settings` and a `(light, dark)` pair is configured, emit `set_theme` for the appropriate slug.

- [ ] **Step 4.8: `just check && just e2e`**

Run: `just check && just e2e`

- [ ] **Step 4.9: Owner gate (visual review + ccc-review-cx)**

- [ ] **Step 4.10: Commit phase 4**

```bash
git commit -m "phase 4: monospace mode + mode chrome + theme switching"
```

- [ ] **Step 4.11: Run the `postcommit-status-and-continue` skill and continue.**

---

## Phase 5a: Render integration (split mode layout, no scroll sync) (owner-driven)

**Goal:** Split mode lays out source + preview side-by-side with the version-coalescing render path; DOM diff updates only the changed nodes. No scroll sync yet.

- [ ] **Step 5a.1: TDD — e2e test asserts that typing in source updates the preview within 100 ms and that `version` drop logic discards stale responses**

(Use WebDriver `await new Promise(r => setTimeout(r, 120))` between batches; inspect `data-version-applied` attribute on the preview root.)

- [ ] **Step 5a.2: morphdom-style DOM diff**

Add `ui/src/dom_diff.ts` with a 60-line implementation: walk old & new DOM in tandem, replace only nodes whose `outerHTML` differs. Acceptable for v1 — the preview is small.

- [ ] **Step 5a.3: Split-mode CSS**

`base.css`: `[data-mode="split"] #editor-pane { flex: 1 } [data-mode="split"] #preview-pane { flex: 1 }`. Draggable 4 px divider via a small JS helper.

- [ ] **Step 5a.4: `just check && just e2e`; owner gate; commit**

```bash
git commit -m "phase 5a: split layout + DOM-diff render integration"
```

- [ ] **Step 5a.5: Run the `postcommit-status-and-continue` skill and continue.**

---

## Phase 5b: Scroll sync (owner-driven)

**Goal:** Editor caret line → preview scrolls to the block whose `data-src-start <= line <= data-src-end`. Forward direction only.

- [ ] **Step 5b.1: TDD — e2e fixture: 200-line doc with H1 every 20 lines; place caret on line 100; assert preview's scrollTop matches the H1 at `data-src-start="100"`-or-nearest-preceding**

- [ ] **Step 5b.2: `ui/src/scroll_sync.ts`**

```typescript
import type { EditorView } from "@codemirror/view";

export function attachScrollSync(view: EditorView, preview: HTMLElement) {
  view.dom.addEventListener("scroll", sync);
  view.dom.addEventListener("input", sync);
  function sync() {
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head).number;
    const all = preview.querySelectorAll<HTMLElement>("[data-src-start]");
    let chosen: HTMLElement | null = null;
    for (const el of all) {
      const s = +(el.dataset.srcStart!); const e = +(el.dataset.srcEnd!);
      if (s <= line && line <= e) { chosen = el; break; }
      if (s <= line) chosen = el;
    }
    if (chosen) {
      requestAnimationFrame(() => chosen!.scrollIntoView({ block: "start", behavior: "instant" }));
    }
  }
}
```

- [ ] **Step 5b.3: Add goldens covering soft-wrapped lines, nested lists, tables**

- [ ] **Step 5b.4: `just check && just e2e`; owner gate; commit**

```bash
git commit -m "phase 5b: scroll sync via data-src-start/end (editor → preview)"
```

- [ ] **Step 5b.5: Run the `postcommit-status-and-continue` skill and continue.**

---

## Phase 6a: Mermaid + KaTeX + syntax highlighting (owner-driven)

**Goal:** Mermaid blocks render client-side with `securityLevel: 'strict'` and the spec's geometry baseline. KaTeX math renders with `trust: false`. Code blocks render with tree-sitter-driven `<span class="hl-…">` tokens. One theme exercises all three.

- [ ] **Step 6a.1: Vendor mermaid 11.x and KaTeX into `ui/vendor/`**

- [ ] **Step 6a.2: `ui/src/mermaid_runner.ts`**

```typescript
import mermaid from "../vendor/mermaid-11.x.js";

let initialised = false;
export function ensureInit(vars: Record<string,string>) {
  if (initialised) { mermaid.initialize({ themeVariables: vars }); return; }
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", themeVariables: vars });
  initialised = true;
}

export async function renderMermaidNodes(root: HTMLElement) {
  const blocks = root.querySelectorAll<HTMLElement>("pre > code.language-mermaid");
  for (const code of blocks) {
    try {
      const { svg } = await mermaid.render(`m-${Math.random().toString(36).slice(2)}`, code.textContent ?? "");
      code.parentElement!.outerHTML = svg;
    } catch (e) {
      code.parentElement!.classList.add("pmd-mermaid-error");
    }
  }
}
```

- [ ] **Step 6a.3: `ui/src/katex_runner.ts` calls `katex.render(src, el, { trust: false, strict: "warn" })`**

- [ ] **Step 6a.4: Tree-sitter highlight in `pmd-core::highlight`**

Pre-render code blocks server-side. Spec §4. Wire into `emit.rs` when an info-string is recognised.

- [ ] **Step 6a.5: Mermaid stylistic baseline CSS**

`ui/styles/mermaid-theme.css`: pin 8 px corner radius on `.node rect`, 1.5 px stroke, no `filter: drop-shadow`, font inherits `var(--pmd-ui-font)` at 0.95 em, edge labels 4 px padding with `var(--pmd-mermaid-edge-label-bg)`, lifelines `1px dashed var(--pmd-mermaid-line)`.

- [ ] **Step 6a.6: E2E**

`crates/pmd-e2e/tests/mermaid_katex.rs`: load `tests/corpus/mermaid-heavy.md` and `math-heavy.md`; assert SVG nodes present, no console errors, screenshots match baselines.

- [ ] **Step 6a.7: `just check && just e2e`; owner gate; commit**

```bash
git commit -m "phase 6a: mermaid + KaTeX + syntax highlighting + mermaid baseline"
```

- [ ] **Step 6a.8: Run the `postcommit-status-and-continue` skill and continue.**

---

## Phase 6b: Theme bundle delivery (owner-driven)

**Goal:** All 17 bundled themes ship: 6 popular + 2 popular swapped (Rosé Pine Dawn replaces Catppuccin Mocha) + 9 originals. Mermaid optional-key derivation runs at theme load when keys absent. Theme change triggers rAF-chunked re-render of existing mermaid/KaTeX nodes.

**Files:**
- Create: 15 more theme folders under `themes/` (8 already exist or need expansion from phase 2: github-light, github-dark, plus 6 popular + 9 originals).

- [ ] **Step 6b.1: For each theme, write `manifest.toml` per the spec §7.3 brief and a minimal `theme.css` (empty `:root {}` plus any custom selectors the brief calls out — e.g., the Sepia Atelier 2% noise overlay)**

For the 9 originals, the colour values to use are drawn from the spec §7.3 entries. Pick six anchor colours per theme — `bg`, `bg_elevated`, `fg`, `fg_muted`, `accent`, `link` — and derive the remaining required keys mechanically (e.g., `inline_code_bg = bg_elevated`, `code_block_bg = bg`, `border = mix(fg, bg, 80%)`, etc.) so all 17 themes pass the validator without hand-tuning every key.

- [ ] **Step 6b.2: Mermaid optional-key derivation in `pmd-app::cmd::theme`**

When generating the `:root { … }` block, if a mermaid optional key is absent in the manifest, compute it per spec §7.2.1 using `pmd_core::theme::mix::mix(...)`. Emit a CSS variable for each computed value.

- [ ] **Step 6b.3: rAF-chunked re-render in `ui/src/theme_apply.ts`**

```typescript
export async function rerenderForThemeChange(root: HTMLElement, ctx: { vars: Record<string,string> }) {
  ensureInit(ctx.vars);
  const targets = Array.from(root.querySelectorAll(".pmd-mermaid, .pmd-math"));
  for (const t of targets) {
    await new Promise<void>(r => requestAnimationFrame(() => r()));
    if (t.classList.contains("pmd-mermaid")) await renderMermaidNodes(t.parentElement!);
    else await renderMathNode(t as HTMLElement);
  }
}
```

- [ ] **Step 6b.4: Theme-completeness CI test now exercises all 17 themes (already wired in phase 2 — just adding the new folders makes it grow)**

- [ ] **Step 6b.5: `just check && just e2e`; owner gate; commit**

```bash
git commit -m "phase 6b: 17-theme bundle + mermaid derivation + rAF re-render"
```

- [ ] **Step 6b.6: Run the `postcommit-status-and-continue` skill and continue.**

---

## Phase 7: Theme polish — picker UX (owner-driven)

**Goal:** In-app picker: card grid, Auto row, hover rationales, "Set as light/dark" mini-actions, keyboard navigation (`/` filter, arrows, Enter, Esc), per-theme screenshot regeneration through the e2e pass using `tests/corpus/canonical-theme-sample.md`.

- [ ] **Step 7.1: TDD — e2e picker test: open picker, type `frieren`, expect Twilight Mage highlighted, press Enter, expect theme applied**

- [ ] **Step 7.2: Implement picker UI in `ui/src/picker.ts` + `ui/styles/picker.css`**

- [ ] **Step 7.3: Generate fresh review screenshots via `just visual-review` and commit any intentional Playwright snapshot updates**

- [ ] **Step 7.4: WCAG warnings surfaced in dev builds via `console.warn` from `set_theme`**

- [ ] **Step 7.5: `just check && just e2e`; owner gate; commit**

```bash
git commit -m "phase 7: theme picker UX + screenshot regeneration"
```

- [ ] **Step 7.6: Run the `postcommit-status-and-continue` skill and continue.**

---

## Phase 8: Packaging + multi-instance polish (owner-driven)

**Goal:** `.desktop`, MIME XML, AppStream metainfo, icons at all sizes, AppImage recipe, Flatpak manifest, `xdg-mime` install script, App ID acceptance test (`swaymsg -t get_tree` or `xprop`), recent files in the in-app File menu.

**Files:**
- Create: `packaging/linux/{dev.previewmd.App.desktop, dev.previewmd.App.metainfo.xml, dev.previewmd.App.mime.xml, icons/*}`, `appimage/`, `flatpak/dev.previewmd.App.yml`, `scripts/{package-appimage.sh, package-flatpak.sh, install-desktop-files.sh}`.

- [ ] **Step 8.1: `packaging/linux/dev.previewmd.App.desktop`**

```ini
[Desktop Entry]
Type=Application
Name=preview-md
GenericName=Markdown Preview
Comment=Best-in-class markdown preview for Linux
Exec=preview-md %F
Icon=dev.previewmd.App
Terminal=false
Categories=Utility;TextEditor;
MimeType=text/markdown;text/x-markdown;
StartupNotify=true
StartupWMClass=dev.previewmd.App
Actions=NewWindow;OpenFile;

[Desktop Action NewWindow]
Name=New Window
Exec=preview-md

[Desktop Action OpenFile]
Name=Open File...
Exec=preview-md --open-dialog
```

- [ ] **Step 8.2: `packaging/linux/dev.previewmd.App.metainfo.xml`**

(Standard AppStream skeleton: `<component type="desktop-application">`, summary, description, screenshots referencing `themes/<slug>/screenshot.png`, releases.)

- [ ] **Step 8.3: `packaging/linux/dev.previewmd.App.mime.xml`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="text/markdown">
    <glob pattern="*.md"/>
    <glob pattern="*.markdown"/>
  </mime-type>
</mime-info>
```

- [ ] **Step 8.4: Icons — generate `16/24/32/48/64/128/256` PNGs from `preview-md.svg`** (script in `scripts/install-desktop-files.sh`)

- [ ] **Step 8.5: Set Wayland `app_id` / X11 `WM_CLASS` at runtime**

In `crates/pmd-app/src/main.rs` (or `platform/linux.rs`), set `gtk_window_set_role` + the wry option that maps to `app_id`. Verify via e2e.

- [ ] **Step 8.6: E2E — App ID acceptance**

`crates/pmd-e2e/tests/multi_instance.rs`: spawn two windows (`preview-md a.md b.md` from inside the container — needs the e2e harness to allow spawning); shell-out to `swaymsg -t get_tree` (cage uses sway's IPC) and assert both windows have `app_id == "dev.previewmd.App"`.

- [ ] **Step 8.7: AppImage recipe**

`scripts/package-appimage.sh` uses `linuxdeploy-x86_64.AppImage` to bundle `target/release/preview-md` + WebKitGTK runtime libs + `.desktop` + icons → single AppImage. If `cargo-appimage` proves simpler at execution time, switch to it; either way the result is one file.

- [ ] **Step 8.8: Flatpak manifest**

`flatpak/dev.previewmd.App.yml` with `runtime: org.freedesktop.Platform`, `sdk: org.freedesktop.Sdk`, `command: preview-md`, and a Rust module pointing at the local source tree.

- [ ] **Step 8.9: `scripts/install-desktop-files.sh`**

Install `.desktop`, MIME XML, icons, AppStream metainfo into `~/.local/share/{applications,mime,icons,metainfo}/`; run `update-desktop-database`, `xdg-mime`, `gtk-update-icon-cache`.

- [ ] **Step 8.10: Recent files in-app**

Wire `get_recent_files` into the File menu (top-left dropdown in the toolbar) and the command palette. A clear-recents action ships too.

- [ ] **Step 8.11: Full-corpus final review-and-fix**

Run `just review-and-fix` against the entire test corpus. Apply any final visual fixes.

- [ ] **Step 8.12: `just check && just e2e && just package-all`**

- [ ] **Step 8.13: Owner gate (full visual review across the whole bundle + ccc-review-cx over the entire branch diff `main...HEAD`)**

- [ ] **Step 8.14: Commit phase 8 / tag v0.1.0**

```bash
git commit -m "phase 8: packaging (AppImage + Flatpak) + multi-instance polish + App ID test"
git tag -a v0.1.0 -m "preview-md v0.1.0 — first releasable build"
```

- [ ] **Step 8.15: Run the `postcommit-status-and-continue` skill and continue.**

---

## Self-review (writing-plans skill internal step)

Spec coverage check, post-write:

- **Goal & three modes** (spec §1, §5): phases 3 (preview), 4 (source), 5a/5b (split). ✓
- **GFM + extensions** (§4): phase 2 (parser), phase 6a (mermaid/KaTeX/highlighting). ✓
- **Theming with 17 themes** (§7): phase 2 (schema + 2 themes), phase 6b (full bundle + derivation), phase 7 (picker). ✓
- **Syntax highlighting** (§4): phase 6a. ✓
- **Multi-instance + launcher** (§6): phase 3 (CLI fan-out), phase 8 (.desktop + StartupWMClass + Wayland app_id verification). ✓
- **Testing** (§8): every phase has TDD + e2e + (owner) visual review. ✓
- **E2E in cage Docker** (§9): phase 1 baseline; all later phases extend `crates/pmd-e2e/tests/`. ✓
- **Dual-model visual review** (§10): owner gate on every phase. ✓
- **CI** (§13): phase 1 skeleton; phase 8 adds package jobs. ✓
- **Distribution** (§14): phase 8. ✓
- **YAGNI fence** (§15): plan never adds anything outside the spec's required scope. ✓
- **Slicing** (§16): one phase per spec slice; 5a/5b and 6a/6b split as required. ✓

Placeholder scan: no "TBD", no "implement later", no "similar to Task N" — every step either lists explicit code or names the exact file + function being touched. Long files (full theme manifests, the linux platform impl, the Flatpak manifest body) are described by structure rather than full text; the structure is concrete enough that an engineer can write the file.

Type consistency: `RenderResult { version, html, source_map }` is the same shape across phases 2, 3, 5a, 5b. `Theme`, `Settings`, `ThemeBundle`, `FileBuffer`, `PathScope` defined in phase 2/3 and referenced consistently afterward.

---

**Run the `postcommit-status-and-continue` skill and continue.**
