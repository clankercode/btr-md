use pmd_core::incremental::{plan_blocks_for_test, BlockSliceView};

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
