# Bounded typed clients own the UI→backend seam

The UI crossed the Tauri seam with ~81 raw `invoke()`/`invoke<T>()` call sites (66 in main.ts) sharing untyped knowledge of ~60 command names and arg shapes, and the e2e mock (patched at `window.__TAURI_INTERNALS__`) had drifted from production. We decided the seam is owned by hand-written, typed, per-domain clients (docs, theme, session, files, …) — not a single 60-command module (interface as wide as the implementation: shallow) and not codegen from the Rust `#[tauri::command]` signatures (tooling to maintain, weaker greppability). The e2e mock is authored in TypeScript against the same command types and compiled for Playwright injection, making it a second adapter at the same seam: mock/prod drift becomes a compile error.

Considered options: single `backend.ts` module; generated TS contract from Rust; runtime contract check on the CJS mock (names only — rejected as too weak).

## Follow-up notes

- **`listen()` event sites are deferred.** The seven `listen()` subscriptions in main.ts (`open-file`, `activate-doc`, `doc_state_changed`, `pmd://diagnostics-enriched`, `pmd://download-denied`, `system_theme_changed`, `mode-change`) are NOT request/response invokes — they have a different shape (payload types plus subscription teardown), so they are out of scope for the `CommandMap`/`call()` seam. Fold them into a later `backend/events.ts` typed against an `EventMap`. Consequently the typed e2e mock (`ui/e2e/mock/mock.ts`) does not treat `open-file` as an invoke (prod only `listen`s `open-file`); it exposes an event-emit path (`window.__pmdEmitEvent`) instead, matching production.

- **`just check` grep guard.** A guard in the `check` recipe enforces the seam's single-importer rule: only `ui/src/backend/invoke.ts` may import the raw `@tauri-apps/api/core` `invoke`. Any other `ui/src/**/*.ts` file importing it fails `just check`.
