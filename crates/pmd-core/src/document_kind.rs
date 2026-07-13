//! Document kind detection for preview + editor language selection.
//!
//! Path extension is primary; HTML may also be sniffed from content (BOM /
//! leading whitespace, then `<!doctype html` or `<html`).

use serde::{Deserialize, Serialize};
use std::path::Path;

/// High-level document kind used by the render pipeline and UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DocumentKind {
    #[default]
    Markdown,
    Html,
    Json,
    Yaml,
    Toml,
    Ini,
}

impl DocumentKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Markdown => "markdown",
            Self::Html => "html",
            Self::Json => "json",
            Self::Yaml => "yaml",
            Self::Toml => "toml",
            Self::Ini => "ini",
        }
    }

    /// True when the preview must not run the markdown pipeline.
    pub fn is_non_markdown(self) -> bool {
        !matches!(self, Self::Markdown)
    }

    /// True for structured config formats (json/yaml/toml/ini).
    pub fn is_config(self) -> bool {
        matches!(self, Self::Json | Self::Yaml | Self::Toml | Self::Ini)
    }
}

/// Markdown filename extensions (lowercase, no dot).
pub const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd"];
/// HTML filename extensions.
pub const HTML_EXTENSIONS: &[&str] = &["html", "htm"];
/// JSON.
pub const JSON_EXTENSIONS: &[&str] = &["json", "jsonc"];
/// YAML.
pub const YAML_EXTENSIONS: &[&str] = &["yaml", "yml"];
/// TOML.
pub const TOML_EXTENSIONS: &[&str] = &["toml"];
/// INI / similar config-ish text.
pub const INI_EXTENSIONS: &[&str] = &["ini", "cfg", "conf", "properties"];

/// All extensions openable as documents (markdown + HTML + config).
pub const DOCUMENT_EXTENSIONS: &[&str] = &[
    "md",
    "markdown",
    "mdown",
    "mkd",
    "html",
    "htm",
    "json",
    "jsonc",
    "yaml",
    "yml",
    "toml",
    "ini",
    "cfg",
    "conf",
    "properties",
];

/// Classify by path extension only (case-insensitive). Unknown → `None`.
pub fn kind_from_path(path: &Path) -> Option<DocumentKind> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    if MARKDOWN_EXTENSIONS.iter().any(|e| *e == ext) {
        return Some(DocumentKind::Markdown);
    }
    if HTML_EXTENSIONS.iter().any(|e| *e == ext) {
        return Some(DocumentKind::Html);
    }
    if JSON_EXTENSIONS.iter().any(|e| *e == ext) {
        return Some(DocumentKind::Json);
    }
    if YAML_EXTENSIONS.iter().any(|e| *e == ext) {
        return Some(DocumentKind::Yaml);
    }
    if TOML_EXTENSIONS.iter().any(|e| *e == ext) {
        return Some(DocumentKind::Toml);
    }
    if INI_EXTENSIONS.iter().any(|e| *e == ext) {
        return Some(DocumentKind::Ini);
    }
    None
}

/// True when `source` (after optional UTF-8 BOM and leading whitespace) looks
/// like a full HTML document: starts with `<!doctype html` or `<html`.
pub fn looks_like_html(source: &str) -> bool {
    let s = strip_bom(source).trim_start();
    if s.is_empty() {
        return false;
    }
    // Cheap prefix check on a lowercased window; doctype may carry public ids.
    let prefix_len = s.len().min(128);
    let prefix = s[..prefix_len].to_ascii_lowercase();
    if prefix.starts_with("<!doctype html") {
        return true;
    }
    // `<html` followed by whitespace, `>`, or end / attributes boundary.
    if let Some(rest) = prefix.strip_prefix("<html") {
        let next = rest.as_bytes().first().copied();
        return match next {
            None => true,
            Some(b) => b == b'>' || b.is_ascii_whitespace() || b == b'/',
        };
    }
    false
}

/// Resolve document kind from optional path + content.
///
/// Priority:
/// 1. Path extension when recognised
/// 2. HTML content sniff (even for extensionless / non-document extensions when
///    the buffer is already open)
/// 3. Default markdown
pub fn detect_document_kind(path: Option<&Path>, source: &str) -> DocumentKind {
    if let Some(p) = path {
        if let Some(kind) = kind_from_path(p) {
            return kind;
        }
    }
    if looks_like_html(source) {
        return DocumentKind::Html;
    }
    DocumentKind::Markdown
}

fn strip_bom(s: &str) -> &str {
    s.strip_prefix('\u{feff}').unwrap_or(s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn path_extensions() {
        assert_eq!(
            kind_from_path(Path::new("a.MD")),
            Some(DocumentKind::Markdown)
        );
        assert_eq!(
            kind_from_path(Path::new("x.HtMl")),
            Some(DocumentKind::Html)
        );
        assert_eq!(
            kind_from_path(Path::new("c.json")),
            Some(DocumentKind::Json)
        );
        assert_eq!(kind_from_path(Path::new("c.YML")), Some(DocumentKind::Yaml));
        assert_eq!(
            kind_from_path(Path::new("c.toml")),
            Some(DocumentKind::Toml)
        );
        assert_eq!(kind_from_path(Path::new("c.ini")), Some(DocumentKind::Ini));
        assert_eq!(kind_from_path(Path::new("c.cfg")), Some(DocumentKind::Ini));
        assert_eq!(kind_from_path(Path::new("c.txt")), None);
    }

    #[test]
    fn html_content_detect_doctype_and_html() {
        assert!(looks_like_html("<!DOCTYPE html><html></html>"));
        assert!(looks_like_html(
            "  \n\t<!doctype HTML SYSTEM \"about:legacy\">"
        ));
        assert!(looks_like_html("<html lang=\"en\">"));
        assert!(looks_like_html("\u{feff}<html>"));
        assert!(!looks_like_html("<h1>not a full doc</h1>"));
        assert!(!looks_like_html("# markdown"));
        assert!(!looks_like_html("<htmlish>"));
    }

    #[test]
    fn detect_prefers_path_over_content() {
        // .md path stays markdown even if content looks like HTML.
        assert_eq!(
            detect_document_kind(Some(Path::new("notes.md")), "<!DOCTYPE html><html>"),
            DocumentKind::Markdown
        );
        assert_eq!(
            detect_document_kind(Some(Path::new("page.html")), "<p>x</p>"),
            DocumentKind::Html
        );
        assert_eq!(
            detect_document_kind(None, "<!DOCTYPE html><html><body>x</body></html>"),
            DocumentKind::Html
        );
        assert_eq!(
            detect_document_kind(Some(Path::new("config.json")), "{}"),
            DocumentKind::Json
        );
    }
}
