use pmd_app_lib::cmd::render::render_cmd_for_test;
use pmd_app_lib::doc::DocRegistry;

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
    let (first_id, _) = registry.register(Some(first_path.clone()), String::new());
    let (second_id, _) = registry.register(Some(second_path.clone()), String::new());
    registry.set_active(first_id);

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
    let (doc_id, _) = registry.register(None, String::new());

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
    let (doc_id, _) = registry.register(Some(missing_path), String::new());

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
