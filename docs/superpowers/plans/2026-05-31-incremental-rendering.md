# Incremental Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render only the markdown blocks that changed — cache sanitized HTML per top-level block (backend) and patch only changed DOM nodes (frontend) — while keeping output byte-identical to the current full render.

**Architecture:** The document is a sequence of top-level blocks (pulldown-cmark offset ranges; the emitter emits exactly one top-level element per block). Backend memoizes per-block sanitized HTML in a process-global cache keyed by `blake3(block_source)`, assembles the document, and falls back to whole-document `render_string` whenever cross-block constructs (footnotes, reference-link definitions, raw HTML) are present. Frontend keyed-reconciles `#pmd-content`'s children against a per-render block manifest, touching only changed blocks.

**Tech Stack:** Rust (pmd-core: pulldown-cmark, ammonia, blake3), Tauri IPC, TypeScript (CodeMirror + vanilla DOM preview), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-05-31-incremental-rendering-design.md`
**Baseline data:** `docs/perf/2026-05-31-render-pipeline-baseline.md`

**Invariant (the backbone of every test):** for all inputs,
`render_incremental(md).html == render_string(md).html` and
`render_incremental(md).source_map == render_string(md).source_map`.

---

## File Structure

- `crates/pmd-core/Cargo.toml` — add `blake3` dep (modify).
- `crates/pmd-core/src/emit.rs` — extract `render_fragment` from `render_string`; make `generate_render_nonce` + `byte_to_line` + `parser_options` `pub(crate)`; (Phase 2) emit nothing new here (modify).
- `crates/pmd-core/src/incremental.rs` — NEW: segmentation, fallback detection, block cache, per-block render, assembly, `render_incremental`, (Phase 2) block manifest + `data-pmd-block` injection.
- `crates/pmd-core/src/lib.rs` — add `pub mod incremental;` (modify).
- `crates/pmd-core/src/emit.rs` `RenderResult` — (Phase 2) add `blocks: Vec<BlockRef>` (modify).
- `crates/pmd-core/tests/incremental.rs` — NEW: unit + fallback tests.
- `crates/pmd-core/tests/prop_incremental.rs` — NEW: `incremental ≡ full` property tests.
- `crates/pmd-app/src/cmd/render.rs` — call `render_incremental` (modify).
- `ui/src/main.ts` — `processRenderQueue` chooses reconcile vs full replace; scoped post-processing (modify).
- `ui/src/block_reconcile.ts` — NEW: keyed block reconciliation (replaces the unused `dom_diff.ts`).
- `ui/e2e/incremental.spec.cjs` — NEW: node-identity + data-src e2e.

---

# PHASE 1 — backend per-block sanitize cache (identical output, frontend untouched)

## Task 1: Add blake3 dependency to pmd-core

**Files:**
- Modify: `crates/pmd-core/Cargo.toml`

- [ ] **Step 1: Add the dependency**

In `[dependencies]` add:

```toml
blake3.workspace = true
```

(`blake3 = "1"` already exists in `[workspace.dependencies]` of the root `Cargo.toml`.)

- [ ] **Step 2: Verify it builds**

Run: `cargo build -p pmd-core -j 2`
Expected: compiles, no errors.

- [ ] **Step 3: Commit**

```bash
git add crates/pmd-core/Cargo.toml Cargo.lock
git commit -m "build(core): add blake3 dep for block hashing"
```

---

## Task 2: Extract `render_fragment` from `render_string` (refactor, output identical)

**Why:** incremental rendering renders individual block slices through the same emit core, with a caller-supplied nonce and line numbers relative to the slice, and sanitizes separately.

**Files:**
- Modify: `crates/pmd-core/src/emit.rs`

- [ ] **Step 1: Make helpers reachable from the new module**

Change visibility (do NOT change behaviour):
- `fn byte_to_line(...)` → `pub(crate) fn byte_to_line(...)`
- `fn generate_render_nonce() -> String` → `pub(crate) fn generate_render_nonce() -> String`

Add a `pub(crate)` accessor for the parser options used by `render_string` so the segmenter parses identically. Extract the existing options block into:

```rust
pub(crate) fn parser_options() -> pulldown_cmark::Options {
    let mut opts = pulldown_cmark::Options::empty();
    opts.insert(
        pulldown_cmark::Options::ENABLE_TABLES
            | pulldown_cmark::Options::ENABLE_TASKLISTS
            | pulldown_cmark::Options::ENABLE_STRIKETHROUGH
            | pulldown_cmark::Options::ENABLE_FOOTNOTES,
    );
    opts
}
```

- [ ] **Step 2: Add the `FragmentRender` type and `render_fragment`**

Add near `RenderResult`:

```rust
/// Raw (pre-sanitize) emit of a markdown fragment. `data-src-*` line numbers are
/// 1-based relative to `md`; trusted mermaid/math nodes carry `render_nonce`.
pub struct FragmentRender {
    pub html: String,
    pub source_map: Vec<(u32, u32)>,
}
```

Move the entire body of the current `render_string` (everything after the nonce is generated, i.e. building `to_line`, the parser loop, `emit_footnotes_section`) into:

```rust
pub fn render_fragment(md: &str, render_nonce: &str) -> FragmentRender {
    let to_line = byte_to_line(md);
    let opts = parser_options();
    let parser = Parser::new_ext(md, opts).into_offset_iter();
    let mut html = String::new();
    let mut source_map = Vec::<(u32, u32)>::new();
    // ... (the existing loop body verbatim, using `render_nonce` as the nonce) ...
    emit_footnotes_section(&mut html, footnotes, &fn_ref_counts);
    FragmentRender { html, source_map }
}
```

- [ ] **Step 3: Rewrite `render_string` to delegate**

```rust
pub fn render_string(md: &str) -> RenderResult {
    let render_nonce = generate_render_nonce();
    let frag = render_fragment(md, &render_nonce);
    let html = crate::sanitize::clean_with_render_nonce(&frag.html, &render_nonce);
    RenderResult {
        version: 0,
        html,
        source_map: frag.source_map,
        render_nonce,
    }
}
```

- [ ] **Step 4: Run the full suite — output must be unchanged**

Run: `cargo test -p pmd-core -j 2`
Expected: PASS, including `golden` and `security` (they assert exact HTML). If golden diffs appear, the loop body was altered during the move — revert and move verbatim.

- [ ] **Step 5: Commit**

```bash
git add crates/pmd-core/src/emit.rs
git commit -m "refactor(core): extract render_fragment from render_string (no behaviour change)"
```

---

## Task 3: Process-stable placeholder nonce

**Files:**
- Create: `crates/pmd-core/src/incremental.rs`
- Modify: `crates/pmd-core/src/lib.rs`

- [ ] **Step 1: Register the module**

In `lib.rs` add (alphabetical with the others):

```rust
pub mod incremental;
```

- [ ] **Step 2: Create the module with the placeholder nonce**

`crates/pmd-core/src/incremental.rs`:

```rust
//! Block-incremental rendering: memoize sanitized HTML per top-level block,
//! keyed by block source text, falling back to whole-document render_string for
//! cross-block constructs. Output is byte-identical to render_string.

