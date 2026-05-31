use pmd_core::facts::{FrontmatterFormat, FrontmatterSyntax};

#[test]
fn yaml_frontmatter_preserves_raw_range_and_common_metadata() {
    let markdown = "---\ntitle: My Doc\ntags:\n  - rust\n  - markdown\ndraft: true\n---\n# Body\n";
    let result = pmd_core::emit::render_string(markdown);
    let frontmatter = result.facts.frontmatter.as_ref().expect("frontmatter");

    assert_eq!(frontmatter.line_start, 1);
    assert_eq!(frontmatter.line_end, 6);
    assert_eq!(frontmatter.metadata.title.as_deref(), Some("My Doc"));
    assert_eq!(frontmatter.metadata.tags, vec!["rust", "markdown"]);
    assert_eq!(frontmatter.metadata.draft, Some(true));
}

#[test]
fn toml_frontmatter_extracts_common_metadata() {
    let markdown =
        "+++\ntitle = \"TOML Doc\"\ntags = [\"rust\", \"markdown\"]\ndraft = false\n+++\n# Body\n";
    let result = pmd_core::emit::render_string(markdown);
    let frontmatter = result.facts.frontmatter.as_ref().expect("frontmatter");

    assert_eq!(frontmatter.format, FrontmatterFormat::Toml);
    assert_eq!(frontmatter.syntax, FrontmatterSyntax::Valid);
    assert_eq!(frontmatter.line_start, 1);
    assert_eq!(frontmatter.line_end, 4);
    assert_eq!(frontmatter.metadata.title.as_deref(), Some("TOML Doc"));
    assert_eq!(frontmatter.metadata.tags, vec!["rust", "markdown"]);
    assert_eq!(frontmatter.metadata.draft, Some(false));
}

#[test]
fn malformed_yaml_frontmatter_preserves_raw_range_with_default_metadata() {
    let markdown = "---\ntitle: [oops\n---\n# Body\n";
    let result = pmd_core::emit::render_string(markdown);
    let frontmatter = result.facts.frontmatter.as_ref().expect("frontmatter");

    assert_eq!(frontmatter.format, FrontmatterFormat::Yaml);
    assert_eq!(frontmatter.syntax, FrontmatterSyntax::Malformed);
    assert_eq!(frontmatter.line_start, 1);
    assert_eq!(frontmatter.line_end, 2);
    assert_eq!(frontmatter.metadata.title, None);
    assert!(frontmatter.metadata.tags.is_empty());
}

#[test]
fn absent_frontmatter_is_none() {
    let result = pmd_core::emit::render_string("# Body\n");

    assert!(result.facts.frontmatter.is_none());
}
