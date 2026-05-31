# Document Inspection & Find — Design

Date: 2026-05-31

Implements synthesis roadmap items #8 (diagram/math inspection), #9 (frontmatter
awareness), #11 (find in source & preview), and #12 (reading/structure stats),
from `docs/research/2026-05-30-feature-brainstorm/synthesis.md`. Delivered as one
combined slice because three of the four are thin surfacings of facts the backend
already computes (`CoreDocumentFacts`), and they share UI conventions.

## Goal

Let a reader open any Markdown file and (a) find text in both source and rendered
views, (b) see and lightly edit frontmatter, (c) understand why a diagram failed
and copy its source, and (d) see reading time and structural counts — without
turning the previewer into an editor platform.

## Existing Infrastructure (do not rebuild)

- **`CoreDocumentFacts`** (`crates/pmd-core/src/facts/`, surfaced via
  `ui/src/document_contracts.ts` + `document_facts_store.ts`) already provides:
  - `frontmatter: FrontmatterFact | null` — `format` (yaml/toml), `syntax`
    (valid/malformed/unsupported_format), `line_start`, `line_end`, `raw`, and
    `metadata: CommonFrontmatter` (title, description, slug, sidebar_label,
    sidebar_position, tags, draft, unknown map).
  - `counts: StructureCounts` — words, bytes, sentences, paragraphs, headings,
    links, images, code_blocks, mermaid_blocks, math_spans, math_blocks.
  - `embedded: EmbeddedFacts` with per-block `line_start`/`line_end`.
  - `DocumentIssue.category` already includes `"frontmatter"` — core may already
    emit malformed-frontmatter issues; verify and surface rather than add.
- **`mermaid_zoom.ts`** already does Expand→fullscreen, wheel-zoom, drag-pan,
  fit, reset, and SVG/PNG download. Mermaid containers carry
  `dataset.mermaidSource`.
- **Preview DOM** (`#pmd-content`): block-keyed (`data-pmd-block`), with
  `data-src-start`/`data-src-end` on block elements for source mapping. Scroll
  sync (`scroll_sync.ts`) already maps between source and preview.
- **CodeMirror** (`editor.ts`): one reused `EditorView`, configured via
  `Compartment`s. **It imports from a *vendored* bundle**
  (`ui/vendor/codemirror-6/codemirror.bundle.js`), built by
  `ui/vendor/build-codemirror.mjs` from `ui/src/codemirror-entry.ts`. That entry
  re-exports a fixed symbol set (`EditorState`, `Compartment`, `EditorView`,
  `basicSetup`, `Decoration`, `ViewPlugin`, `markdown`, `markdownLanguage`,
  `syntaxTree`, `GFM`, `oneDark`, `unifiedMergeView`) — **it does NOT export any
  search API**, and the bundle is hand-built with esbuild `alias` dedupe of the
  CodeMirror singletons (`@codemirror/state`, `@codemirror/view`,
  `@codemirror/language`, `@lezer/common`). The repo has two `@codemirror/search`
  copies (hoisted `0.20.1`, nested `6.7.0`); naive importing would mismatch the
  `state`/`view` singletons. Adding search is a **bundle change** (see Find below),
  not a free transitive import.
- **Actions** (`actions.ts`): `edit.find` / `edit.findNext` / `edit.findPrevious`
  exist with defaults Ctrl+F / Ctrl+G / Shift+Ctrl+G but currently only call
  `editor.focus()` in `main.ts`.
- **Status bar** (`chrome.ts`): `.pmd-status-counts` span; `setCounts(Counts)`.
- **Panel/popover patterns**: `outline_panel.ts`, `trust_policy_panel.ts`,
  `diagnostics_panel.ts`, `context_menu.ts` (cursor-positioned, dismiss on
  outside-click/Escape).

## Decisions (from brainstorming)

- Find: **source + rendered preview**, with a source/preview scope choice in split
  mode, match counts, keyboard nav, and **no raw-HTML injection**.
- Mermaid: **inline errors tied to source + copy source**. No KaTeX/math inspection.
- Frontmatter: **inspector + add-entry + edit-recognized-value + malformed
  diagnostic**. No delete in v1.
- Stats: **click the status-bar counts → popover** with reading time + structural
  counts. Inline bar unchanged.
- Triggers: **status bar** hosts both the stats popover (existing counts) and an
  always-present frontmatter control (a chip when frontmatter exists → inspector;
  a subdued "+ frontmatter" when absent → insert block + inspector).