use std::sync::OnceLock;

/// A process-stable random token used as the render nonce inside cached blocks.
/// Never returned to the frontend; substituted for the real per-render nonce at
/// assembly. Random so it cannot appear in document content.
fn placeholder_nonce() -> &'static str {
    static P: OnceLock<String> = OnceLock::new();
    P.get_or_init(crate::emit::generate_render_nonce)
}
```

- [ ] **Step 3: Verify it builds**

Run: `cargo build -p pmd-core -j 2`
Expected: compiles (unused-fn warnings are fine for now).

- [ ] **Step 4: Commit**

```bash
git add crates/pmd-core/src/incremental.rs crates/pmd-core/src/lib.rs
git commit -m "feat(core): incremental module scaffold + placeholder nonce"
```

---

## Task 4: Block segmentation + fallback detection

**Files:**
- Modify: `crates/pmd-core/src/incremental.rs`
- Test: `crates/pmd-core/tests/incremental.rs` (create)

- [ ] **Step 1: Write failing tests for segmentation + fallback**

`crates/pmd-core/tests/incremental.rs`:

```rust
use pmd_core::incremental::{plan_blocks_for_test, BlockSliceView};

#[test]
fn segments_top_level_blocks_with_lines() {
    let md = "# Title\n\nPara one.\n\n- a\n- b\n";
    let blocks = plan_blocks_for_test(md).expect("no fallback");
    // heading, paragraph, list  => 3 top-level blocks
    let texts: Vec<&str> = blocks.iter().map(|b| &md[b.start..b.end]).collect();
    assert_eq!(texts.len(), 3);
    assert!(texts[0].starts_with("# Title"));
    assert!(texts[1].starts_with("Para one."));
    assert!(texts[2].starts_with("- a"));
    assert_eq!(blocks[0].start_line, 1);
    assert_eq!(blocks[1].start_line, 3);
    assert_eq!(blocks[2].start_line, 5);
}

#[test]
fn rule_is_its_own_block() {
    let md = "a\n\n---\n\nb\n";
    let blocks = plan_blocks_for_test(md).expect("no fallback");
    assert_eq!(blocks.len(), 3); // para, hr, para
}

#[test]
fn falls_back_on_raw_html() {
    assert!(plan_blocks_for_test("<div>x</div>\n").is_none());
}

#[test]
fn falls_back_on_footnotes() {
    assert!(plan_blocks_for_test("text[^1]\n\n[^1]: note\n").is_none());
}

