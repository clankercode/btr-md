use pmd_app_lib::preview::link_activation::{ActivationKind, LinkActivationStore};

#[test]
fn fragment_link_scrolls_to_block() {
    let store = pmd_app_lib::preview::link_activation::test_state();
    store.insert_link_for_test(7, 12, "link-0", "#section", "Section");

    let action = store
        .prepare_link_activation(7, 12, "link-0", ActivationKind::Primary)
        .unwrap();

    assert_eq!(action.kind.as_str(), "scroll_to_block");
    assert_eq!(action.block_id.as_deref(), Some("section"));
}

#[test]
fn local_markdown_link_returns_backend_owned_open_request() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    let linked_path = temp.path().join("linked.md");
    std::fs::write(&doc_path, "[Linked](linked.md)").unwrap();
    std::fs::write(&linked_path, "# Linked").unwrap();
    let store = pmd_app_lib::preview::link_activation::test_state();
    store.insert_link_for_test_with_doc_path(7, 12, "link-0", "linked.md", "Linked", &doc_path);

    let action = store
        .prepare_link_activation(7, 12, "link-0", ActivationKind::Primary)
        .unwrap();

    assert_eq!(action.kind.as_str(), "open_document");
    assert_eq!(
        action.normalized_url.as_deref(),
        Some(linked_path.to_str().unwrap())
    );
}

#[test]
fn local_file_link_returns_default_app_request() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    let linked_path = temp.path().join("report.pdf");
    std::fs::write(&doc_path, "[Report](report.pdf)").unwrap();
    std::fs::write(&linked_path, b"pdf").unwrap();
    let store = pmd_app_lib::preview::link_activation::test_state();
    store.insert_link_for_test_with_doc_path(7, 12, "link-0", "report.pdf", "Report", &doc_path);

    let action = store
        .prepare_link_activation(7, 12, "link-0", ActivationKind::Primary)
        .unwrap();

    assert_eq!(action.kind.as_str(), "open_default_app");
    assert_eq!(
        action.normalized_url.as_deref(),
        Some(linked_path.to_str().unwrap())
    );
}

#[test]
fn external_link_requires_confirmation_with_normalized_parts() {
    let store = pmd_app_lib::preview::link_activation::test_state();
    store.insert_link_for_test(
        7,
        12,
        "link-0",
        "https://example.com/path?q=1",
        "safe label",
    );

    let action = store
        .prepare_link_activation(7, 12, "link-0", ActivationKind::Primary)
        .expect("action");

    assert_eq!(action.kind.as_str(), "external_confirmation");
    assert_eq!(
        action.normalized_url.as_deref(),
        Some("https://example.com/path?q=1")
    );
    assert_eq!(action.scheme.as_deref(), Some("https"));
    assert_eq!(action.host.as_deref(), Some("example.com"));
    assert!(action.action_token.is_some());
}

#[test]
fn mailto_link_requires_confirmation() {
    let store = pmd_app_lib::preview::link_activation::test_state();
    store.insert_link_for_test(7, 12, "link-0", "mailto:a@example.com", "Email");

    let action = store
        .prepare_link_activation(7, 12, "link-0", ActivationKind::Keyboard)
        .unwrap();

    assert_eq!(action.kind.as_str(), "external_confirmation");
    assert_eq!(action.scheme.as_deref(), Some("mailto"));
    assert!(action.action_token.is_some());
}

#[test]
fn unknown_scheme_is_denied() {
    let store = pmd_app_lib::preview::link_activation::test_state();
    store.insert_link_for_test(7, 12, "link-0", "javascript:alert(1)", "bad");

    let action = store
        .prepare_link_activation(7, 12, "link-0", ActivationKind::Primary)
        .unwrap();

    assert_eq!(action.kind.as_str(), "denied");
}

#[test]
fn stale_link_ids_and_versions_are_rejected() {
    let store = pmd_app_lib::preview::link_activation::test_state();
    store.insert_link_for_test(7, 12, "link-0", "https://example.com", "Open");

    assert!(store
        .prepare_link_activation(7, 12, "link-99", ActivationKind::Primary)
        .is_err());
    assert!(store
        .prepare_link_activation(7, 13, "link-0", ActivationKind::Primary)
        .is_err());
}

#[test]
fn external_confirmation_token_is_bound_single_use_and_not_renderer_swappable() {
    let store = pmd_app_lib::preview::link_activation::test_state();
    store.insert_link_for_test(
        7,
        12,
        "link-0",
        "https://example.com/path?q=1",
        "safe label",
    );
    let token = store
        .prepare_link_activation(7, 12, "link-0", ActivationKind::Primary)
        .unwrap()
        .action_token
        .unwrap();

    assert!(store.confirm_external_open(7, 99, &token).is_err());
    assert!(store
        .confirm_external_open_with_renderer_url_for_test(7, 12, &token, "https://evil.test")
        .is_err());
    assert!(store.confirm_external_open(7, 12, &token).is_ok());
    assert!(store.confirm_external_open(7, 12, &token).is_err());
}

#[tokio::test]
async fn render_registers_production_link_targets_for_backend_activation() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    std::fs::write(&doc_path, "[Open](https://example.com/path?q=1)").unwrap();
    let store = LinkActivationStore::test_noop_external_opener();

    let result = pmd_app_lib::cmd::render::render_cmd_for_test_with_links(
        7,
        12,
        Some(&doc_path),
        "[Open](https://example.com/path?q=1)".to_string(),
        &store,
    )
    .await
    .expect("render");

    assert!(result.html.contains("data-pmd-link-id=\"link-0\""));
    assert!(!result
        .html
        .contains("href=\"https://example.com/path?q=1\""));

    let action = store
        .prepare_link_activation(7, 12, "link-0", ActivationKind::Primary)
        .expect("stored production link target");
    assert_eq!(action.kind.as_str(), "external_confirmation");
    assert_eq!(
        action.normalized_url.as_deref(),
        Some("https://example.com/path?q=1")
    );
}

#[tokio::test]
async fn newer_render_invalidates_pending_external_confirmation_tokens() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    std::fs::write(&doc_path, "[Open](https://example.com/old)").unwrap();
    let store = LinkActivationStore::test_noop_external_opener();

    pmd_app_lib::cmd::render::render_cmd_for_test_with_links(
        7,
        12,
        Some(&doc_path),
        "[Open](https://example.com/old)".to_string(),
        &store,
    )
    .await
    .unwrap();
    let token = store
        .prepare_link_activation(7, 12, "link-0", ActivationKind::Primary)
        .unwrap()
        .action_token
        .unwrap();

    pmd_app_lib::cmd::render::render_cmd_for_test_with_links(
        7,
        13,
        Some(&doc_path),
        "[Open](https://example.com/new)".to_string(),
        &store,
    )
    .await
    .unwrap();

    assert!(store.confirm_external_open(7, 12, &token).is_err());
}
