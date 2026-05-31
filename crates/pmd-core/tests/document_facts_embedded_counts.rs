#[test]
fn embedded_facts_and_counts_match_rendered_document() {
    let md = "# H\n\nText with $x$ and [link](file.md).\n\n![alt](img.png)\n\n```mermaid\ngraph TD; A-->B\n```\n\n$$\ny = 1\n$$\n\n```rust\nfn main() {}\n";
    let result = pmd_core::emit::render_string(md);

    assert_eq!(result.facts.counts.headings, 1);
    assert_eq!(result.facts.counts.links, result.facts.links.len() as u32);
    assert_eq!(result.facts.counts.images, result.facts.images.len() as u32);
    assert_eq!(result.facts.counts.code_blocks, 2);
    assert_eq!(result.facts.counts.mermaid_blocks, 1);
    assert_eq!(result.facts.embedded.mermaid_blocks.len(), 1);
    assert_eq!(result.facts.embedded.code_blocks.len(), 2);
    assert_eq!(result.facts.embedded.math_spans.len(), 1);
    assert_eq!(result.facts.embedded.math_blocks.len(), 1);
}
