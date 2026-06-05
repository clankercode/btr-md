# Event-driven scroll sync (split mode) — design

**Date:** 2026-06-05
**Status:** approved (brainstorming) → planning

## Problem

In `split` mode the editor (LHS) and rendered preview (RHS) scroll
independently. The existing `attachScrollSync` continuously synchronised
LHS→RHS on every scroll/input event; it does not work well and is being
**replaced entirely**.

We want sync that fires **only on discrete user intent**, in both directions:

- **RHS click → LHS:** clicking rendered content moves the editor cursor to the
  corresponding source location and scrolls it into view.
- **LHS edit → RHS:** editing text scrolls the preview so the edited block is
  vertically centred.

There is no continuous coupling — scrolling one pane never moves the other.

## Constraints / context

- Active in `split` mode only. In `source` mode the preview is hidden; in
  `preview` mode the editor is hidden — both triggers are no-ops there.
- The Rust renderer (`pmd-core`) already emits `data-src-start` / `data-src-end`
  on block-level elements: paragraphs, headings, blockquotes, code blocks
  (`pre`), lists, **list items**, tables, **rows (`tr`)**, and **cells
  (`td`/`th`)**. Values are 1-based, inclusive source **line** numbers. There
  are **no inline/word-level** source offsets. No Rust changes are required.
- `data-src-end` is emitted as an empty placeholder and filled in later; by the
  time nodes are in the live DOM it normally has a value, but the code must be
  tolerant of a missing/empty `data-src-end`.
- Per repo CLAUDE.md: the Playwright e2e suite drives a **mocked backend in
  Chromium** whose `renderMarkdown` emits only stub HTML (no real tables / code
  / `data-src` tree), and WebKitGTK caret/click behaviour differs from Chromium.
  The click→dispatch glue and render hook therefore **cannot** be covered by
  e2e and must be verified by hand on `just run`.

## Decisions (from brainstorming)

1. **Click precision:** best-effort word offset. Map the click to the deepest
   tagged block, then attempt to resolve the clicked word to a line+column
   within that block's source range. Fallback to the block's start line.
2. **Existing sync:** replace entirely (it is broken); no opt-in toggle.
3. **Edit→scroll timing:** debounced — recentre once the existing debounced
   re-render settles, not on every keystroke.

## Architecture

### Module: `ui/src/scroll_sync.ts` (rewrite)

```ts
export interface ScrollSyncHandle {
  /** Centre the RHS preview on the most-specific block at 1-based editor `line`.
   *  No-op if no tagged block matches. */
  centerPreviewOnLine(line: number): void;
  /** Mark that a user edit to `docId` happened; the next settled render of that
   *  same doc recentres. No-op (disarms) unless `getMode()==='split'`. */
  notifyEdit(docId: number): void;
  /** Called by `main.ts` from the post-render *success* block (DOM fresh) with
   *  the rendered doc id. Always disarms; recentres on the current cursor line
   *  only when the rendered doc matches the armed doc and still in split mode.
   *  Keying on `docId` makes the trigger race-free — a superseded/rejected
   *  render never reaches this hook, so it cannot drop a newer edit's pending
   *  centre, and a render for a different doc (after a tab switch) disarms
   *  without centring the wrong document. */
  flushPendingEditCenter(docId: number): void;
  detach(): void;
}

export function attachScrollSync(opts: {
  view: EditorView;            // CodeMirror editor (LHS)
  previewPane: HTMLElement;    // scroll container (RHS)
  previewContent: HTMLElement; // holds the data-src-tagged nodes
  getMode: () => Mode;         // current view mode
}): ScrollSyncHandle;
```

### Trigger A — RHS click → LHS cursor + scroll

A single `click` listener on `previewPane`:

1. Bail unless `getMode() === 'split'`.
2. Bail if the click landed on an interactive control:
   `target.closest('a,button,input,textarea,select,[contenteditable],[role="button"]')`.
   This covers preview links and the table / code / mermaid toolbars (all
   buttons), so sync never hijacks their behaviour.
