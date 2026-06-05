use pmd_core::emit::render_string;
use pmd_core::incremental::{plan_blocks_for_test, render_block_for_test, render_incremental};

#[test]
fn segments_top_level_blocks_with_lines() {
    let md = "# Title\n\nPara one.\n\n- a\n- b\n";
    let blocks = plan_blocks_for_test(md).expect("no fallback");
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

#[test]
fn block_render_is_sanitized_and_cached_relative() {
    let (html1, hits1) = render_block_for_test("Hello **world**.");
    assert!(html1.contains("data-src-start=\"1\""));
    assert!(html1.contains("<strong>world</strong>"));
    let (html2, hits2) = render_block_for_test("Hello **world**.");
    assert_eq!(html1, html2);
    assert!(
        hits2 > hits1,
        "second identical render should hit the cache"
    );
}

#[test]
fn cache_eviction_does_not_corrupt() {
    let first = pmd_core::incremental::render_block_for_test("para number 0").0;
    for i in 1..5000 {
        let _ = pmd_core::incremental::render_block_for_test(&format!("para number {i}"));
    }
    let again = pmd_core::incremental::render_block_for_test("para number 0").0;
    assert_eq!(first, again);
}

fn strip_block_attr(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let needle = " data-pmd-block=\"";
    let mut i = 0;
    while let Some(p) = html[i..].find(needle) {
        let s = i + p;
        out.push_str(&html[i..s]);
        let after = s + needle.len();
        let end = html[after..]
            .find('"')
            .map(|q| after + q + 1)
            .unwrap_or(html.len());
        i = end;
    }
    out.push_str(&html[i..]);
    out
}

fn assert_equiv(md: &str) {
    let inc = render_incremental(md);
    let full = render_string(md);
    // Normalize per-render nonces before comparing — nonces are intentionally
    // unique per render call; structural equivalence is what matters.
    // Also strip data-pmd-block attrs (only present in incremental path).
    let inc_html = strip_block_attr(&inc.html.replace(&inc.render_nonce, "NONCE"));
    let full_html = strip_block_attr(&full.html.replace(&full.render_nonce, "NONCE"));
    assert_eq!(inc_html, full_html, "html mismatch for:\n{md}");
    assert_eq!(
        inc.source_map, full.source_map,
        "source_map mismatch for:\n{md}"
    );
}

#[test]
fn incremental_equals_full_basic() {
    assert_equiv(
        "# Title\n\nPara **one** with `code`.\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n",
    );
}

#[test]
fn incremental_equals_full_with_math_and_code() {
    assert_equiv(
        "Euler $e^{i\\pi}+1=0$ here.\n\n```rust\nfn main() {}\n```\n\n$$\n\\int_0^1 x\\,dx\n$$\n",
    );
}

#[test]
fn incremental_falls_back_and_equals_full_on_footnotes() {
    assert_equiv("text[^1]\n\n[^1]: a note\n");
}

#[test]
fn incremental_emits_block_manifest_and_attrs() {
    let md = "# Title\n\nPara.\n\n- a\n- b\n";
    let r = render_incremental(md);
    assert_eq!(r.blocks.len(), 3);
    for b in &r.blocks {
        assert!(
            r.html.contains(&format!("data-pmd-block=\"{}\"", b.key)),
            "missing data-pmd-block for key {}",
            b.key
        );
    }
    assert_eq!(r.blocks[0].base_line, 1);
    assert_eq!(r.blocks[1].base_line, 3);
    assert_eq!(r.blocks[2].base_line, 5);
}

#[test]
fn full_render_has_empty_manifest() {
    let r = render_incremental("<div>x</div>\n"); // raw HTML => fallback
    assert!(r.blocks.is_empty());
}

#[test]
fn falls_back_on_blockquote_reference_definition() {
    assert!(render_incremental("> [x]: https://e.com\n\nsee [x]\n")
        .blocks
        .is_empty());
}

#[test]
fn falls_back_on_list_reference_definition() {
    assert!(render_incremental("- [x]: https://e.com\n\nsee [x]\n")
        .blocks
        .is_empty());
}

#[test]
fn incremental_equals_full_blockquote_ref_def() {
    assert_equiv("> [x]: https://e.com\n\nsee [x]\n");
}

#[test]
fn falls_back_on_tab_separated_list_reference_definition() {
    assert!(
        pmd_core::incremental::render_incremental("-\t[x]: https://e.com\n\nsee [x]\n")
            .blocks
            .is_empty()
    );
    assert!(
        pmd_core::incremental::render_incremental("1.\t[x]: https://e.com\n\nsee [x]\n")
            .blocks
            .is_empty()
    );
}

#[test]
fn incremental_equals_full_tab_separated_list_ref_def() {
    assert_equiv("-\t[x]: https://e.com\n\nsee [x]\n");
}

// Regression: the block manifest must have exactly one entry per top-level HTML
// element. Frontmatter is a top-level `plan_blocks` block but renders to EMPTY
// html (metadata events are dropped), so it must NOT produce a manifest entry —
// otherwise the UI reconcile's manifest<->fragment index alignment breaks (the
// preview renders garbage then freezes).
fn count_block_attrs(html: &str) -> usize {
    html.matches(" data-pmd-block=\"").count()
}

#[test]
fn frontmatter_block_does_not_desync_manifest() {
    let md = "---\nname: x\ndescription: \"y\"\n---\n\nBody one.\n\nBody two.\n";
    let r = render_incremental(md);
    assert_eq!(
        r.blocks.len(),
        count_block_attrs(&r.html),
        "manifest len must equal number of root elements; manifest={:?} html={}",
        r.blocks,
        r.html
    );
}

#[test]
fn incremental_equals_full_with_frontmatter() {
    assert_equiv("---\ntitle: My Doc\ndraft: true\n---\n\n# Body\n\nHello.\n");
}

#[test]
fn malformed_unclosed_frontmatter_does_not_desync_manifest() {
    // While typing frontmatter (no closing fence yet) the manifest must still
    // align with emitted root elements.
    let md = "---\nname: persist-before-compact\ndescription: \"Instructions.\"\n";
    let r = render_incremental(md);
    assert_eq!(
        r.blocks.len(),
        count_block_attrs(&r.html),
        "manifest len must equal root-element count for unclosed frontmatter; manifest={:?} html={}",
        r.blocks,
        r.html
    );
}
