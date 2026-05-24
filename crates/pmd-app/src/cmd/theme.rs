use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize)]
pub struct ThemeInfo {
    pub slug: String,
    pub name: String,
    pub mode: String,
    pub inspired_by: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ThemeBundle {
    pub css: String,
    pub mermaid_vars: BTreeMap<String, String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

fn theme_dirs() -> Vec<std::path::PathBuf> {
    let mut dirs = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let bundle = parent.parent().unwrap_or(parent);
            let themes = bundle.join("themes");
            if themes.is_dir() {
                dirs.push(themes);
            }
        }
    }

    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        let manifest_path = std::path::Path::new(&manifest);
        let workspace_root = manifest_path.parent().unwrap().parent().unwrap();
        let themes = workspace_root.join("themes");
        if themes.is_dir() {
            dirs.push(themes);
        }
    }

    if let Ok(home) = std::env::var("HOME") {
        let user_theme = std::path::Path::new(&home)
            .join(".config")
            .join("preview-md")
            .join("themes");
        if user_theme.is_dir() {
            dirs.push(user_theme);
        }
    }

    dirs
}

#[tauri::command]
pub fn list_themes() -> Result<Vec<ThemeInfo>, String> {
    let mut themes = Vec::new();
    for base in theme_dirs() {
        if let Ok(entries) = std::fs::read_dir(&base) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let manifest_path = path.join("manifest.toml");
                    if manifest_path.exists() {
                        let slug = path
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("unknown")
                            .to_string();

                        if let Ok(content) = std::fs::read_to_string(&manifest_path) {
                            if let Ok(theme) = pmd_core::theme::parse_manifest(&content) {
                                let inspired_by = theme.meta.inspired_by.as_ref().and_then(|i| {
                                    i.work
                                        .as_ref()
                                        .or(i.character.as_ref())
                                        .cloned()
                                        .filter(|s| !s.is_empty())
                                });
                                themes.push(ThemeInfo {
                                    slug,
                                    name: theme.meta.name,
                                    mode: theme.meta.mode,
                                    inspired_by,
                                });
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(themes)
}

#[tauri::command]
pub fn set_theme(slug: String) -> Result<ThemeBundle, String> {
    let manifest_path = find_theme_dir(&slug)
        .ok_or_else(|| format!("theme not found: {}", slug))?
        .join("manifest.toml");

    let manifest_content =
        std::fs::read_to_string(&manifest_path).map_err(|e| format!("read manifest: {}", e))?;
    let theme = pmd_core::theme::parse_manifest(&manifest_content)
        .map_err(|e| format!("parse manifest: {}", e))?;

    let mut warnings = Vec::new();
    if let Err(e) = pmd_core::theme::validate::validate(&theme) {
        warnings.push(format!("WCAG contrast issue: {}", e));
    }

    let theme_dir = manifest_path.parent().unwrap();
    let css_path = theme_dir.join("theme.css");
    let extra_css = if css_path.exists() {
        std::fs::read_to_string(&css_path).unwrap_or_default()
    } else {
        String::new()
    };

    let mut css_vars = String::from(":root {\n");
    for (k, v) in &theme.palette.colours {
        let css_key = k.replace('_', "-");
        css_vars.push_str(&format!("  --pmd-{css_key}: {v};\n"));
    }
    for (k, v) in &theme.palette.syntax {
        let css_key = k.replace('_', "-");
        css_vars.push_str(&format!("  --pmd-syntax-{css_key}: {v};\n"));
    }

    let derive_mermaid = |key: &str, fallback: Option<&str>| -> Option<String> {
        if theme.palette.colours.contains_key(key) {
            return None;
        }
        fallback.map(|s| s.to_string())
    };

    let bg = theme.palette.colours.get("bg");
    let bg_elevated = theme.palette.colours.get("bg_elevated");
    let fg = theme.palette.colours.get("fg");
    let accent = theme.palette.colours.get("accent");

    if let (Some(bg), Some(bg_elevated), Some(fg), Some(accent)) = (bg, bg_elevated, fg, accent) {
        if let (Some(bg_rgb), Some(fg_rgb), Some(accent_rgb)) = (
            pmd_core::theme::mix::parse_hex(bg),
            pmd_core::theme::mix::parse_hex(fg),
            pmd_core::theme::mix::parse_hex(accent),
        ) {
            if let Some(v) = derive_mermaid("mermaid_edge_label_bg", Some(bg_elevated)) {
                css_vars.push_str(&format!("  --pmd-mermaid-edge-label-bg: {};\n", v));
            }
            if !theme.palette.colours.contains_key("mermaid_cluster_bg") {
                let mixed = pmd_core::theme::mix::mix(bg_rgb, fg_rgb, 0.04);
                css_vars.push_str(&format!(
                    "  --pmd-mermaid-cluster-bg: {};\n",
                    pmd_core::theme::mix::to_hex(mixed)
                ));
            }
            if let Some(v) = derive_mermaid("mermaid_note_bg", Some(bg_elevated)) {
                css_vars.push_str(&format!("  --pmd-mermaid-note-bg: {};\n", v));
            }
            if let Some(v) = derive_mermaid("mermaid_note_border", Some(accent)) {
                css_vars.push_str(&format!("  --pmd-mermaid-note-border: {};\n", v));
            }
            if !theme.palette.colours.contains_key("mermaid_actor_bg") {
                let mixed = pmd_core::theme::mix::mix(accent_rgb, bg_rgb, 0.30);
                css_vars.push_str(&format!(
                    "  --pmd-mermaid-actor-bg: {};\n",
                    pmd_core::theme::mix::to_hex(mixed)
                ));
            }
            if derive_mermaid("mermaid_error", Some("#e77878")).is_some() {
                css_vars.push_str("  --pmd-mermaid-error: #e77878;\n");
            }
        }
    }

    css_vars.push_str("}\n");
    css_vars.push_str(&extra_css);

    let mut mermaid_vars = BTreeMap::new();

    let mermaid_map: [(&str, &str); 5] = [
        ("mermaid_primary", "primaryColor"),
        ("mermaid_primary_text", "primaryTextColor"),
        ("mermaid_secondary", "secondaryColor"),
        ("mermaid_tertiary", "tertiaryColor"),
        ("mermaid_line", "lineColor"),
    ];
    for (key, mermaid_key) in &mermaid_map {
        if let Some(v) = theme.palette.colours.get(*key) {
            mermaid_vars.insert(mermaid_key.to_string(), v.clone());
        }
    }

    if let Some(bg) = theme.palette.colours.get("bg") {
        mermaid_vars.insert("background".to_string(), bg.clone());
    }

    let get_or_derive_str = |key: &str, fallback: Option<&str>| -> Option<String> {
        if let Some(v) = theme.palette.colours.get(key) {
            Some(v.clone())
        } else {
            fallback.map(|s| s.to_string())
        }
    };

    if let Some(v) = get_or_derive_str(
        "mermaid_edge_label_bg",
        bg_elevated.as_ref().map(|s| s.as_str()),
    ) {
        mermaid_vars.insert("edgeLabelBackground".to_string(), v);
    }
    if !mermaid_vars.contains_key("clusterBkg") {
        if let (Some(bg_elevated), Some(fg)) = (bg_elevated, fg) {
            if let (Some(bg_rgb), Some(fg_rgb)) = (
                pmd_core::theme::mix::parse_hex(bg_elevated),
                pmd_core::theme::mix::parse_hex(fg),
            ) {
                let mixed = pmd_core::theme::mix::mix(bg_rgb, fg_rgb, 0.04);
                mermaid_vars.insert(
                    "clusterBkg".to_string(),
                    pmd_core::theme::mix::to_hex(mixed),
                );
            }
        }
    }
    if let Some(v) = get_or_derive_str("mermaid_note_bg", bg_elevated.as_ref().map(|s| s.as_str()))
    {
        mermaid_vars.insert("noteBkgColor".to_string(), v);
    }
    if let Some(v) = get_or_derive_str("mermaid_note_border", accent.as_ref().map(|s| s.as_str())) {
        mermaid_vars.insert("noteBorderColor".to_string(), v);
    }
    if !mermaid_vars.contains_key("actorBkg") {
        if let (Some(accent), Some(bg)) = (accent, bg) {
            if let (Some(accent_rgb), Some(bg_rgb)) = (
                pmd_core::theme::mix::parse_hex(accent),
                pmd_core::theme::mix::parse_hex(bg),
            ) {
                let mixed = pmd_core::theme::mix::mix(accent_rgb, bg_rgb, 0.30);
                mermaid_vars.insert("actorBkg".to_string(), pmd_core::theme::mix::to_hex(mixed));
            }
        }
    }
    if let Some(v) = get_or_derive_str("mermaid_error", Some("#e77878")) {
        mermaid_vars.insert("errorBkgColor".to_string(), v);
    }

    Ok(ThemeBundle {
        css: css_vars,
        mermaid_vars,
        warnings,
    })
}

fn find_theme_dir(slug: &str) -> Option<std::path::PathBuf> {
    for base in theme_dirs() {
        let path = base.join(slug);
        if path.is_dir() && path.join("manifest.toml").exists() {
            return Some(path);
        }
    }
    None
}
