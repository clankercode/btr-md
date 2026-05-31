# Document Inspection & Find Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task. Each task is one bite-sized TDD step (write failing test → run it & see it fail → minimal impl → run & pass → commit). Do not batch tasks. Do not skip the "see it fail" runs.

**Goal:** Let a reader open any Markdown file and (a) find text in both the source editor and the rendered preview, (b) inspect and lightly edit frontmatter, (c) understand why a Mermaid diagram failed and copy its source, and (d) see reading time and structural counts — without turning the previewer into an editor platform. Implements synthesis items #8, #9, #11, #12 as one slice per `docs/superpowers/specs/2026-05-31-document-inspection-and-find-design.md`.

**Architecture:** Tauri 2 desktop app. Rust backend (`crates/pmd-core` parses Markdown into `CoreDocumentFacts`; `crates/pmd-app` wraps it for the preview command and emits `DocumentIssue`s). Vanilla-TS frontend (`ui/src/*.ts`, flat layout, no framework) bundled by esbuild (`vendor/build-app.mjs` → `dist/bundle.js`). CodeMirror 6 is consumed through a **hand-built vendored bundle** (`ui/vendor/codemirror-6/codemirror.bundle.js`, built from `ui/src/codemirror-entry.ts` by `ui/vendor/build-codemirror.mjs`, which aliases the CM singletons to dedupe physical copies). The preview DOM (`#pmd-content`) is block-keyed and reconciled incrementally; backend facts flow through `document_facts_store`. Three of the four features are thin surfacings of facts the backend already computes; only Find is a new subsystem.

**Tech Stack:** Rust (workspace, `cargo`, `just`), TypeScript (Node 22 `node --test` strips types; tests import `./module.ts`), esbuild, CodeMirror 6 (+ `@codemirror/search` v6 added here), Mermaid 11, KaTeX, Playwright (`ui/e2e/*.spec.cjs`). Commands: UI unit `cd ui && npm run test:unit` (single file `node --test src/<file>.test.ts`); typecheck `cd ui && npm run typecheck`; app bundle `cd ui && npm run build`; CM bundle rebuild `cd ui && node vendor/build-codemirror.mjs`; Rust tests `just test` (`cargo test --workspace --exclude pmd-e2e -j 2`); e2e `cd ui && npm run test:e2e:playwright`. **Limit cargo/tests to 2 threads (`-j 2`).** Each task ends with a `git add` + conventional commit.

---

## File Structure

The existing `ui/src` layout is **flat** (verified: `find ui/src -type d` returns only `ui/src`; no subfolders are used anywhere). **Decision: use flat module names** (`find_preview.ts`, not `find/find_preview.ts`) to match the repo convention and keep imports `./x.ts`.

### Created

