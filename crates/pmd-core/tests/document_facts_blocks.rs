use pmd_core::facts::AnchorSource;

#[test]
fn blocks_have_stable_ids_kinds_lines_and_parents() {
    let md = "# Title\n\n> quote\n\n- item\n\n```rust\nfn main() {}\n```\n\n| A |\n| - |\n| B |\n\n[^n]: note\n\n---\n";
    let result = pmd_core::emit::render_string(md);
    let blocks = &result.facts.blocks;

    assert!(blocks
        .iter()
        .any(|b| b.id == "block-1" && b.kind.as_str() == "heading" && b.line_start == 1));
    assert!(blocks.iter().any(|b| b.kind.as_str() == "blockquote"));
    assert!(blocks
        .iter()
        .any(|b| b.kind.as_str() == "list_item" && b.parent_id.is_some()));
    assert!(blocks.iter().any(|b| b.kind.as_str() == "code_block"));
    assert!(blocks.iter().any(|b| b.kind.as_str() == "table"));
    assert!(blocks
        .iter()
        .any(|b| b.kind.as_str() == "footnote_definition"));
    assert!(blocks.iter().any(|b| b.kind.as_str() == "rule"));
}

#[test]
fn footnotes_create_reference_and_definition_anchors() {
    let result = pmd_core::emit::render_string("Text[^note].\n\n[^note]: Body\n");

    let footnote_anchors: Vec<_> = result
        .facts
        .anchors
        .iter()
        .filter(|anchor| anchor.source == AnchorSource::Footnote)
        .collect();

    assert_eq!(footnote_anchors.len(), 2);
    assert!(footnote_anchors
        .iter()
        .any(|anchor| anchor.slug == "fnref-note"));
    assert!(footnote_anchors
        .iter()
        .any(|anchor| anchor.slug == "fn-note"));
    assert!(footnote_anchors
        .iter()
        .all(|anchor| !anchor.block_id.is_empty()));
}