3. Bail if `window.getSelection()` is non-collapsed (user is selecting text to
   copy — don't move the cursor out from under them).
4. Resolve the caret at the click point via `document.caretRangeFromPoint`
   (WebKit/Chromium) with a `caretPositionFromPoint` fallback → text node +
   offset → **word under the caret** (`wordAtCaret`).
5. From the click target, `closest('[data-src-start]')` → deepest tagged block.
   Read `srcStart` (and `srcEnd` if present/valid, else `srcStart`).
6. **Best-effort word offset** (`resolveSourcePosition`): search the source
   lines `[srcStart..srcEnd]` for the word; on first match place the cursor at
   that line+column. If the word is empty or not found, place the cursor at the
   start of `srcStart`.
7. **Clamp** the resolved line to `[1, doc.lines]` and the column to the target
   line's length **before** computing the document position — CodeMirror's
   `dispatch` does not clamp out-of-range positions (only `gotoEditorLine`
   clamps, and we are not routing through it). Then
   `view.dispatch({ selection: { anchor: pos }, scrollIntoView: true })` and
   `view.focus()`.

### Trigger B — LHS edit → RHS centre (debounced after render)

- `onActiveEdit()` (the existing per-edit callback in `main.ts`) calls
  `handle.notifyEdit(tab.docId)`, which arms an internal doc-keyed gate **only
  when already in split mode** (otherwise it disarms). Programmatic renders
  (theme change, tab switch, reload) do not arm it, so they never trigger
  recentring.
- In `processRenderQueue`'s post-render success block (where the DOM is freshly
  reconciled), `main.ts` calls `handle.flushPendingEditCenter(result.doc_id)`.
  That always disarms the gate and, when the rendered doc matches the armed doc
  **and** `getMode()==='split'`, calls `centerPreviewOnLine(<current cursor
  line>)`. Because the gate is keyed on the doc id and disarmed only here on a
  *successful current* render, a superseded/rejected render (which never reaches
  this hook) cannot drop a newer edit's pending centre — no `finally` cancel is
  needed and there is no race. This rides the existing ~180ms render debounce,
  so it is naturally debounced and coalesces keystrokes.
- `centerPreviewOnLine(line)` collects descriptors from
  `previewContent.querySelectorAll('[data-src-start]')` — each `{ el, start,
  end, depth }` where `depth` is the element's DOM nesting depth within
  `previewContent` — and delegates block selection to the pure `pickBlockForLine`
  helper. **Most specific** = largest `start ≤ line` that still covers it
  (`end ≥ line`, with empty/NaN `end` treated as `start`), tie-broken by
  **greatest DOM `depth`** (so a `td`/`th`/`li` wins over its enclosing
  `table`/`tr`/`ul` when they share a source range — smallest line-span alone
  cannot disambiguate equal ranges). The chosen element gets
  `scrollIntoView({ block: 'center', inline: 'nearest' })`, which scrolls the
  nearest scroll container (`previewPane`).

### `main.ts` wiring changes

- Update the `attachScrollSync(...)` call (line ~1627) to the new options
  object; capture the returned handle.
