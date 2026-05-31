use pmd_core::incremental::{plan_blocks_for_test, render_block_for_test, render_incremental, BlockSliceView};
use pmd_core::emit::render_string;

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
    assert!(hits2 > hits1, "second identical render should hit the cache");
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

fn assert_equiv(md: &str) {
    let inc = render_incremental(md);
    let full = render_string(md);
    // Normalize per-render nonces before comparing — nonces are intentionally
    // unique per render call; structural equivalence is what matters.
    let inc_html = inc.html.replace(&inc.render_nonce, "NONCE");
    let full_html = full.html.replace(&full.render_nonce, "NONCE");
    assert_eq!(inc_html, full_html, "html mismatch for:\n{md}");
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
