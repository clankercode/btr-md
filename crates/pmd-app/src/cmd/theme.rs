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

    let theme_dir = manifest_path.parent().unwrap();
    let css_path = theme_dir.join("theme.css");
    let extra_css = if css_path.exists() {
        std::fs::read_to_string(&css_path).unwrap_or_default()
    } else {
        String::new()
    };

    let mut css_vars = String::from(":root {\n");
    for (k, v) in &theme.palette.colours {
        css_vars.push_str(&format!("  --pmd-{k}: {v};\n"));
    }
    for (k, v) in &theme.palette.syntax {
        css_vars.push_str(&format!("  --pmd-syntax-{k}: {v};\n"));
    }
    css_vars.push_str("}\n");
    css_vars.push_str(&extra_css);

    let mut mermaid_vars = BTreeMap::new();
    for key in [
        "mermaid_primary",
        "mermaid_primary_text",
        "mermaid_secondary",
        "mermaid_tertiary",
        "mermaid_line",
    ] {
        if let Some(v) = theme.palette.colours.get(key) {
            let mermaid_key = key.replace("mermaid_", "");
            mermaid_vars.insert(mermaid_key, v.clone());
        }
    }

    Ok(ThemeBundle {
        css: css_vars,
        mermaid_vars,
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
