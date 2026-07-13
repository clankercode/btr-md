use pmd_app_lib::cmd::render::render_cmd_for_test;
use pmd_app_lib::doc::DocRegistry;
use std::path::Path;

#[tokio::test]
async fn render_returns_versioned_html() {
    let r = render_cmd_for_test(1, 7, None, "hello".into())
        .await
        .unwrap();
    assert_eq!(r.doc_id, 1);
    assert_eq!(r.version, 7);
    assert!(r.html.contains("hello"));
    assert!(r.html.contains("data-src-start"));
    assert!(r.facts.core.counts.words > 0);
}

#[tokio::test]
async fn render_contract_serializes_flattened_facts_and_snake_case_diagnostics() {
    let result = render_cmd_for_test(3, 4, None, "# Title\n\nText".into())
        .await
        .unwrap();
    let value = serde_json::to_value(&result).unwrap();

    assert!(value.get("doc_id").is_some());
    assert!(value.get("source_map").is_some());
    assert!(value.get("render_nonce").is_some());
    assert!(value["facts"].get("doc_id").is_some());
    assert!(value["facts"].get("headings").is_some());
    assert!(value["facts"].get("core").is_none());
    assert_eq!(value["diagnostics"]["phase"], "initial");
    assert!(value["diagnostics"].get("link_summary").is_some());
    assert!(value["diagnostics"]["resources"]
        .get("allowed_roots")
        .is_some());
}

#[test]
fn preview_snapshot_uses_requested_doc_path_and_allowed_root() {
    let temp = tempfile::tempdir().unwrap();
    let first_path = temp.path().join("first.md");
    let second_dir = temp.path().join("nested");
    std::fs::create_dir(&second_dir).unwrap();
    let second_path = second_dir.join("second.md");

    let registry = DocRegistry::new();
    let (first_id, _) = registry.register("main", Some(first_path.clone()), String::new());
    let (second_id, _) = registry.register("main", Some(second_path.clone()), String::new());
    registry.set_active("main", first_id);

    let snapshot = registry.preview_snapshot(second_id.0).unwrap();

    assert_eq!(snapshot.doc_id, second_id.0);
    assert_eq!(snapshot.path.as_ref(), Some(&second_path));
    assert_eq!(
        snapshot.allowed_roots,
        vec![second_dir.canonicalize().unwrap()]
    );
}

#[test]
fn preview_snapshot_leaves_untitled_docs_without_allowed_roots() {
    let registry = DocRegistry::new();
    let (doc_id, _) = registry.register("main", None, String::new());

    let snapshot = registry.preview_snapshot(doc_id.0).unwrap();

    assert_eq!(snapshot.doc_id, doc_id.0);
    assert_eq!(snapshot.path, None);
    assert!(snapshot.allowed_roots.is_empty());
}

#[test]
fn preview_snapshot_errors_for_unknown_doc() {
    let registry = DocRegistry::new();

    let error = registry.preview_snapshot(777).unwrap_err();

    assert_eq!(error, "Unknown document");
}

#[test]
fn preview_snapshot_errors_when_file_parent_cannot_be_canonicalized() {
    let temp = tempfile::tempdir().unwrap();
    let missing_path = temp.path().join("missing").join("doc.md");
    let registry = DocRegistry::new();
    let (doc_id, _) = registry.register("main", Some(missing_path), String::new());

    let error = registry.preview_snapshot(doc_id.0).unwrap_err();

    assert!(error.contains("Document parent directory is unavailable"));
}

#[tokio::test]
async fn render_returns_identity_facts_and_initial_diagnostics() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    std::fs::write(&doc_path, "# Title\n\n[bad](missing.md)").unwrap();

    let result = pmd_app_lib::cmd::render::render_cmd_for_test(
        7,
        12,
        Some(&doc_path),
        "# Title\n\n[bad](missing.md)".into(),
    )
    .await
    .expect("render");

    assert_eq!(result.doc_id, 7);
    assert_eq!(result.version, 12);
    assert_eq!(result.facts.doc_id, 7);
    assert_eq!(result.facts.version, 12);
    assert_eq!(result.diagnostics.doc_id, 7);
    assert_eq!(result.diagnostics.version, 12);
    assert_eq!(
        result.diagnostics.phase,
        pmd_app_lib::preview::contracts::DiagnosticPhase::Initial
    );
}

#[tokio::test]
async fn malformed_frontmatter_returns_diagnostic_without_blank_preview() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    let markdown = "---\ntitle: [unterminated\n---\n# Body\n";
    std::fs::write(&doc_path, markdown).unwrap();

    let result =
        pmd_app_lib::cmd::render::render_cmd_for_test(7, 13, Some(&doc_path), markdown.into())
            .await
            .expect("render");

    assert!(result.html.contains("Body"));
    assert!(result.diagnostics.issues.iter().any(|issue| {
        issue.category.as_str() == "frontmatter"
            && issue.severity.as_str() == "warning"
            && issue.message.contains("Frontmatter could not be parsed")
    }));
}

#[tokio::test]
async fn html_document_uses_html_preview_path_not_markdown() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("page.html");
    let source = r##"<!DOCTYPE html><html><head><script>evil()</script></head>