## Components

### 1. Find (`ui/src/find/`)

New module split into source and preview concerns plus a small controller.

**Source (`find_source.ts`) — requires a bundle change first:** add
`@codemirror/search` **v6** as a direct dependency, add `@codemirror/search` to
the singleton `alias` map in `build-codemirror.mjs` (pinning the v6 copy so it
shares the bundle's `@codemirror/state`/`@codemirror/view` instances), import
`search`, `searchKeymap`, `openSearchPanel`, `findNext`, `findPrevious` in
`codemirror-entry.ts`, re-export them, and rebuild the vendored bundle. Then add
`search({ top: true })` + `searchKeymap` in a new editor compartment (`editor.ts`)
and re-point the three `edit.*` actions in `main.ts` (currently `editor.focus()`)
to `openSearchPanel` / `findNext` / `findPrevious`. CodeMirror's panel supplies
match highlighting and counts. (Plan Phase 0 confirms the rebuilt bundle still
produces a working markdown tree — the dedupe is the known fragile point.)

**Preview (`find_preview.ts`):** highlight matches inside `#pmd-content` using the
**CSS Custom Highlight API** — build `Range`s over text nodes for the query and
register them with `CSS.highlights.set("pmd-find", highlight)`, styled via
`::highlight(pmd-find)` in CSS. This is an **overlay keyed to ranges: it mutates
no DOM and injects no markup**, satisfying the sanitization constraint and not
disturbing block-incremental reconciliation. Track a "current match" for
next/previous and `scrollIntoView` it.

- **Recompute integration point (no existing hook).** Preview post-processing is
  inline in `processRenderQueue` (`main.ts`), split across the incremental
  (`reconcileBlocks` + per-changed-node mermaid/math/code/table) and full
  (`innerHTML` replace + same post-processing) branches. There is no reusable
  post-render subscription. The plan adds **one** explicit recompute call placed
  after the `if (blocks) {…} else {…}` block (so it covers both branches, after
  all async post-processing `await`s complete), plus a call on query change. A
  thin `onPreviewRendered(cb)` notifier may be introduced to avoid coupling
  `find_preview` directly into `processRenderQueue`.
- **WebKitGTK support is a hard prerequisite.** Phase 0 of the plan verifies
  `CSS.highlights` exists in the app's webview. If absent, fall back to wrapping
  matches in `<mark class="pmd-find">` built **only via DOM APIs over existing
  text nodes (never `innerHTML`)**. Because incremental reconciliation preserves
  unchanged keyed nodes, the fallback **must tear down all `mark.pmd-find` across
  the live `#pmd-content` before each reconcile/recompute** (otherwise stale or
  nested marks survive in unchanged blocks). The fallback is uglier but contained
  to `find_preview.ts`.

**Controller (`find_controller.ts`):** owns the find bar UI (query input, count
"n/m", prev/next, close, and in split mode a source⇄preview scope segmented
control). Routes to source or preview backend by scope; in single-pane modes the
scope is implied by the active pane. Pure query→ranges logic is unit-tested.

### 2. Mermaid errors + copy source (`mermaid_runner.ts`, `mermaid_zoom.ts`)

**Existing baseline:** `renderMermaidNode`'s `catch` already adds
`.pmd-mermaid-error` and sets `container.textContent = source`, and
`copySourceRange` already copies `data-src-start`/`data-src-end` onto the
container. So this is an **enhancement of an existing path**, not new rendering.

- On `mermaid.render` rejection, replace the bare `textContent = source` with a
  structured inline error: the error message, the (still-visible) source, and a
  **"Go to source"** link. The source line is read directly from
  `container.dataset.srcStart` (already present — no ancestor walk).
- **A new shared line-jump helper is required** — `scroll_sync.ts` only maps
  selection→preview-scroll, and `jumpEditorToBlock` (`main.ts`) is
  heading/block-id-specific, not arbitrary-line. Add `gotoEditorLine(line)`
  (in/alongside `editor.ts`'s jump logic): clamp to `view.state.doc.lines`,
  resolve `doc.line(n).from`, and `dispatch({ selection, scrollIntoView: true })`,
  mirroring `jumpEditorToBlock`'s existing dispatch. The error link calls it; the
  link no-ops gracefully when `dataset.srcStart` is absent.
- Add a **"Copy source"** button next to Expand (`addMermaidExpandButton`), copying
  `container.dataset.mermaidSource` to the clipboard.

### 3. Frontmatter inspector + editor (`ui/src/frontmatter/`)

**Inspector (`frontmatter_panel.ts`):** a popover (context-menu-style) opened from
an **always-present** `.pmd-status-frontmatter` status-bar control, so the
"no block yet" add path always has a trigger:

- When `facts.frontmatter` is present, the control shows a "frontmatter" chip and
  opens the inspector listing recognized `CommonFrontmatter` fields and unknown
  keys, with the format (YAML/TOML) and a malformed badge from `syntax`.
- When absent, the control shows a subdued "+ frontmatter" affordance; activating
  it inserts a new YAML block (below) and opens the inspector.

A command-palette action (`document.editFrontmatter`, no default shortcut) exposes
the same entry point for discoverability, and the existing
`primary_action: "Edit frontmatter"` on the malformed diagnostic is wired to open
the inspector.

**Editing (`frontmatter_edit.ts`, pure):** add a new `key: value` entry and edit a
recognized field's value. Edits are **line-oriented transactions on the CodeMirror
buffer**, located via `frontmatter.line_start`/`line_end`.

**Line semantics (confirmed against `crates/pmd-core/src/facts/frontmatter.rs`):**
`line_start` is the **opening** fence line (always 1); `line_end` is the **last
content line, i.e. the line *before* the closing fence**, so the closing
delimiter sits at **`line_end + 1`** (verified by
`crates/pmd-core/tests/document_facts_frontmatter.rs`). For an unclosed block the
parser sets `line_end` to the last line of the file and `syntax` is `malformed`.

- *Edit value*: find the field's line within `[line_start+1, line_end]`, replace
  its value text.
- *Add entry*: insert a new line **after `line_end`** (i.e. immediately before the
  closing fence at `line_end + 1`).
- *No block yet* (`frontmatter == null`): insert a new **YAML** block
  (`---\nkey: value\n---\n`) at the top of the document.
- *Malformed/unsupported* (`syntax !== "valid"`): **add and edit are disabled** —
  there is no safe closing delimiter, so the inspector shows the malformed badge
  and a "fix in source" hint instead.

Going through the buffer means undo/redo, dirty-state, autosave, and
re-render-from-facts all work unchanged, and existing comments/unknown lines are
preserved (no full re-serialize). Edits are restricted to scalar string/number/
bool values and `tags` (comma-split) — complex nested YAML is read-only in v1.
Existing valid TOML blocks are editable with TOML syntax; new blocks default to
YAML.

**Diagnostic (already implemented — verify only):** `frontmatter_issues` in
`crates/pmd-app/src/preview/contracts.rs` already emits a `Warning`/`Frontmatter`
`DocumentIssue` for `syntax == Malformed` (with `primary_action: "Edit
frontmatter"`), and `diagnostics_panel.ts` renders any category generically — so
the malformed diagnostic already appears. No new emission needed; the plan only
verifies it surfaces and wires `primary_action` to the inspector.
`unsupported_format` is **not** emitted today (and per review may be unreachable);
extending the diagnostic to it is **out of scope** for v1.

### 4. Stats popover (`ui/src/stats_popover.ts`, `chrome.ts`)

Make `.pmd-status-counts` a button. On click, open a popover reading the active
doc's `facts.counts` (`StructureCounts`) plus a computed **reading time**
(`ceil(words / 200)` min). Rows map to `StructureCounts` fields: words, bytes,
sentences, paragraphs, headings, links, images, code blocks, Mermaid blocks, math
(math_spans + math_blocks), plus computed reading time. Uses parser-derived
`facts.counts`, not the JS `counts.ts` (which stays for the inline bar).
Reading-time + row-assembly logic is pure and unit-tested.

## Data Flow

`render` → backend returns `RenderResult { facts, diagnostics, ... }` →
`document_facts_store` holds the active snapshot. The frontmatter chip, stats
popover, and frontmatter inspector all read `store.current(activeDocId).facts`.
Frontmatter edits write to the CodeMirror buffer → normal change/render cycle →
fresh facts → UI updates. Find operates on the live editor state (source) and the
rendered DOM (preview), independent of the facts store.

## Error Handling

- Find: empty query clears highlights; zero matches shows "0/0" and disables
  next/prev; preview highlight recompute is wrapped so a stale range never throws.
- Mermaid: render failure is shown inline, never silent; "Go to source" reads
  `container.dataset.srcStart` (copied on by `copySourceRange`) and no-ops
  gracefully when it is absent.
- Frontmatter edit: malformed existing block → editing is disabled (inspector
  shows the malformed badge and a "fix in source" hint) to avoid corrupting it;
  add-entry on a malformed block is also disabled. Buffer writes are guarded so a
  failed locate leaves the document unchanged.
- Stats: popover shows "—" for any count when no facts snapshot is available yet.

## Security

- Preview find adds **no markup** (Custom Highlight API) — no new sanitization
  surface. The `<mark>` fallback wraps existing text nodes only (no attribute or
  HTML from content) and is rebuilt from the sanitized DOM each render.
- Frontmatter editing only writes to the user's already-open, in-scope document
  buffer via CodeMirror; it introduces no new path authority and goes through the
  existing save-authority model.
- "Copy source"/clipboard writes are user-initiated and copy only the document's
  own diagram source.

## Testing

- **Unit (`node --test`):** `frontmatter_edit` (locate/edit/add/insert-block round
  trips, preserve comments, malformed guard), `stats_popover` (reading time, row
  assembly from `StructureCounts`), find query→ranges (match enumeration,
  case/whole-word options if included), reading-time edge cases (0 words).
- **e2e (Playwright):** Ctrl+F opens find and navigates matches in source and
  preview; split-mode scope toggle; frontmatter chip → inspector → add/edit
  reflects in source and re-render; malformed frontmatter shows a diagnostic;
  Mermaid syntax error shows an inline error with working "Go to source"; copy
  source; status counts → stats popover values.

## Out of Scope (v1)

- KaTeX/math inspection controls; frontmatter entry deletion; nested/complex YAML
  editing; network/remote find; find-and-replace; per-block Mermaid trust UI.

## Open Questions

- **CSS Custom Highlight API in WebKitGTK** — resolved in plan Phase 0 (verify;
  else `<mark>` fallback). Does not change the public design.
- The `frontmatter` (Malformed) diagnostic is **already emitted and surfaced** —
  no longer open. Remaining work is verification only: confirm it renders in the
  diagnostics panel and wire its `primary_action: "Edit frontmatter"` to open the
  inspector.
- **Vendored-bundle rebuild with `@codemirror/search` v6** — the CodeMirror
  bundle is hand-built with singleton dedupe; adding search risks a
  state/view-instance mismatch (empty parse tree). Plan Phase 0 rebuilds and
  smoke-checks markdown highlighting before any search wiring.

--- SUMMARY ---

- **What:** One slice covering find (source + rendered preview), frontmatter
  inspector + add/edit, Mermaid inline errors + copy source, and a stats popover.
  Targets synthesis items #8/#9/#11/#12.
- **Why combined:** #8/#9/#12 are thin surfacings of facts the backend already
  computes (`CoreDocumentFacts`: frontmatter, counts, embedded blocks); only find
  is a new subsystem. They share status-bar/popover/panel conventions.
- **Key decisions:**
  - Find spans source (add `@codemirror/search` v6 to the **vendored bundle** —
    not a free transitive import — then wire it via a compartment + the existing
    `edit.*` actions) and preview (CSS Custom Highlight API — no DOM mutation, no
    raw-HTML injection; `<mark>` fallback with mandatory teardown if the webview
    lacks the API), with a split-mode scope toggle and match counts.
  - Frontmatter editing is **line-oriented edits to the CodeMirror buffer**
    (add entry + edit recognized value; no delete), preserving comments/unknown
    keys and reusing undo/save/render. New blocks default to YAML.
  - Mermaid: inline error mapped to source line + copy-source button; no math.
  - Stats: click status counts → popover with reading time + structural counts
    from `facts.counts`; inline bar unchanged.
  - Both the frontmatter inspector and stats popover are triggered from the status
    bar; the frontmatter control is always present (chip when frontmatter exists,
    "+ frontmatter" when absent) so the add-block path always has a trigger.
- **Security:** no new sanitization surface (highlight overlay adds no markup);
  frontmatter edits write only to the open in-scope buffer; clipboard copies only
  the document's own content.
- **Risks/Open:** WebKitGTK support for the Custom Highlight API (plan Phase 0,
  with fallback); the vendored CodeMirror bundle rebuild with `@codemirror/search`
  v6 (singleton-dedupe fragility, plan Phase 0 smoke-check). The
  malformed-frontmatter diagnostic already exists and surfaces (verify + wire
  `primary_action` only). None change the public design.
