use pmd_app_lib::preview::trust_roots::TrustRootState;

fn write_doc(path: &std::path::Path) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(path, "# Doc\n").unwrap();
}

#[test]
fn detects_git_root_when_markdown_file_is_loaded() {
    let temp = tempfile::tempdir().unwrap();
    let repo = temp.path().join("repo");
    let docs = repo.join("docs");
    std::fs::create_dir_all(repo.join(".git")).unwrap();
    let doc_path = docs.join("doc.md");
    write_doc(&doc_path);

    let context =
        pmd_app_lib::preview::git_root::discover_document_trust_context(&doc_path).unwrap();

    assert_eq!(context.doc_dir, docs.canonicalize().unwrap());
    assert_eq!(context.git_root, Some(repo.canonicalize().unwrap()));
}

#[test]
fn git_worktree_file_marker_counts_as_git_root() {
    let temp = tempfile::tempdir().unwrap();
    let worktree = temp.path().join("worktree");
    let docs = worktree.join("docs");
    std::fs::create_dir_all(&docs).unwrap();
    std::fs::write(
        worktree.join(".git"),
        "gitdir: ../.git/worktrees/dit-asset-grants\n",
    )
    .unwrap();
    let doc_path = docs.join("doc.md");
    write_doc(&doc_path);

    let context =
        pmd_app_lib::preview::git_root::discover_document_trust_context(&doc_path).unwrap();

    assert_eq!(context.git_root, Some(worktree.canonicalize().unwrap()));
}

#[test]
fn remembered_trusted_git_root_materializes_as_session_grant_on_load() {
    let temp = tempfile::tempdir().unwrap();
    let repo = temp.path().join("repo");
    std::fs::create_dir_all(repo.join(".git")).unwrap();
    let doc_path = repo.join("docs/doc.md");
    write_doc(&doc_path);
    let repo_root = repo.canonicalize().unwrap();

    let mut trust = pmd_app_lib::preview::trust_roots::TrustRootStore::empty_for_test();
    trust.remember_trusted_for_test(&repo_root).unwrap();
    let mirror = pmd_app_lib::preview::asset_scope::RecordingAssetScopeMirror::default();
    let mut grants =
        pmd_app_lib::preview::grants::GrantStore::with_mirror(Box::new(mirror.clone()));

    let applied = trust
        .apply_remembered_trust_for_document("main", 1, &doc_path, &mut grants)
        .unwrap();

    assert_eq!(applied.granted_roots, vec![repo_root.clone()]);
    assert!(!applied.should_prompt_for_repo_root);
    assert_eq!(mirror.allowed_roots(), vec![repo_root.clone()]);
    assert!(grants.is_allowed_for_test("main", 1, &repo_root.join("docs/doc.md")));
}

#[test]
fn remembered_declined_git_root_suppresses_prompt_and_does_not_grant() {
    let temp = tempfile::tempdir().unwrap();
    let repo = temp.path().join("repo");
    std::fs::create_dir_all(repo.join(".git")).unwrap();
    let doc_path = repo.join("docs/doc.md");
    write_doc(&doc_path);
    let repo_root = repo.canonicalize().unwrap();

    let mut trust = pmd_app_lib::preview::trust_roots::TrustRootStore::empty_for_test();
    trust.remember_declined_for_test(&repo_root).unwrap();
    let mirror = pmd_app_lib::preview::asset_scope::RecordingAssetScopeMirror::default();
    let mut grants = pmd_app_lib::preview::grants::GrantStore::with_mirror(Box::new(mirror));

    let applied = trust
        .apply_remembered_trust_for_document("main", 1, &doc_path, &mut grants)
        .unwrap();

    assert_eq!(applied.declined_roots, vec![repo_root.clone()]);
    assert!(applied.granted_roots.is_empty());
    assert!(!applied.should_prompt_for_repo_root);
    assert!(!grants.is_allowed_for_test("main", 1, &repo_root.join("docs/doc.md")));
}

