use pmd_app_lib::preview::resource_policy::{resolve_resources, ResourcePolicyContext};

fn create_file(path: &std::path::Path) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(path, b"png").unwrap();
}

#[test]
fn grants_are_scoped_by_window_and_document_and_do_not_leak() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("assets");
    create_file(&root.join("a.png"));

    let mirror = pmd_app_lib::preview::asset_scope::RecordingAssetScopeMirror::default();
    let mut grants = pmd_app_lib::preview::grants::GrantStore::with_mirror(Box::new(mirror));

    let grant = grants.grant_for_test("main", 1, &root).expect("grant");

    assert!(grants.is_allowed_for_test("main", 1, &root.join("a.png")));
    assert!(!grants.is_allowed_for_test("main", 2, &root.join("a.png")));
    assert!(!grants.is_allowed_for_test("secondary", 1, &root.join("a.png")));

    grants.revoke_for_test("main", 1, grant.id).expect("revoke");
    assert!(!grants.is_allowed_for_test("main", 1, &root.join("a.png")));
}

#[test]
fn grant_uses_canonical_picker_output_and_never_persists_settings() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("assets");
    std::fs::create_dir(&root).unwrap();
    let settings_path = temp.path().join("state/trust-roots.json");

    let mirror = pmd_app_lib::preview::asset_scope::RecordingAssetScopeMirror::default();
    let mut grants = pmd_app_lib::preview::grants::GrantStore::with_mirror(Box::new(mirror));

    let grant = grants
        .grant_for_test("main", 1, &root.join("../assets/."))
        .expect("grant");

    assert_eq!(grant.canonical_root, root.canonicalize().unwrap());
    assert!(
        !settings_path.exists(),
        "session asset grants must not write persistent trust settings"
    );
}

#[test]
fn asset_scope_mirror_allows_after_grant_and_revokes_after_last_owner() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("assets");
    std::fs::create_dir(&root).unwrap();
    let canonical_root = root.canonicalize().unwrap();

    let mirror = pmd_app_lib::preview::asset_scope::RecordingAssetScopeMirror::default();
    let mut grants =
        pmd_app_lib::preview::grants::GrantStore::with_mirror(Box::new(mirror.clone()));

    let first = grants.grant_for_test("main", 1, &root).unwrap();
    let second = grants.grant_for_test("main", 2, &root).unwrap();

    assert_eq!(mirror.allowed_roots(), vec![canonical_root.clone()]);

    grants.revoke_for_test("main", 1, first.id).unwrap();
    assert!(mirror.revoked_roots().is_empty());
    assert!(grants.is_allowed_for_test("main", 2, &root));

    grants.revoke_for_test("main", 2, second.id).unwrap();
    assert_eq!(mirror.revoked_roots(), vec![canonical_root]);
}

#[test]
fn revokes_all_grants_for_closed_document_and_forgotten_root() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("assets");
    let other = temp.path().join("other");
    std::fs::create_dir(&root).unwrap();
    std::fs::create_dir(&other).unwrap();
    let canonical_root = root.canonicalize().unwrap();

    let mirror = pmd_app_lib::preview::asset_scope::RecordingAssetScopeMirror::default();
    let mut grants =
        pmd_app_lib::preview::grants::GrantStore::with_mirror(Box::new(mirror.clone()));

    grants.grant_for_test("main", 1, &root).unwrap();
    grants.grant_for_test("main", 1, &other).unwrap();
    grants.grant_for_test("main", 2, &root).unwrap();

    grants
        .revoke_all_for_doc(pmd_app_lib::doc::state::DocId(1))
        .unwrap();
    assert!(!grants.is_allowed_for_test("main", 1, &root));
    assert!(grants.is_allowed_for_test("main", 2, &root));
    assert!(mirror
        .revoked_roots()
        .contains(&other.canonicalize().unwrap()));

    grants.revoke_all_for_root(&root).unwrap();
    assert!(!grants.is_allowed_for_test("main", 2, &root));
    assert!(mirror.revoked_roots().contains(&canonical_root));

    std::fs::remove_dir(&root).unwrap();
    grants.revoke_all_for_root(&root).unwrap();
}

#[cfg(unix)]
#[test]
fn symlink_escape_remains_blocked_after_canonicalization() {
    use std::os::unix::fs::symlink;

    let temp = tempfile::tempdir().unwrap();
    let docs = temp.path().join("docs");
    let assets = temp.path().join("assets");
    let outside = temp.path().join("outside");
    std::fs::create_dir(&docs).unwrap();
    std::fs::create_dir(&assets).unwrap();
    std::fs::create_dir(&outside).unwrap();
    let doc_path = docs.join("doc.md");
    std::fs::write(&doc_path, "![escape](../assets/escape.png)").unwrap();
    create_file(&outside.join("escape.png"));
    symlink(outside.join("escape.png"), assets.join("escape.png")).unwrap();
    let markdown = "![escape](../assets/escape.png)";
    let rendered = pmd_core::emit::render_string(markdown);

    let resolution = resolve_resources(ResourcePolicyContext {
        doc_id: 1,
        version: 2,
        doc_path: Some(&doc_path),
        markdown,
        facts: &rendered.facts,
        rendered_html: &rendered.html,
        allowed_roots: vec![assets.canonicalize().unwrap()],
    })
    .unwrap();

    assert_eq!(resolution.report.decisions[0].decision.as_str(), "blocked");
    assert_eq!(
        resolution.report.decisions[0].reason.as_str(),
        "outside_allowed_roots"
    );
}

#[test]
fn granted_roots_are_supplied_to_resource_policy() {
    let temp = tempfile::tempdir().unwrap();
    let docs = temp.path().join("docs");
    let assets = temp.path().join("assets");
    std::fs::create_dir(&docs).unwrap();
    std::fs::create_dir(&assets).unwrap();
    let doc_path = docs.join("doc.md");
    std::fs::write(&doc_path, "![logo](../assets/logo.png)").unwrap();
    create_file(&assets.join("logo.png"));
    let markdown = "![logo](../assets/logo.png)";
    let rendered = pmd_core::emit::render_string(markdown);

    let mirror = pmd_app_lib::preview::asset_scope::RecordingAssetScopeMirror::default();
    let mut grants = pmd_app_lib::preview::grants::GrantStore::with_mirror(Box::new(mirror));
    let grant = grants.grant_for_test("main", 1, &assets).unwrap();

    let resolution = resolve_resources(ResourcePolicyContext {
        doc_id: 1,
        version: 2,
        doc_path: Some(&doc_path),
        markdown,
        facts: &rendered.facts,
        rendered_html: &rendered.html,
        allowed_roots: vec![docs.canonicalize().unwrap(), grant.canonical_root],
    })
    .unwrap();

    assert_eq!(resolution.report.decisions[0].decision.as_str(), "allowed");
    assert_eq!(
        resolution.report.decisions[0].reason.as_str(),
        "allowed_local_scope"
    );
    assert!(resolution.safe_html.contains("data:image/png;base64,"));
}
