use pmd_core::theme::{parse_manifest, validate};

fn load(slug: &str) -> pmd_core::theme::Theme {
    let path = format!("../../themes/{slug}/manifest.toml");
    let s = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    parse_manifest(&s).unwrap_or_else(|e| panic!("parse {slug}: {e}"))
}

#[test]
fn github_light_validates() {
    validate(&load("github-light")).unwrap();
}

#[test]
fn github_dark_validates() {
    validate(&load("github-dark")).unwrap();
}