<body>
<nav class="toc"><a href="#sec">Sec</a></nav>
<h1 id="sec">Section</h1>
<p>use_snake_case and #not-md</p>
</body></html>"##;
    std::fs::write(&doc_path, source).unwrap();

    let result = render_cmd_for_test(9, 1, Some(Path::new(&doc_path)), source.into())
        .await
        .expect("render html");

    assert!(
        result.html.contains("<nav"),
        "structure kept: {}",
        result.html
    );
    assert!(result.html.contains(r#"class="toc""#), "{}", result.html);
    assert!(result.html.contains("use_snake_case"), "{}", result.html);
    assert!(result.html.contains("#not-md"), "{}", result.html);
    assert!(
        !result.html.contains("<script"),
        "script stripped: {}",
        result.html
    );
    assert!(!result.html.contains("evil"), "{}", result.html);
    assert!(
        result.html.contains("data-pmd-link-id="),
        "link markers: {}",
        result.html
    );
    assert!(
        result.blocks.is_empty(),
        "HTML is full-replace, not block-incremental"
    );
    assert!(
        result
            .facts
            .core
            .headings
            .iter()
            .any(|h| h.text == "Section"),
        "outline headings: {:?}",
        result.facts.core.headings
    );
}

#[tokio::test]
async fn html_extension_htm_also_uses_html_path() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("page.HTM");
    let source = "<article><h2>Hi</h2><p>body</p></article>";
    std::fs::write(&doc_path, source).unwrap();

    let result = render_cmd_for_test(3, 2, Some(&doc_path), source.into())
        .await
        .expect("render htm");

    assert!(result.html.contains("<article"), "{}", result.html);
    assert!(result.html.contains("<h2"), "{}", result.html);
    assert!(
        !result.html.contains("<em>"),
        "no md emphasis: {}",
        result.html
    );
    assert_eq!(result.document_kind, "html");
}

#[tokio::test]
async fn html_content_autodetect_without_html_extension() {
    let temp = tempfile::tempdir().unwrap();
    // Extensionless path is not openable via dialog, but if already registered
    // the content sniff still selects the HTML pipeline.
    let doc_path = temp.path().join("snippet");
    let source = "<!DOCTYPE html><html><body><p>use_snake_case</p></body></html>";
    std::fs::write(&doc_path, source).unwrap();

    let result = render_cmd_for_test(4, 1, Some(&doc_path), source.into())
        .await
        .expect("render sniffed html");

    assert_eq!(result.document_kind, "html");
    assert!(result.html.contains("use_snake_case"), "{}", result.html);
    assert!(!result.html.contains("<em>"), "{}", result.html);
}

#[tokio::test]
async fn trusted_html_styles_require_allow_flag() {
    use pmd_app_lib::cmd::render::render_cmd_for_test_with_options;

    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("styled.html");
    let source = r#"<!DOCTYPE html><html><head>
<style>h1 { color: blue; }</style>
</head><body><h1>Title</h1></body></html>"#;
    std::fs::write(&doc_path, source).unwrap();

    let stripped = render_cmd_for_test(5, 1, Some(&doc_path), source.into())
        .await
        .expect("default strip");
    assert!(stripped.document_styles_available, "trusted + has styles");
    assert!(!stripped.document_styles_applied);
    assert!(!stripped.html.contains("color: blue"), "{}", stripped.html);

    let applied = render_cmd_for_test_with_options(5, 2, Some(&doc_path), source.into(), true)
        .await
        .expect("allow styles");
    assert!(applied.document_styles_applied);
    assert!(
        applied.html.contains("data-pmd-doc-style"),
        "{}",
        applied.html
    );
    assert!(applied.html.contains("color: blue"), "{}", applied.html);
}

#[tokio::test]
async fn unsaved_html_buffer_never_applies_styles() {
    use pmd_app_lib::cmd::render::render_cmd_for_test_with_options;

    let source = r#"<!DOCTYPE html><html><head>
<style>h1 { color: blue; }</style>
</head><body><h1>Title</h1></body></html>"#;
    let result = render_cmd_for_test_with_options(6, 1, None, source.into(), true)
        .await
        .expect("unsaved");
    assert_eq!(result.document_kind, "html");
    assert!(
        !result.document_styles_available,
        "untrusted must not advertise prompt"
    );
    assert!(!result.document_styles_applied);
    assert!(!result.html.contains("color: blue"), "{}", result.html);
}

#[tokio::test]
async fn json_document_uses_config_preview_not_markdown() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("data.json");
    let source = r#"{"msg":"<b>x</b>","n":1}"#;
    std::fs::write(&doc_path, source).unwrap();

    let result = render_cmd_for_test(7, 1, Some(&doc_path), source.into())
        .await
        .expect("json");

    assert_eq!(result.document_kind, "json");
    assert!(result.html.contains("pmd-config-doc"), "{}", result.html);
    assert!(
        result.html.contains("&lt;b&gt;"),
        "escaped: {}",
        result.html
    );
    assert!(!result.html.contains("<b>x</b>"), "{}", result.html);
    assert!(result.blocks.is_empty());
}

#[tokio::test]
async fn yaml_toml_ini_documents_use_config_preview() {
    let temp = tempfile::tempdir().unwrap();
    for (name, source, kind) in [
        ("a.yaml", "title: hello\n", "yaml"),
        ("b.toml", "title = \"hello\"\n", "toml"),
        ("c.ini", "[main]\ntitle=hello\n", "ini"),
    ] {
        let doc_path = temp.path().join(name);
        std::fs::write(&doc_path, source).unwrap();
        let result = render_cmd_for_test(8, 1, Some(&doc_path), source.into())
            .await
            .unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!(result.document_kind, kind, "{name}");
        assert!(
            result.html.contains("pmd-config-doc"),
            "{name}: {}",
            result.html
        );
        assert!(result.html.contains("hello"), "{name}: {}", result.html);
    }
}
