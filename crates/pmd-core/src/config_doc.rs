//! Structured preview for config-ish documents (JSON / YAML / TOML / INI).
//!
//! Not the markdown pipeline: content is always HTML-escaped and shown in a
//! `<pre><code>` block (optionally pretty-printed). Parse errors surface as a
//! non-executable alert banner; nothing is evaluated.

use crate::document_kind::DocumentKind;
use crate::emit::{generate_render_nonce, RenderResult};
use crate::escape::escape_html;
use crate::facts::counts::{add_word_count, finalize_counts};
use crate::facts::CoreDocumentFacts;

/// Render a config document for the live preview.
pub fn render_config_document(kind: DocumentKind, source: &str) -> RenderResult {
    debug_assert!(
        kind.is_config(),
        "render_config_document called with non-config kind {kind:?}"
    );
    let render_nonce = generate_render_nonce();
    let (display, parse_error) = prepare_display(kind, source);
    let html = config_preview_html(kind, &display, parse_error.as_deref());

    let mut facts = CoreDocumentFacts::empty();
    facts.counts.bytes = source.len().try_into().unwrap_or(u32::MAX);
    add_word_count(&mut facts, source);
    facts.counts.sentences = source
        .chars()
        .filter(|c| matches!(c, '.' | '!' | '?'))
        .count()
        .try_into()
        .unwrap_or(u32::MAX);
    finalize_counts(&mut facts);

    RenderResult {
        version: 0,
        html,
        source_map: Vec::new(),
        render_nonce,
        blocks: Vec::new(),
        facts,
    }
}

fn prepare_display(kind: DocumentKind, source: &str) -> (String, Option<String>) {
    match kind {
        DocumentKind::Json => match serde_json::from_str::<serde_json::Value>(source) {
            Ok(value) => match serde_json::to_string_pretty(&value) {
                Ok(pretty) => (pretty, None),
                Err(e) => (
                    source.to_string(),
                    Some(format!("JSON re-serialize failed: {e}")),
                ),
            },
            Err(e) => (source.to_string(), Some(format!("Invalid JSON: {e}"))),
        },
        DocumentKind::Yaml => match yaml_rust2::YamlLoader::load_from_str(source) {
            Ok(_docs) => {
                // Keep author formatting; we only validate parseability.
                (source.to_string(), None)
            }
            Err(e) => (source.to_string(), Some(format!("Invalid YAML: {e}"))),
        },
        DocumentKind::Toml => match source.parse::<toml::Value>() {
            Ok(value) => match toml::to_string_pretty(&value) {
                Ok(pretty) => (pretty, None),
                Err(e) => (
                    source.to_string(),
                    Some(format!("TOML re-serialize failed: {e}")),
                ),
            },
            Err(e) => (source.to_string(), Some(format!("Invalid TOML: {e}"))),
        },
        DocumentKind::Ini => {
            // No dedicated parser in-tree; show escaped text as-is.
            (source.to_string(), None)
        }
        DocumentKind::Markdown | DocumentKind::Html => (
            source.to_string(),
            Some("internal: not a config kind".into()),
        ),
    }
}

fn config_preview_html(kind: DocumentKind, body: &str, parse_error: Option<&str>) -> String {
    let kind_s = kind.as_str();
    let mut out = String::with_capacity(body.len() + 256);
    out.push_str("<div class=\"pmd-config-doc\" data-pmd-kind=\"");
    out.push_str(kind_s);
    out.push_str("\">");
    if let Some(err) = parse_error {
        out.push_str("<div class=\"pmd-config-error\" role=\"alert\">");
        out.push_str(&escape_html(err));
        out.push_str("</div>");
    }
    out.push_str("<pre class=\"pmd-config-pre\"><code class=\"language-");
    out.push_str(kind_s);
    out.push_str("\">");
    out.push_str(&escape_html(body));
    out.push_str("</code></pre></div>");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_pretty_and_escaped() {
        let r = render_config_document(DocumentKind::Json, r#"{"b":1,"a":"<script>"}"#);
        assert!(r.html.contains("pmd-config-doc"), "{}", r.html);
        assert!(r.html.contains("&lt;script&gt;"), "escaped: {}", r.html);
        assert!(!r.html.contains("<script>"), "{}", r.html);
        // Quotes in the pretty JSON are HTML-escaped inside <code>.
        assert!(r.html.contains("&quot;a&quot;"), "{}", r.html);
        assert!(r.blocks.is_empty());
    }

    #[test]
    fn json_invalid_shows_error_and_raw() {
        let r = render_config_document(DocumentKind::Json, "{nope");
        assert!(r.html.contains("pmd-config-error"), "{}", r.html);
        assert!(r.html.contains("Invalid JSON"), "{}", r.html);
        assert!(r.html.contains("{nope"), "{}", r.html);
    }

    #[test]
    fn yaml_valid_and_invalid() {
        let ok = render_config_document(DocumentKind::Yaml, "a: 1\nb: two\n");
        assert!(ok.html.contains("a: 1"), "{}", ok.html);
        assert!(!ok.html.contains("pmd-config-error"), "{}", ok.html);

        // Tab after indent marker is a classic YAML parse error.
        let bad = render_config_document(DocumentKind::Yaml, "a:\n\t- bad tab indent");
        assert!(
            bad.html.contains("pmd-config-error") || bad.html.contains("Invalid YAML"),
            "{}",
            bad.html
        );
    }

    #[test]
    fn toml_pretty() {
        let r = render_config_document(DocumentKind::Toml, "b=1\na=\"x\"");
        assert!(r.html.contains("pmd-config-doc"), "{}", r.html);
        assert!(!r.html.contains("pmd-config-error"), "{}", r.html);
    }

    #[test]
    fn ini_is_escaped_pre() {
        let r = render_config_document(DocumentKind::Ini, "[sec]\nkey=<val>");
        assert!(r.html.contains("language-ini"), "{}", r.html);
        assert!(r.html.contains("&lt;val&gt;"), "{}", r.html);
        assert!(!r.html.contains("<val>"), "{}", r.html);
    }
}
