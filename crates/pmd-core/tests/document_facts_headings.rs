use pmd_core::emit::render_string;

#[test]
fn render_result_includes_empty_fact_sets_for_plain_text() {
    let result = render_string("plain paragraph");

    assert!(result.facts.headings.is_empty());
    assert!(result.facts.links.is_empty());
    assert_eq!(result.facts.counts.paragraphs, 1);
    assert_eq!(result.facts.counts.words, 2);
}