#[test]
fn falls_back_on_reference_link_definition() {
    assert!(plan_blocks_for_test("see [it][x]\n\n[x]: https://e.com\n").is_none());
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p pmd-core --test incremental -j 2`
Expected: FAIL (functions/types not defined).

- [ ] **Step 3: Implement segmentation + fallback**

Add to `incremental.rs`:

```rust
use pulldown_cmark::{Event, Parser, Tag};

pub(crate) struct BlockSlice {
    pub start: usize,
    pub end: usize,
    pub start_line: u32,
}

/// Returns the ordered top-level block slices, or `None` if the document
/// contains a cross-block construct that requires a whole-document render
/// (footnotes, reference-link definitions, raw HTML).
pub(crate) fn plan_blocks(md: &str) -> Option<Vec<BlockSlice>> {
    if has_reference_definition(md) {
        return None;
    }
    let to_line = crate::emit::byte_to_line(md);
    let mut blocks = Vec::new();
    let mut depth: i32 = 0;
    let mut cur_start = 0usize;
    for (event, range) in Parser::new_ext(md, crate::emit::parser_options()).into_offset_iter() {
        match event {
            Event::Html(_) | Event::InlineHtml(_) | Event::FootnoteReference(_) => return None,
            Event::Start(Tag::FootnoteDefinition(_)) => return None,
            Event::Start(_) => {
                if depth == 0 {
                    cur_start = range.start;
                }
                depth += 1;
            }
            Event::End(_) => {
                depth -= 1;
                if depth == 0 {
                    blocks.push(BlockSlice { start: cur_start, end: range.end, start_line: to_line(cur_start) });
                }
            }
            Event::Rule => {
                if depth == 0 {
                    blocks.push(BlockSlice { start: range.start, end: range.end, start_line: to_line(range.start) });
                }
            }
            _ => {}
        }
    }
    Some(blocks)
}

/// Conservative scan for reference-style link/image definitions: a line of the
/// form `[label]: ...` with up to 3 leading spaces. pulldown-cmark consumes
/// these without emitting events, so they cannot be detected from the stream.
/// A false positive only forces a (correct) full render.
fn has_reference_definition(md: &str) -> bool {
    md.lines().any(|line| {
        let t = line.trim_start_matches(' ');
        if line.len() - t.len() > 3 || !t.starts_with('[') {
            return false;
        }
        if let Some(close) = t.find("]:") {
            close > 1 // non-empty label
        } else {
            false
        }
    })
}

// Test-only view (stable shape for the integration test above).
pub struct BlockSliceView {
    pub start: usize,
    pub end: usize,
    pub start_line: u32,
}

pub fn plan_blocks_for_test(md: &str) -> Option<Vec<BlockSliceView>> {
    plan_blocks(md).map(|v| {
        v.into_iter()
            .map(|b| BlockSliceView { start: b.start, end: b.end, start_line: b.start_line })
            .collect()
    })
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cargo test -p pmd-core --test incremental -j 2`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add crates/pmd-core/src/incremental.rs crates/pmd-core/tests/incremental.rs
git commit -m "feat(core): top-level block segmentation + full-render fallback detection"
```

---

## Task 5: Block cache + per-block render

**Files:**
- Modify: `crates/pmd-core/src/incremental.rs`

- [ ] **Step 1: Write a failing test for per-block render + caching**

Append to `crates/pmd-core/tests/incremental.rs`:

```rust
use pmd_core::incremental::render_block_for_test;

#[test]
fn block_render_is_sanitized_and_cached_relative() {
    // relative line numbers: a standalone paragraph is block-line 1
    let (html1, hits1) = render_block_for_test("Hello **world**.");
    assert!(html1.contains("data-src-start=\"1\""));
    assert!(html1.contains("<strong>world</strong>"));
    // second call to the SAME source is a cache hit, identical html
    let (html2, hits2) = render_block_for_test("Hello **world**.");
    assert_eq!(html1, html2);
    assert!(hits2 > hits1, "second identical render should hit the cache");
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p pmd-core --test incremental block_render -j 2`
Expected: FAIL (function not defined).

- [ ] **Step 3: Implement the cache + per-block render**

Add to `incremental.rs`:

```rust
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

pub(crate) struct CachedBlock {
    /// Sanitized HTML; `data-src-*` are 1-based relative to the block; trusted
    /// nodes carry the placeholder nonce.
    pub html: String,
    pub source_map: Vec<(u32, u32)>,
}

const BLOCK_CACHE_CAP: usize = 4096;

struct BlockCache {
    map: HashMap<[u8; 32], Arc<CachedBlock>>,
    order: VecDeque<[u8; 32]>,
    hits: u64,
}

impl BlockCache {
    fn new() -> Self {
        Self { map: HashMap::new(), order: VecDeque::new(), hits: 0 }
    }
    fn get(&mut self, key: &[u8; 32]) -> Option<Arc<CachedBlock>> {
        let v = self.map.get(key).cloned();
        if v.is_some() {
            self.hits += 1;
        }
        v
    }
    fn put(&mut self, key: [u8; 32], block: Arc<CachedBlock>) {
        if self.map.insert(key, block).is_none() {
            self.order.push_back(key);
            while self.order.len() > BLOCK_CACHE_CAP {
                if let Some(old) = self.order.pop_front() {
                    self.map.remove(&old);
                }
            }
        }
    }
}

fn cache() -> &'static Mutex<BlockCache> {
    static C: OnceLock<Mutex<BlockCache>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(BlockCache::new()))
}

/// Render+sanitize one block's source with the placeholder nonce, memoized by
/// blake3(source). Returns shared cached HTML (relative line numbers).
pub(crate) fn render_block_cached(src: &str) -> Arc<CachedBlock> {
    let key: [u8; 32] = *blake3::hash(src.as_bytes()).as_bytes();
    if let Some(hit) = cache().lock().unwrap().get(&key) {
        return hit;
    }
    let frag = crate::emit::render_fragment(src, placeholder_nonce());
    let html = crate::sanitize::clean_with_render_nonce(&frag.html, placeholder_nonce());
    let block = Arc::new(CachedBlock { html, source_map: frag.source_map });
    cache().lock().unwrap().put(key, block.clone());
    block
}

pub fn render_block_for_test(src: &str) -> (String, u64) {
    let b = render_block_cached(src);
    let hits = cache().lock().unwrap().hits;
    (b.html.clone(), hits)
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cargo test -p pmd-core --test incremental block_render -j 2`
Expected: PASS.

- [ ] **Step 5: Add an eviction-correctness test**

Append to `crates/pmd-core/tests/incremental.rs` (renders far more than `BLOCK_CACHE_CAP` distinct blocks, then re-renders an early one — eviction must not corrupt output):

```rust
#[test]
fn cache_eviction_does_not_corrupt() {
    let first = pmd_core::incremental::render_block_for_test("para number 0").0;
    for i in 1..5000 {
        let _ = pmd_core::incremental::render_block_for_test(&format!("para number {i}"));
    }
    // block 0 was almost certainly evicted; re-rendering it must reproduce
    // exactly the same HTML (a fresh miss renders identically).
    let again = pmd_core::incremental::render_block_for_test("para number 0").0;
    assert_eq!(first, again);
}
```

Run: `cargo test -p pmd-core --test incremental cache_eviction -j 2`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/pmd-core/src/incremental.rs crates/pmd-core/tests/incremental.rs
git commit -m "feat(core): per-block render + bounded blake3-keyed sanitize cache"
```

---

## Task 6: Assembly — line-offset rewrite + nonce substitution + `render_incremental`

**Files:**
- Modify: `crates/pmd-core/src/incremental.rs`

- [ ] **Step 1: Write a failing equivalence unit test**

Append to `crates/pmd-core/tests/incremental.rs`:

```rust
use pmd_core::emit::render_string;
use pmd_core::incremental::render_incremental;

fn assert_equiv(md: &str) {
    let inc = render_incremental(md);
    let full = render_string(md);
    assert_eq!(inc.html, full.html, "html mismatch for:\n{md}");
    assert_eq!(inc.source_map, full.source_map, "source_map mismatch for:\n{md}");
}

#[test]
fn incremental_equals_full_basic() {
    assert_equiv("# Title\n\nPara **one** with `code`.\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n");
}

#[test]
fn incremental_equals_full_with_math_and_code() {
    assert_equiv("Euler $e^{i\\pi}+1=0$ here.\n\n```rust\nfn main() {}\n```\n\n$$\n\\int_0^1 x\\,dx\n$$\n");
}

#[test]
fn incremental_falls_back_and_equals_full_on_footnotes() {
    assert_equiv("text[^1]\n\n[^1]: a note\n");
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p pmd-core --test incremental incremental_ -j 2`
Expected: FAIL (`render_incremental` not defined).

- [ ] **Step 3: Implement assembly + `render_incremental`**

Add to `incremental.rs`:

```rust
/// Append `block_html` to `out`, adding `base` to every `data-src-start` and
/// `data-src-end` numeric value. `base = block.start_line - 1`. Pure string
/// scan — no HTML parsing.
fn append_with_line_offset(out: &mut String, block_html: &str, base: u32) {
    const KEYS: [&str; 2] = ["data-src-start=\"", "data-src-end=\""];
    let bytes = block_html.as_bytes();
    let mut i = 0usize;
    while i < block_html.len() {
        let mut matched = None;
        for k in KEYS {
            if block_html[i..].starts_with(k) {
                matched = Some(k);
                break;
            }
        }
        match matched {
            Some(k) => {
                out.push_str(k);
                i += k.len();
                // read the digits (may be empty for an unfilled placeholder,
                // which should not occur after render_fragment, but be safe)
                let num_start = i;
                while i < block_html.len() && bytes[i].is_ascii_digit() {
                    i += 1;
                }
                if i > num_start {
                    let n: u32 = block_html[num_start..i].parse().unwrap_or(0);
                    out.push_str(&(n + base).to_string());
                } // else: nothing to push
            }
            None => {
                // push one char and advance by its utf-8 length
                let ch = block_html[i..].chars().next().unwrap();
                out.push(ch);
                i += ch.len_utf8();
            }
        }
    }
}

pub fn render_incremental(md: &str) -> crate::emit::RenderResult {
    let Some(blocks) = plan_blocks(md) else {
        return crate::emit::render_string(md);
    };
    let render_nonce = crate::emit::generate_render_nonce();
    let mut html = String::new();
    let mut source_map = Vec::<(u32, u32)>::new();
    for b in &blocks {
        let cb = render_block_cached(&md[b.start..b.end]);
        let base = b.start_line - 1;
        append_with_line_offset(&mut html, &cb.html, base);
        for &(s, e) in &cb.source_map {
            source_map.push((s + base, e + base));
        }
    }
    // Map the cache-internal placeholder nonce to this render's nonce.
    let html = html.replace(placeholder_nonce(), &render_nonce);
    crate::emit::RenderResult { version: 0, html, source_map, render_nonce }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cargo test -p pmd-core --test incremental incremental_ -j 2`
Expected: PASS (all 3). If `incremental_equals_full_*` fail with an html diff, inspect the diff: a per-block-vs-whole-doc ammonia divergence means a fallback trigger is missing — widen `plan_blocks` and re-run.

- [ ] **Step 5: Commit**

```bash
git add crates/pmd-core/src/incremental.rs crates/pmd-core/tests/incremental.rs
git commit -m "feat(core): assemble incremental render (line offset + nonce sub) with full-render fallback"
```

---

## Task 7: Property test — incremental ≡ full, including after edits

**Files:**
- Create: `crates/pmd-core/tests/prop_incremental.rs`

- [ ] **Step 1: Write the property test**

```rust
use proptest::prelude::*;
use pmd_core::emit::render_string;
use pmd_core::incremental::render_incremental;

// A markdown generator that avoids fallback triggers (no raw HTML, footnotes,
// or reference-link definitions) so the incremental fast path is exercised.
fn block_strategy() -> impl Strategy<Value = String> {
    let inline = prop::collection::vec(
        prop_oneof![
            "[a-zA-Z0-9 ]{1,20}",
            "[a-zA-Z0-9 ]{0,8}".prop_map(|s| format!("**{s}**")),
            "[a-zA-Z0-9 ]{0,8}".prop_map(|s| format!("*{s}*")),
            "[a-zA-Z0-9 ]{0,8}".prop_map(|s| format!("`{s}`")),
            Just("$x^2$".to_string()),
        ],
        1..6,
    )
    .prop_map(|parts| parts.join(" "));

    prop_oneof![
        inline.clone(),                                        // paragraph
        inline.clone().prop_map(|s| format!("# {s}")),         // heading
        inline.clone().prop_map(|s| format!("> {s}")),         // blockquote
        inline.clone().prop_map(|s| format!("- {s}\n- more")), // list
        Just("```rust\nfn main() {}\n```".to_string()),        // code
        Just("| a | b |\n|---|---|\n| 1 | 2 |".to_string()),   // table
        Just("---".to_string()),                               // rule
    ]
}

fn doc_strategy() -> impl Strategy<Value = String> {
    prop::collection::vec(block_strategy(), 1..12).prop_map(|blocks| {
        let mut s = blocks.join("\n\n");
        s.push('\n');
        s
    })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(400))]

    #[test]
    fn incremental_matches_full(md in doc_strategy()) {
        let inc = render_incremental(&md);
        let full = render_string(&md);
        prop_assert_eq!(&inc.html, &full.html);
        prop_assert_eq!(&inc.source_map, &full.source_map);
    }

    // Render, edit (which warms the cache for unchanged blocks), render again:
    // the result after the edit must still equal a cold full render.
    #[test]
    fn incremental_matches_full_after_edit(
        md in doc_strategy(),
        extra in block_strategy(),
    ) {
        let _ = render_incremental(&md);                 // warm cache
        let edited = format!("{md}\n{extra}\n");
        let inc = render_incremental(&edited);
        let full = render_string(&edited);
        prop_assert_eq!(&inc.html, &full.html);
        prop_assert_eq!(&inc.source_map, &full.source_map);
    }
}
```

- [ ] **Step 2: Run the property test**

Run: `cargo test -p pmd-core --test prop_incremental -j 2`
Expected: PASS. A failure prints the minimal failing markdown — if it is a real per-block/whole-doc divergence, add the construct to the fallback triggers in `plan_blocks` (Task 4) and re-run; if it is a generator producing an accidental fallback trigger (e.g. a line that looks like a ref-def), tighten the generator.

- [ ] **Step 3: Commit**

```bash
git add crates/pmd-core/tests/prop_incremental.rs
git commit -m "test(core): property test pinning incremental == full render (with edits)"
```

---

## Task 8: Wire `render_cmd` to `render_incremental`

**Files:**
- Modify: `crates/pmd-app/src/cmd/render.rs`

- [ ] **Step 1: Switch the command**

```rust
use anyhow::Result;
use pmd_core::emit::RenderResult;
use pmd_core::incremental::render_incremental;

#[tauri::command]
pub async fn render_cmd(version: u64, markdown: String) -> Result<RenderResult, String> {
    let mut r = render_incremental(&markdown);
    r.version = version;
    Ok(r)
}
```

- [ ] **Step 2: Run the app crate's tests**

Run: `cargo test -p pmd-app -j 2`
Expected: PASS (IPC tests unaffected — output identical).

- [ ] **Step 3: Build the whole workspace**

Run: `cargo build --workspace -j 2`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add crates/pmd-app/src/cmd/render.rs
git commit -m "feat(app): render via incremental block cache (identical output)"
```

**Phase 1 is complete and shippable here** — output is byte-identical and the frontend is untouched; the ~84% backend sanitize cost is now paid only for changed blocks.

---

# PHASE 2 — frontend per-block DOM patch

## Task 9: Backend block manifest + `data-pmd-block` injection

**Files:**
- Modify: `crates/pmd-core/src/emit.rs` (`RenderResult`)
- Modify: `crates/pmd-core/src/incremental.rs`
- Test: `crates/pmd-core/tests/incremental.rs`

- [ ] **Step 1: Write failing tests for the manifest**

Append to `crates/pmd-core/tests/incremental.rs`:

```rust
#[test]
fn incremental_emits_block_manifest_and_attrs() {
    let md = "# Title\n\nPara.\n\n- a\n- b\n";
    let r = render_incremental(md);
    assert_eq!(r.blocks.len(), 3);
    // each top-level element carries its key
    for b in &r.blocks {
        assert!(r.html.contains(&format!("data-pmd-block=\"{}\"", b.key)),
            "missing data-pmd-block for key {}", b.key);
    }
    // base_line matches the block start lines
    assert_eq!(r.blocks[0].base_line, 1);
    assert_eq!(r.blocks[1].base_line, 3);
    assert_eq!(r.blocks[2].base_line, 5);
}

#[test]
fn full_render_has_empty_manifest() {
    // raw HTML => fallback => no manifest (frontend full-replaces)
    let r = render_incremental("<div>x</div>\n");
    assert!(r.blocks.is_empty());
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p pmd-core --test incremental manifest -j 2` and `... full_render_has_empty -j 2`
Expected: FAIL (`blocks` field / `key` missing).

- [ ] **Step 3: Add `BlockRef` + `blocks` field**

In `emit.rs`, extend `RenderResult` (keep existing fields; add `#[serde(default)]` so deserialization stays compatible):

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BlockRef {
    pub key: String,
    pub base_line: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RenderResult {
    pub version: u64,
    pub html: String,
    pub source_map: Vec<(u32, u32)>,
    pub render_nonce: String,
    #[serde(default)]
    pub blocks: Vec<BlockRef>,
}
```

Update `render_string` to set `blocks: Vec::new()` (fallback/no-manifest path).

- [ ] **Step 4: Inject `data-pmd-block` and build the manifest in `render_incremental`**

Add a helper and update the assembly loop:

```rust
/// Insert ` data-pmd-block="key"` into the first start-tag of `block_html`
/// (right after the tag name). Every top-level block emits exactly one opening
/// element, so the first `<name` is that element.
fn inject_block_key(out: &mut String, block_html: &str, key: &str) {
    // find the first '<' that begins a start tag (not '</')
    if let Some(lt) = block_html.find('<') {
        if block_html[lt + 1..].starts_with('/') {
            // defensive: no start tag — append unmodified
            out.push_str(block_html);
            return;
        }
        // tag name ends at first whitespace or '>'
        let after_name = block_html[lt + 1..]
            .find(|c: char| c.is_whitespace() || c == '>')
            .map(|p| lt + 1 + p)
            .unwrap_or(block_html.len());
        out.push_str(&block_html[..after_name]);
        out.push_str(&format!(" data-pmd-block=\"{key}\""));
        out.push_str(&block_html[after_name..]);
    } else {
        out.push_str(block_html);
    }
}
```

Rework the loop in `render_incremental` so it offsets lines AND injects the key AND records the manifest. Because `append_with_line_offset` and `inject_block_key` both rewrite the block HTML, compose them: first offset into a temp `String`, then inject the key into that, then push:

```rust
    let mut blocks_manifest = Vec::<crate::emit::BlockRef>::new();
    for b in &blocks {
        let cb = render_block_cached(&md[b.start..b.end]);
        let base = b.start_line - 1;
        let key = blake3::hash(md[b.start..b.end].as_bytes()).to_hex().to_string();
        let mut offset_html = String::new();
        append_with_line_offset(&mut offset_html, &cb.html, base);
        inject_block_key(&mut html, &offset_html, &key);
        for &(s, e) in &cb.source_map {
            source_map.push((s + base, e + base));
        }
        blocks_manifest.push(crate::emit::BlockRef { key, base_line: b.start_line });
    }
    let html = html.replace(placeholder_nonce(), &render_nonce);
    crate::emit::RenderResult { version: 0, html, source_map, render_nonce, blocks: blocks_manifest }
```

(Compute the hex key from the same source slice used for the cache key so they agree.)

- [ ] **Step 5: Re-run equivalence + manifest tests**

Run: `cargo test -p pmd-core --test incremental -j 2`
Expected: PASS. NOTE: the `incremental_equals_full_*` html assertions from Task 6 will now FAIL because incremental adds `data-pmd-block`. Update those assertions to strip `data-pmd-block="..."` before comparing:

```rust
fn strip_block_attr(html: &str) -> String {
    // remove ` data-pmd-block="..."` occurrences
    let mut out = String::with_capacity(html.len());
    let needle = " data-pmd-block=\"";
    let mut i = 0;
    while let Some(p) = html[i..].find(needle) {
        let s = i + p;
        out.push_str(&html[i..s]);
        let after = s + needle.len();
        let end = html[after..].find('"').map(|q| after + q + 1).unwrap_or(html.len());
        i = end;
    }
    out.push_str(&html[i..]);
    out
}
```

Update `assert_equiv` (in `tests/incremental.rs`) to compare `strip_block_attr(&inc.html)` against `full.html`. **Also copy the same `strip_block_attr` helper verbatim into `tests/prop_incremental.rs`** (integration-test files are separate crates and cannot share a private helper) and apply it in both property assertions: `prop_assert_eq!(strip_block_attr(&inc.html), full.html)`. (The `data-pmd-block` attribute is the documented difference between incremental and full output; everything else stays byte-identical.)

- [ ] **Step 6: Commit**

```bash
git add crates/pmd-core/src/emit.rs crates/pmd-core/src/incremental.rs crates/pmd-core/tests/incremental.rs crates/pmd-core/tests/prop_incremental.rs
git commit -m "feat(core): block manifest + data-pmd-block attr for frontend patching"
```

---

## Task 10: Frontend keyed block reconciler

**Files:**
- Create: `ui/src/block_reconcile.ts`
- Test: covered by e2e in Task 12 (DOM-identity behaviour is only observable in a browser)

- [ ] **Step 1: Implement the reconciler**

`ui/src/block_reconcile.ts`:

```typescript
export interface BlockRef {
  key: string;
  base_line: number;
}

// Reconcile #pmd-content's direct children (keyed by data-pmd-block) against a
// freshly-parsed detached fragment. Returns the list of nodes that were newly
// inserted or replaced (for scoped post-processing). Unchanged-key nodes are
// kept in place (preserving rendered mermaid/katex); if their base_line shifted,
// their descendants' data-src-* are patched in place.
export function reconcileBlocks(
  live: HTMLElement,
  fragment: HTMLElement,
  blocks: BlockRef[],
): HTMLElement[] {
  const liveByKey = new Map<string, HTMLElement>();
  for (const child of Array.from(live.children)) {
    const k = (child as HTMLElement).dataset.pmdBlock;
    if (k) liveByKey.set(k, child as HTMLElement);
  }

  const fragChildren = Array.from(fragment.children) as HTMLElement[];
  const changed: HTMLElement[] = [];
  const desired: HTMLElement[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const { key, base_line } = blocks[i];
    const existing = liveByKey.get(key);
    const fresh = fragChildren[i];
    if (existing && existing.dataset.pmdBlock === key) {
      // keep the live node; patch line numbers if the block shifted
      const prevBase = Number(existing.dataset.pmdBase ?? base_line);
      if (prevBase !== base_line) {
        shiftDataSrc(existing, base_line - prevBase);
      }
      existing.dataset.pmdBase = String(base_line);
      desired.push(existing);
      liveByKey.delete(key);
    } else {
      // new or changed: adopt the fragment node
      fresh.dataset.pmdBase = String(base_line);
      desired.push(fresh);
      changed.push(fresh);
    }
  }

  // Re-order / insert / remove to match `desired` exactly.
  // Remove any live children no longer desired.
  const desiredSet = new Set(desired);
  for (const child of Array.from(live.children)) {
    if (!desiredSet.has(child as HTMLElement)) child.remove();
  }
  // Place desired nodes in order.
  let ref: Node | null = live.firstChild;
  for (const node of desired) {
    if (node === ref) {
      ref = node.nextSibling;
    } else {
      live.insertBefore(node, ref);
    }
  }
  return changed;
}

function shiftDataSrc(root: HTMLElement, delta: number) {
  const apply = (el: HTMLElement) => {
    const s = el.dataset.srcStart;
    const e = el.dataset.srcEnd;
    if (s !== undefined) el.dataset.srcStart = String(Number(s) + delta);
    if (e !== undefined) el.dataset.srcEnd = String(Number(e) + delta);
  };
  if (root.dataset.srcStart !== undefined) apply(root);
  root.querySelectorAll<HTMLElement>('[data-src-start]').forEach(apply);
}
```

- [ ] **Step 2: Typecheck**

Run: `cd ui && npx tsc -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add ui/src/block_reconcile.ts
git commit -m "feat(ui): keyed block reconciler for incremental DOM patching"
```

---

## Task 11: Use the reconciler in `processRenderQueue` with scoped post-processing

**Files:**
- Modify: `ui/src/main.ts`

- [ ] **Step 1: Extend the `RenderResult` interface**

In `main.ts`, add `blocks` to the result interface and import the reconciler:

```typescript
import { reconcileBlocks, type BlockRef } from './block_reconcile.js';
```

Add to the `RenderResult` interface:

```typescript
  blocks?: BlockRef[];
```

- [ ] **Step 2: Branch the apply path**

Replace the body that currently does `previewContent.innerHTML = result.html; …` with:

```typescript
    if (stillCurrent) {
      previewContent.dataset.versionApplied = String(result.version);
      previewContent.dataset.pmdNonce = result.render_nonce;
      if (result.blocks && result.blocks.length > 0) {
        const frag = document.createElement('div');
        frag.innerHTML = result.html;
        const changed = reconcileBlocks(previewContent, frag, result.blocks);
        for (const node of changed) {
          markAllNodes(node, result.render_nonce);
          await renderMermaidNodes(node, result.render_nonce);
          await renderMathNodes(node, result.render_nonce);
          decorateCodeBlocks(node);
          decorateTables(node, () => editor?.getValue() ?? '');
        }
      } else {
        // fallback / first render: full replace (existing behaviour)
        previewContent.innerHTML = result.html;
        markAllNodes(previewContent, result.render_nonce);
        await renderMermaidNodes(previewContent, result.render_nonce);
        await renderMathNodes(previewContent, result.render_nonce);
        decorateCodeBlocks(previewContent);
        decorateTables(previewContent, () => editor?.getValue() ?? '');
      }
    }
```

NOTE: confirm `markAllNodes`, `renderMermaidNodes`, `renderMathNodes`, `decorateCodeBlocks`, `decorateTables` all accept an arbitrary container root and only operate within it (they use `container.querySelectorAll`). They do — passing a single changed block node scopes them correctly.

- [ ] **Step 3: Typecheck + build the bundle**

Run: `cd ui && npx tsc -p tsconfig.json && node vendor/build-app.mjs`
Expected: typecheck clean, bundle built.

- [ ] **Step 4: Commit**

```bash
git add ui/src/main.ts ui/dist/bundle.js ui/dist/bundle.js.map
git commit -m "feat(ui): patch only changed blocks; scope post-processing to them"
```

---

## Task 12: Frontend e2e — node identity, scoped render, correct data-src

**Files:**
- Create: `ui/e2e/incremental.spec.cjs`

- [ ] **Step 1: Write the e2e spec**

Mechanism: in Playwright the backend is mocked, so the spec makes `render_cmd`
return a manifest+HTML **derived from the editor's current markdown** — a faithful
emulation of the real backend contract (split on blank lines → one block per
chunk; `key = sha-256(chunk)` via `crypto.subtle` or a small JS hash;
`base_line` = cumulative line count; each block element gets `data-pmd-block`
and `data-src-start/end`). Then type to change exactly one block and assert
DOM-node identity of the others.

`ui/e2e/incremental.spec.cjs`:

```javascript
const { test, expect } = require('playwright/test');
const { appUrl, installTauriMock } = require('./helpers.cjs');

// Make the mocked render_cmd emulate the backend block contract from the
// markdown it is given. Injected before page load so the bundle's invoke uses it.
async function installBlockRenderMock(page) {
  await installTauriMock(page);
  await page.addInitScript(() => {
    const internals = window.__TAURI_INTERNALS__;
    const orig = internals.invoke.bind(internals);
    // tiny deterministic hash (FNV-1a) -> hex
    const hash = (s) => {
      let h = 0x811c9dc5 >>> 0;
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
      return ('00000000' + h.toString(16)).slice(-8);
    };
    internals.invoke = async (cmd, args) => {
      if (cmd !== 'render_cmd') return orig(cmd, args);
      const md = String(args.markdown ?? '');
      const chunks = md.split(/\n{2,}/).filter((c) => c.trim().length > 0);
      let line = 1, html = '', blocks = [];
      for (const raw of md.split(/(\n{2,})/)) { // keep separators to count lines
        if (/^\n{2,}$/.test(raw)) { line += (raw.match(/\n/g) || []).length; continue; }
        if (!raw.trim()) { continue; }
        const key = hash(raw);
        const start = line;
        const end = line + (raw.match(/\n/g) || []).length;
        const text = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        html += `<p data-pmd-block="${key}" data-src-start="${start}" data-src-end="${end}">${text}</p>`;
        blocks.push({ key, base_line: start });
        line = end + 1;
      }
      void chunks;
      return { html, version: args.version ?? 0, render_nonce: 'n', source_map: [], blocks };
    };
  });
}

test('editing one block leaves the other block nodes identical', async ({ page }) => {
  await installBlockRenderMock(page);
  await page.goto(appUrl());
  await page.locator('#pmd-welcome-new').click();
  const content = page.locator('.cm-content');
  await expect(content).toBeVisible();
  await content.click();

  await page.keyboard.type('Alpha block\n\nBeta block\n\nGamma block');
  await page.waitForTimeout(250); // past debounce

  // tag the three live block nodes
  await page.evaluate(() => {
    document.querySelectorAll('#pmd-content [data-pmd-block]')
      .forEach((el, i) => { el.__probe = `probe-${i}`; });
  });

  // edit only the middle block
  await content.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Alpha block\n\nBeta CHANGED\n\nGamma block');
  await page.waitForTimeout(250);

  const probes = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#pmd-content [data-pmd-block]')).map((el) => el.__probe ?? null));

  // First and third blocks unchanged → same nodes (probe survives);
  // middle block changed → new node (probe gone / null).
  expect(probes[0]).toBe('probe-0');
  expect(probes[2]).toBe('probe-2');
  expect(probes[1]).toBeNull();
});

test('inserting a line above shifts data-src on an unchanged block without recreating it', async ({ page }) => {
  await installBlockRenderMock(page);
  await page.goto(appUrl());
  await page.locator('#pmd-welcome-new').click();
  const content = page.locator('.cm-content');
  await content.click();
  await page.keyboard.type('First\n\nSecond');
  await page.waitForTimeout(250);

  await page.evaluate(() => {
    const els = document.querySelectorAll('#pmd-content [data-pmd-block]');
    els[els.length - 1].__probe = 'last';
  });

  // insert a line at the very top (shifts the second block down)
  await content.click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('Zero\n\n');
  await page.waitForTimeout(250);

  const result = await page.evaluate(() => {
    const last = document.querySelector('#pmd-content [data-pmd-block]:last-child');
    return { probe: last?.__probe ?? null, srcStart: last?.getAttribute('data-src-start') };
  });
  // 'Second' block kept its node (probe survives) and its data-src-start moved.
  expect(result.probe).toBe('last');
  expect(Number(result.srcStart)).toBeGreaterThan(2);
});
```

(If a mermaid diagram is in an unchanged block, the same `__probe`/identity
technique on its `<svg>` proves it is not re-rendered; add that assertion if a
mermaid fixture is wired. Expect to iterate these specs in-browser — the
debounce timing and CodeMirror key handling may need small adjustments.)

- [ ] **Step 2: Run the e2e**

Run (from `ui/`, with the global Playwright):
```bash
NODE_PATH=$HOME/.bun/install/global/node_modules PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium \
  $HOME/.bun/install/global/node_modules/.bin/playwright test -c playwright.config.cjs --project=desktop incremental
```
(Requires the `ui/node_modules` symlink to the real install; remove it before committing if it isn't tracked/ignored.)
Expected: PASS.

- [ ] **Step 3: Run the existing e2e suite for regressions**

Run the full `ui/e2e` suite the same way (drop the `incremental` filter).
Expected: PASS (features, tauri-api, visual).

- [ ] **Step 4: Commit**

```bash
git add ui/e2e/incremental.spec.cjs
git commit -m "test(ui): e2e for block-incremental DOM patching"
```

---

## Task 13: End-to-end verification + re-measure

**Files:** none (verification)

- [ ] **Step 1: Full Rust suite**

Run: `cargo test --workspace --exclude pmd-e2e -j 2`
Expected: PASS (golden, security, incremental, prop_incremental, app).

- [ ] **Step 2: Re-measure** the render pipeline on a large mixed doc, before vs after, to confirm the per-edit win (re-run the methodology in `docs/perf/2026-05-31-render-pipeline-baseline.md`; expect a single-block edit to re-sanitize one block, not the whole doc). Save updated numbers to `docs/perf/2026-05-31-incremental-after.md`.

- [ ] **Step 3: Live verify** via the `verify` skill (drive the real app / WebDriver harness): type into a large doc with diagrams and confirm (a) responsiveness, (b) unchanged diagrams don't flicker/re-render, (c) scroll-sync still maps correctly after edits.

- [ ] **Step 4: Code review** via `ccc-review-cx` (security focus on the per-block sanitize fallback + nonce substitution), fix to PASS.

- [ ] **Step 5: Commit any review fixes, then this branch is ready to merge.**

---

## Notes for the implementer

- **The property test (Task 7) is the safety net.** If it ever fails on a real divergence, the fix is to widen the fallback in `plan_blocks` (Task 4), never to "adjust" expected output.
- **Do not** attempt per-block rendering when `plan_blocks` returns `None` — the whole-document `render_string` path is correct by construction and must remain the fallback.
- **`data-pmd-block` is the only intended difference** between incremental and full HTML; all equivalence assertions strip it.
- Keep `ui/node_modules` (symlink to the real install) OUT of commits — it is not tracked/ignored in this worktree.
