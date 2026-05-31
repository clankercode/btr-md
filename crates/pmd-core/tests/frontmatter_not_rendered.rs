//! Frontmatter is metadata, not body: the leading `---`/`+++` block must be
//! excluded from rendered HTML (surfaced only via the inspector). A
//! mid-document `---` thematic break must still render as `<hr>` (no
//! over-stripping).

use pmd_core::emit;

#[test]
fn yaml_frontmatter_is_excluded_from_rendered_html() {
    let md = "---\ntitle: My Doc\ntags:\n  - rust\ndraft: true\n---\n# Body\n\nHello world.\n";
    let html = emit::render_string(md).html;

    // No frontmatter keys/values leak into the body.
    assert!(!html.contains("title"), "frontmatter key leaked: {html}");
    assert!(!html.contains("My Doc"), "frontmatter value leaked: {html}");
    assert!(!html.contains("draft"), "frontmatter key leaked: {html}");
    // The frontmatter fence must not render as a thematic break.
    assert!(
        !html.contains("<hr>"),
        "frontmatter rendered as <hr>: {html}"
    );

    // The actual body still renders.
    assert!(html.contains("<h1"), "body heading missing: {html}");
    assert!(html.contains("Body"), "body heading text missing: {html}");
    assert!(
        html.contains("Hello world."),
        "body paragraph missing: {html}"
    );
}

#[test]
fn toml_frontmatter_is_excluded_from_rendered_html() {
    let md = "+++\ntitle = \"TOML Doc\"\n+++\n# Body\n";
    let html = emit::render_string(md).html;

    assert!(
        !html.contains("TOML Doc"),
        "frontmatter value leaked: {html}"
    );
    assert!(
        !html.contains("<hr>"),
        "frontmatter rendered as <hr>: {html}"
    );
    assert!(html.contains("Body"), "body heading missing: {html}");
}

#[test]
fn midbody_thematic_break_still_renders() {
    // A `---` that is NOT leading frontmatter is a genuine thematic break.
    let md = "# Body\n\nBefore.\n\n---\n\nAfter.\n";
    let html = emit::render_string(md).html;

    assert!(html.contains("<hr>"), "thematic break missing: {html}");
    assert!(html.contains("Before."), "pre-break text missing: {html}");
    assert!(html.contains("After."), "post-break text missing: {html}");
}

#[test]
fn frontmatter_text_is_not_word_counted() {
    let md = "---\ntitle: Some Long Frontmatter Title Here\n---\nOne two three.\n";
    let counts = emit::render_string(md).facts.counts;
    // Only the three body words should be counted, not the frontmatter title.
    assert_eq!(counts.words, 3, "frontmatter words counted in body");
}

#[test]
fn frontmatter_reference_syntax_does_not_affect_body_link_facts() {
    let md = "---\n[doc]: ./hidden.md\ntitle: \"[hidden][missing]\"\n---\n[body][doc]\n\n[doc]: ./body.md\n";
    let result = emit::render_string(md);

    assert_eq!(
        result.facts.reference_definitions.len(),
        1,
        "frontmatter definition leaked into facts"
    );
    assert_eq!(
        result.facts.reference_definitions[0].target, "./body.md",
        "body link resolved against hidden frontmatter definition"
    );
    assert_eq!(result.facts.links.len(), 1, "hidden link syntax leaked");
    assert_eq!(
        result.facts.links[0].definition_id.as_deref(),
        Some("definition-0")
    );
    assert!(
        result.html.contains("data-pmd-link-id=\"link-0\""),
        "visible body link marker id was shifted by hidden frontmatter links: {}",
        result.html
    );
}

#[test]
fn frontmatter_math_and_structure_do_not_leak_into_facts() {
    let md = "---\ntitle: \"$x$\"\ndiagram: \"```mermaid\"\n---\n# Body\n\n$x$\n";
    let result = emit::render_string(md);

    assert_eq!(result.facts.counts.headings, 1);
    assert_eq!(result.facts.embedded.math_spans.len(), 1);
    assert_eq!(result.facts.embedded.math_spans[0].line_start, 7);
    assert!(result.facts.embedded.mermaid_blocks.is_empty());
}

#[test]
fn frontmatter_does_not_create_source_map_entries() {
    let md = "---\ntitle: Hidden\n---\n# Body\n";
    let result = emit::render_string(md);

    assert!(
        result.source_map.iter().all(|(start, _)| *start >= 4),
        "frontmatter produced source-map entries: {:?}",
        result.source_map
    );
}
