# Bounded typed clients own the UI→backend seam

The UI crossed the Tauri seam with ~81 raw `invoke()`/`invoke<T>()` call sites (66 in main.ts) sharing untyped knowledge of ~60 command names and arg shapes, and the e2e mock (patched at `window.__TAURI_INTERNALS__`) had drifted from production. We decided the seam is owned by hand-written, typed, per-domain clients (docs, theme, session, files, …) — not a single 60-command module (interface as wide as the implementation: shallow) and not codegen from the Rust `#[tauri::command]` signatures (tooling to maintain, weaker greppability). The e2e mock is authored in TypeScript against the same command types and compiled for Playwright injection, making it a second adapter at the same seam: mock/prod drift becomes a compile error.

Considered options: single `backend.ts` module; generated TS contract from Rust; runtime contract check on the CJS mock (names only — rejected as too weak).

## Follow-up notes

- **`listen()` event sites are on the typed seam.** `backend/events.ts` owns `EventMap` (event name → payload) and `subscribe()`, the sole importer of raw Tauri `listen`. Production call sites in `main.ts` use `subscribe('…', (payload) => …)` so payload shapes are checked at compile time. The e2e mock exposes `window.__pmdEmitEvent` typed against the same `EventMap` (prod only listens for `open-file`; it is not an invoke).

- **`just check` grep guards.** Guards in the `check` recipe enforce the seam's single-importer rules:
  - only `ui/src/backend/invoke.ts` may import the raw `@tauri-apps/api/core` `invoke`;
  - only `ui/src/backend/events.ts` may import the raw `@tauri-apps/api/event` `listen` (and the rest of that module).
