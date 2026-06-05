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
  /** Mark that a user edit happened; the next settled render will recentre. */
  notifyEdit(): void;
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
7. `view.dispatch({ selection: { anchor: pos }, scrollIntoView: true })` then
   `view.focus()`.

### Trigger B — LHS edit → RHS centre (debounced after render)

- `onActiveEdit()` (the existing per-edit callback in `main.ts`) calls
  `handle.notifyEdit()`, which sets an internal `editCenterPending` flag. **Only
  this path sets it** — programmatic renders (theme change, tab switch, reload)
  do not, so they never trigger recentring.
- In `processRenderQueue`'s post-render success block (where the DOM is freshly
  reconciled), if `editCenterPending` **and** `getMode()==='split'`, call
  `centerPreviewOnLine(<current cursor line>)` and clear the flag. This rides
  the existing ~180ms render debounce, so it is naturally debounced and
  coalesces keystrokes.
- `centerPreviewOnLine(line)` (`findBlockForLine`): among
  `previewContent.querySelectorAll('[data-src-start]')`, pick the **most
  specific** block containing `line` — largest `srcStart ≤ line`, tie-broken by
  smallest span (`srcEnd - srcStart`), tolerant of empty `srcEnd`. Then
  `el.scrollIntoView({ block: 'center', inline: 'nearest' })`, which scrolls the
  nearest scroll container (`previewPane`).

### `main.ts` wiring changes

- Update the `attachScrollSync(...)` call (line ~1627) to the new options
  object; capture the returned handle.
- In `onActiveEdit()`: `scrollSync?.notifyEdit()`.
- In `processRenderQueue` post-render block: the edit-driven recentre call.

## Module boundaries / testability

Pure (or jsdom-only) helpers, unit-tested with vitest
(`ui/src/scroll_sync.test.ts`):

- `findBlockForLine(content: HTMLElement, line: number): HTMLElement | null` —
  most-specific-block selection; tolerant of missing `data-src-end`.
- `resolveSourcePosition(srcText: string, srcStart: number, srcEnd: number,
  word: string): { line: number; col: number }` — word search within a line
  range, fallback to line start.
- `wordAtCaret(node: Text, offset: number): string` — extract the word at an
  offset in a text node.

The click→dispatch path (real CodeMirror + WebKit caret APIs) and the
post-render recentre (real rendered tables/code) are **verified manually on
`just run`** — not claimed as e2e-covered.

## Error handling

- Missing/NaN `data-src-end` → treated as equal to `srcStart` (single line).
- Caret APIs absent or returning null → fall back to the block start line; never
  throw.
- No tagged block found for a line → `centerPreviewOnLine` is a silent no-op.
- Out-of-range lines are clamped by the editor's existing dispatch (doc bounds).

## Out of scope

- Inline/word-level source mapping in the renderer (no `data-src` on inline
  spans) — best-effort text search is the substitute.
- Continuous scroll-position coupling between panes.
- A user-facing on/off setting.

## Files touched

| File | Change |
|------|--------|
| `ui/src/scroll_sync.ts` | Full rewrite to the new API + helpers |
| `ui/src/scroll_sync.test.ts` | New — unit tests for the pure helpers |
| `ui/src/main.ts` | New `attachScrollSync` call; `notifyEdit()` in `onActiveEdit`; recentre in post-render hook |

No Rust changes.

--- SUMMARY ---

- **Goal:** replace the broken continuous `attachScrollSync` with two discrete,
  event-driven sync triggers, active only in `split` mode.
- **RHS click → LHS:** ignore interactive targets and active selections; resolve
  the clicked word via caret APIs; map to the deepest `[data-src-start]` block;
  best-effort search the block's source line range for the word to set
  line+column (fallback: block start); dispatch cursor move + `scrollIntoView`.
- **LHS edit → RHS:** `onActiveEdit` flags a pending recentre; the existing
  debounced render's post-render hook centres the most-specific block at the
  cursor line via `scrollIntoView({block:'center'})`. Programmatic renders are
  excluded.
- **Data available:** renderer already tags block-level source line ranges
  (down to table cells / list items); no inline offsets and no Rust changes.
- **Testing:** pure helpers (`findBlockForLine`, `resolveSourcePosition`,
  `wordAtCaret`) get vitest unit tests; the CodeMirror/WebKit/real-render glue
  is verified by hand on `just run` (the mocked-Chromium e2e suite can't reach
  it, per CLAUDE.md).
- **Open questions:** none blocking.
