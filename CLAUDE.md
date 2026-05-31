# btr-md / preview-md — Repo Norms

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
