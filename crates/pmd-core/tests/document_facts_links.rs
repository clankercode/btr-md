#[test]
fn classifies_inline_reference_mailto_fragment_and_image_facts() {
    let markdown = "[frag](#title) [doc](other.md#section) [site](https://example.com) [mail](mailto:a@example.com) [ref][missing]\n\n![alt](./img.png \"Logo\")";
    let result = pmd_core::emit::render_string(markdown);

    let kinds: Vec<_> = result
        .facts
        .links
        .iter()
        .map(|link| link.kind.as_str())
        .collect();
    assert_eq!(
        kinds,
        [
            "fragment",
            "local_markdown",
            "external_url",
            "mailto",
            "reference"
        ]
    );
    assert_eq!(result.facts.images[0].target.as_deref(), Some("./img.png"));
    assert_eq!(result.facts.images[0].alt_text, "alt");
}

#[test]
fn reference_definitions_have_duplicate_indexes_and_links_resolve_definition_ids() {
    let markdown =
        "[first][doc]\n\n[second][doc]\n\n[doc]: ./one.md \"One\"\n[doc]: ./two.md \"Two\"\n";
    let result = pmd_core::emit::render_string(markdown);

    let definitions = &result.facts.reference_definitions;
    assert_eq!(definitions.len(), 2);
    assert_eq!(definitions[0].id, "definition-0");
    assert_eq!(definitions[0].duplicate_index, 0);
    assert_eq!(definitions[0].title.as_deref(), Some("One"));
    assert_eq!(definitions[1].id, "definition-1");
    assert_eq!(definitions[1].duplicate_index, 1);
    assert_eq!(definitions[1].title.as_deref(), Some("Two"));

    let links = &result.facts.links;
    assert_eq!(links.len(), 2);
    assert_eq!(links[0].reference_label.as_deref(), Some("doc"));
    assert_eq!(links[0].definition_id.as_deref(), Some("definition-0"));
    assert_eq!(links[1].reference_label.as_deref(), Some("doc"));
    assert_eq!(links[1].definition_id.as_deref(), Some("definition-0"));
}

#[test]
fn reference_scans_ignore_code_contexts() {
    let markdown =
        "`[inline][missing]`\n\n```\n[fenced][missing]\n[def]: ./inside-code.md\n```\n\n    [indented][missing]\n\nreal [visible][missing]\n";
    let result = pmd_core::emit::render_string(markdown);

    assert!(result.facts.reference_definitions.is_empty());
    assert_eq!(result.facts.links.len(), 1);
    assert_eq!(result.facts.links[0].label_text, "visible");
    assert_eq!(
        result.facts.links[0].reference_label.as_deref(),
        Some("missing")
    );
}

#[test]
fn indented_fence_markers_do_not_hide_following_references() {
    let unresolved = pmd_core::emit::render_string("    ```\nreal [visible][missing]\n");
    assert_eq!(unresolved.facts.links.len(), 1);
    assert_eq!(unresolved.facts.links[0].label_text, "visible");

    let resolved =
        pmd_core::emit::render_string("    ```\nreal [visible][missing]\n\n[missing]: ./doc.md\n");
    assert_eq!(resolved.facts.reference_definitions.len(), 1);
    assert_eq!(
        resolved.facts.links[0].definition_id.as_deref(),
        Some("definition-0")
    );
}

#[test]
fn fenced_code_inner_fence_like_lines_do_not_reenable_reference_scans() {
    let markdown =
        "````\n```not-a-close\n[inside][missing]\n```\n[also-inside][missing]\n````\n\nreal [visible][missing]\n";
    let result = pmd_core::emit::render_string(markdown);

    assert_eq!(result.facts.links.len(), 1);
    assert_eq!(result.facts.links[0].label_text, "visible");
}
