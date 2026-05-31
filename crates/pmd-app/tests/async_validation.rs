use std::sync::Arc;

use pmd_app_lib::preview::contracts::{
    DocumentDiagnostics, DocumentIssue, IssueCategory, IssueSeverity,
};
use pmd_app_lib::preview::validation::{ValidationEngine, ValidationLimits, ValidationRequest};

#[tokio::test]
async fn cross_file_anchor_validation_reports_missing_heading() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join("doc.md"), "[missing](other.md#nope)").unwrap();
    std::fs::write(temp.path().join("other.md"), "# Present\n").unwrap();

    let diagnostics = pmd_app_lib::preview::validation::validate_for_test(
        10,
        22,
        &temp.path().join("doc.md"),
        "[missing](other.md#nope)",
    )
    .await
    .expect("diagnostics");

    assert!(diagnostics.issues.iter().any(|issue| {
        issue.category.as_str() == "anchor" && issue.severity.as_str() == "error"
    }));
}

#[tokio::test]
async fn local_file_and_image_path_diagnostics_distinguish_missing_from_valid() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    std::fs::write(temp.path().join("present.pdf"), b"pdf").unwrap();
    std::fs::write(temp.path().join("ok.png"), b"png").unwrap();
    let markdown =
        "[ok](present.pdf) [missing](missing.pdf)\n\n![ok](ok.png)\n![missing](missing.png)";

    let diagnostics =
        pmd_app_lib::preview::validation::validate_for_test(10, 23, &doc_path, markdown)
            .await
            .expect("diagnostics");

    assert!(diagnostics.issues.iter().any(|issue| {
        issue.category.as_str() == "link"
            && issue.severity.as_str() == "error"
            && issue.message.contains("missing.pdf")
    }));
    assert!(diagnostics.issues.iter().any(|issue| {
        issue.category.as_str() == "image"
            && issue.severity.as_str() == "error"
            && issue.message.contains("missing.png")
    }));
    assert!(!diagnostics
        .issues
        .iter()
        .any(|issue| issue.message.contains("present.pdf")));
    assert!(!diagnostics
        .issues
        .iter()
        .any(|issue| issue.message.contains("ok.png")));
}

#[tokio::test]
async fn duplicate_heading_slugs_validate_current_and_cross_file_fragments() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    let other_path = temp.path().join("other.md");
    std::fs::write(&other_path, "# Title\n\n# Title\n").unwrap();
    let markdown =
        "# Title\n\n# Title\n\n[local ok](#title-1) [local bad](#title-2) [cross ok](other.md#title-1)";

    let diagnostics =
        pmd_app_lib::preview::validation::validate_for_test(10, 24, &doc_path, markdown)
            .await
            .expect("diagnostics");

    assert!(!diagnostics
        .issues
        .iter()
        .any(|issue| issue.message.contains("#title-1")));
    assert!(diagnostics.issues.iter().any(|issue| {
        issue.category.as_str() == "anchor"
            && issue.severity.as_str() == "error"
            && issue.message.contains("#title-2")
    }));
}

#[tokio::test]
async fn unresolved_reference_link_creates_link_issue() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    let markdown = "[missing][nope]";

    let diagnostics =
        pmd_app_lib::preview::validation::validate_for_test(10, 25, &doc_path, markdown)
            .await
            .expect("diagnostics");

    assert!(diagnostics.issues.iter().any(|issue| {
        issue.category.as_str() == "link"
            && issue.severity.as_str() == "error"
            && issue.message.contains("nope")
    }));
}

#[tokio::test]
async fn unresolved_reference_image_creates_image_issue() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    let markdown = "![logo][missing-ref]";

    let diagnostics =
        pmd_app_lib::preview::validation::validate_for_test(10, 251, &doc_path, markdown)
            .await
            .expect("diagnostics");

    assert!(diagnostics.issues.iter().any(|issue| {
        issue.category.as_str() == "image"
            && issue.severity.as_str() == "error"
            && issue.message.contains("Image reference unresolved")
    }));
}

#[tokio::test]
async fn validation_does_not_recursively_crawl_linked_markdown() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    std::fs::write(
        temp.path().join("other.md"),
        "# Present\n\n[nested](nested.md#missing)",
    )
    .unwrap();
    std::fs::write(temp.path().join("nested.md"), "# Different\n").unwrap();
    let markdown = "[direct](other.md#present)";

    let diagnostics =
        pmd_app_lib::preview::validation::validate_for_test(10, 26, &doc_path, markdown)
            .await
            .expect("diagnostics");

    assert!(!diagnostics
        .issues
        .iter()
        .any(|issue| issue.message.contains("nested.md")));
}

#[tokio::test]
async fn budget_exhaustion_reports_warning() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    let markdown = (0..520)
        .map(|idx| format!("[missing-{idx}](missing-{idx}.md)"))
        .collect::<Vec<_>>()
        .join("\n");

    let diagnostics =
        pmd_app_lib::preview::validation::validate_for_test(10, 27, &doc_path, &markdown)
            .await
            .expect("diagnostics");

    assert!(diagnostics.issues.iter().any(|issue| {
        issue.severity.as_str() == "warning"
            && issue.category.as_str() == "filesystem"
            && issue.message.contains("512 fact budget")
    }));
}

