# Incremental rendering — design spec

Date: 2026-05-31
Branch: `feat/incremental-rendering`
Status: design (pre-implementation)

## 1. Problem & goals

Rendering re-does **whole-document work on every render**, which is wasteful on
large markdown files. Measured baseline (see
[`docs/perf/2026-05-31-render-pipeline-baseline.md`](../../perf/2026-05-31-render-pipeline-baseline.md))
shows two bottlenecks with a single root cause:

- **Backend:** whole-document ammonia **sanitization** = 80–88% of Rust
  `render_string` time (62 ms @ 1 MB prose, up to 614 ms @ 2 MB tables), linear
  in output tag count.
- **Frontend:** whole-document **`innerHTML` replace → full re-layout** = ~70% of
  the main-thread apply path, linear in block count (~610 ms @ 9000 blocks).

IPC, parse+emit, and (already-cached) mermaid/katex are minor.

**Goals**
- Lower per-edit preview latency: re-render and re-apply only what changed.
- Keep output **byte-identical** to the current full render (no visual/behavioural change).
- Preserve the security model (ammonia stays the trust boundary).

**Non-goals (this spec)**
- Huge-document *initial-load* cost (first render is still linear in blocks).
  Addressed later by viewport/lazy rendering (Phase 3, out of scope here).
- Changing markdown semantics, themes, or the sanitizer allowlist.

Typing jank is **already** addressed (80 ms render debounce + source-keyed
mermaid/katex caches, landed on `master`). This work targets the remaining
per-edit *latency* and main-thread *reflow*.

## 2. Core idea

The document is an ordered sequence of **top-level blocks**. pulldown-cmark's
`into_offset_iter()` gives every event a source byte range; tracking nesting
depth, each depth-0 container (paragraph, heading, blockquote, list, table,
code block, rule, HTML block, footnote definition, …) is one top-level block
with a source slice. The emitter emits **exactly one top-level HTML element per
block**, so `#pmd-content`'s direct children map 1:1 to blocks.

Design: **memoize sanitized HTML per block, keyed by block source text, and
only touch what changed.** The cache is **stateless** — a process-global
bounded LRU keyed by `blake3(block_source)` (blake3 is already a dependency).
No "previous render" state is tracked; the cache *is* the memory, and identical
blocks dedupe even across documents.

## 3. Always-correct invariant & fallback

**Invariant:** for every input, the incremental result is byte-identical to
`render_string(full_doc)`.

Per-block rendering diverges from whole-document rendering only for
cross-block / spanning constructs. Before using the incremental path,
`render_incremental` scans for **fallback triggers** and, if any are present,
runs the existing whole-document `render_string` unchanged:

- **Footnote definitions / references** (`[^id]:`, `[^id]`) — numbering and the
  emitted footnote section are global.
- **Reference-style link definitions** (`[id]: url "title"`) — a definition
  anywhere affects link emission elsewhere.
- **Raw HTML** (`Event::Html` / `Event::InlineHtml`) — may be unbalanced/spanning
  across blocks; this is also the only ammonia per-block composability hazard.

Fallback means *no speedup* for those documents, never *wrong output*. (A later
iteration may special-case footnotes; out of scope here.)

For documents **without** triggers, every top-level block the emitter produces
is a balanced, self-contained HTML element, so
`clean(block_a) ⧺ clean(block_b) == clean(block_a ⧺ block_b)` — verified by the
property test in §7.

## 4. Phase 1 — backend per-block sanitize cache

New module `crates/pmd-core/src/incremental.rs`. Public entry:
`render_incremental(md: &str) -> RenderResult` (same return type as
`render_string`).

Flow:
1. **Segment** `md` into ordered top-level block source slices `[b0, b1, …]`
   (depth-0 offset tracking over the parser). Record each block's start line.
