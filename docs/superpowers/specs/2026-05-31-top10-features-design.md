# Top-10 Unimplemented Features — Design

Date: 2026-05-31
Branch: `feat/top10-features`
Source: `docs/feature-ideas.md` + `docs/research/2026-05-30-feature-brainstorm/synthesis.md`
(audited 2026-05-31).

This batch implements the ten highest-value unimplemented features from the
audited backlog. They are largely independent and grouped into six
implementation slices that land sequentially on one branch, each with its own
commit(s) and a codex review-and-fix pass.

## Locked decisions

- **#8 GitHub Parity Mode** → indicator + fixture corpus only. No behavioral
  render toggle (renderer is already GFM; a strictness switch is YAGNI and
  redundant with the existing strict sanitizer).
- **#10 Packaging** → full attempt: Flatpak manifest, XDG portal open/save
  wiring, tightened permissions, **plus** scripted placeholder screenshots
  captured from a real `just run` (best-effort; flagged for later replacement
  with curated marketing shots).

## On-mission filter

Every feature must improve rendering fidelity, document navigation, local
correctness, or visible trust — and must not pull the app toward a cloud note
platform or execution environment. All export/render features reuse the
existing scoped-asset path and strict sanitizer; no new network surface.

## Slices

### Slice A — Editor ergonomics (CodeMirror)

Confirmed infra: `ui/src/editor.ts` builds extensions with a `markdown({base,
extensions:[GFM]})` language and a `searchCompartment`; `codemirror-entry.ts`
already re-exports `@codemirror/search`.

