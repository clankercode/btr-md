# Coverage Ledger: Markdown Rendering and Sanitizer

Date: 2026-05-25
Reviewer: Codex

## Files Reviewed

- `crates/pmd-core/src/emit.rs`
- `crates/pmd-core/src/sanitize/allowlist.rs`
- `crates/pmd-core/src/sanitize/mod.rs`
- `crates/pmd-core/tests/security.rs`
- `ui/src/main.ts`
- `ui/src/chrome.ts`
- `ui/src/mermaid_runner.ts`
- `ui/src/katex_runner.ts`
- `ui/src/theme_apply.ts`
- `crates/pmd-app/tauri.conf.json`

## Commits Considered

- `84293e6 fix(security): markdown sanitizer hardening (scheme/MIME, alt text, code-block math, renderer trust)`
- `d162866 fix(scope+watcher): tighten scope admission, wire file watcher end-to-end, harden recents`
- `e1dee69 fix(theme): persist active theme, auto-switch via matchMedia, re-init mermaid, bundle KaTeX fonts, dedupe slugs, robust settings parse`
- `999f0af fix(harness): wire CLI flags, repair packaging targets, refresh e2e selectors, add appstream screenshots`

## Commands Run

- `git log --oneline -8`
- `git diff --stat 84293e6..HEAD -- <target files>`
- `git diff --unified=80 84293e6..HEAD -- <target files>`
- `cargo test -p pmd-core --test security`
- `cargo test -p pmd-core`
- `npm run build`
- Local Rust probes compiled with the latest `target/debug/deps/libpmd_core-*.rlib`

## Scope Notes

Reviewed the Rust emission and sanitize path, UI error rendering, Mermaid/KaTeX target collection, theme re-render target collection, CSP image-source policy, and current security test depth. No live exploit attempts, network calls, or app runtime browser instrumentation were performed.