2. **Fallback check** (§3). If triggered → `return render_string(md)`.
3. For each block `bi`:
   - `key = blake3(bi.source)`.
   - **Hit** → reuse the cached `CachedBlock`.
   - **Miss** → render just this block (`parse+emit` the slice → raw HTML →
     `ammonia clean`), build a `CachedBlock`, insert into the LRU.
4. **Assemble** the per-block HTML in order into the document HTML; build
   `source_map`; return `RenderResult { html, source_map, render_nonce }`.

### 4.1 What must NOT be baked into a cached block (would go stale)

- **Absolute line numbers** (`data-src-start` / `data-src-end`). Cache them
  **block-relative** (block's first source line = 1). At assembly, each block's
  base line = lines before it in the document; rewrite `data-src-*` =
  `base − 1 + relative` with a cheap string scan. Only blocks **after** an edit
  have a shifted base and need rewriting; unchanged blocks above the edit are
  reused verbatim. The expensive ammonia pass is skipped for *all* cache hits;
  the line rewrite is O(block HTML) string work, far cheaper than re-sanitizing.
- **The per-render nonce** (on trusted mermaid/math nodes). Cached blocks are
  rendered/sanitized with a **process-stable random placeholder nonce** `P`
  (generated once via getrandom, never present in document content); at assembly
  the placeholder is substituted with the current render's nonce `N` in a single
  string pass (same mechanism as the mermaid SVG re-id fix). This **preserves the
  per-render-nonce security model**.
  - *Decision (best long-run):* keep the per-render nonce. A **stable
    per-session nonce** would remove the substitution step but is
    **replay-vulnerable** — a nonce observed once (e.g. rendered HTML pasted back
    into the document as raw HTML) stays valid all session and could forge a
    "trusted" mermaid/math node. Per-render regeneration defeats that replay; the
    placeholder→`N` substitution is cheap, so we do not trade security for it.
    `P` is process-stable only as an internal cache token (never returned to the
    frontend), so it carries no replay surface.

### 4.2 Cache

- `static` bounded LRU behind a `Mutex` (or sharded), key `blake3` digest,
  value `CachedBlock { html_with_placeholders: String, … }`.
- Size bound by entry count and/or bytes (e.g. a few thousand blocks); evict
  oldest. Editing a block char-by-char creates one entry per intermediate
  source — the bound prevents unbounded growth.
- No explicit invalidation needed: changing a block changes its source → new
  key → miss → render. Old entries age out.

### 4.3 `render_cmd` integration

`render_cmd` calls `render_incremental` instead of `render_string`. Output is
identical, so the frontend is **unchanged in Phase 1** — this phase ships on its
own and captures the ~84% backend cost with no protocol change.

## 5. Phase 2 — frontend per-block DOM patch

Goal: stop replacing the whole `#pmd-content` subtree (and forcing a full
re-layout) on every render; patch only changed blocks.

### 5.1 Backend → frontend contract additions

`RenderResult` gains a block manifest:
- `blocks: Vec<BlockRef>` where `BlockRef { key: String, base_line: u32 }`, in
  document order.
- Each top-level element in `html` carries `data-pmd-block="<key>"`.
- `html` still contains the full document (so first render / fallback / cache
  miss for the whole doc all work); the frontend uses `blocks` to reconcile.

(Backwards-compatible: if `blocks` is absent/empty the frontend falls back to
the current `innerHTML` replace.)

### 5.2 Frontend keyed reconciliation

Mechanism: build a **detached** fragment from `result.html`
(`template.innerHTML = result.html` — this pays the HTML *parse* cost,
~10 ms/1000 blocks, but **no layout**, because it is not in the document). Then
keyed-reconcile the detached fragment's children into the live `#pmd-content`,
where only inserted/replaced children trigger (scoped) layout — avoiding the
full re-layout that the current wholesale `innerHTML =` forces.

`#pmd-content`'s direct children are keyed by `data-pmd-block`. Diff the live
key list against the detached fragment's keys (keyed list reconciliation):
- **key present, same relative position** → keep the **live** DOM node (preserves
  rendered mermaid/katex and node identity); if its `base_line` changed, patch
  `data-src-start/end` on it (cheap; no rebuild).
- **new / changed key** → adopt the node from the detached fragment
  (insert/replace in the live tree).
- **removed key** → remove the live node.

Post-processing runs **only on inserted/changed nodes**:
- `markAllNodes`, `renderMermaidNodes`, `renderMathNodes`, `decorateCodeBlocks`,
  `decorateTables` are scoped to the changed nodes rather than scanning the whole
  tree every render.

`dom_diff.ts` (currently unused) is the starting point but will be reworked into
a **keyed** block reconciler (the existing one is positional/recursive and would
fight mermaid/katex-decorated nodes — see the perf-branch notes).

### 5.3 Preserved behaviour

- Scroll-sync, table-copy, and mermaid source-range copy read `data-src-*`;
  those attributes stay correct (patched on shifted blocks).
- Mermaid/KaTeX rendered output on **unchanged** nodes is untouched (nodes keep
  identity), so no re-render of unchanged diagrams/math at all.

## 6. Components & boundaries

- `pmd-core/src/incremental.rs` — segmentation, fallback detection, per-block
  render, block LRU cache, assembly (line + nonce rewrite). Depends on existing
  `emit` and `sanitize`. Pure/testable; no Tauri.
- `pmd-core/src/emit.rs` — may expose a `render_block`/`emit_block` helper and a
  placeholder-nonce mode; otherwise unchanged.
- `pmd-app/src/cmd/render.rs` — calls `render_incremental`; serializes the new
  `blocks` manifest.
- `ui/src/` — a keyed block reconciler (reworked `dom_diff.ts`) + scoped
  post-processing in `processRenderQueue` (main.ts).

## 7. Testing strategy (correctness is the main risk)

- **Property test (`pmd-core`, proptest):** for arbitrary markdown *without*
  fallback triggers, `render_incremental(md).html == render_string(md).html`.
  Then apply a random edit `md → md'` and assert
  `render_incremental(md').html == render_string(md').html` (cache warm). This
  pins both composability and cache correctness.
- **Fallback tests:** docs with footnotes / ref-links / raw HTML take the full
  path and match `render_string`.
- **Existing golden + security suites** must stay green (identical output).
- **Cache-bound test:** exceeding the LRU bound evicts and still renders
  correctly.
- **Frontend e2e (Playwright):** after edits, unchanged block nodes keep DOM
  identity (no re-creation); changed blocks update; `data-src-*` correct after
  line shifts; mermaid/katex on unchanged nodes not re-run.

## 8. Phasing

Both phases below are implemented in a **single implementation plan** (they are
coupled through block segmentation). Phase-1 tasks come first and remain
independently landable/shippable (identical output, frontend untouched).

- **Phase 1** — backend `render_incremental` + block cache + fallback + assembly
  (line/nonce rewrite). Identical output. Captures the dominant ~84% backend cost.
- **Phase 2** — block manifest in `RenderResult` + frontend keyed reconciliation
  + scoped post-processing. Captures the ~70% frontend reflow.
- **Phase 3 (future, out of scope)** — viewport/lazy rendering for huge-document
  initial load; composes with, but is independent of, the above.

## 9. Risks & open questions

- **Per-block ammonia composability** for no-fallback docs — assumed and pinned
  by the property test; if the test finds a divergence, widen fallback triggers.
- **Fallback frequency** — footnote/ref-link/raw-HTML-heavy docs get no speedup.
  Acceptable for v1.
- **Nonce handling** — placeholder-substitution chosen (no security change);
  per-session nonce noted as a future simplification.
- **One-element-per-block assumption** — holds for the current emitter; the
  property/golden tests will catch any block that emits 0 or >1 top-level
  elements, which would need the manifest to carry element counts per block.
- **LRU sizing** — pick bounds from the frontend cache precedent (256–512
  entries) tuned to block sizes; `log` evictions in debug if useful.