1. **Markdown Formatting Shortcuts** (#2, High/Low). `Ctrl+B` bold, `Ctrl+I`
   italic, `` Ctrl+` `` inline code, `Ctrl+K` link, heading/list toggles. A
   pure selection-transform keymap in a new `ui/src/editor_format.ts`. Commands
   are shared with any toolbar/insert-menu actions to avoid divergence. Note:
   `Ctrl+B` currently toggles the sidebar — rebind the editor-focused `Ctrl+B`
   to bold and move sidebar toggle off `Ctrl+B` (or scope sidebar toggle to
   non-editor focus). Resolve the conflict explicitly in the keybindings layer.
2. **Smart List Continuation** (#3, High/Low). Enter at end of a list item
   inserts the next marker; Enter on an empty item exits the list. Prefer the
   `@codemirror/lang-markdown` markdown keymap if it covers this; otherwise a
   small custom keymap. Handles ordered renumbering and task-list `- [ ]`.
3. **Find-and-Replace** (#4, High/Med). Add the replace half to the existing
   find bar: replace field, Replace / Replace-All, regex + case toggles, source
   scope (CM search replace). Preview scope stays find-only (no DOM mutation of
   sanitized output). Reuses `@codemirror/search` replace APIs.

### Slice B — Export

No print CSS or export commands exist today.

4. **PDF Export** (#1, High/Low). Menu/command action that applies a
   print-specific stylesheet (strip chrome, paginate, expand collapsed blocks)
   and invokes the WebKitGTK print path (`window.print()`), which offers
   "Save as PDF". New `ui/styles/print.css` gated by `@media print` + a
   `print-export` body class; a `document.export.pdf` action.
5. **HTML Export (self-contained)** (#7, High/Med). Export current document as
   one HTML file: inlined theme CSS, images inlined as data URIs (read through
   the existing scoped-asset path — no new policy), KaTeX/Mermaid pre-rendered
   from the current preview DOM. New backend command `cmd/export.rs`
   (`export_html`) + a `document.export.html` action with a native save dialog.
   Output is run through the same sanitizer guarantees as preview.

### Slice C — Clipboard / asset workflows

6. **Image Paste / Drag-and-Drop Embed** (#5 / synthesis #4 remainder,
   High/Med). On paste or drop of image data into a **saved** document, copy
   bytes to `images/<document-stem>/` beside the file, insert a relative
   `![](images/<stem>/<name>)`, and auto-extend the asset grant for that
   subfolder. Unsaved buffer → prompt to save first. First write to a new
   folder asks for confirmation. Backend command for the copy + grant;
   `drag_overlay.ts` extended to distinguish markdown-open from image-embed.
7. **Paste-as-Markdown from HTML** (#6, High/Med). `Ctrl+Shift+V`: when the
   clipboard holds HTML, sanitize it through ammonia first, then convert to
   Markdown (Rust-side, `htmd` or `html2md` crate — chosen at impl time) and
   insert. Plain-text clipboard falls through to normal paste. New
   `cmd` handler `paste_html_as_markdown`; clipboard HTML treated as untrusted.

### Slice D — GitHub parity

8. **GitHub Parity Mode + compat notes** (#8, High-value). A status indicator
   showing the active render profile ("GitHub-flavored"), and a fixture corpus
   under `crates/pmd-core/tests/fixtures/github-parity/` covering alerts,
   footnotes, task lists, duplicate anchors, Mermaid, math, relative links, and
   intentional raw-HTML/security deviations, with a golden-test harness and a
   short `docs/github-parity.md` documenting known differences. No behavioral
   toggle.

### Slice E — CLI

9. **CLI Flags for Headless Render** (#9, High/Med). `cli.rs` already parses
   `--list-themes`/`--open-dialog`. Add `--render <in.md> [--output <out>]`
   that drives `pmd-core` headlessly (no Tauri window), writing sanitized HTML
   to the file or stdout. Reuses the Slice-B self-contained export path for a
   `--standalone` flag (default: fragment). Exits before window creation in
   `main.rs`.

### Slice F — Packaging

10. **AppStream/Flatpak/Portal completeness** (#10, Necessary). Add a Flatpak
    manifest (`packaging/flatpak/md.btr.app.yaml` aligned with
    `scripts/package-flatpak.sh`), wire XDG Desktop Portal open/save for
    Flatpak (FileChooser portal; Tauri dialog/fs configured to prefer portal),
    tighten Flatpak filesystem permissions to the minimum, add captioned
    `<screenshots>` to the metainfo, and a `scripts/capture-screenshots.sh`
    that scripts a `just run` capture to produce placeholder PNGs (best-effort;
    flagged TODO for curated replacements).

## Workflow per slice

1. Plan the slice (TDD task list where it applies).
2. Implement (subagents as useful; Opus preferred).
3. Run **ccc-review-cx instructing codex to run the full review-and-fix loop
   itself** (review + fix in one invocation), told to surface as many issues as
   it can.
4. Verify: `just check` gate (fmt, Rust tests -j2, clippy, UI
   typecheck/unit/build) before committing the slice.
5. Commit with a conventional message; move to the next slice.

## Testing strategy

- **Rust**: unit + golden tests for export HTML, parity fixtures, CLI render;
  `-j 2` per system norms.
- **UI unit** (`cd ui && npm run test:unit`): formatting transforms, list
  continuation, find-replace query logic, paste-as-markdown conversion mapping,
  image-embed path/markdown generation.
- **e2e caveat** (per CLAUDE.md): the Playwright suite drives a *mocked* backend
  in Chromium — it cannot verify rendered tables/code/Mermaid/KaTeX, native
  print/window chrome, or portal dialogs. PDF print, real HTML export visuals,
  paste/drop in WebKitGTK, and portal pickers are verified by hand on
  `just run`, not claimed as e2e-covered.

## Out of scope (explicit)

Print-preview mode, behavioral parity toggle, Vim mode, search-across-files,
reverse scroll sync, crash-recovery dir, dependency checksums — all remain on
the backlog (runners-up), not part of this batch.

--- SUMMARY ---

- Implements the **10 top unimplemented backlog features** on one branch
  (`feat/top10-features`) in **six sequential slices**: editor ergonomics,
  export, clipboard/asset, GitHub parity, CLI, packaging.
- **Locked scope:** #8 is indicator + fixture corpus only (no render toggle);
  #10 is the full packaging push including scripted placeholder screenshots.
- **Key cross-cutting constraints:** reuse the existing scoped-asset path and
  strict sanitizer; add **no network surface**; treat clipboard HTML as
  untrusted (ammonia before HTML→MD).
- **Notable conflict to resolve:** editor `Ctrl+B` must move from sidebar-toggle
  to bold; sidebar toggle rebound or focus-scoped.
- **Per-slice loop:** plan → implement (subagents/Opus) → codex
  **review-and-fix** (one invocation, surface max issues) → `just check` →
  commit.
- **Verification reality:** e2e mock can't cover print, real export visuals,
  WebKitGTK paste/drop, or portal dialogs — those are hand-verified on
  `just run`.