#[tokio::test]
async fn blocked_local_image_keeps_initial_resource_policy_issue() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    let markdown = "![secret](../secret.png)";
    let mut initial = DocumentDiagnostics::empty_initial(10, 28);
    initial.issues.push(DocumentIssue {
        id: "resource:10:28:image-0".to_string(),
        severity: IssueSeverity::Blocked,
        category: IssueCategory::ResourcePolicy,
        line_start: Some(1),
        line_end: Some(1),
        block_id: None,
        message: "Image blocked: grant the containing folder or move it under the document folder."
            .to_string(),
        detail: Some("../secret.png".to_string()),
        primary_action: Some("asset.grantFolder".to_string()),
    });

    let mut engine = ValidationEngine::new(ValidationLimits::default());
    let diagnostics = engine
        .validate(ValidationRequest {
            doc_id: 10,
            version: 28,
            doc_path,
            markdown: markdown.to_string(),
            initial_diagnostics: initial,
            is_current: Arc::new(|_, _| true),
        })
        .await
        .expect("diagnostics");

    assert!(diagnostics.issues.iter().any(|issue| {
        issue.severity.as_str() == "blocked"
            && issue.category.as_str() == "resource_policy"
            && issue.message.contains("Image blocked")
    }));
}

#[tokio::test]
async fn stale_validation_worker_result_is_not_emitted() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    std::fs::write(&doc_path, "[missing](missing.md#nope)").unwrap();
    let worker = pmd_app_lib::preview::render_pipeline::ValidationWorker::new();
    worker.observe_render(10, 30);

    let result = worker
        .validate_current(
            10,
            29,
            doc_path,
            "[missing](missing.md#nope)".to_string(),
            DocumentDiagnostics::empty_initial(10, 29),
        )
        .await
        .expect("validation");

    assert!(result.is_none());
}

#[tokio::test]
async fn invalidation_refreshes_cross_file_anchor_cache() {
    let temp = tempfile::tempdir().unwrap();
    let doc_path = temp.path().join("doc.md");
    let other_path = temp.path().join("other.md");
    std::fs::write(&other_path, "# Old\n").unwrap();
    let markdown = "[linked](other.md#new)";
    let mut engine = ValidationEngine::new(ValidationLimits::default());

    let first = engine
        .validate(ValidationRequest {
            doc_id: 10,
            version: 31,
            doc_path: doc_path.clone(),
            markdown: markdown.to_string(),
            initial_diagnostics: DocumentDiagnostics::empty_initial(10, 31),
            is_current: Arc::new(|_, _| true),
        })
        .await
        .expect("first diagnostics");
    assert!(first
        .issues
        .iter()
        .any(|issue| issue.message.contains("#new")));

    std::fs::write(&other_path, "# New\n").unwrap();
    engine.invalidate_for_watcher_change(&other_path);
    let second = engine
        .validate(ValidationRequest {
            doc_id: 10,
            version: 32,
            doc_path: doc_path.clone(),
            markdown: markdown.to_string(),
            initial_diagnostics: DocumentDiagnostics::empty_initial(10, 32),
            is_current: Arc::new(|_, _| true),
        })
        .await
        .expect("second diagnostics");
    assert!(!second
        .issues
        .iter()
        .any(|issue| issue.message.contains("#new")));

    std::fs::write(&other_path, "# Save\n").unwrap();
    engine.invalidate_for_save(&other_path);
    let after_save = engine
        .validate(ValidationRequest {
            doc_id: 10,
            version: 33,
            doc_path: doc_path.clone(),
            markdown: "[linked](other.md#save)".to_string(),
            initial_diagnostics: DocumentDiagnostics::empty_initial(10, 33),
            is_current: Arc::new(|_, _| true),
        })
        .await
        .expect("save invalidation diagnostics");
    assert!(!after_save
        .issues
        .iter()
        .any(|issue| issue.message.contains("#save")));

    std::fs::write(&other_path, "# Grant\n").unwrap();
    engine.invalidate_for_grant_change(10);
    let after_grant = engine
        .validate(ValidationRequest {
            doc_id: 10,
            version: 34,
            doc_path: doc_path.clone(),
            markdown: "[linked](other.md#grant)".to_string(),
            initial_diagnostics: DocumentDiagnostics::empty_initial(10, 34),
            is_current: Arc::new(|_, _| true),
        })
        .await
        .expect("grant invalidation diagnostics");
    assert!(!after_grant
        .issues
        .iter()
        .any(|issue| issue.message.contains("#grant")));

    std::fs::write(&other_path, "# Reload\n").unwrap();
    engine.invalidate_for_reload(10);
    let after_reload = engine
        .validate(ValidationRequest {
            doc_id: 10,
            version: 35,
            doc_path,
            markdown: "[linked](other.md#reload)".to_string(),
            initial_diagnostics: DocumentDiagnostics::empty_initial(10, 35),
            is_current: Arc::new(|_, _| true),
        })
        .await
        .expect("reload diagnostics");
    assert!(!after_reload
        .issues
        .iter()
        .any(|issue| issue.message.contains("#reload")));
}
