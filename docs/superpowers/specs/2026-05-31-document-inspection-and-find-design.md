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
  `Compartment`s; `codemirror` meta-package (^6.0.2) ships `@codemirror/search`
  transitively.
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
- Triggers: **status bar** hosts both the stats popover (existing counts) and a
  frontmatter chip (shown only when frontmatter is present).

## Components

### 1. Find (`ui/src/find/`)

New module split into source and preview concerns plus a small controller.

**Source (`find_source.ts`):** add `search({ top: true })` + `searchKeymap` in a
new editor compartment (`editor.ts`). Re-point the three `edit.*` actions in
`main.ts` to `openSearchPanel` / `findNext` / `findPrevious` from
`@codemirror/search`. CodeMirror's panel supplies match highlighting and counts.

**Preview (`find_preview.ts`):** highlight matches inside `#pmd-content` using the
**CSS Custom Highlight API** — build `Range`s over text nodes for the query and
register them with `CSS.highlights.set("pmd-find", highlight)`, styled via
`::highlight(pmd-find)` in CSS. This is an **overlay keyed to ranges: it mutates
no DOM and injects no markup**, satisfying the sanitization constraint and not
disturbing block-incremental reconciliation. Recompute on query change and after
each render (subscribe to the existing post-render hook). Track a "current match"
for next/previous and `scrollIntoView` it.

- **WebKitGTK support is a hard prerequisite.** Phase 0 of the plan verifies
  `CSS.highlights` exists in the app's webview. If absent, fall back to wrapping
  matches in `<mark class="pmd-find">` via DOM `Range`s, torn down and rebuilt per
  render. The fallback is uglier but contained to `find_preview.ts`.

**Controller (`find_controller.ts`):** owns the find bar UI (query input, count
"n/m", prev/next, close, and in split mode a source⇄preview scope segmented
control). Routes to source or preview backend by scope; in single-pane modes the
scope is implied by the active pane. Pure query→ranges logic is unit-tested.

### 2. Mermaid errors + copy source (`mermaid_runner.ts`, `mermaid_zoom.ts`)

- On `mermaid.render` rejection, replace the silent gap with an inline
  `.pmd-mermaid-error` block showing the message and a "Go to source" link. The
  source line comes from the enclosing `[data-src-start]` ancestor; clicking
  scrolls the editor to that line (reuse scroll-sync's line→pos path).
- Add a **"Copy source"** button next to Expand (`addMermaidExpandButton`), copying
  `container.dataset.mermaidSource` to the clipboard.

### 3. Frontmatter inspector + editor (`ui/src/frontmatter/`)

**Inspector (`frontmatter_panel.ts`):** a popover (context-menu-style) opened from
a `.pmd-status-frontmatter` chip that appears only when `facts.frontmatter` is
present. Lists recognized `CommonFrontmatter` fields and unknown keys, with the
format (YAML/TOML) and a malformed/unsupported badge from `syntax`.

**Editing (`frontmatter_edit.ts`, pure):** add a new `key: value` entry and edit a
recognized field's value. Edits are **line-oriented transactions on the CodeMirror
buffer**, located via `frontmatter.line_start`/`line_end`:

- *Edit value*: find the field's line within the block, replace its value text.
- *Add entry*: insert a new line before the block's closing delimiter.
- *No block yet*: insert a new **YAML** block (`---\nkey: value\n---\n`) at the top
  of the document.

Going through the buffer means undo/redo, dirty-state, autosave, and
re-render-from-facts all work unchanged, and existing comments/unknown lines are
preserved (no full re-serialize). Edits are restricted to scalar string/number/
bool values and `tags` (comma-split) — complex nested YAML is read-only in v1.
TOML blocks are editable with TOML syntax; new blocks default to YAML.

**Diagnostic:** ensure malformed/unsupported frontmatter shows as a `frontmatter`
issue in `diagnostics_panel.ts`. If core already emits it, this is surfacing only;
if not, add emission in `crates/pmd-core/src/facts/`.

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
- Mermaid: render failure is shown inline, never silent; "Go to source" no-ops
  gracefully if the block lacks a `data-src-start` ancestor.
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
- Whether core already emits the `frontmatter` diagnostic — confirmed in plan
  Phase 0 (surface vs. add).

--- SUMMARY ---

- **What:** One slice covering find (source + rendered preview), frontmatter
  inspector + add/edit, Mermaid inline errors + copy source, and a stats popover.
  Targets synthesis items #8/#9/#11/#12.
- **Why combined:** #8/#9/#12 are thin surfacings of facts the backend already
  computes (`CoreDocumentFacts`: frontmatter, counts, embedded blocks); only find
  is a new subsystem. They share status-bar/popover/panel conventions.
- **Key decisions:**
  - Find spans source (wire `@codemirror/search`) and preview (CSS Custom
    Highlight API — no DOM mutation, no raw-HTML injection; `<mark>` fallback if
    the webview lacks the API), with a split-mode scope toggle and match counts.
  - Frontmatter editing is **line-oriented edits to the CodeMirror buffer**
    (add entry + edit recognized value; no delete), preserving comments/unknown
    keys and reusing undo/save/render. New blocks default to YAML.
  - Mermaid: inline error mapped to source line + copy-source button; no math.
  - Stats: click status counts → popover with reading time + structural counts
    from `facts.counts`; inline bar unchanged.
  - Both the frontmatter inspector and stats popover are triggered from the status
    bar (a frontmatter chip appears only when frontmatter is present).
- **Security:** no new sanitization surface (highlight overlay adds no markup);
  frontmatter edits write only to the open in-scope buffer; clipboard copies only
  the document's own content.
- **Risks/Open:** WebKitGTK support for the Custom Highlight API (plan Phase 0,
  with fallback); whether the malformed-frontmatter diagnostic already exists
  (surface vs. add). Neither changes the public design.