- In `onActiveEdit()`: `scrollSync?.notifyEdit(tab.docId)`.
- In `processRenderQueue`'s post-render success block (after `findController
  .refreshPreview()` etc.): `scrollSync?.flushPendingEditCenter(result.doc_id)`.
  No `finally` hook is required — the doc-keyed gate is disarmed only by this
  successful-current-render path.

## Module boundaries / testability

The repo's UI unit tests use **`node:test`** (`npm run test:unit` →
`node --test src/*.test.ts`); there is no vitest or jsdom dependency. The pure
helpers therefore take **plain strings / descriptor arrays — no DOM** — so they
run under `node:test` with no DOM shim. New file `ui/src/scroll_sync.test.ts`:

- `pickBlockForLine(blocks: { start: number; end: number; depth: number }[],
  line: number): number` — returns the index of the most-specific block (largest
  `start ≤ line` covering `line`, tie-broken by greatest `depth`), or `-1`.
  Tolerant of `NaN`/missing `end`.
- `resolveSourcePosition(srcText: string, srcStart: number, srcEnd: number,
  word: string): { line: number; col: number }` — word search within a line
  range, fallback to `{ line: srcStart, col: 0 }`.
- `wordAt(text: string, offset: number): string` — extract the word at an offset
  in a string (the DOM glue passes `textNode.data` + the caret offset).
- `createEditCenterGate(): EditCenterGate` — the DOM-free doc-keyed
  `arm`/`settle`/`reset` state machine behind the LHS-edit trigger. `arm(docId |
  null)` records the edited doc (null = not split); `settle(renderedDocId,
  split)` always disarms and returns whether to centre (armed doc ===
  rendered doc, in split); `reset()` force-disarms on detach. Keying on the doc
  id is what removes the race — disarming happens only on a successful current
  render, never on a stale one.

The thin DOM/CodeMirror glue (`centerPreviewOnLine`'s `querySelectorAll` + depth
walk, the click handler's caret resolution and `view.dispatch`) wraps these pure
helpers. That glue — plus the post-render recentre over real rendered
tables/code — is **verified manually on `just run`**; the mocked-Chromium e2e
suite can't reach it (per CLAUDE.md), so it is not claimed as e2e-covered.

`ui/tsconfig.json`'s scoped `include` list gains `src/scroll_sync.ts` so the new
module is typechecked by `just check` (the list enumerates unit-tested modules;
`table_copy.ts` is the precedent).

## Error handling

- Missing/NaN `data-src-end` → treated as equal to `srcStart` (single line).
- Caret APIs absent or returning null → fall back to the block start line; never
  throw.
- No tagged block found for a line → `centerPreviewOnLine` is a silent no-op.
- Out-of-range line/column → the module clamps both (line to `[1, doc.lines]`,
  column to the target line length) **before** building the dispatch position,
  because CodeMirror's `dispatch` does not clamp (unlike `gotoEditorLine`).
- The edit-centre gate is keyed on doc id and disarmed only on a successful
  current render, so a rejected or superseded render can neither drop a newer
  edit's pending centre nor recentre an unrelated later render / wrong document.

## Out of scope

- Inline/word-level source mapping in the renderer (no `data-src` on inline
  spans) — best-effort text search is the substitute.
- Continuous scroll-position coupling between panes.
- A user-facing on/off setting.

## Files touched

| File | Change |
|------|--------|
| `ui/src/scroll_sync.ts` | Full rewrite to the new API + pure helpers |
| `ui/src/scroll_sync.test.ts` | New — `node:test` unit tests for the pure helpers |
| `ui/src/main.ts` | New `attachScrollSync` call; `notifyEdit(tab.docId)` in `onActiveEdit`; `flushPendingEditCenter(result.doc_id)` in post-render success hook |
| `ui/tsconfig.json` | Add `src/scroll_sync.ts` to the scoped `include` list |

No Rust changes.

--- SUMMARY ---

- **Goal:** replace the broken continuous `attachScrollSync` with two discrete,
  event-driven sync triggers, active only in `split` mode.
- **RHS click → LHS:** ignore interactive targets and active selections; resolve
  the clicked word via caret APIs; map to the deepest `[data-src-start]` block;
  best-effort search the block's source line range for the word to set
  line+column (fallback: block start); dispatch cursor move + `scrollIntoView`.
- **LHS edit → RHS:** `onActiveEdit` flags a pending recentre (only in split
  mode); the existing debounced render's post-render hook
  (`flushPendingEditCenter`) clears the flag and centres the most-specific block
  (deepest matching DOM element) at the cursor line via
  `scrollIntoView({block:'center'})`. Programmatic renders are excluded and a
  stale flag can never carry over.
- **Data available:** renderer already tags block-level source line ranges
  (down to table cells / list items); no inline offsets and no Rust changes.
- **Testing:** DOM-free pure helpers (`pickBlockForLine`,
  `resolveSourcePosition`, `wordAt`) get `node:test` unit tests (the repo's UI
  test runner; no vitest/jsdom); the CodeMirror/WebKit/real-render glue is
  verified by hand on `just run` (the mocked-Chromium e2e suite can't reach it,
  per CLAUDE.md).
- **Open questions:** none blocking.
