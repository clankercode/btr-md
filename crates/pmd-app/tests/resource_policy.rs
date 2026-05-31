use pmd_app_lib::preview::resource_policy::{
    resolve_for_test, resolve_resources, ResourcePolicyContext,
};

#[test]
fn blocked_local_image_becomes_placeholder_and_issue() {
    let temp = tempfile::tempdir().unwrap();
    let docs = temp.path().join("docs");
    std::fs::create_dir(&docs).unwrap();
    std::fs::write(temp.path().join("secret.png"), b"png").unwrap();
    let doc_path = docs.join("doc.md");
    std::fs::write(&doc_path, "![secret](../secret.png)").unwrap();

    let resolution = resolve_for_test(1, 2, &doc_path, "![secret](../secret.png)").unwrap();

    assert_eq!(resolution.report.decisions[0].decision.as_str(), "blocked");
    assert_eq!(
        resolution.report.decisions[0].reason.as_str(),
        "outside_allowed_roots"
    );
    assert!(resolution.safe_html.contains("pmd-image-placeholder"));
    assert!(!resolution.safe_html.contains("../secret.png"));
    assert!(resolution.issues.iter().any(|issue| {
        issue.severity.as_str() == "blocked"
            && issue.category.as_str() == "image"
            && issue.message.contains("Image blocked")
            && issue.primary_action.as_deref() == Some("asset.grantFolder")
    }));
}

#[test]
fn allowed_local_image_rewrites_to_asset_url() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    std::fs::write(&doc_path, "![ok](ok.png)").unwrap();
    std::fs::write(temp.path().join("ok.png"), b"png").unwrap();

    let resolution = resolve_for_test(1, 3, &doc_path, "![ok](ok.png)").unwrap();

    assert_eq!(resolution.report.decisions[0].decision.as_str(), "allowed");
    assert_eq!(
        resolution.report.decisions[0].reason.as_str(),
        "allowed_local_scope"
    );
    assert!(resolution.safe_html.contains("asset://localhost/"));
    assert!(resolution.safe_html.contains("alt=\"ok\""));
    assert_eq!(resolution.report.loaded_resources.len(), 1);
}

#[test]
fn missing_local_image_becomes_error_issue() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    std::fs::write(&doc_path, "![missing](missing.png)").unwrap();

    let resolution = resolve_for_test(1, 4, &doc_path, "![missing](missing.png)").unwrap();

    assert_eq!(resolution.report.decisions[0].decision.as_str(), "missing");
    assert!(resolution.issues.iter().any(|issue| {
        issue.severity.as_str() == "error"
            && issue.category.as_str() == "image"
            && issue.message.contains("Image missing")
    }));
}

#[test]
fn unresolved_reference_image_becomes_error_issue() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    std::fs::write(&doc_path, "![logo][missing-ref]\n").unwrap();

    let resolution = resolve_for_test(1, 45, &doc_path, "![logo][missing-ref]\n").unwrap();

    assert_eq!(resolution.report.decisions[0].decision.as_str(), "missing");
    assert!(resolution.issues.iter().any(|issue| {
        issue.severity.as_str() == "error"
            && issue.category.as_str() == "image"
            && issue.message.contains("Image reference unresolved")
    }));
}

#[test]
fn remote_image_is_blocked_without_fetchable_src() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    std::fs::write(&doc_path, "![remote](https://example.com/i.png)").unwrap();

    let resolution =
        resolve_for_test(1, 5, &doc_path, "![remote](https://example.com/i.png)").unwrap();

    assert_eq!(
        resolution.report.decisions[0].reason.as_str(),
        "remote_blocked"
    );
    assert!(!resolution.safe_html.contains("https://example.com/i.png"));
    assert!(resolution.safe_html.contains("Content Blocked"));
}

#[test]
fn external_links_are_confirmable_not_remote_resource_blocks() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    std::fs::write(&doc_path, "[site](https://example.com)").unwrap();

    let resolution = resolve_for_test(1, 6, &doc_path, "[site](https://example.com)").unwrap();

    assert_eq!(resolution.report.decisions[0].kind.as_str(), "link");
    assert_eq!(
        resolution.report.decisions[0].reason.as_str(),
        "external_link_requires_confirmation"
    );
    assert!(!resolution
        .issues
        .iter()
        .any(|issue| issue.message.contains("Remote image blocked")));
    assert!(!resolution
        .safe_html
        .contains("href=\"https://example.com\""));
}

#[test]
fn file_url_image_is_blocked_without_fetchable_src() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    std::fs::write(&doc_path, "![file](file:///etc/passwd)").unwrap();

    let resolution = resolve_for_test(1, 6, &doc_path, "![file](file:///etc/passwd)").unwrap();

    assert_eq!(
        resolution.report.decisions[0].reason.as_str(),
        "file_url_blocked"
    );
    assert!(!resolution.safe_html.contains("file:///etc/passwd"));
}

#[test]
fn untitled_document_blocks_relative_resource_until_saved() {
    let core = pmd_core::emit::render_string("![draft](draft.png)");

    let resolution = resolve_resources(ResourcePolicyContext {
        doc_id: 1,
        version: 7,
        doc_path: None,
        markdown: "![draft](draft.png)",
        rendered_html: &core.html,
        allowed_roots: Vec::new(),
    })
    .unwrap();

    assert_eq!(resolution.report.decisions[0].decision.as_str(), "blocked");
    assert_eq!(
        resolution.report.decisions[0].reason.as_str(),
        "outside_allowed_roots"
    );
    assert!(resolution.safe_html.contains("pmd-image-placeholder"));
}