#[test]
fn unknown_git_root_recommends_prompt_without_granting() {
    let temp = tempfile::tempdir().unwrap();
    let repo = temp.path().join("repo");
    std::fs::create_dir_all(repo.join(".git")).unwrap();
    let doc_path = repo.join("docs/doc.md");
    write_doc(&doc_path);
    let repo_root = repo.canonicalize().unwrap();

    let trust = pmd_app_lib::preview::trust_roots::TrustRootStore::empty_for_test();
    let mirror = pmd_app_lib::preview::asset_scope::RecordingAssetScopeMirror::default();
    let mut grants = pmd_app_lib::preview::grants::GrantStore::with_mirror(Box::new(mirror));

    let applied = trust
        .apply_remembered_trust_for_document("main", 1, &doc_path, &mut grants)
        .unwrap();

    assert_eq!(applied.recommended_repo_root, Some(repo_root.clone()));
    assert!(applied.should_prompt_for_repo_root);
    assert!(applied.granted_roots.is_empty());
}

#[test]
fn trust_root_decisions_persist_and_reload_only_canonical_paths() {
    let temp = tempfile::tempdir().unwrap();
    let trusted = temp.path().join("trusted");
    let declined = temp.path().join("declined");
    std::fs::create_dir(&trusted).unwrap();
    std::fs::create_dir(&declined).unwrap();
    let settings_path = temp.path().join("state/trust-roots.json");

    let mut trust =
        pmd_app_lib::preview::trust_roots::TrustRootStore::empty_at(settings_path.clone());
    trust.remember_trusted_for_test(&trusted).unwrap();
    trust.remember_declined_for_test(&declined).unwrap();

    let loaded = pmd_app_lib::preview::trust_roots::TrustRootStore::load(settings_path).unwrap();

    assert_eq!(
        loaded.decision_for(&trusted.canonicalize().unwrap()),
        Some(TrustRootState::Trusted)
    );
    assert_eq!(
        loaded.decision_for(&declined.canonicalize().unwrap()),
        Some(TrustRootState::Declined)
    );
    assert!(loaded
        .list()
        .iter()
        .all(|decision| decision.canonical_root.is_absolute()));
}

#[test]
fn stale_trust_root_decisions_load_and_can_be_forgotten() {
    let temp = tempfile::tempdir().unwrap();
    let stale = temp.path().join("stale");
    let settings_path = temp.path().join("state/trust-roots.json");
    std::fs::create_dir_all(settings_path.parent().unwrap()).unwrap();
    std::fs::write(
        &settings_path,
        format!(
            "{{\"roots\":[{{\"canonical_root\":\"{}\",\"state\":\"trusted\"}}]}}",
            stale.display()
        ),
    )
    .unwrap();

    let mut loaded =
        pmd_app_lib::preview::trust_roots::TrustRootStore::load(settings_path).unwrap();
    assert_eq!(loaded.decision_for(&stale), Some(TrustRootState::Trusted));

    loaded.forget(&stale).unwrap();
    assert_eq!(loaded.decision_for(&stale), None);
}

#[cfg(unix)]
#[test]
fn persisted_trust_root_replaced_by_symlink_is_dropped_on_load() {
    use std::os::unix::fs::symlink;

    let temp = tempfile::tempdir().unwrap();
    let settings_path = temp.path().join("state/trust-roots.json");
    let trusted = temp.path().join("trusted");
    let target = temp.path().join("target");
    std::fs::create_dir_all(settings_path.parent().unwrap()).unwrap();
    std::fs::create_dir(&trusted).unwrap();
    std::fs::create_dir(&target).unwrap();
    let trusted_canonical = trusted.canonicalize().unwrap();

    let mut trust =
        pmd_app_lib::preview::trust_roots::TrustRootStore::empty_at(settings_path.clone());
    trust.remember_trusted_for_test(&trusted).unwrap();

    std::fs::remove_dir(&trusted).unwrap();
    symlink(&target, &trusted).unwrap();

    let loaded = pmd_app_lib::preview::trust_roots::TrustRootStore::load(settings_path).unwrap();

    assert_eq!(loaded.decision_for(&trusted_canonical), None);
    assert_eq!(loaded.decision_for(&target.canonicalize().unwrap()), None);
}
