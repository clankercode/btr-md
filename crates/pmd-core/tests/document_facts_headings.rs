use pmd_core::emit::render_string;
use pmd_core::facts::AnchorSource;

#[test]
fn render_result_includes_empty_fact_sets_for_plain_text() {
    let result = render_string("plain paragraph");

    assert!(result.facts.headings.is_empty());
    assert!(result.facts.links.is_empty());
    assert_eq!(result.facts.counts.paragraphs, 1);
    assert_eq!(result.facts.counts.words, 2);
}

#[test]
fn headings_have_github_style_duplicate_slugs() {
    let result =
        pmd_core::emit::render_string("# Hello, World!\n\n## Hello World\n\n# Hello World");
    let headings = &result.facts.headings;

    assert_eq!(headings.len(), 3);
    assert_eq!(headings[0].slug, "hello-world");
    assert_eq!(headings[0].duplicate_index, 0);
    assert_eq!(headings[1].slug, "hello-world-1");
    assert_eq!(headings[1].duplicate_index, 1);
    assert_eq!(headings[2].slug, "hello-world-2");
    assert_eq!(headings[2].duplicate_index, 2);
    assert_eq!(headings[0].line_start, 1);
}

#[test]
fn heading_ids_create_explicit_anchors() {
    let result = render_string("# Title {#custom-id}\n\n# Title");
    let anchors = &result.facts.anchors;

    assert_eq!(result.facts.headings[0].slug, "custom-id");
    assert_eq!(anchors[0].slug, "custom-id");
    assert_eq!(anchors[0].source, AnchorSource::ExplicitId);
    assert_eq!(anchors[1].source, AnchorSource::Heading);
}
