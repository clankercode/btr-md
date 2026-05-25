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

fn slugs() -> Vec<String> {
    let mut slugs: Vec<_> = std::fs::read_dir("../../themes")
        .unwrap()
        .flatten()
        .filter(|entry| entry.path().join("manifest.toml").exists())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    slugs.sort();
    slugs
}

fn relative_luminance(hex: &str) -> f64 {
    let (r, g, b) = pmd_core::theme::mix::parse_hex(hex)
        .unwrap_or_else(|| panic!("invalid test colour: {hex}"));
    fn channel(value: u8) -> f64 {
        let scaled = f64::from(value) / 255.0;
        if scaled <= 0.03928 {
            scaled / 12.92
        } else {
            ((scaled + 0.055) / 1.055).powf(2.4)
        }
    }
    0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

fn contrast_ratio(a: &str, b: &str) -> f64 {
    let a = relative_luminance(a);
    let b = relative_luminance(b);
    let (lighter, darker) = if a > b { (a, b) } else { (b, a) };
    (lighter + 0.05) / (darker + 0.05)
}

#[test]
fn all_bundled_themes_meet_normal_text_contrast_on_main_surfaces() {
    const MIN_NORMAL_TEXT: f64 = 4.5;
    for slug in slugs() {
        let theme = load(&slug);
        for background in ["bg", "bg_elevated"] {
            let fg = &theme.palette.colours["fg"];
            let bg = &theme.palette.colours[background];
            let ratio = contrast_ratio(fg, bg);
            assert!(
                ratio >= MIN_NORMAL_TEXT,
                "{slug} fg/{background} contrast {ratio:.2}:1 is below {MIN_NORMAL_TEXT}:1"
            );
        }
    }
}
