# Coverage Ledger: Round-3 Markdown Rendering and Sanitizer

Date: 2026-05-25
Reviewer: Codex

## Files Reviewed

- `crates/pmd-core/src/emit.rs`
- `crates/pmd-core/src/sanitize/allowlist.rs`
- `crates/pmd-core/src/sanitize/mod.rs`
- `crates/pmd-core/tests/security.rs`
- `ui/src/main.ts`
- `ui/src/mermaid_runner.ts`
- `ui/src/katex_runner.ts`
- `ui/src/theme_apply.ts`
- `crates/pmd-app/tauri.conf.json` for CSP context only

## Commits Considered

- `81fd2e8 fix: reject protocol-relative image URLs (T1-M6-R, T1-M7-R)`
- `86a3bbd fix: suppress formatted alt child tags (T1-M5-R, T1-M7-R)`
- `98d04b2 fix: require render nonce for math runners (T1-M3-R, T1-M7-R)`

## Commands and Probes

- `git status --short`
- `git log --oneline --decorate -8`
- `git diff --stat 84293e6..HEAD -- <target files>`
- `rg -n "data-pmd-nonce|nonce|mermaid|katex|language-mermaid|language-math|alt|img|src|protocol|scheme|allow|class" <target files>`
- `cargo test -p pmd-core --test security` (20 tests passed)
- Direct current security test binary: `target/debug/deps/security-f48f2232ed7b11b2 --nocapture` (20 tests passed)
- `npm run build` from `ui/` (passed)
- Local Rust probes linked against current `pmd_core` rlib for nonce replay, raw renderer classes, image URL variants, and attribute-filter behavior
- Node WHATWG URL probe for backslash network-path resolution

## Notes

The first `cargo test -p pmd-core --test security` invocation waited on an existing workspace Cargo artifact lock from another running job, then completed successfully. The already-built current security test binary was also run directly while waiting and passed all 20 tests.
