use pmd_core::theme::{parse_manifest, schema};

fn slugs() -> Vec<String> {
    std::fs::read_dir("../../themes")
        .unwrap()
        .flatten()
        .filter_map(|e| e.file_name().into_string().ok())
        .collect()
}

#[test]
fn bundled_theme_set_is_complete() {
    let mut got = slugs();
    got.sort();
    let expected = [
        "cobalt-bone",
        "dracula",
        "github-dark",
        "github-light",
        "lavender-forest",
        "nord",
        "onyx-sorcerer",
        "rose-melancholy",
        "rose-pine-dawn",
        "rust-warden",
        "sepia-atelier",
        "sky-hero",
        "solarized-dark",
        "solarized-light",
        "sun-and-sea",
        "tokyo-night",
        "twilight-mage",
    ];
    assert_eq!(got, expected);
}

#[test]
fn every_bundled_theme_has_required_keys() {
    let req = schema::required_palette_keys();
    let sreq = schema::required_syntax_keys();
    for slug in slugs() {
        let s = std::fs::read_to_string(format!("../../themes/{slug}/manifest.toml")).unwrap();
        let t = parse_manifest(&s).unwrap();
        for k in &req {
            assert!(t.palette.colours.contains_key(*k), "{slug} missing {k}");
        }
        for k in &sreq {
            assert!(
                t.palette.syntax.contains_key(*k),
                "{slug} missing syntax.{k}"
            );
        }
    }
}
