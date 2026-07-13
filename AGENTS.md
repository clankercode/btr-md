# btr-md / preview-md — Repo Norms

## Backlog (`.backlog/`)

- Use `bl` / `backlog` for tasks, bugs, and ideas. Prefer `bl --help` / `bl howto` when unsure.
- **Always keep `.backlog/` changes committed.** After any `bl` mutation (`init`, `bug`, `idea`, `add*`, `claim`, `done`, `set`, `append`, etc.), commit the resulting `.backlog/` updates promptly so claims, status, and planning history are on the branch—not only in the working tree.
- Do not leave uncommitted backlog drift at the end of a session or before opening a PR.

## Worktrees for feature work

Default to doing new feature work in a **dedicated git worktree under `.worktrees/`**
(create it with the `superpowers:using-git-worktrees` skill, or `git worktree add
.worktrees/<feature> -b <branch>`). This keeps `master` clean and lets features
land independently.

- **Ideally one worktree per feature.** Batching several related features into one
  worktree is fine when they share a spec/plan and land together.
- Branch from `master`; rebase onto `master` before merging back.
- Clean up the worktree (`git worktree remove`) and delete the merged branch once
  the work is on `master`.

## Build & test

Use the `justfile`. Common targets: `just run` (build UI + run app), `just test`
(Rust, excludes e2e), `just check` (full pre-PR gate: fmt, Rust tests, clippy, UI
typecheck/unit/build, theme + package smoke). UI unit tests: `cd ui && npm run
test:unit`. Limit Rust builds/tests to 2 threads (`-j 2`).

## What the e2e suite can NOT verify (verify on a real `just run`)

The Playwright e2e suite drives a **mocked Tauri backend** (`ui/e2e/helpers.cjs`)
in **Chromium**, not the real app in WebKitGTK. Some things therefore pass tests
yet break in the real app — confirm these by hand on `just run`, and do **not**
claim e2e coverage for them:

- **Rendered HTML.** The mock's `renderMarkdown` emits only a stub (`<h1>` + a
  `<p>`); it never produces real `<table>`, code blocks, mermaid, KaTeX, etc. So
  any DOM decoration of rendered output (table copy/expand, code-block toolbars,
  diagram controls) cannot be exercised by e2e.
- **Native window chrome.** The OS window-close button, window destroy/close, and
  anything gated by Tauri **capabilities** (`crates/pmd-app/capabilities/`) are
  not reachable. `core:window:default` grants only `allow-is-*` readers — calls
  like `getCurrentWindow().destroy()`/`.close()` need `allow-destroy`/`allow-close`
  added explicitly, or they reject at runtime with no e2e signal.
- **WebKitGTK-specific behaviour** (pointer/click quirks, paste, focus) differs
  from Chromium; reproduce real-app input bugs on `just run`, not just in tests.