| File | Responsibility |
| --- | --- |
| `ui/src/find_query.ts` | Pure: enumerate match ranges (`[from,to]` offsets) for a query over a plain string, with case-insensitive matching; `0` matches for empty query. |
| `ui/src/find_query.test.ts` | Unit tests for `findMatches`. |
| `ui/src/find_preview.ts` | Preview-side find backend: detect `CSS.highlights` support; highlight matches in `#pmd-content` via the Custom Highlight API (range overlay, no DOM mutation) or a `<mark>`-fallback built only over existing text nodes with mandatory teardown; track current match + scroll into view; recompute on render. |
| `ui/src/find_preview.test.ts` | Unit tests for the pure helper `mapMatchesToNodeRanges` (per-node sub-ranges tagged with logical `matchIndex`; cross-node match shares one index). |
| `ui/src/find_source.ts` | Source-side find backend: wrappers around the vendored `openSearchPanel`/`findNext`/`findPrevious` + `setSourceQuery` (pushes the typed query into CM's search state) + a `searchCompartment` factory consumed by `editor.ts`. |
| `ui/src/find_controller.ts` | Owns the find-bar UI (query input, `n/m` LOGICAL-match count, prev/next, close, split-mode source⇄preview scope toggle); routes to source/preview backend by scope; pushes the query into CM when scope is source. |
| `ui/src/frontmatter_edit.ts` | Pure, **doc-based** (no `FrontmatterFact`): `locateBlock(doc)` re-derives block bounds from the live buffer, `formatScalar` emits valid YAML/TOML scalars, `editValueChange`/`addEntryChange`/`insertBlockChange` return CodeMirror change descriptors. Decoupled from the async facts store. |
| `ui/src/frontmatter_edit.test.ts` | Unit tests: locateBlock, formatScalar (YAML/TOML quoting), edit/add round trips, comment preservation, fresh-block edit/add with NO facts available. |
| `ui/src/frontmatter_panel.ts` | Inspector popover (context-menu-style) listing recognized + unknown frontmatter fields, format/malformed badge, add-entry + edit-value controls. |
| `ui/src/stats_popover.ts` | Pure row-assembly + reading-time from `StructureCounts`, plus a popover renderer reading the active doc's `facts.counts`. |
| `ui/src/stats_popover.test.ts` | Unit tests for reading time (incl. 0 words) and row assembly from `StructureCounts`. |
| `ui/e2e/document-inspection-find.spec.cjs` | Playwright scenarios for find (source + preview + split scope), frontmatter chip/add/edit, malformed diagnostic, Mermaid inline error + go-to-source + copy-source, stats popover. |

### Modified

| File | Change |
| --- | --- |
| `ui/package.json` | Add `@codemirror/search` v6 dependency. |
| `ui/tsconfig.json` | Add ONLY the genuinely-pure modules (`find_query`, `find_preview`, `frontmatter_edit`, `frontmatter_panel`, `stats_popover`, + `context_menu` if missing) to the `include` allowlist (Task 0.7). `find_source.ts`/`find_controller.ts` stay excluded (they import the untyped bundle / the editor+chrome shells) and are build-verified, like the other shells. |
| `ui/vendor/build-codemirror.mjs` | Add `@codemirror/search` (pinned to the v6 copy) to the singleton `alias` map. |
| `ui/src/codemirror-entry.ts` | Import + re-export `search`, `searchKeymap`, `openSearchPanel`, `findNext`, `findPrevious`, `setSearchQuery`, `SearchQuery`. |
| `ui/src/editor.ts` | Add a `searchCompartment` wired into `buildExtensions()`; expose `openSearch`/`searchNext`/`searchPrevious`/`gotoEditorLine` on `EditorHandle`. (Outside tsconfig — verified via build.) |
| `ui/src/main.ts` | Re-point `edit.find/findNext/findPrevious` to the find controller; add `document.editFrontmatter` handling (doc-based edit handlers, no stale facts); add a single preview-find recompute call after the render if/else; create the find controller, stats popover, and frontmatter panel; wire chrome controls; map the "Edit frontmatter" diagnostic primary_action to open the inspector. (Outside tsconfig — verified via build.) |
| `ui/src/chrome.ts` | Make `.pmd-status-counts` a clickable button (stats popover trigger); add an always-present `.pmd-status-frontmatter` control + `onCountsClick`/`onFrontmatterClick`/`setFrontmatterState` API. (Outside tsconfig — verified via build.) |
| `ui/src/mermaid_zoom.ts` | Export a shared `makeCopySourceButton(source)` factory; use it (idempotently) in `addMermaidExpandButton`. (Outside tsconfig — verified via build.) |
| `ui/src/mermaid_runner.ts` | Replace the bare `textContent = source` catch with a structured inline error (message + "Go to source" link calling injected `gotoEditorLine` + shared `makeCopySourceButton` + visible source). (Outside tsconfig — verified via build.) |
| `ui/src/actions.ts` | Add `document.editFrontmatter` to `ActionId`, `NO_DEFAULT_ACTION_IDS`, and `defaultActionSpecs`. |
| `ui/styles/components.css` | Styles for `.pmd-find-bar`, `.pmd-status-counts` button, `.pmd-status-frontmatter`, `.pmd-frontmatter-panel`, `.pmd-stats-popover`, `.pmd-mermaid-error` structured layout, `::highlight(pmd-find)` / `mark.pmd-find`. |

---

## Phase 0 — Prerequisites & verification (no feature code)

### Task 0.1 — Verify the Malformed frontmatter diagnostic surfaces today (Rust)

Run the existing core test that proves the parser flags malformed frontmatter, then the app test for the emission helper.

Run:
```
just test
```
Expected: passes, including `malformed_yaml_frontmatter_preserves_raw_range_with_default_metadata` (in `crates/pmd-core/tests/document_facts_frontmatter.rs`).

Then confirm the emission helper exists exactly as the spec claims. Open `crates/pmd-app/src/preview/contracts.rs` and read `frontmatter_issues` (~line 293). Confirm it emits, for `syntax == Malformed`, a `DocumentIssue` with `severity: Warning`, `category: Frontmatter`, `primary_action: Some("Edit frontmatter")`. **Do not change it.** Record in the commit message that emission is verified and no new emission is needed.

Commit:
```
git add -A && git commit -m "test(frontmatter): verify malformed-frontmatter diagnostic emission baseline"
```
(If `just test` already passes with no edits, commit an empty marker with `--allow-empty` to anchor the verification step.)

### Task 0.1b — Fix the pre-existing red UI unit-test baseline (stale action count)

**The worktree starts RED on `master`, unrelated to this feature.** A concurrent feature session added actions to `NO_DEFAULT_ACTION_IDS` without updating the count literal in `ui/src/actions.test.ts:53`, which still asserts `17`. The array now has **20** entries (verified by counting `NO_DEFAULT_ACTION_IDS` in `ui/src/actions.ts`), so the test fails `20 !== 17`. The TDD loop needs a green baseline before feature work, so correct the literal first.

First confirm the current failure:
```
cd ui && node --test src/actions.test.ts
```
Expected: FAILS — the last test reports `AssertionError [ERR_ASSERTION]: 20 !== 17` (the `NO_DEFAULT_ACTION_IDS.length` assertion).

Edit `ui/src/actions.test.ts`: change the final assertion in the `"all no-default actions are registered searchable and unbound"` test from `assert.equal(NO_DEFAULT_ACTION_IDS.length, 17);` to `assert.equal(NO_DEFAULT_ACTION_IDS.length, 20);`.

Run:
```
cd ui && node --test src/actions.test.ts
```
Expected: all tests pass (the count now matches the 20-entry array).

Commit:
```
git add -A && git commit -m "test(actions): correct stale NO_DEFAULT_ACTION_IDS count baseline"
```
(This is a pre-existing breakage from concurrent work; we fix it up front so the rest of the plan starts from green. Task 2.10 bumps the literal to 21 when this feature adds `document.editFrontmatter`.)

### Task 0.2 — Decide the preview-highlight strategy (`CSS.highlights` probe)

The app's webview is WebKitGTK. We cannot rely on `CSS.highlights` being present. Add a **runtime feature probe** that the preview-find code branches on, so no manual environment step is needed and the choice is testable.

Write the probe as part of `find_preview.ts` later (Task 1.6). For Phase 0, document the **decision rule** here so the implementer hard-codes it:

- Probe: `typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight === "function"`.
- If `true` → **Custom Highlight API path**: build `Range`s, `CSS.highlights.set("pmd-find", new Highlight(...ranges))`, styled via `::highlight(pmd-find)`. No DOM mutation.
- If `false` → **`<mark class="pmd-find">` fallback**: wrap matches using `Range.surroundContents`/`splitText` over **existing text nodes only** (never `innerHTML`); **tear down every `mark.pmd-find` across `#pmd-content` before each recompute** (because incremental reconciliation keeps unchanged keyed nodes, stale marks would otherwise survive).

To confirm the live webview value during development, the implementer may run the app (`just dev` or the app binary) and evaluate `"highlights" in CSS` in the devtools console; this is informational only — the shipped code branches on the probe regardless. No commit for this task (documentation/decision only); it is realized in Task 1.6.

### Task 0.3 — Add `@codemirror/search` v6 as a dependency

Read `ui/package.json`. The repo has two physical `@codemirror/search` copies: hoisted `0.20.1` (from the unused `@codemirror/basic-setup` dep) and nested `node_modules/codemirror/node_modules/@codemirror/search` `6.7.0` (verified). Add a **direct** v6 dependency so a v6 copy is pinned and resolvable.

Edit `ui/package.json` `dependencies` to add (keeping alphabetical order, after `@codemirror/merge`):
```json
    "@codemirror/search": "^6.5.0",
```

Run:
```
cd ui && npm install
```
Expected: installs without error; `node_modules/@codemirror/search/package.json` reports a `6.x` version (the direct dep upgrades the hoisted copy from `0.20.1`).

Verify:
```
cd ui && node -e "console.log(require('./node_modules/@codemirror/search/package.json').version)"
```
Expected: prints `6.x.y` (>= 6.5.0).

Commit:
```
git add -A && git commit -m "build(ui): add @codemirror/search v6 direct dependency"
```

### Task 0.4 — Alias `@codemirror/search` to the v6 copy in the CM bundle build

Read `ui/vendor/build-codemirror.mjs`. The `SINGLETONS` array aliases `@codemirror/state`, `@codemirror/view`, `@codemirror/language`, `@lezer/common` to one physical dir each via `packageDir`. `@codemirror/search` is NOT a state-holding singleton, but it transitively imports `@codemirror/state`/`@codemirror/view`; those are already aliased, so search will share them. To guarantee esbuild bundles the **v6** search (not the stale `0.20.1`), add an explicit alias entry pinning search to its resolved dir.

Edit `ui/vendor/build-codemirror.mjs`. After the `for (const pkg of SINGLETONS)` loop that populates `alias`, add:
```js
// @codemirror/search is not a shared-state singleton, but the tree must use the
// v6 copy (it imports the already-aliased state/view singletons). Pin its dir so
// esbuild does not bundle the stale 0.20.1 hoisted copy.
alias['@codemirror/search'] = packageDir('@codemirror/search');
```

Run (to confirm `packageDir` resolves and the log shows search; the bundle itself is exercised in Task 0.6):
```
cd ui && node -e "const{createRequire}=require('node:module');const path=require('node:path');const{existsSync,readFileSync}=require('node:fs');const anchor=path.join(process.cwd(),'node_modules','@codemirror','lang-markdown','package.json');const req=createRequire(anchor);function packageDir(n){let d=path.dirname(req.resolve(n));while(d!==path.dirname(d)){const pj=path.join(d,'package.json');if(existsSync(pj)&&JSON.parse(readFileSync(pj,'utf8')).name===n)return d;d=path.dirname(d);}throw new Error(n);}const dir=packageDir('@codemirror/search');console.log('search ->', JSON.parse(readFileSync(path.join(dir,'package.json'),'utf8')).version);"
```
Expected: prints `search -> 6.x.y`.

Commit:
```
git add -A && git commit -m "build(ui): pin @codemirror/search v6 in CM bundle alias map"
```

### Task 0.5 — Re-export search APIs from `codemirror-entry.ts`

Read `ui/src/codemirror-entry.ts`. Add the import and re-export.

Edit `ui/src/codemirror-entry.ts`. After the `import { unifiedMergeView } from '@codemirror/merge';` line add (`setSearchQuery`/`SearchQuery` are needed so the find bar can push our typed query into CM's search state — used by `setSourceQuery` in Task 1.3 and the controller in Task 1.7):
```ts
import {
  search,
  searchKeymap,
  openSearchPanel,
  findNext,
  findPrevious,
  setSearchQuery,
  SearchQuery,
} from '@codemirror/search';
```
And inside the `export { ... };` block, add (after `unifiedMergeView,`):
```ts
  search,
  searchKeymap,
  openSearchPanel,
  findNext,
  findPrevious,
  setSearchQuery,
  SearchQuery,
```

Commit:
```
git add -A && git commit -m "feat(ui): export @codemirror/search APIs from codemirror entry"
```

### Task 0.6 — Rebuild the vendored bundle and smoke-check markdown highlighting

The singleton dedupe is the known fragile point: if search drags in a second `@codemirror/state`/`view`, the markdown parse tree goes empty (no highlighting). Rebuild and verify the bundle exports the search symbols **and** still parses markdown.

Run:
```
cd ui && node vendor/build-codemirror.mjs
```
Expected: prints `[build-codemirror] dedupe aliases:` with each singleton at a `6.x` version, finishes with esbuild's success summary, writes `vendor/codemirror-6/codemirror.bundle.js`.

Smoke-check the bundle exports + a non-empty markdown tree:
```
cd ui && node --input-type=module -e "import * as cm from './vendor/codemirror-6/codemirror.bundle.js'; const need=['openSearchPanel','findNext','findPrevious','search','searchKeymap','setSearchQuery','SearchQuery','EditorState','markdown','markdownLanguage','syntaxTree','GFM']; for(const n of need){ if(typeof cm[n]==='undefined'){ throw new Error('missing export '+n); } } const st=cm.EditorState.create({doc:'# Title\n\n**bold**',extensions:[cm.markdown({base:cm.markdownLanguage,extensions:[cm.GFM]})]}); const tree=cm.syntaxTree(st); let nodes=0; tree.iterate({enter(){nodes++;}}); console.log('exports ok; tree nodes:', nodes); if(nodes<3){ throw new Error('EMPTY PARSE TREE — singleton dedupe broke'); }"
```
Expected: prints `exports ok; tree nodes: N` with `N >= 3`. If it throws "EMPTY PARSE TREE", the alias dedupe regressed — STOP and fix `build-codemirror.mjs` (do not proceed to feature wiring).

Run the full UI check that the bundle feeds:
```
cd ui && npm run typecheck && npm run test:unit
```
Expected: typecheck passes; existing unit tests pass.

Commit:
```
git add -A && git commit -m "build(ui): rebuild CM bundle with @codemirror/search; verify markdown tree intact"
```

### Task 0.7 — Add ONLY the genuinely-pure modules to the tsconfig `include` allowlist

`npm run typecheck` runs `tsc -p tsconfig.json`, whose `include` is a **deliberate allowlist** (verified header: "Add new modules to `include` as they are written; do NOT glob src/."). Crucially, **type-only imports still pull the imported `.ts` module into the tsc program.** So if an allowlisted module imports `./editor.js` or `./chrome.js`, those excluded shells get compiled too — and they have real strict errors (untyped vendored-bundle imports, `btn.dataset` on `Element`, etc.), breaking typecheck. The allowlist must therefore include **only modules whose entire import graph is already-allowlisted modules + DOM/standard libs**.

Audit of the new modules (verified against the import statements in each create-task):
- `find_query.ts` — no imports. **Allowlist.**
- `find_preview.ts` — imports `./find_query.js` only (allowlisted). Uses only `document`/`Range`/`NodeFilter`/`TreeWalker` (in `lib.dom`) plus `CSS`/`Highlight` via casts. **Allowlist.**
- `frontmatter_edit.ts` — imports `./document_contracts.js` only (already allowlisted). **Allowlist.**
- `stats_popover.ts` — imports `./document_contracts.js` + `./context_menu.js` (both allowlisted/DOM). **Allowlist.**
- `frontmatter_panel.ts` — imports `./document_contracts.js` + `./context_menu.js` (allowlisted/DOM). **Allowlist.**
- `find_source.ts` — imports the **vendored bundle** (`../vendor/codemirror-6/codemirror.bundle.js`, untyped). **Do NOT allowlist** — verify via `npm run build` like the shells.
- `find_controller.ts` — imports `EditorHandle` from `./editor.js` and `Mode` from `./chrome.js` (excluded shells). **Do NOT allowlist** — pulling those in would break typecheck; verify via `npm run build`.

Note: `context_menu.ts` is NOT yet in the allowlist — verify with `grep -n context_menu ui/tsconfig.json`; if absent, add `"src/context_menu.ts"` too (it is a pure DOM helper: read it to confirm it imports nothing outside `lib.dom`). If it is already present, skip that line.

Edit `ui/tsconfig.json`. In the `include` array, after `"src/shortcut_editor.ts"` add a comma to that entry and append the five pure modules (plus `context_menu.ts` only if missing):
```json
    "src/shortcut_editor.ts",
    "src/context_menu.ts",
    "src/find_query.ts",
    "src/find_preview.ts",
    "src/frontmatter_edit.ts",
    "src/frontmatter_panel.ts",
    "src/stats_popover.ts"
```
**No bundle `.d.ts` is needed** — with `find_source.ts` excluded, no allowlisted module imports the vendored bundle.

Run:
```
cd ui && npm run typecheck
```
Expected: passes. Verified: `tsc` does **not** error when an explicit `include` path does not exist yet — it ignores the entry until the file is created, then type-checks it. So adding all paths up front is safe and each later "typecheck passes" assertion becomes real once that module exists.

Commit:
```
git add -A && git commit -m "build(ui): allowlist pure find/frontmatter/stats modules for typecheck"
```

---

## Phase 1 — Find (source + rendered preview)

### Task 1.1 — Pure `findMatches`: failing test

Create `ui/src/find_query.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { findMatches } from "./find_query.ts";

test("empty query yields no matches", () => {
  assert.deepEqual(findMatches("hello world", ""), []);
});

test("case-insensitive matches return offset ranges", () => {
  assert.deepEqual(findMatches("Hello hello HELLO", "hello"), [
    [0, 5],
    [6, 11],
    [12, 17],
  ]);
});

test("overlapping is non-greedy left-to-right (no overlap)", () => {
  assert.deepEqual(findMatches("aaaa", "aa"), [
    [0, 2],
    [2, 4],
  ]);
});

test("no matches yields empty array", () => {
  assert.deepEqual(findMatches("abc", "z"), []);
});
```

Run:
```
cd ui && node --test src/find_query.test.ts
```
Expected: FAILS — `Cannot find module './find_query.ts'`.

### Task 1.2 — Implement `findMatches`; pass

Create `ui/src/find_query.ts`:
```ts
/** A match as a half-open offset range `[from, to)` into the searched string. */
export type MatchRange = [number, number];

/**
 * Enumerate case-insensitive, non-overlapping matches of `query` in `text`,
 * left to right. An empty query yields no matches.
 */
export function findMatches(text: string, query: string): MatchRange[] {
  if (query.length === 0) return [];
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const ranges: MatchRange[] = [];
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    ranges.push([idx, idx + needle.length]);
    from = idx + needle.length;
  }
  return ranges;
}
```

Run:
```
cd ui && node --test src/find_query.test.ts
```
Expected: 4 tests pass.

Commit:
```
git add -A && git commit -m "feat(find): pure case-insensitive match enumeration"
```

### Task 1.3 — `find_source.ts` source backend (search compartment factory + nav wrappers)

Read `ui/src/editor.ts` (the `Compartment` usage of `wrapCompartment`/`diffCompartment` in `buildExtensions`). The source backend is a thin module that `editor.ts` consumes; keeping it separate matches the spec's module split.

`basicSetup` already includes `searchKeymap` in its keymap (verified in `node_modules/codemirror/dist/index.js`) but does **not** include the `search()` extension itself — so the compartment supplies only `search({ top: true })`; do NOT add a second `keymap.of(searchKeymap)` (it would duplicate the keymap, and `keymap` is not exported from the bundle).

Create `ui/src/find_source.ts`. It imports the **untyped vendored bundle**, so — like `main.ts`/`editor.ts` — it is **intentionally outside tsconfig** (Task 0.7 does NOT allowlist it); view params are typed `any` (matching the bundle's untyped symbols):
```ts
import {
  search,
  openSearchPanel,
  findNext,
  findPrevious,
  setSearchQuery,
  SearchQuery,
} from '../vendor/codemirror-6/codemirror.bundle.js';

/** The search extension installed in the editor's search compartment. The panel
 *  is shown at the top and supplies CodeMirror's own match highlighting/counts.
 *  basicSetup already binds searchKeymap, so only the search() extension is added. */
export function searchExtension(): unknown {
  return search({ top: true });
}

/** Open CodeMirror's find panel over the given view (an EditorView, typed `any`). */
export function openSourceFind(view: any): void {
  openSearchPanel(view);
}

/** Push the find-bar query into CodeMirror's search state so the source pane
 *  searches for it (one input drives both panes). */
export function setSourceQuery(view: any, query: string): void {
  view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: query })) });
}

/** Advance to the next/previous source match (no-ops if the panel is closed). */
export function sourceFindNext(view: any): void {
  findNext(view);
}
export function sourceFindPrevious(view: any): void {
  findPrevious(view);
}
```

`find_source.ts` imports the untyped bundle and is **outside tsconfig** (verified: allowlisting a bundle-importer would drag the untyped `.js` into `tsc` and error). Verify via the esbuild build instead.

Run:
```
cd ui && npm run build
```
Expected: app bundle builds without error (esbuild resolves the bundle re-exports from Task 0.5).

Commit:
```
git add -A && git commit -m "feat(find): source-side find backend over vendored CM search"
```

### Task 1.4 — Wire the search compartment + nav + `gotoEditorLine` into `editor.ts`

Read `ui/src/editor.ts`. Mirror the existing `wrapCompartment`/`diffCompartment` pattern. Mermaid (Phase 3) also needs `gotoEditorLine`, so add it now on `EditorHandle`, mirroring `jumpEditorToBlock`'s dispatch in `main.ts`.

Edit `ui/src/editor.ts`:

1. Add an import from `find_source.js` (the search symbols come from there; no bundle-import change is needed in `editor.ts`):
```ts
import { searchExtension, openSourceFind, sourceFindNext, sourceFindPrevious } from './find_source.js';
```

2. In the `EditorHandle` interface, add (after `setDiff`):
```ts
  /** Open CodeMirror's source find panel. */
  openSearch: () => void;
  /** Advance to the next source search match. */
  searchNext: () => void;
  /** Advance to the previous source search match. */
  searchPrevious: () => void;
  /** Move the selection+viewport to 1-based `line` (clamped); no-op if out of range. */
  gotoEditorLine: (line: number) => void;
```

3. Add a module-level compartment beside `wrapCompartment`/`diffCompartment` (line ~103–104):
```ts
const searchCompartment = new Compartment();
```

4. In `buildExtensions()` (after `diffCompartment.of([])`), add:
```ts
    searchCompartment.of(searchExtension()),
```

5. In the returned `EditorHandle` object (after `setDiff`), add:
```ts
    openSearch: () => openSourceFind(view),
    searchNext: () => sourceFindNext(view),
    searchPrevious: () => sourceFindPrevious(view),
    gotoEditorLine: (line: number) => {
      const total = view.state.doc.lines;
      const n = Math.max(1, Math.min(total, line));
      const pos = view.state.doc.line(n).from;
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    },
```

`editor.ts` is **intentionally outside tsconfig** (untyped vendored-bundle imports), so `npm run typecheck` does not cover this change — verify via the esbuild bundle instead.

Run:
```
cd ui && node vendor/build-codemirror.mjs >/dev/null && npm run build
```
Expected: app bundle builds without error (esbuild resolves `find_source.js` and the new `EditorHandle` members). Both `editor.ts` and `find_source.ts` are outside tsconfig (untyped bundle imports), so the build — not typecheck — is the verification here.

Commit:
```
git add -A && git commit -m "feat(editor): search compartment + nav helpers + gotoEditorLine"
```

### Task 1.5 — `find_preview.ts` pure helpers: failing test

The pure helpers (independent of `document`/`CSS`) are: collecting visible text nodes under a root, and mapping a flat-text match-range list to per-text-node sub-ranges. These are unit-testable with `jsdom`-free DOM stubs (Node 22 has no DOM, so the helpers operate on a minimal node shape we pass in).

Each sub-range carries the `matchIndex` of the **logical** match it belongs to, so a match that spans two text nodes shares one `matchIndex`. The controller's count/nav index logical matches (Finding: cross-node matches must not double-count), not sub-ranges.

Create `ui/src/find_preview.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mapMatchesToNodeRanges, type TextChunk } from "./find_preview.ts";

// Three text nodes concatenating to "foobarfoo"; query "foo" matches at 0 and 6.
const chunks: TextChunk[] = [
  { node: "A", start: 0, text: "foo" },
  { node: "B", start: 3, text: "bar" },
  { node: "C", start: 6, text: "foo" },
];

test("maps flat ranges to per-node offsets tagged with their logical matchIndex", () => {
  const out = mapMatchesToNodeRanges(chunks, [[0, 3], [6, 9]]);
  assert.deepEqual(out, [
    { matchIndex: 0, node: "A", from: 0, to: 3 },
    { matchIndex: 1, node: "C", from: 0, to: 3 },
  ]);
});

test("a match spanning two nodes splits into two sub-ranges sharing one matchIndex", () => {
  // query "obar": match [2,6) spans node A (offset 2..3) and node B (0..3)
  const out = mapMatchesToNodeRanges(chunks, [[2, 6]]);
  assert.deepEqual(out, [
    { matchIndex: 0, node: "A", from: 2, to: 3 },
    { matchIndex: 0, node: "B", from: 0, to: 3 },
  ]);
});

test("two matches keep distinct matchIndex values", () => {
  // matches [[0,3],[2,6]] → match 0 in A only; match 1 spans A+B
  const out = mapMatchesToNodeRanges(chunks, [[0, 3], [2, 6]]);
  assert.deepEqual(out.map((r) => r.matchIndex), [0, 1, 1]);
});

test("empty match list yields no node ranges", () => {
  assert.deepEqual(mapMatchesToNodeRanges(chunks, []), []);
});
```

Run:
```
cd ui && node --test src/find_preview.test.ts
```
Expected: FAILS — module not found.

### Task 1.6 — Implement `find_preview.ts`; pass

Create `ui/src/find_preview.ts`:
```ts
import { findMatches, type MatchRange } from './find_query.js';

/** A flattened text node: its concatenation `start` offset and `text`. The
 *  `node` field is `Text` at runtime; tests pass a string stand-in. */
export interface TextChunk {
  node: unknown;
  start: number;
  text: string;
}

/** A highlight sub-range within a single text node, tagged with the index of
 *  the LOGICAL match it belongs to (a cross-node match shares one matchIndex). */
export interface NodeRange {
  matchIndex: number;
  node: unknown;
  from: number;
  to: number;
}

/**
 * Split flat-text match ranges into per-text-node sub-ranges. A match that
 * spans several chunks produces one sub-range per overlapped chunk, all tagged
 * with that match's index (its position in `matches`). Pure.
 */
export function mapMatchesToNodeRanges(
  chunks: TextChunk[],
  matches: MatchRange[],
): NodeRange[] {
  const out: NodeRange[] = [];
  matches.forEach(([mFrom, mTo], matchIndex) => {
    for (const chunk of chunks) {
      const chunkEnd = chunk.start + chunk.text.length;
      const overlapFrom = Math.max(mFrom, chunk.start);
      const overlapTo = Math.min(mTo, chunkEnd);
      if (overlapFrom < overlapTo) {
        out.push({
          matchIndex,
          node: chunk.node,
          from: overlapFrom - chunk.start,
          to: overlapTo - chunk.start,
        });
      }
    }
  });
  return out;
}

// --- Live DOM side (not unit-tested; exercised via e2e) ---------------------

const HIGHLIGHT_NAME = 'pmd-find';
const MARK_CLASS = 'pmd-find';

/** True when the webview supports the CSS Custom Highlight API (Phase 0 rule). */
export function supportsHighlightApi(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    'highlights' in CSS &&
    typeof (globalThis as { Highlight?: unknown }).Highlight === 'function'
  );
}

/** Collect non-empty text nodes under `root` and their concatenation offsets. */
function collectTextChunks(root: HTMLElement): TextChunk[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const chunks: TextChunk[] = [];
  let start = 0;
  let node = walker.nextNode();
  while (node) {
    const text = node.textContent ?? '';
    if (text.length > 0) {
      chunks.push({ node, start, text });
      start += text.length;
    }
    node = walker.nextNode();
  }
  return chunks;
}

export interface PreviewFind {
  /** Re-run the current query against the live preview DOM. Safe to call often. */
  recompute(): void;
  /** Set the query and recompute; returns total match count. */
  setQuery(query: string): number;
  /** Number of matches from the last recompute. */
  count(): number;
  /** Move the current highlight; wraps around. No-op when there are no matches. */
  next(): void;
  previous(): void;
  /** 1-based index of the current match, or 0 when none. */
  currentIndex(): number;
  /** Clear all highlights/marks. */
  clear(): void;
}

/** Build a preview-find controller bound to a content root. */
export function createPreviewFind(root: HTMLElement): PreviewFind {
  const useHighlightApi = supportsHighlightApi();
  let query = '';
  // `rangesByMatch[i]` holds the Range(s) of logical match `i` (a cross-node
  // match has >1 range). `allRanges` is the flat union for painting. `current`
  // indexes LOGICAL matches, so count()/next/previous never double-count.
  let rangesByMatch: Range[][] = [];
  let allRanges: Range[] = [];
  let current = -1;

  function tearDownMarks(): void {
    // Fallback path only: marks survive in unchanged reconciled blocks, so
    // remove every pmd-find mark across the live root, unwrapping in place.
    root.querySelectorAll<HTMLElement>(`mark.${MARK_CLASS}`).forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    });
  }

  function clearHighlights(): void {
    if (useHighlightApi) {
      (CSS as unknown as { highlights: Map<string, unknown> }).highlights.delete(HIGHLIGHT_NAME);
    } else {
      tearDownMarks();
    }
    rangesByMatch = [];
    allRanges = [];
  }

  function buildRanges(): Range[][] {
    const chunks = collectTextChunks(root);
    const flat = chunks.map((c) => c.text).join('');
    const matches = findMatches(flat, query);
    const nodeRanges = mapMatchesToNodeRanges(chunks, matches);
    const byMatch: Range[][] = matches.map(() => []);
    for (const nr of nodeRanges) {
      try {
        const r = document.createRange();
        r.setStart(nr.node as Node, nr.from);
        r.setEnd(nr.node as Node, nr.to);
        byMatch[nr.matchIndex].push(r);
      } catch {
        // A stale node from a concurrent reconcile: skip it, never throw.
      }
    }
    // Drop logical matches that produced no live ranges (all skipped).
    return byMatch.filter((group) => group.length > 0);
  }

  function paint(): void {
    if (useHighlightApi) {
      const HighlightCtor = (globalThis as { Highlight: new (...r: Range[]) => unknown }).Highlight;
      (CSS as unknown as { highlights: Map<string, unknown> }).highlights.set(
        HIGHLIGHT_NAME,
        new HighlightCtor(...allRanges),
      );
    } else {
      // Wrap each range's content in a <mark>. Iterate in reverse so earlier
      // ranges' offsets stay valid as later ones mutate the tree.
      for (let i = allRanges.length - 1; i >= 0; i--) {
        try {
          const mark = document.createElement('mark');
          mark.className = MARK_CLASS;
          allRanges[i].surroundContents(mark);
        } catch {
          // Range not surroundable (crosses element boundary): skip safely.
        }
      }
    }
  }

  function scrollCurrentIntoView(): void {
    const group = rangesByMatch[current];
    const r = group?.[0]; // first sub-range of the current logical match
    if (!r) return;
    const node = r.startContainer.parentElement;
    node?.scrollIntoView({ block: 'center' });
  }

  function recompute(): void {
    clearHighlights();
    if (query.length === 0) {
      current = -1;
      return;
    }
    rangesByMatch = buildRanges();
    allRanges = rangesByMatch.flat();
    current = rangesByMatch.length > 0 ? Math.min(Math.max(current, 0), rangesByMatch.length - 1) : -1;
    paint();
  }

  return {
    recompute,
    setQuery(next: string): number {
      query = next;
      current = -1;
      recompute();
      return rangesByMatch.length;
    },
    count: () => rangesByMatch.length,
    next(): void {
      if (rangesByMatch.length === 0) return;
      current = (current + 1) % rangesByMatch.length;
      scrollCurrentIntoView();
    },
    previous(): void {
      if (rangesByMatch.length === 0) return;
      current = (current - 1 + rangesByMatch.length) % rangesByMatch.length;
      scrollCurrentIntoView();
    },
    currentIndex: () => (current >= 0 ? current + 1 : 0),
    clear(): void {
      query = '';
      current = -1;
      clearHighlights();
    },
  };
}
```

Run:
```
cd ui && node --test src/find_preview.test.ts && npm run typecheck
```
Expected: 4 tests pass; typecheck passes (`find_preview.ts` is in the tsconfig allowlist).

Security note (state in commit): the Custom Highlight path mutates **no DOM and injects no markup**; the `<mark>` fallback uses only `surroundContents` over existing text nodes (never `innerHTML`) and tears down every `mark.pmd-find` before each recompute.

Commit:
```
git add -A && git commit -m "feat(find): preview highlight backend (Custom Highlight API + mark fallback)"
```

### Task 1.7 — `find_controller.ts`: the find bar UI + scope routing

Read `ui/src/context_menu.ts` (popover dismissal pattern) and `ui/src/chrome.ts` `Mode` type for the split-mode check. The controller owns a fixed find bar at the top of the preview/editor region. Scope is a segmented control shown only in `split` mode; in single-pane modes scope is implied by the active pane.

Create `ui/src/find_controller.ts`:
```ts
import type { EditorHandle } from './editor.js';
import { createPreviewFind, type PreviewFind } from './find_preview.js';
import { setSourceQuery } from './find_source.js';
import type { Mode } from './chrome.js';

export type FindScope = 'source' | 'preview';

export interface FindControllerDeps {
  getEditor: () => EditorHandle | null;
  previewContent: HTMLElement;
  getMode: () => Mode;
}

export interface FindController {
  element: HTMLElement;
  /** Open the find bar; routes to the implied scope for the current mode. */
  open(): void;
  close(): void;
  next(): void;
  previous(): void;
  /** Recompute the preview overlay against the freshly rendered DOM. */
  refreshPreview(): void;
  isOpen(): boolean;
}

export function createFindController(deps: FindControllerDeps): FindController {
  const preview: PreviewFind = createPreviewFind(deps.previewContent);

  const bar = document.createElement('div');
  bar.className = 'pmd-find-bar';
  bar.hidden = true;
  bar.setAttribute('role', 'search');

  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'pmd-find-input';
  input.setAttribute('aria-label', 'Find in document');
  input.placeholder = 'Find';

  const countEl = document.createElement('span');
  countEl.className = 'pmd-find-count';
  countEl.textContent = '0/0';

  const scopeGroup = document.createElement('div');
  scopeGroup.className = 'pmd-find-scope';
  scopeGroup.setAttribute('role', 'tablist');
  const scopeButtons: Record<FindScope, HTMLButtonElement> = {
    source: makeScopeBtn('Source', 'source'),
    preview: makeScopeBtn('Preview', 'preview'),
  };
  scopeGroup.append(scopeButtons.source, scopeButtons.preview);

  const prevBtn = makeIconBtn('‹', 'Previous match');
  const nextBtn = makeIconBtn('›', 'Next match');
  const closeBtn = makeIconBtn('×', 'Close find');

  bar.append(input, countEl, scopeGroup, prevBtn, nextBtn, closeBtn);

  let scope: FindScope = 'preview';

  function makeScopeBtn(label: string, value: FindScope): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pmd-find-scope-btn';
    b.textContent = label;
    b.dataset.scope = value;
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => setScope(value));
    return b;
  }
  function makeIconBtn(label: string, title: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pmd-find-btn';
    b.textContent = label;
    b.title = title;
    return b;
  }

  function impliedScope(): FindScope {
    const mode = deps.getMode();
    if (mode === 'source') return 'source';
    if (mode === 'preview') return 'preview';
    return scope; // split: user choice
  }

  function updateScopeUi(): void {
    const splitMode = deps.getMode() === 'split';
    scopeGroup.hidden = !splitMode;
    for (const value of ['source', 'preview'] as FindScope[]) {
      scopeButtons[value].setAttribute('aria-selected', String(value === scope));
      scopeButtons[value].classList.toggle('data-active', value === scope);
    }
  }

  function updateCount(): void {
    if (impliedScope() === 'preview') {
      countEl.textContent = `${preview.currentIndex()}/${preview.count()}`;
      const none = preview.count() === 0;
      prevBtn.disabled = none;
      nextBtn.disabled = none;
    } else {
      // Source counts/highlighting come from CodeMirror's own panel.
      countEl.textContent = '';
      prevBtn.disabled = false;
      nextBtn.disabled = false;
    }
  }

  /** Push the typed query into CodeMirror's search state so the source pane
   *  actually searches for it (one input drives both panes). */
  function pushSourceQuery(): void {
    const ed = deps.getEditor();
    if (ed) setSourceQuery(ed.view, input.value);
  }

  function applyQuery(): void {
    if (impliedScope() === 'preview') {
      preview.setQuery(input.value);
    } else {
      preview.clear();
      pushSourceQuery();
    }
    updateCount();
  }

  function setScope(next: FindScope): void {
    scope = next;
    updateScopeUi();
    if (next === 'source') {
      preview.clear();
      const ed = deps.getEditor();
      ed?.openSearch();
      pushSourceQuery();
    }
    applyQuery();
  }

  input.addEventListener('input', applyQuery);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); api.next(); }
    else if (e.key === 'Escape') { e.preventDefault(); api.close(); }
  });
  prevBtn.addEventListener('click', () => api.previous());
  nextBtn.addEventListener('click', () => api.next());
  closeBtn.addEventListener('click', () => api.close());

  const api: FindController = {
    element: bar,
    open(): void {
      bar.hidden = false;
      scope = impliedScope();
      updateScopeUi();
      input.focus();
      input.select();
      if (impliedScope() === 'source') deps.getEditor()?.openSearch();
      applyQuery(); // applyQuery pushes the query to CM when scope is source
    },
    close(): void {
      bar.hidden = true;
      preview.clear();
      deps.getEditor()?.focus();
    },
    next(): void {
      if (impliedScope() === 'preview') { preview.next(); updateCount(); }
      else deps.getEditor()?.searchNext();
    },
    previous(): void {
      if (impliedScope() === 'preview') { preview.previous(); updateCount(); }
      else deps.getEditor()?.searchPrevious();
    },
    refreshPreview(): void {
      if (bar.hidden) return;
      if (impliedScope() !== 'preview') return;
      preview.recompute();
      updateCount();
    },
    isOpen: () => !bar.hidden,
  };
  return api;
}
```

`find_controller.ts` imports `EditorHandle` from `./editor.js` and `Mode` from `./chrome.js` — both are **excluded shells**, and type-only imports still pull the imported `.ts` into the `tsc` program (which would surface their strict errors). So `find_controller.ts` is **intentionally outside tsconfig** (Task 0.7 does NOT allowlist it); verify via the esbuild build.

Run:
```
cd ui && npm run build
```
Expected: app bundle builds without error.

Commit:
```
git add -A && git commit -m "feat(find): find-bar controller with split-mode scope routing"
```

### Task 1.8 — Wire find controller into `main.ts` actions + recompute hook

Read `ui/src/main.ts`: the `edit.find/findNext/findPrevious` case (lines 612–616, currently `editor?.focus()`), `processRenderQueue` (the if/else at lines 1300–1323), and where chrome/panels are appended.

Edit `ui/src/main.ts`:

1. Add the import (after the `createCommandOverlay` import, ~line 45):
```ts
import { createFindController } from './find_controller.js';
```

2. After `const chrome = createChrome(document.body);` (line 306), create the controller and mount its bar into `mainRegion` (declared above at line 137). Place this after `mainRegion` is appended to `appContainer` — i.e. add immediately after line 306:
```ts
const findController = createFindController({
  getEditor: () => editor,
  previewContent,
  getMode: () => currentMode,
});
mainRegion.appendChild(findController.element);
```

3. Replace the `edit.find/findNext/findPrevious` case (lines 612–616):
```ts
    case 'edit.find':
      findController.open();
      return;
    case 'edit.findNext':
      findController.next();
      return;
    case 'edit.findPrevious':
      findController.previous();
      return;
```

4. Add **one** recompute call after the render if/else in `processRenderQueue`. Locate the closing `}` of the `else { ... }` block (after line 1323, before `applyOutlineRender(result);` at line 1324). Insert immediately before `applyOutlineRender(result);`:
```ts
      // Single post-render hook covering both reconcile and full-replace
      // branches: refresh the preview-find overlay against the new DOM. Wrapped
      // implicitly — refreshPreview never throws on stale ranges.
      findController.refreshPreview();
```

`main.ts` is **intentionally outside tsconfig** (untyped vendored-bundle imports), so `npm run typecheck` does not cover these `main.ts` edits — the esbuild build is the verification (it resolves the import and the `findController` API). `find_controller.ts` itself is **build-verified** in Task 1.7 (it imports the editor/chrome shells, so it stays outside tsconfig).

Run:
```
cd ui && npm run build
```
Expected: app bundle builds without error.

Commit:
```
git add -A && git commit -m "feat(find): wire find controller into actions + post-render recompute"
```

### Task 1.9 — Find-bar CSS

Read `ui/styles/components.css` (e.g. the `.pmd-mermaid-expand` block at ~948 for token usage). Append a find-bar section at the end of `ui/styles/components.css`:
```css
/* --------------------------------------------
   Find bar (source + preview)
   -------------------------------------------- */
.pmd-find-bar {
  position: absolute;
  top: var(--pmd-space-2);
  right: var(--pmd-space-3);
  z-index: 20;
  display: flex;
  align-items: center;
  gap: var(--pmd-space-2);
  padding: var(--pmd-space-1) var(--pmd-space-2);
  background: var(--pmd-bg-elevated);
  border: 1px solid var(--pmd-border);
  border-radius: var(--pmd-radius-md);
  box-shadow: var(--pmd-shadow-md, 0 2px 8px rgba(0, 0, 0, 0.2));
}
.pmd-find-bar[hidden] { display: none; }
.pmd-find-input {
  min-width: 12rem;
  padding: 2px var(--pmd-space-2);
  font-family: inherit;
  font-size: var(--pmd-text-sm);
  color: var(--pmd-fg);
  background: var(--pmd-bg);
  border: 1px solid var(--pmd-border);
  border-radius: var(--pmd-radius-sm);
}
.pmd-find-count {
  font-variant-numeric: tabular-nums;
  color: var(--pmd-fg-muted);
  font-size: var(--pmd-text-xs);
}
.pmd-find-scope { display: flex; gap: 2px; }
.pmd-find-scope[hidden] { display: none; }
.pmd-find-scope-btn,
.pmd-find-btn {
  padding: 2px var(--pmd-space-2);
  font-family: inherit;
  font-size: var(--pmd-text-xs);
  color: var(--pmd-fg);
  background: var(--pmd-bg);
  border: 1px solid var(--pmd-border);
  border-radius: var(--pmd-radius-sm);
  cursor: pointer;
}
.pmd-find-scope-btn.data-active { background: var(--pmd-border); }
.pmd-find-btn:disabled { opacity: 0.4; cursor: default; }

/* Preview match highlight: Custom Highlight API (no markup) + <mark> fallback. */
::highlight(pmd-find) {
  background: var(--pmd-accent, #ffd54f);
  color: var(--pmd-bg, #000);
}
mark.pmd-find {
  background: var(--pmd-accent, #ffd54f);
  color: var(--pmd-bg, #000);
}
```

Note: `#pmd-content`'s pane already establishes a positioning context for the absolutely-positioned bar via `mainRegion`; if not, the bar still renders fixed-to-region acceptably. (Verify visually during e2e.)

Run:
```
cd ui && npm run build
```
Expected: builds (CSS is static; this confirms no accidental TS reference broke).

Commit:
```
git add -A && git commit -m "style(find): find bar + preview highlight styles"
```

---

## Phase 2 — Frontmatter inspector + edit

**Design note (decoupled from the async facts store):** the facts store only refreshes after a backend re-render, so edit/add MUST NOT read `FrontmatterFact` (it is stale or `null` right after an insert). Instead, all locate/edit/add operate on the **live editor doc string**: a pure `locateBlock(doc)` re-derives the block boundaries each call. `frontmatter_edit.ts` therefore takes NO `FrontmatterFact` param. The inspector may still read facts for *display* values, but every buffer write goes through these doc-based helpers.

Line semantics (verified against `crates/pmd-core/src/facts/frontmatter.rs` + `crates/pmd-core/tests/document_facts_frontmatter.rs`): line 1 is the opening fence (`---` YAML / `+++` TOML); the closing fence is the next line equal to that fence; `endLine` = the **last content line** (line *before* the closing fence). No opening fence or no closing fence → `locateBlock` returns `null` (treated as "no editable block", matching the malformed/absent guard). All line numbers are **1-based**.

### Task 2.1 — `locateBlock` (pure block scan): failing test

Create `ui/src/frontmatter_edit.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  locateBlock,
  hasOpeningFence,
  formatScalar,
  editValueChange,
  addEntryChange,
  insertBlockChange,
} from "./frontmatter_edit.ts";

const doc = "---\ntitle: Old\ntags: a, b\n---\n# Body\n";

test("locateBlock finds a closed YAML block", () => {
  assert.deepEqual(locateBlock(doc), { format: "yaml", startLine: 1, endLine: 3 });
});

test("hasOpeningFence distinguishes truly-absent from unclosed frontmatter", () => {
  assert.equal(hasOpeningFence("# Body\n"), false);          // truly absent
  assert.equal(hasOpeningFence("---\ntitle: x\n# Body\n"), true);  // fence, unclosed
  assert.equal(hasOpeningFence("+++\n"), true);
  assert.equal(hasOpeningFence(doc), true);                  // closed block
});

test("locateBlock finds a closed TOML block", () => {
  const toml = "+++\ntitle = \"Old\"\n+++\n# Body\n";
  assert.deepEqual(locateBlock(toml), { format: "toml", startLine: 1, endLine: 2 });
});

test("locateBlock returns null when there is no opening fence", () => {
  assert.equal(locateBlock("# Body\n"), null);
});

test("locateBlock returns null for an unclosed block", () => {
  assert.equal(locateBlock("---\ntitle: x\n# Body\n"), null);
});
```

Run:
```
cd ui && node --test src/frontmatter_edit.test.ts
```
Expected: FAILS — module not found.

### Task 2.2 — Implement `locateBlock`; pass

Create `ui/src/frontmatter_edit.ts`:
```ts
/** A CodeMirror-style change: replace `[from, to)` (char offsets) with `insert`. */
export interface FmChange {
  from: number;
  to: number;
  insert: string;
}

export type FmFormat = 'yaml' | 'toml';

/** The live-doc block boundaries (1-based lines), re-derived from the buffer
 *  string so edits never depend on the async facts store. */
export interface FmBlock {
  format: FmFormat;
  startLine: number; // opening fence (always 1 when present)
  endLine: number;   // last content line; closing fence is at endLine + 1
}

/** Char offset of the start of 1-based `line` in `doc`. */
function lineStartOffset(doc: string, line: number): number {
  let offset = 0;
  let current = 1;
  while (current < line) {
    const nl = doc.indexOf('\n', offset);
    if (nl === -1) return doc.length;
    offset = nl + 1;
    current += 1;
  }
  return offset;
}

/** End offset (exclusive of the trailing newline) of 1-based `line`. */
function lineEndOffset(doc: string, line: number): number {
  const start = lineStartOffset(doc, line);
  const nl = doc.indexOf('\n', start);
  return nl === -1 ? doc.length : nl;
}

/**
 * Re-derive frontmatter block boundaries from the live doc string. Line 1 must
 * be `---` (yaml) or `+++` (toml); the closing fence is the next line equal to
 * that fence. Returns `null` when there is no opening fence or no closing fence
 * (treated as "no editable block").
 */
export function locateBlock(doc: string): FmBlock | null {
  const lines = doc.split('\n');
  const first = (lines[0] ?? '').trimEnd();
  let format: FmFormat;
  let fence: string;
  if (first === '---') { format = 'yaml'; fence = '---'; }
  else if (first === '+++') { format = 'toml'; fence = '+++'; }
  else return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trimEnd() === fence) {
      // i is the 0-based closing-fence index; its 1-based line is i+1, so the
      // last content line is i (1-based), and endLine = i.
      return { format, startLine: 1, endLine: i };
    }
  }
  return null; // no closing fence → unclosed/malformed
}

/**
 * True when the doc's first line is a frontmatter opening fence (`---` or `+++`),
 * regardless of whether the block is closed. Lets callers distinguish "truly
 * absent" (no fence) from "present but unclosed/malformed" (fence, no close):
 * a starter block must be inserted only in the former case, never in front of a
 * malformed block (which is read-only — see the spec).
 */
export function hasOpeningFence(doc: string): boolean {
  const first = (doc.split('\n', 1)[0] ?? '').trimEnd();
  return first === '---' || first === '+++';
}

/** 1-based line of recognized `key` within content lines `[2, endLine]`, or null. */
function locateFieldLine(doc: string, block: FmBlock, key: string): number | null {
  const re = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:=]`);
  for (let line = block.startLine + 1; line <= block.endLine; line++) {
    const from = lineStartOffset(doc, line);
    const to = lineEndOffset(doc, line);
    if (re.test(doc.slice(from, to))) return line;
  }
  return null;
}
```

Add stubs so later tasks' imports resolve (filled in next tasks):
```ts
export function formatScalar(): string { throw new Error('not implemented'); }
export function editValueChange(): FmChange | null { throw new Error('not implemented'); }
export function addEntryChange(): FmChange | null { throw new Error('not implemented'); }
export function insertBlockChange(): FmChange { throw new Error('not implemented'); }
```

Run:
```
cd ui && node --test src/frontmatter_edit.test.ts
```
Expected: the four `locateBlock` tests pass.

Commit:
```
git add -A && git commit -m "feat(frontmatter): pure live-doc block scan (locateBlock)"
```

### Task 2.3 — `formatScalar` (valid YAML/TOML serialization): failing test

The naive `key = my-slug` is **invalid TOML** (strings need quotes). `formatScalar(format, value)` produces a valid scalar: TOML → bare for int/float/bool, else a JSON-escaped double-quoted string; YAML → bare unless the value needs quoting (empty, leading/trailing space, contains any YAML-significant char, or a leading indicator).

Append to `ui/src/frontmatter_edit.test.ts`:
```ts
test("formatScalar TOML quotes strings, leaves numbers/bools bare", () => {
  assert.equal(formatScalar("toml", "my-slug"), '"my-slug"');
  assert.equal(formatScalar("toml", "42"), "42");
  assert.equal(formatScalar("toml", "true"), "true");
  assert.equal(formatScalar("toml", 'a"b'), '"a\\"b"');
});

test("formatScalar YAML leaves plain scalars bare, quotes when needed", () => {
  assert.equal(formatScalar("yaml", "my-slug"), "my-slug");
  assert.equal(formatScalar("yaml", "Hello World"), "Hello World");
  assert.equal(formatScalar("yaml", "a: b"), '"a: b"');     // contains ':'
  assert.equal(formatScalar("yaml", " leading"), '" leading"'); // leading space
  assert.equal(formatScalar("yaml", ""), '""');             // empty
});
```

Run:
```
cd ui && node --test src/frontmatter_edit.test.ts
```
Expected: FAILS — `formatScalar` not implemented.

### Task 2.4 — Implement `formatScalar`; pass

Edit `ui/src/frontmatter_edit.ts`. Replace the `formatScalar` stub:
```ts
/** Does the string parse as a TOML bare scalar (int/float/bool)? */
function isBareTomlScalar(value: string): boolean {
  if (value === 'true' || value === 'false') return true;
  return /^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(value);
}

// YAML chars that force quoting if present anywhere, plus indicators that force
// quoting only as the first char. Conservative for v1 (scalar strings only).
const YAML_SPECIAL = /[:#[\]{}&*!|>'"%,@`]/;
const YAML_LEADING_INDICATOR = /^[-?:,[\]{}#&*!|>'"%@`]/;

/** Serialize a scalar value to a valid `format` token. */
export function formatScalar(format: FmFormat, value: string): string {
  if (format === 'toml') {
    if (isBareTomlScalar(value)) return value;
    return JSON.stringify(value); // double-quoted, escaped
  }
  // YAML: quote only when the bare form would be ambiguous/invalid.
  const needsQuote =
    value === '' ||
    value !== value.trim() ||
    YAML_SPECIAL.test(value) ||
    YAML_LEADING_INDICATOR.test(value);
  return needsQuote ? JSON.stringify(value) : value;
}
```

Run:
```
cd ui && node --test src/frontmatter_edit.test.ts
```
Expected: the `formatScalar` tests + `locateBlock` tests pass.

Commit:
```
git add -A && git commit -m "feat(frontmatter): valid YAML/TOML scalar serialization"
```

### Task 2.5 — `editValueChange` (doc-based, preserves trailing comment): failing test

Edits LOCATE THE BLOCK FROM THE LIVE DOC (no `FrontmatterFact`). They also preserve a trailing inline ` # comment` per the spec.

Append to `ui/src/frontmatter_edit.test.ts`:
```ts
test("editValueChange replaces only the value, preserving key + indent", () => {
  const change = editValueChange(doc, "title", "New Title");
  assert.ok(change);
  const next = doc.slice(0, change.from) + change.insert + doc.slice(change.to);
  assert.equal(next, "---\ntitle: New Title\ntags: a, b\n---\n# Body\n");
});

test("editValueChange preserves a trailing inline comment", () => {
  const commented = "---\ntitle: Old # note\n---\n# Body\n";
  const change = editValueChange(commented, "title", "New");
  assert.ok(change);
  const next = commented.slice(0, change.from) + change.insert + commented.slice(change.to);
  assert.equal(next, "---\ntitle: New # note\n---\n# Body\n");
});

test("editValueChange YAML-quotes a value containing a colon", () => {
  const change = editValueChange(doc, "title", "a: b");
  assert.ok(change);
  const next = doc.slice(0, change.from) + change.insert + doc.slice(change.to);
  assert.equal(next, '---\ntitle: "a: b"\ntags: a, b\n---\n# Body\n');
});

test("editValueChange returns null when there is no closable block", () => {
  assert.equal(editValueChange("---\ntitle: x\n# Body\n", "title", "y"), null);
});

test("editValueChange returns null when the key is absent", () => {
  assert.equal(editValueChange(doc, "slug", "x"), null);
});
```

Run:
```
cd ui && node --test src/frontmatter_edit.test.ts
```
Expected: FAILS — `editValueChange` not implemented (stub throws).

### Task 2.6 — Implement `editValueChange`; pass

Edit `ui/src/frontmatter_edit.ts`. Replace the `editValueChange` stub:
```ts
/**
 * Replace the value of recognized scalar `key` with `value`, re-deriving the
 * block from the live doc. Keeps key/delimiter/indent and any trailing inline
 * ` # comment`. Returns `null` when there is no closable block or `key` is
 * absent. The value is serialized via formatScalar for the block's format.
 *
 * Comment preservation note (v1): the trailing-comment split is a simple
 * `/(\s+#.*)$/` on the post-delimiter remainder; a `#` *inside* a quoted value
 * could be mis-split, accepted for v1 (scalar strings only).
 */
export function editValueChange(doc: string, key: string, value: string): FmChange | null {
  const block = locateBlock(doc);
  if (!block) return null;
  const line = locateFieldLine(doc, block, key);
  if (line === null) return null;
  const from = lineStartOffset(doc, line);
  const to = lineEndOffset(doc, line);
  const text = doc.slice(from, to);
  // "<indent><key><ws><:|=><ws>" prefix, then the existing value remainder.
  const m = text.match(/^(\s*[^:=]+\s*[:=]\s*)(.*)$/);
  if (!m) return null;
  const prefix = m[1];
  const remainder = m[2];
  const comment = remainder.match(/(\s+#.*)$/)?.[1] ?? '';
  const formatted = formatScalar(block.format, value);
  return { from: from + prefix.length, to, insert: `${formatted}${comment}` };
}
```

Run:
```
cd ui && node --test src/frontmatter_edit.test.ts
```
Expected: the `editValueChange` tests + earlier tests pass.

Commit:
```
git add -A && git commit -m "feat(frontmatter): doc-based edit-value with comment preservation + quoting"
```

### Task 2.7 — `addEntryChange` (doc-based, valid serialization): failing test

Append to `ui/src/frontmatter_edit.test.ts`:
```ts
test("addEntryChange inserts a new YAML entry before the closing fence", () => {
  const change = addEntryChange(doc, "slug", "my-slug");
  assert.ok(change);
  const next = doc.slice(0, change.from) + change.insert + doc.slice(change.to);
  assert.equal(next, "---\ntitle: Old\ntags: a, b\nslug: my-slug\n---\n# Body\n");
});

test("addEntryChange emits VALID quoted TOML", () => {
  const tomlDoc = "+++\ntitle = \"Old\"\n+++\n# Body\n";
  const change = addEntryChange(tomlDoc, "slug", "my-slug");
  assert.ok(change);
  const next = tomlDoc.slice(0, change.from) + change.insert + tomlDoc.slice(change.to);
  assert.equal(next, '+++\ntitle = "Old"\nslug = "my-slug"\n+++\n# Body\n');
});

test("addEntryChange returns null when there is no closable block", () => {
  assert.equal(addEntryChange("---\ntitle: x\n# Body\n", "slug", "y"), null);
});
```

Run:
```
cd ui && node --test src/frontmatter_edit.test.ts
```
Expected: FAILS — `addEntryChange` not implemented.

### Task 2.8 — Implement `addEntryChange`; pass

Edit `ui/src/frontmatter_edit.ts`. Replace the `addEntryChange` stub:
```ts
/**
 * Insert a new entry (`key: value` YAML / `key = value` TOML, value serialized
 * via formatScalar) immediately after the last content line, i.e. just before
 * the closing fence at `endLine + 1`. Re-derives the block from the live doc;
 * returns `null` when there is no closable block.
 */
export function addEntryChange(doc: string, key: string, value: string): FmChange | null {
  const block = locateBlock(doc);
  if (!block) return null;
  const sep = block.format === 'toml' ? ' = ' : ': ';
  const formatted = formatScalar(block.format, value);
  const at = lineStartOffset(doc, block.endLine + 1);
  return { from: at, to: at, insert: `${key}${sep}${formatted}\n` };
}
```

Run:
```
cd ui && node --test src/frontmatter_edit.test.ts
```
Expected: all add/edit/locate/format tests pass.

Commit:
```
git add -A && git commit -m "feat(frontmatter): doc-based add-entry with valid serialization"
```

### Task 2.9a — `insertBlockChange` + fresh-block edit/add (no facts available): failing test

Append to `ui/src/frontmatter_edit.test.ts`:
```ts
test("insertBlockChange prepends a new YAML block at the top", () => {
  const bodyDoc = "# Body\n";
  const change = insertBlockChange(bodyDoc, "title", "New");
  const next = bodyDoc.slice(0, change.from) + change.insert + bodyDoc.slice(change.to);
  assert.equal(next, "---\ntitle: New\n---\n# Body\n");
});

test("insertBlockChange on an empty doc", () => {
  const change = insertBlockChange("", "title", "New");
  assert.equal(change.from, 0);
  assert.equal(change.to, 0);
  assert.equal(change.insert, "---\ntitle: New\n---\n");
});

test("edit/add work on a FRESHLY INSERTED block with NO facts available", () => {
  // Simulate the no-block flow: insert a starter block, apply it, then edit/add
  // using ONLY the resulting doc string (facts store is still empty here).
  const start = "# Body\n";
  const ins = insertBlockChange(start, "title", "");
  const afterInsert = start.slice(0, ins.from) + ins.insert + start.slice(ins.to);
  assert.equal(afterInsert, "---\ntitle: \n---\n# Body\n");

  const edit = editValueChange(afterInsert, "title", "Hello");
  assert.ok(edit, "edit must locate the freshly inserted block from the doc");
  const afterEdit = afterInsert.slice(0, edit.from) + edit.insert + afterInsert.slice(edit.to);
  assert.equal(afterEdit, "---\ntitle: Hello\n---\n# Body\n");

  const add = addEntryChange(afterEdit, "slug", "my-slug");
  assert.ok(add);
  const afterAdd = afterEdit.slice(0, add.from) + add.insert + afterEdit.slice(add.to);
  assert.equal(afterAdd, "---\ntitle: Hello\nslug: my-slug\n---\n# Body\n");
});
```

Run:
```
cd ui && node --test src/frontmatter_edit.test.ts
```
Expected: FAILS — `insertBlockChange` not implemented (stub throws).

### Task 2.9b — Implement `insertBlockChange`; pass

Edit `ui/src/frontmatter_edit.ts`. Replace the `insertBlockChange` stub:
```ts
/**
 * Prepend a new YAML frontmatter block to a document that has none. New blocks
 * always default to YAML per the design. The value is serialized via
 * formatScalar so an inserted starter value is always valid.
 */
export function insertBlockChange(doc: string, key: string, value: string): FmChange {
  void doc;
  const formatted = value === '' ? '' : formatScalar('yaml', value);
  return { from: 0, to: 0, insert: `---\n${key}: ${formatted}\n---\n` };
}
```
Note: an empty starter value emits `title: ` (a blank value line), which `locateBlock` still treats as content line 2 — so the subsequent edit on the fresh doc locates it correctly (covered by the "freshly inserted block" test).

Run:
```
cd ui && node --test src/frontmatter_edit.test.ts && npm run typecheck
```
Expected: all frontmatter_edit tests pass; typecheck passes (`frontmatter_edit.ts` is in the tsconfig allowlist).

Commit:
```
git add -A && git commit -m "feat(frontmatter): insert new YAML block when none exists"
```

### Task 2.10 — Add the `document.editFrontmatter` action

Read `ui/src/actions.ts` and `ui/src/actions.test.ts`. After the Task 0.1b baseline fix the count literal is `20`; adding one no-default action bumps `NO_DEFAULT_ACTION_IDS` to **21** (the `DEFAULT_ACTION_SHORTCUTS` count is unaffected — this action has no default shortcut).

Edit `ui/src/actions.ts`:

1. In the `ActionId` union, after `"document.mergeDiskChanges"`, add:
```ts
  | "document.editFrontmatter"
```

2. In `NO_DEFAULT_ACTION_IDS`, after `"document.mergeDiskChanges",` add:
```ts
  "document.editFrontmatter",
```

3. In `defaultActionSpecs`, after the `document.mergeDiskChanges` spec, add:
```ts
  spec("document.editFrontmatter", "Edit frontmatter", "Document", "Inspect and edit document frontmatter", []),
```

Update `ui/src/actions.test.ts`: change `assert.equal(NO_DEFAULT_ACTION_IDS.length, 20);` (the Task 0.1b value) to `assert.equal(NO_DEFAULT_ACTION_IDS.length, 21);`. (The literal is brittle — it has already drifted once under concurrent work; a future cleanup could derive it from `defaultActionSpecs.filter(s => s.defaultShortcuts.length === 0).length`, but keep the literal for now to match the existing test style.)

Run:
```
cd ui && node --test src/actions.test.ts && npm run typecheck
```
Expected: passes (`actions.ts` is in the tsconfig allowlist). Note: the existing test `every registered action has a runnable handler` still passes because `spec()` provides a `run`; the `main.ts` switch must handle the new id — done in Task 2.13 — but the registry test uses a stub `run`.

Commit:
```
git add -A && git commit -m "feat(actions): add document.editFrontmatter (no default shortcut)"
```

### Task 2.11 — Add the frontmatter chip + stats-button hooks to `chrome.ts`

Read `ui/src/chrome.ts` (the status bar block, lines 198–214, and the returned object). Make `.pmd-status-counts` a `<button>` and add an always-present `.pmd-status-frontmatter` control. Extend the `ChromeInstance` interface.

Edit `ui/src/chrome.ts`:

1. In the `ChromeInstance` interface, after `setCounts`, add:
```ts
  onCountsClick: (handler: () => void) => void;
  onFrontmatterClick: (handler: () => void) => void;
  /** `present` shows the "frontmatter" chip; otherwise the subdued "+ frontmatter". */
  setFrontmatterState: (state: { present: boolean; malformed: boolean }) => void;
```

2. Replace the `statusCounts` creation (lines 206–208):
```ts
  const statusCounts = document.createElement('button');
  statusCounts.type = 'button';
  statusCounts.className = 'pmd-status-item pmd-status-counts';
  statusCounts.setAttribute('aria-label', 'Document statistics');
  statusBar.appendChild(statusCounts);

  const statusFrontmatter = document.createElement('button');
  statusFrontmatter.type = 'button';
  statusFrontmatter.className = 'pmd-status-item pmd-status-frontmatter';
  statusFrontmatter.setAttribute('aria-label', 'Frontmatter');
  statusFrontmatter.textContent = '+ frontmatter';
  statusBar.appendChild(statusFrontmatter);
```

3. Add handler arrays near `let themePickerHandlers ...` (line ~296):
```ts
  let countsClickHandlers: (() => void)[] = [];
  let frontmatterClickHandlers: (() => void)[] = [];
  statusCounts.addEventListener('click', () => countsClickHandlers.forEach((h) => h()));
  statusFrontmatter.addEventListener('click', () => frontmatterClickHandlers.forEach((h) => h()));
```

4. In the returned object, after `onMergeClick`, add:
```ts
    onCountsClick: (handler: () => void) => { countsClickHandlers.push(handler); },
    onFrontmatterClick: (handler: () => void) => { frontmatterClickHandlers.push(handler); },
    setFrontmatterState: (state: { present: boolean; malformed: boolean }) => {
      statusFrontmatter.textContent = state.present ? 'frontmatter' : '+ frontmatter';
      statusFrontmatter.classList.toggle('pmd-status-frontmatter-present', state.present);
      statusFrontmatter.classList.toggle('pmd-status-frontmatter-malformed', state.malformed);
    },
```

`chrome.ts` is **intentionally outside tsconfig** (it is a legacy UI shell, not in the `include` allowlist), so `npm run typecheck` does not cover it — verify via the esbuild build. The new interface members are additive (only `createChrome` produces them, only `main.ts` consumes them, in Task 2.13).

Run:
```
cd ui && npm run build
```
Expected: app bundle builds without error.

Commit:
```
git add -A && git commit -m "feat(chrome): clickable stats button + always-present frontmatter control"
```

### Task 2.12 — `frontmatter_panel.ts` inspector popover

Read `ui/src/context_menu.ts` (`clampMenuPosition`, dismiss pattern) and `ui/src/document_contracts.ts` (`CommonFrontmatter` field names). The panel is a cursor-positioned popover. It lists recognized fields (title, description, slug, sidebar_label, sidebar_position, tags, draft) + `unknown` keys, shows the format + a malformed badge, and offers add-entry + edit-value. Edits/adds are disabled when `syntax !== 'valid'`.

Create `ui/src/frontmatter_panel.ts`:
```ts
import type { FrontmatterFact, CommonFrontmatter } from './document_contracts.js';
import { clampMenuPosition } from './context_menu.js';

export interface FrontmatterPanelDeps {
  /** Apply an edit to a recognized field's value. */
  onEditValue: (key: string, value: string) => void;
  /** Add a new key:value entry. */
  onAddEntry: (key: string, value: string) => void;
}

const RECOGNIZED: Array<keyof CommonFrontmatter> = [
  'title', 'description', 'slug', 'sidebar_label', 'sidebar_position', 'tags', 'draft',
];

let openPanelEl: HTMLElement | null = null;

export function closeFrontmatterPanel(): void {
  if (openPanelEl) { openPanelEl.remove(); openPanelEl = null; }
}

/** Open the inspector at (x, y) for `fm` (or `null` when no block exists). */
export function openFrontmatterPanel(
  x: number,
  y: number,
  fm: FrontmatterFact | null,
  deps: FrontmatterPanelDeps,
): void {
  closeFrontmatterPanel();
  const panel = document.createElement('div');
  panel.className = 'pmd-dropdown-menu pmd-frontmatter-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Frontmatter');

  const editable = fm !== null && fm.syntax === 'valid';

  const header = document.createElement('div');
  header.className = 'pmd-frontmatter-header';
  if (fm) {
    header.textContent = `Frontmatter (${fm.format.toUpperCase()})`;
    if (fm.syntax !== 'valid') {
      const badge = document.createElement('span');
      badge.className = 'pmd-frontmatter-badge';
      badge.textContent = 'malformed';
      header.append(' ', badge);
    }
  } else {
    header.textContent = 'No frontmatter';
  }
  panel.append(header);

  if (fm && fm.syntax !== 'valid') {
    const hint = document.createElement('p');
    hint.className = 'pmd-frontmatter-hint';
    hint.textContent = 'Fix the frontmatter in source to enable editing.';
    panel.append(hint);
  }

  if (fm && fm.syntax === 'valid') {
    const list = document.createElement('div');
    list.className = 'pmd-frontmatter-fields';
    for (const key of RECOGNIZED) {
      const raw = fm.metadata[key];
      const value =
        key === 'tags' ? (raw as string[]).join(', ') : raw === null || raw === undefined ? '' : String(raw);
      list.append(fieldRow(key, value, editable, deps));
    }
    for (const [key, value] of Object.entries(fm.metadata.unknown)) {
      list.append(fieldRow(key, value, editable, deps));
    }
    panel.append(list);
  }

  if (editable || fm === null) {
    panel.append(addEntryRow(deps));
  }

  // Measure off-screen, clamp into viewport (mirrors context_menu.ts).
  panel.style.position = 'fixed';
  panel.style.visibility = 'hidden';
  document.body.appendChild(panel);
  const rect = panel.getBoundingClientRect();
  const { left, top } = clampMenuPosition(
    { x, y }, { w: rect.width, h: rect.height }, { w: window.innerWidth, h: window.innerHeight },
  );
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.visibility = 'visible';
  openPanelEl = panel;

  const dismiss = (ev: Event) => {
    if (ev.type === 'mousedown' && panel.contains(ev.target as Node)) return;
    if (ev.type === 'keydown' && (ev as KeyboardEvent).key !== 'Escape') return;
    closeFrontmatterPanel();
    window.removeEventListener('mousedown', dismiss, true);
    window.removeEventListener('keydown', dismiss, true);
  };
  window.addEventListener('mousedown', dismiss, true);
  window.addEventListener('keydown', dismiss, true);
}

function fieldRow(
  key: string, value: string, editable: boolean, deps: FrontmatterPanelDeps,
): HTMLElement {
  const row = document.createElement('label');
  row.className = 'pmd-frontmatter-field';
  const name = document.createElement('span');
  name.className = 'pmd-frontmatter-key';
  name.textContent = key;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'pmd-frontmatter-value';
  input.value = value;
  input.disabled = !editable;
  input.addEventListener('change', () => deps.onEditValue(key, input.value));
  row.append(name, input);
  return row;
}

function addEntryRow(deps: FrontmatterPanelDeps): HTMLElement {
  const row = document.createElement('div');
  row.className = 'pmd-frontmatter-add';
  const keyInput = document.createElement('input');
  keyInput.type = 'text';
  keyInput.placeholder = 'key';
  keyInput.className = 'pmd-frontmatter-add-key';
  const valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.placeholder = 'value';
  valueInput.className = 'pmd-frontmatter-add-value';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'pmd-btn pmd-btn-ghost pmd-btn-sm';
  addBtn.textContent = 'Add';
  addBtn.addEventListener('click', () => {
    const key = keyInput.value.trim();
    if (!key) return;
    deps.onAddEntry(key, valueInput.value);
  });
  row.append(keyInput, valueInput, addBtn);
  return row;
}
```

Run:
```
cd ui && npm run typecheck
```
Expected: passes.

Commit:
```
git add -A && git commit -m "feat(frontmatter): inspector popover (fields, malformed badge, add/edit)"
```

### Task 2.13 — Wire the frontmatter panel + chip + action into `main.ts`

Read `ui/src/main.ts`: `factsStore` (line 324), `editor` dispatch pattern (e.g. `jumpEditorToBlock` lines 873–885), the `runDiagnosticPrimaryAction` (709–716) + `isImplementedDiagnosticAction` (718–720), and `applyOutlineRender` (887–902) where facts arrive.

Edit `ui/src/main.ts`:

1. Add imports (after `createFindController` import):
```ts
import { openFrontmatterPanel } from './frontmatter_panel.js';
import { hasOpeningFence, editValueChange, addEntryChange, insertBlockChange, type FmChange } from './frontmatter_edit.js';
```

2. Add a helper that applies an `FmChange` to the active editor (guarded), near `jumpEditorToBlock` (~line 885). The edit/add handlers re-read the **live buffer** (`editor.getValue()`) and call the **doc-based** helpers — they NEVER read `FrontmatterFact`, so a freshly-inserted block (whose facts have not refreshed yet) is still edited/added correctly:
```ts
function applyFrontmatterChange(change: FmChange | null): void {
  if (!change || !editor) return;
  const max = editor.view.state.doc.length;
  // Guard: a failed locate (change === null) is handled above; bounds-check too.
  if (change.from > max || change.to > max) return;
  editor.view.dispatch({
    changes: { from: change.from, to: change.to, insert: change.insert },
  });
}

// Facts are read ONLY for the inspector's display values, never for edits.
function activeFrontmatter(): FrontmatterFact | null {
  const active = store.activeDoc();
  if (!active) return null;
  return factsStore.current(active.docId)?.facts?.frontmatter ?? null;
}

function openFrontmatterInspector(x: number, y: number): void {
  if (!editor) return;
  const doc = editor.getValue();
  // Insert a starter YAML block ONLY when frontmatter is TRULY ABSENT (no opening
  // fence) — decided from the LIVE BUFFER, not activeFrontmatter() (facts lag a
  // render). Do NOT key off locateBlock()===null alone: that is also null for an
  // unclosed/malformed block (opening fence, no close), and inserting in front of
  // a malformed block would mutate it — but malformed frontmatter is read-only
  // (see spec). hasOpeningFence distinguishes the two: false ⇒ absent ⇒ insert;
  // true ⇒ a block exists (closed or malformed) ⇒ never insert.
  if (!hasOpeningFence(doc)) {
    applyFrontmatterChange(insertBlockChange(doc, 'title', ''));
  }
  // Display only: may be null on the no-block turn (facts lag one render);
  // the panel then shows "No frontmatter" + the add-entry row. Cosmetic only —
  // the block is already committed and the doc-based handlers operate on it.
  const fmForDisplay = activeFrontmatter();
  openFrontmatterPanel(x, y, fmForDisplay, {
    // Doc-based: no FrontmatterFact, no `cur!`. Re-derives the block each call.
    onEditValue: (key, value) => {
      if (!editor) return;
      applyFrontmatterChange(editValueChange(editor.getValue(), key, value));
    },
    onAddEntry: (key, value) => {
      if (!editor) return;
      applyFrontmatterChange(addEntryChange(editor.getValue(), key, value));
    },
  });
}
```
Add the `FrontmatterFact` type to the existing `document_contracts.js` import block (lines 53–59):
```ts
  type FrontmatterFact,
```

3. Handle the action in `runAction` (after the `document.mergeDiskChanges` case, ~line 603):
```ts
    case 'document.editFrontmatter': {
      const bar = document.querySelector('.pmd-status-frontmatter');
      const rect = bar?.getBoundingClientRect();
      openFrontmatterInspector(rect?.left ?? 80, rect?.top ?? 80);
      return;
    }
```

4. Wire the chrome chip click (after the chrome handler wiring, e.g. near line 1095 where `chrome.onThemePickerClick` is):
```ts
chrome.onFrontmatterClick(() => {
  const rect = document.querySelector('.pmd-status-frontmatter')?.getBoundingClientRect();
  openFrontmatterInspector(rect?.left ?? 80, rect?.top ?? 80);
});
```

5. Update the chip state when facts arrive. In `applyOutlineRender` (after `outlinePanel.setHeadings(...)`, ~line 897), add:
```ts
  const fm = result.facts.frontmatter;
  chrome.setFrontmatterState({ present: fm !== null, malformed: fm?.syntax === 'malformed' });
```
Also set a default in the tab-activate/empty paths: in the `store.onActivate` `empty`/`browser` cases (lines 1469–1483, alongside `chrome.setCounts(null)`), add `chrome.setFrontmatterState({ present: false, malformed: false });`.

6. Map the diagnostic `primary_action: "Edit frontmatter"` to the action. The diagnostics panel calls `onPrimaryAction(action, issue)` with the human label `"Edit frontmatter"` (verified in `diagnostics_panel.ts` and `contracts.rs`). The current `runDiagnosticPrimaryAction` (lines 709–716) matches `defaultActionSpecs` by `id`, which won't match the label. Add a label→id mapping at the top of `runDiagnosticPrimaryAction`:
```ts
  if (action === 'Edit frontmatter') {
    await runAction('document.editFrontmatter');
    return;
  }
```
And make `isImplementedDiagnosticAction` return `true` for it (so the panel renders a clickable button, not just text). Edit `isImplementedDiagnosticAction` (lines 718–720):
```ts
function isImplementedDiagnosticAction(action: string): boolean {
  if (action === 'Edit frontmatter') return true;
  return defaultActionSpecs.some((item) => item.id === action);
}
```
Note: `onPrimaryAction` in `main.ts`'s `createDiagnosticsPanel` config (lines 356–358) currently ignores the second arg — leave it, it forwards `action` to `runDiagnosticPrimaryAction(action)`. The panel's `canRunPrimaryAction` (line 359) calls `isImplementedDiagnosticAction(action)` — now true for the label.

`main.ts` is **intentionally outside tsconfig**, so `npm run typecheck` does not cover these `main.ts` edits — the esbuild build is the verification. `frontmatter_edit.ts`/`frontmatter_panel.ts` were already type-checked in their create tasks.

Run:
```
cd ui && npm run build
```
Expected: app bundle builds without error.

Commit:
```
git add -A && git commit -m "feat(frontmatter): wire inspector to chip, action, and diagnostic primary action"
```

### Task 2.14 — Frontmatter panel + chip CSS

Append to `ui/styles/components.css`:
```css
/* --------------------------------------------
   Frontmatter inspector + status chip
   -------------------------------------------- */
.pmd-status-frontmatter {
  margin-left: var(--pmd-space-3);
  font-size: var(--pmd-text-xs);
  color: var(--pmd-fg-muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--pmd-radius-sm);
  padding: 0 var(--pmd-space-2);
  cursor: pointer;
}
.pmd-status-frontmatter-present {
  color: var(--pmd-fg);
  border-color: var(--pmd-border);
  background: var(--pmd-bg-elevated);
}
.pmd-status-frontmatter-malformed { color: var(--pmd-error, #ef4444); }
.pmd-frontmatter-panel { min-width: 18rem; padding: var(--pmd-space-2); }
.pmd-frontmatter-header { font-weight: var(--pmd-font-medium); margin-bottom: var(--pmd-space-2); }
.pmd-frontmatter-badge {
  font-size: var(--pmd-text-xs);
  color: var(--pmd-error, #ef4444);
  border: 1px solid currentColor;
  border-radius: var(--pmd-radius-sm);
  padding: 0 var(--pmd-space-1);
}
.pmd-frontmatter-hint { font-size: var(--pmd-text-xs); color: var(--pmd-fg-muted); }
.pmd-frontmatter-field { display: flex; align-items: center; gap: var(--pmd-space-2); margin: 2px 0; }
.pmd-frontmatter-key { width: 9rem; font-size: var(--pmd-text-xs); color: var(--pmd-fg-muted); }
.pmd-frontmatter-value { flex: 1; }
.pmd-frontmatter-add { display: flex; gap: var(--pmd-space-1); margin-top: var(--pmd-space-2); }
```

Run:
```
cd ui && npm run build
```
Expected: builds.

Commit:
```
git add -A && git commit -m "style(frontmatter): inspector panel + status chip styles"
```

---

## Phase 3 — Mermaid inline errors + copy source

### Task 3.1 — Shared `makeCopySourceButton` factory + use in `addMermaidExpandButton` (`mermaid_zoom.ts`)

Read `ui/src/mermaid_zoom.ts` `addMermaidExpandButton` (lines 12–30). Critically, `addMermaidExpandButton` **early-returns when there is no `<svg>`** (line ~16) — so it is never called on a FAILED render. The copy-source button must therefore be reusable by BOTH the success path (here) and the inline-error path (Task 3.2). Factor a shared, exported `makeCopySourceButton(source)`.

Edit `ui/src/mermaid_zoom.ts`:

1. Add an exported factory near the top of the file (after the constants, before `addMermaidExpandButton`):
```ts
/** A "Copy source" button that copies `source` to the clipboard. User-initiated;
 *  copies only the document's own diagram source. Reused by the success path
 *  (addMermaidExpandButton) and the inline-error path (renderMermaidError). */
export function makeCopySourceButton(source: string): HTMLButtonElement {
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "pmd-mermaid-copy";
  copyBtn.textContent = "Copy source";
  copyBtn.title = "Copy this diagram's source to the clipboard";
  copyBtn.addEventListener("click", () => {
    void navigator.clipboard.writeText(source);
  });
  return copyBtn;
}
```

2. Ensure the copy button **at the very top of `addMermaidExpandButton`, BEFORE the early `return`s** (lines 13–17). The existing `if (container.querySelector(":scope > button.pmd-mermaid-expand")) return;` (line 14) and `if (!svg) return;` (line 17) both bail before reaching the bottom of the function, so a copy-ensure placed after `container.appendChild(button);` (line 29) would NOT run on a re-render where the expand button already exists. Insert this as the **first statement** of the function body (immediately after the opening `{`, before the line-14 comment):
```ts
  // Copy-source button is independent of the expand button (which needs an svg
  // and is idempotent-guarded below). Ensure it FIRST, before the early returns,
  // so it is added even when the expand button already exists on a re-render.
  if (!container.querySelector(":scope > button.pmd-mermaid-copy")) {
    container.appendChild(makeCopySourceButton(container.dataset.mermaidSource ?? ""));
  }
```
(Leave the rest of `addMermaidExpandButton` unchanged — the expand-button early returns at lines 14/17 still guard only the expand button.)

`mermaid_zoom.ts` is outside tsconfig (legacy UI shell), so verify via the build.

Run:
```
cd ui && npm run build
```
Expected: app bundle builds without error.

Commit:
```
git add -A && git commit -m "feat(mermaid): shared copy-source button factory + use on success path"
```

### Task 3.2 — Structured Mermaid error in `mermaid_runner.ts` (with go-to-source + copy-source)

Read `ui/src/mermaid_runner.ts` (the `catch` at lines 118–121: currently `classList.add("pmd-mermaid-error"); container.textContent = source;`). Replace with a structured error built via DOM APIs (createElement/textContent only — preserves the existing sanitization invariant). It shows the error message, a **"Go to source"** link reading `container.dataset.srcStart` (copied on by `copySourceRange`) and calling `gotoEditorLine` via an injected setter, the visible source, AND the shared **"Copy source"** button (so e2e 5.5 finds `.pmd-mermaid-copy` on the failed diagram — `addMermaidExpandButton` never runs on a failed render).

Edit `ui/src/mermaid_runner.ts`:

1. Extend the existing `import { addMermaidExpandButton } from './mermaid_zoom.js';` (line 2) to also import the factory:
```ts
import { addMermaidExpandButton, makeCopySourceButton } from './mermaid_zoom.js';
```

2. After the imports (line ~4), add a module-level injectable jump callback:
```ts
let gotoLine: (line: number) => void = () => {};
/** Inject the editor line-jump used by inline Mermaid error "Go to source". */
export function setMermaidGotoLine(fn: (line: number) => void): void {
  gotoLine = fn;
}
```

3. Replace the `catch (e)` body (lines 118–121):
```ts
  } catch (e) {
    container.classList.add("pmd-mermaid-error");
    renderMermaidError(container, source, e);
  }
```

4. Add the renderer at the end of the file:
```ts
function renderMermaidError(container: HTMLElement, source: string, error: unknown): void {
  container.replaceChildren();

  const message = document.createElement("p");
  message.className = "pmd-mermaid-error-message";
  message.textContent = error instanceof Error ? error.message : String(error);
  container.append(message);

  const startRaw = container.dataset.srcStart;
  if (startRaw) {
    const link = document.createElement("button");
    link.type = "button";
    link.className = "pmd-mermaid-error-goto";
    link.textContent = "Go to source";
    link.addEventListener("click", () => gotoLine(Number(startRaw)));
    container.append(link);
  }

  // Copy-source on the FAILED diagram (addMermaidExpandButton never runs here).
  container.append(makeCopySourceButton(source));

  const pre = document.createElement("pre");
  pre.className = "pmd-mermaid-error-source";
  pre.textContent = source; // text node only — no markup injected.
  container.append(pre);
}
```

`mermaid_runner.ts` is outside tsconfig (untyped vendored imports), so verify via the build.

Run:
```
cd ui && npm run build
```
Expected: app bundle builds without error.

Commit:
```
git add -A && git commit -m "feat(mermaid): structured inline error with go-to-source + copy-source"
```

### Task 3.3 — Inject `gotoEditorLine` into the Mermaid runner from `main.ts`

Read `ui/src/main.ts` `ensureEditor` (lines 1340–1345). The runner needs the editor's `gotoEditorLine` once the editor is mounted.

Edit `ui/src/main.ts`:

1. Extend the mermaid_runner import (line 8) to also import the setter:
```ts
import { renderMermaidNodes, setMermaidTheme, setMermaidGotoLine } from './mermaid_runner.js';
```

2. In `ensureEditor`, after `editor = await mountEditor(...)` (line 1342), add:
```ts
  setMermaidGotoLine((line) => editor?.gotoEditorLine(line));
```

`main.ts` and `mermaid_runner.ts` are both outside tsconfig, so verify via the build.

Run:
```
cd ui && npm run build
```
Expected: app bundle builds without error.

Commit:
```
git add -A && git commit -m "feat(mermaid): inject editor line-jump for inline error go-to-source"
```

### Task 3.4 — Mermaid error + copy-source CSS

Read `ui/styles/base.css` (`.pmd-mermaid-error` at line 256) and `ui/styles/components.css` (`.pmd-mermaid-expand` at 948). Append a Copy-source button rule beside the Expand button in `ui/styles/components.css` (so hover/positioning matches), and the structured-error layout in `ui/styles/base.css`.

In `ui/styles/components.css`, after the `.pmd-mermaid-expand:focus-visible` rule block (~line 976), append:
```css
.pmd-mermaid-copy {
  position: absolute;
  top: var(--pmd-space-2);
  right: 6.5rem;
  z-index: 2;
  padding: var(--pmd-space-1) var(--pmd-space-3);
  font-family: inherit;
  font-size: var(--pmd-text-xs);
  font-weight: var(--pmd-font-medium);
  line-height: 1;
  color: var(--pmd-fg);
  background: var(--pmd-bg-elevated);
  border: 1px solid var(--pmd-border);
  border-radius: var(--pmd-radius-md);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--pmd-transition-base);
}
.pmd-mermaid:hover .pmd-mermaid-copy,
.pmd-mermaid:focus-within .pmd-mermaid-copy,
.pmd-mermaid-copy:focus-visible { opacity: 1; }
```

In `ui/styles/base.css`, after the `.pmd-mermaid-error` block (~line 262), append:
```css
.pmd-mermaid-error-message { margin: 0 0 var(--pmd-space-2); font-weight: var(--pmd-font-medium); }
.pmd-mermaid-error-goto {
  margin-bottom: var(--pmd-space-2);
  font: inherit;
  color: var(--pmd-accent, #2563eb);
  background: none;
  border: none;
  text-decoration: underline;
  cursor: pointer;
}
.pmd-mermaid-error-source {
  margin: 0;
  white-space: pre-wrap;
  font-family: var(--pmd-font-mono, monospace);
  font-size: var(--pmd-text-xs);
}
```

Run:
```
cd ui && npm run build
```
Expected: builds.

Commit:
```
git add -A && git commit -m "style(mermaid): inline error layout + copy-source button"
```

---

## Phase 4 — Stats popover

### Task 4.1 — Pure stats rows + reading time: failing test

Read `ui/src/document_contracts.ts` `StructureCounts` (lines 165–177). Create `ui/src/stats_popover.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import type { StructureCounts } from "./document_contracts.ts";
import { readingTimeMinutes, statsRows } from "./stats_popover.ts";

const counts: StructureCounts = {
  words: 450, bytes: 2600, sentences: 30, paragraphs: 12, headings: 5,
  links: 8, images: 2, code_blocks: 3, mermaid_blocks: 1, math_spans: 4, math_blocks: 1,
};

test("reading time is ceil(words / 200)", () => {
  assert.equal(readingTimeMinutes(450), 3);
  assert.equal(readingTimeMinutes(200), 1);
  assert.equal(readingTimeMinutes(201), 2);
});

test("reading time is 0 for 0 words", () => {
  assert.equal(readingTimeMinutes(0), 0);
});

test("statsRows maps StructureCounts fields plus reading time", () => {
  const rows = statsRows(counts);
  const byLabel = new Map(rows.map((r) => [r.label, r.value]));
  assert.equal(byLabel.get("Words"), "450");
  assert.equal(byLabel.get("Bytes"), "2,600");
  assert.equal(byLabel.get("Sentences"), "30");
  assert.equal(byLabel.get("Paragraphs"), "12");
  assert.equal(byLabel.get("Headings"), "5");
  assert.equal(byLabel.get("Links"), "8");
  assert.equal(byLabel.get("Images"), "2");
  assert.equal(byLabel.get("Code blocks"), "3");
  assert.equal(byLabel.get("Mermaid blocks"), "1");
  assert.equal(byLabel.get("Math"), "5"); // math_spans + math_blocks
  assert.equal(byLabel.get("Reading time"), "3 min");
});

test("statsRows renders dashes when counts are null", () => {
  const rows = statsRows(null);
  assert.ok(rows.every((r) => r.value === "—"));
});
```

Run:
```
cd ui && node --test src/stats_popover.test.ts
```
Expected: FAILS — module not found.

### Task 4.2 — Implement `readingTimeMinutes` + `statsRows`; pass

Create `ui/src/stats_popover.ts`:
```ts
import type { StructureCounts } from './document_contracts.js';
import { clampMenuPosition } from './context_menu.js';

export interface StatsRow {
  label: string;
  value: string;
}

const WORDS_PER_MINUTE = 200;

/** Estimated reading time in whole minutes: `ceil(words / 200)`; 0 for 0 words. */
export function readingTimeMinutes(words: number): number {
  if (words <= 0) return 0;
  return Math.ceil(words / WORDS_PER_MINUTE);
}

const num = (x: number): string => x.toLocaleString();

/** Assemble display rows from `StructureCounts`; `null` → all dashes. */
export function statsRows(counts: StructureCounts | null): StatsRow[] {
  if (!counts) {
    return ROW_LABELS.map((label) => ({ label, value: '—' }));
  }
  return [
    { label: 'Words', value: num(counts.words) },
    { label: 'Bytes', value: num(counts.bytes) },
    { label: 'Sentences', value: num(counts.sentences) },
    { label: 'Paragraphs', value: num(counts.paragraphs) },
    { label: 'Headings', value: num(counts.headings) },
    { label: 'Links', value: num(counts.links) },
    { label: 'Images', value: num(counts.images) },
    { label: 'Code blocks', value: num(counts.code_blocks) },
    { label: 'Mermaid blocks', value: num(counts.mermaid_blocks) },
    { label: 'Math', value: num(counts.math_spans + counts.math_blocks) },
    { label: 'Reading time', value: `${readingTimeMinutes(counts.words)} min` },
  ];
}

const ROW_LABELS = [
  'Words', 'Bytes', 'Sentences', 'Paragraphs', 'Headings', 'Links', 'Images',
  'Code blocks', 'Mermaid blocks', 'Math', 'Reading time',
];

let openPopoverEl: HTMLElement | null = null;

export function closeStatsPopover(): void {
  if (openPopoverEl) { openPopoverEl.remove(); openPopoverEl = null; }
}

/** Open the stats popover at (x, y) showing rows derived from `counts`. */
export function openStatsPopover(x: number, y: number, counts: StructureCounts | null): void {
  closeStatsPopover();
  const popover = document.createElement('div');
  popover.className = 'pmd-dropdown-menu pmd-stats-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', 'Document statistics');
  for (const row of statsRows(counts)) {
    const r = document.createElement('div');
    r.className = 'pmd-stats-row';
    const label = document.createElement('span');
    label.className = 'pmd-stats-label';
    label.textContent = row.label;
    const value = document.createElement('span');
    value.className = 'pmd-stats-value';
    value.textContent = row.value;
    r.append(label, value);
    popover.append(r);
  }

  popover.style.position = 'fixed';
  popover.style.visibility = 'hidden';
  document.body.appendChild(popover);
  const rect = popover.getBoundingClientRect();
  const { left, top } = clampMenuPosition(
    { x, y }, { w: rect.width, h: rect.height }, { w: window.innerWidth, h: window.innerHeight },
  );
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.style.visibility = 'visible';
  openPopoverEl = popover;

  const dismiss = (ev: Event) => {
    if (ev.type === 'mousedown' && popover.contains(ev.target as Node)) return;
    if (ev.type === 'keydown' && (ev as KeyboardEvent).key !== 'Escape') return;
    closeStatsPopover();
    window.removeEventListener('mousedown', dismiss, true);
    window.removeEventListener('keydown', dismiss, true);
  };
  window.addEventListener('mousedown', dismiss, true);
  window.addEventListener('keydown', dismiss, true);
}
```

Run:
```
cd ui && node --test src/stats_popover.test.ts && npm run typecheck
```
Expected: 4 tests pass; typecheck passes (`stats_popover.ts` is in the tsconfig allowlist).

Commit:
```
git add -A && git commit -m "feat(stats): pure reading-time + row assembly + popover"
```

### Task 4.3 — Wire the stats popover to the status counts button in `main.ts`

Read `ui/src/main.ts`: where `chrome` handlers are wired (~line 1095). The popover reads the active doc's `facts.counts`.

Edit `ui/src/main.ts`:

1. Add the import (after `openFrontmatterPanel` import):
```ts
import { openStatsPopover } from './stats_popover.js';
```

2. Add a helper near `activeFrontmatter` (added in Task 2.13):
```ts
function activeStructureCounts(): import('./document_contracts.js').StructureCounts | null {
  const active = store.activeDoc();
  if (!active) return null;
  return factsStore.current(active.docId)?.facts?.counts ?? null;
}
```

3. Wire the click (near the other chrome handlers, ~line 1095):
```ts
chrome.onCountsClick(() => {
  const rect = document.querySelector('.pmd-status-counts')?.getBoundingClientRect();
  openStatsPopover(rect?.left ?? 80, (rect?.top ?? 80) - 8, activeStructureCounts());
});
```

`main.ts` is outside tsconfig, so verify via the build (`stats_popover.ts` was already type-checked in Task 4.2).

Run:
```
cd ui && npm run build
```
Expected: app bundle builds without error.

Commit:
```
git add -A && git commit -m "feat(stats): open stats popover from status counts button"
```

### Task 4.4 — Stats popover CSS

Append to `ui/styles/components.css`:
```css
/* --------------------------------------------
   Stats popover
   -------------------------------------------- */
.pmd-stats-popover { min-width: 14rem; padding: var(--pmd-space-2); }
.pmd-stats-row {
  display: flex;
  justify-content: space-between;
  gap: var(--pmd-space-3);
  padding: 2px 0;
  font-size: var(--pmd-text-sm);
}
.pmd-stats-label { color: var(--pmd-fg-muted); }
.pmd-stats-value { font-variant-numeric: tabular-nums; }
.pmd-status-counts { cursor: pointer; border: none; background: transparent; }
.pmd-status-counts:hover { color: var(--pmd-fg); }
```

Run:
```
cd ui && npm run build
```
Expected: builds.

Commit:
```
git add -A && git commit -m "style(stats): popover layout + clickable counts button"
```

---

## Phase 5 — End-to-end coverage & full check

### Task 5.1 — e2e: find in source and preview + split scope

Read `ui/e2e/document-intelligence.spec.cjs` (the `openOutlineFixture` pattern using `installTauriMock` + `appUrl` + typing into `.cm-content`) and `ui/e2e/helpers.cjs` (the mock `factsForMarkdown` returns `counts`/`frontmatter: null`; `renderHtml` overrides the preview HTML; `renderFacts` overrides facts).

Create `ui/e2e/document-inspection-find.spec.cjs` starting with the find scenario. Assert concretely:

- Setup: `installTauriMock(page, { renderHtml: '<article class="pmd-preview"><p data-pmd-block-id="b0">alpha beta alpha</p></article>' })`; `page.goto(appUrl())`; click "New File"; type `alpha beta alpha\n` into `.cm-content`; await the `<p>` containing "alpha" visible.
- Open find: `page.keyboard.press('Control+F')`. Assert `.pmd-find-bar` is visible and `.pmd-find-input` is focused.
- Type `alpha` into `.pmd-find-input`. Assert `.pmd-find-count` text is `1/2` after pressing Enter once (current index 1, total 2) — i.e. `await expect(page.locator('.pmd-find-count')).toHaveText('1/2')`. (On open in split mode the implied scope is preview. "alpha beta alpha" has two `alpha` matches; they are single-node so logical count = 2, confirming the cross-node-counting fix does not regress the common case.)
- Press the next button (`.pmd-find-btn` with title "Next match") / Enter; assert `.pmd-find-count` becomes `2/2`.
- Switch scope to Source (`.pmd-find-scope-btn[data-scope="source"]` click in split mode). Assert CodeMirror's panel appears: `await expect(page.locator('.cm-panels .cm-search')).toBeVisible()`. **Assert our typed query actually drove CM's search** (the `setSourceQuery` fix — this is the regression the finding flags): the CM search field reflects it — `await expect(page.locator('.cm-panels input[name="search"].cm-textfield')).toHaveValue('alpha')` — and CM highlights matches in the document: `await expect(page.locator('.cm-searchMatch').first()).toBeVisible()` (>= 1 match decoration). Then press `.pmd-find-btn` "Next match" and assert `.cm-searchMatch-selected` becomes visible (`findNext` selects a match). Also assert `.pmd-find-count` is empty (source counts come from CM, not our bar).
- Press `Escape`; assert `.pmd-find-bar` is hidden.

Run:
```
cd ui && npm run build && npm run test:e2e:playwright -- document-inspection-find
```
Expected: this spec's find test passes. (Build first so `dist/bundle.js` reflects the new code; e2e loads the built bundle.)

Commit:
```
git add -A && git commit -m "test(e2e): find in source/preview with split-mode scope toggle"
```

### Task 5.2 — e2e: stats popover values

Append a test to `ui/e2e/document-inspection-find.spec.cjs`:

- Setup: `installTauriMock(page, { renderFacts: { counts: { words: 400, bytes: 1000, sentences: 10, paragraphs: 4, headings: 2, links: 1, images: 0, code_blocks: 1, mermaid_blocks: 0, math_spans: 0, math_blocks: 0 } } })`. Verified in `helpers.cjs`: `factsForMarkdown` does `{ ...facts, ...renderFacts }` with `counts` further merged (`{ ...facts.counts, ...renderFacts.counts }`), so passing only `{ counts: {...} }` overrides counts while keeping the harness-built `headings`/`frontmatter: null`/`embedded`.
- Open a doc (New File + type a heading) so a facts snapshot exists.
- Click `.pmd-status-counts`. Assert `.pmd-stats-popover` is visible.
- Assert a row: `await expect(page.locator('.pmd-stats-row', { hasText: 'Reading time' })).toContainText('2 min')` (`ceil(400/200) = 2`).
- Assert `Words` row contains `400`.
- Press `Escape`; assert popover hidden.

Run:
```
cd ui && npm run test:e2e:playwright -- document-inspection-find
```
Expected: stats test passes.

Commit:
```
git add -A && git commit -m "test(e2e): stats popover shows counts and reading time"
```

### Task 5.3 — e2e: frontmatter chip → inspector → add/edit reflects in source

Append a test:

- Setup: `installTauriMock(page, { renderFacts: { frontmatter: { format: 'yaml', line_start: 1, line_end: 2, raw: '---\ntitle: Hello\n---\n', syntax: 'valid', metadata: { title: 'Hello', description: null, slug: null, sidebar_label: null, sidebar_position: null, tags: [], draft: null, unknown: {} } } } })`. (`renderFacts.frontmatter` overrides the harness `null` via the shallow merge; see 5.2.)
- New File; type `---\ntitle: Hello\n---\n# Body\n` into `.cm-content`; await render.
- Assert `.pmd-status-frontmatter` has text `frontmatter` (chip, present state) and class `pmd-status-frontmatter-present`.
- Click `.pmd-status-frontmatter`; assert `.pmd-frontmatter-panel` visible; assert the `title` field input has value `Hello`.
- Edit the `title` value input to `Renamed` and blur (dispatch `change`). Assert the editor buffer now contains `title: Renamed` — `await expect(page.locator('.cm-content')).toContainText('title: Renamed')`.
- Reopen the panel, in the add row type key `slug` / value `my-slug`, click Add. Assert `.cm-content` contains `slug: my-slug`.

Run:
```
cd ui && npm run test:e2e:playwright -- document-inspection-find
```
Expected: frontmatter test passes.

Commit:
```
git add -A && git commit -m "test(e2e): frontmatter inspector add/edit reflects in source"
```

### Task 5.4 — e2e: malformed frontmatter diagnostic surfaces + opens inspector

Append a test:

- Setup: `installTauriMock(page, { renderFacts: { frontmatter: { format: 'yaml', line_start: 1, line_end: 2, raw: '---\ntitle: [oops\n---\n', syntax: 'malformed', metadata: { title: null, description: null, slug: null, sidebar_label: null, sidebar_position: null, tags: [], draft: null, unknown: {} } } }, renderDiagnostics: { issues: [ { id: 'frontmatter:1:1:1', severity: 'warning', category: 'frontmatter', line_start: 1, line_end: 2, block_id: null, message: 'Frontmatter could not be parsed; previewing document body anyway.', detail: 'Fix the YAML/TOML frontmatter delimiters or syntax.', primary_action: 'Edit frontmatter' } ] } })`. (Verified in `helpers.cjs`: `renderDiagnostics` is spread over a default diagnostics object — `diagnosticsForMarkdown` does `{ ...structuredClone(renderDiagnostics) }` over defaults — so `doc_id`/`version`/`phase`/`resources`/`link_summary` are auto-filled; passing only `{ issues: [...] }` is sufficient.)
- New File; type `---\ntitle: [oops\n---\n# Body\n`.
- Open the diagnostics panel: `page.keyboard.press('Control+Shift+M')`. Assert a diagnostic row exists with text `Frontmatter could not be parsed`.
- Assert the row's malformed badge/action button labeled `Edit frontmatter` exists and is a `<button>` (clickable). Click it.
- Assert `.pmd-frontmatter-panel` opens and shows the `malformed` badge (`.pmd-frontmatter-badge` text `malformed`) and the "Fix the frontmatter in source" hint; the field inputs are absent/disabled (assert no `.pmd-frontmatter-value` enabled input).

Run:
```
cd ui && npm run test:e2e:playwright -- document-inspection-find
```
Expected: malformed test passes.

Commit:
```
git add -A && git commit -m "test(e2e): malformed frontmatter diagnostic opens read-only inspector"
```

### Task 5.5 — e2e: Mermaid inline error + go-to-source + copy source

**Fixture mechanism (verified — a raw `<pre><code class="language-mermaid">` will NOT render under the mock).** The e2e Tauri mock returns `render_nonce: ''` (verified in `helpers.cjs:502`). `markMermaidNodes` (`theme_apply.ts`) gates on `hasRenderNonce` = `renderNonce.length > 0 && …`, so with an empty nonce it marks **nothing** — a raw `<pre><code class="language-mermaid">` is never converted to a `.pmd-mermaid` target. But `renderMermaidNodes`/`collectMermaidTargets` (`mermaid_runner.ts`) select `.pmd-mermaid[data-mermaid-source][data-pmd-nonce]` filtered by `dataset.pmdNonce === renderNonce` (`'' === ''` matches), and `ensureMermaidContainer` skips its nonce guard when `renderNonce` is falsy (`''`) — so a **pre-marked container with an empty `data-pmd-nonce`** IS collected and `mermaid.render`-ed (and fails). So the fixture must be a pre-marked `.pmd-mermaid` div, not a raw code block.

- Setup: `installTauriMock(page, { renderHtml: '<article class="pmd-preview"><div class="pmd-mermaid" data-mermaid-source="graph TD; A--&gt;" data-pmd-nonce="" data-src-start="3" data-src-end="3"></div></article>' })` — an intentionally broken Mermaid source pre-marked for the empty nonce, with `data-src-start="3"` on the container itself (which `renderMermaidError` reads as `container.dataset.srcStart`). The mock keeps `renderFacts` default.
- New File; type lines so the editor has a recognizable line 3, e.g. `line one\nline two\nmermaid here\n`; await render.
- Assert `.pmd-mermaid-error` appears (the broken source fails `mermaid.render`) and contains `.pmd-mermaid-error-message` (non-empty text) and `.pmd-mermaid-error-source` containing `graph TD`.
- Click `.pmd-mermaid-error-goto` ("Go to source"). Assert the editor selection moved to line 3 (`data-src-start="3"`): `await expect(page.locator('.cm-activeLine')).toContainText('mermaid here')`.
- Assert the **`.pmd-mermaid-copy` ("Copy source") button is present on the error container** — this is the regression the finding flags: `addMermaidExpandButton` early-returns with no SVG, so the copy button must come from `renderMermaidError` calling the shared `makeCopySourceButton` (Task 3.1/3.2). `await expect(page.locator('.pmd-mermaid-error .pmd-mermaid-copy')).toBeVisible()`. Then click it. To verify the copied text, grant clipboard permission via `context.grantPermissions(['clipboard-read', 'clipboard-write'])` at the top of the test and read back: `expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('graph TD')`. (If the CI webview blocks clipboard reads, fall back to asserting the button exists + clicks without throwing.)

Run:
```
cd ui && npm run test:e2e:playwright -- document-inspection-find
```
Expected: mermaid test passes.

Commit:
```
git add -A && git commit -m "test(e2e): mermaid inline error go-to-source + copy source"
```

### Task 5.6 — Full project check

Run the whole gate (this rebuilds the CM bundle implicitly via `npm run build`? No — `just check` runs `npm run build` which is the app bundle only; the CM bundle was rebuilt in Phase 0 and is committed). Run:
```
just check
```
Expected: all stages pass — Rust tests/clippy, UI typecheck, UI unit tests (including `find_query`, `find_preview`, `frontmatter_edit`, `stats_popover`, updated `actions`), UI build, UI e2e, theme/package validation.

If `just check` fails only in unrelated stages (e.g. appstream/desktop validators when tools are absent), confirm those are the documented skips and that all feature stages passed.

Commit (only if `just check` produced any formatting/lockfile changes):
```
git add -A && git commit -m "chore: full check pass for document inspection & find slice"
```
(If nothing changed, skip the commit.)

---

\n\n--- SUMMARY ---\n\n

- **Slice scope:** One feature slice covering Find (#11), Frontmatter inspector + add/edit (#9), Mermaid inline errors + copy-source (#8), and a reading/structure Stats popover (#12). Three of four are thin surfacings of `CoreDocumentFacts`; only Find is a new subsystem. Plan saved to `docs/superpowers/plans/2026-05-31-document-inspection-and-find.md`.

- **Module layout decision:** `ui/src` is verified **flat** (no subfolders anywhere), so new modules use flat names (`find_query.ts`, `find_preview.ts`, `find_source.ts`, `find_controller.ts`, `frontmatter_edit.ts`, `frontmatter_panel.ts`, `stats_popover.ts`) — not `find/…` subdirs — to match convention and keep `./x.ts` imports.

- **Phase 0 risks handled first:**
  - *CSS Custom Highlight API on WebKitGTK*: a runtime probe (`"highlights" in CSS && typeof Highlight === "function"`) selects the no-markup Custom Highlight path or the `<mark>` fallback. Decision rule is baked into `find_preview.ts`; the fallback uses only DOM APIs over existing text nodes and tears down every `mark.pmd-find` before each recompute.
  - *Vendored CM bundle rebuild with `@codemirror/search` v6*: add the direct dep, pin it in the `build-codemirror.mjs` alias map (sharing the already-aliased state/view singletons), re-export from `codemirror-entry.ts`, rebuild, then a smoke-check asserts the search exports exist **and** the markdown parse tree is non-empty (the dedupe failure mode). Wiring proceeds only if the tree is intact.
  - *Malformed-frontmatter diagnostic*: verify-only — the Rust `frontmatter_issues` emission already exists; no new emission. Its `primary_action: "Edit frontmatter"` label is mapped to the new `document.editFrontmatter` action in `main.ts` (both `runDiagnosticPrimaryAction` and `isImplementedDiagnosticAction` updated so the panel renders a clickable button).

- **Find approach:** Pure `findMatches` (case-insensitive, non-overlapping offset ranges) is unit-tested first. Source find reuses CodeMirror's panel/counts via a new `searchCompartment` in `editor.ts` (basicSetup already binds `searchKeymap`), driven by the existing `edit.find/findNext/findPrevious` actions (re-pointed in `main.ts`; the global hotkey handler intercepts Ctrl+F, so the action must explicitly open the panel). The typed query is pushed into CM via `setSearchQuery`/`SearchQuery` (`setSourceQuery`) so one input drives both panes. Preview find maps matches to per-node sub-ranges **tagged with a logical `matchIndex`**, so `count()`/next/previous index LOGICAL matches (a cross-node match counts once); all sub-ranges are painted. A **single** recompute call sits after the render if/else in `processRenderQueue`. The controller hosts the find bar with a split-mode source⇄preview scope toggle and `n/m` counts.

- **Frontmatter approach (decoupled from async facts):** Pure `frontmatter_edit.ts` is **doc-based** — `locateBlock(doc)` re-derives block bounds from the live buffer each call, so edit/add never read the (stale/null) facts store. `editValueChange(doc, key, value)` and `addEntryChange(doc, key, value)` take no `FrontmatterFact`; the no-block flow inserts a starter block then edits it straight from the buffer (covered by a "fresh block, no facts" test). `formatScalar` emits **valid** YAML/TOML scalars (TOML strings quoted, YAML quoted only when ambiguous). Edit-value preserves a trailing inline `# comment`. All edits go through the open in-scope CodeMirror buffer (undo/save/render reuse, no new path authority); a block with no closable fence yields `null` (no edit). The inspector reads facts for **display only** and is wired with the always-present `.pmd-status-frontmatter` chip.

- **Mermaid approach:** The existing `catch` is enhanced (no new render path) to show message + a "Go to source" button reading `container.dataset.srcStart` and calling the new `gotoEditorLine(line)` (injected into `mermaid_runner.ts` via a setter) + visible source. A shared, exported `makeCopySourceButton(source)` in `mermaid_zoom.ts` is used by BOTH `addMermaidExpandButton` (success path) AND `renderMermaidError` (failed path — `addMermaidExpandButton` early-returns with no SVG), so copy-source is present on failed diagrams too. All DOM is built via createElement/textContent — no markup injection.

- **Stats approach:** Pure `readingTimeMinutes` (`ceil(words/200)`, 0 for 0 words) and `statsRows` (maps `StructureCounts` fields incl. Math = `math_spans + math_blocks`, "—" when null) are unit-tested, then surfaced via a popover opened from the now-clickable `.pmd-status-counts` button reading `facts.counts`. The inline status bar (JS `counts.ts`) is unchanged.

- **Security invariants stated in-task:** preview find adds no markup on the Highlight path; the `<mark>` fallback wraps existing text nodes only and rebuilds from the sanitized DOM each render with full teardown; frontmatter edits write only to the open buffer; clipboard writes are user-initiated and copy only the document's own diagram source.

- **Typecheck scope (verified):** `tsconfig.json` `include` is a deliberate allowlist (NOT a glob), and type-only imports still pull the imported `.ts` into the `tsc` program. So Task 0.7 allowlists **only the genuinely-pure modules** whose entire import graph is allowlisted + DOM (`find_query`, `find_preview`, `frontmatter_edit`, `frontmatter_panel`, `stats_popover`, + `context_menu`); these were assembled and verified to typecheck clean under strict + lib.dom. `find_source.ts` (imports the untyped bundle) and `find_controller.ts` (imports the excluded `editor.ts`/`chrome.ts` shells) stay **excluded** and are build-verified like `main.ts`/`editor.ts`/`chrome.ts`/`mermaid_*`. No bundle `.d.ts` is needed once no allowlisted module imports the bundle.

- **Pre-existing red baseline:** `ui/src/actions.test.ts:53` asserted `NO_DEFAULT_ACTION_IDS.length === 17` but the array now has **20** entries (drift from concurrent work) → the suite is red on `master`. **Task 0.1b** corrects the literal to `20` up front (green baseline); **Task 2.10** then bumps it to `21` when this feature adds `document.editFrontmatter`.

- **Testing:** Unit tests precede wiring in every feature (find query/preview-mapping with logical-match grouping, frontmatter locateBlock/formatScalar/edit/add/insert + fresh-block-no-facts, stats rows/reading-time, updated actions inventory). e2e (`document-inspection-find.spec.cjs`) covers find source/preview/split-scope (incl. asserting the typed query drives CM's source search), stats values, frontmatter chip add/edit reflected in source, malformed diagnostic → read-only inspector, and Mermaid inline error → go-to-source + copy-source-on-failed-diagram, following the `installTauriMock`/`appUrl` patterns in `helpers.cjs`. Final gate is `just check` (cargo `-j 2`).

- **Total: 6 phases, 46 tasks.** Each task is one bite-sized TDD step ending in a conventional commit.
