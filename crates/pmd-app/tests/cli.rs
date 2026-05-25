use pmd_app_lib::{cli, path_scope::PathScope};

#[test]
fn parse_args_recognizes_harness_flags() {
    let scope = PathScope::new();

    let parsed = cli::parse_args(["--list-themes", "--open-dialog"], &scope);

    assert!(parsed.list_themes);
    assert!(parsed.open_dialog);
    assert_eq!(parsed.initial_path, None);
}

#[test]
fn parse_args_still_admits_single_initial_file() {
    let temp = tempfile::tempdir().expect("tempdir");
    let path = temp.path().join("hello.md");
    std::fs::write(&path, "# Hello").expect("write markdown");
    let scope = PathScope::new();

    let parsed = cli::parse_args([path.to_string_lossy().to_string()], &scope);

    assert_eq!(parsed.initial_path, Some(path.canonicalize().unwrap()));
    assert!(!parsed.list_themes);
    assert!(!parsed.open_dialog);
}
