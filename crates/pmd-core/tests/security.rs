use pmd_core::emit::render_string;
use pmd_core::sanitize::{clean, clean_with_render_nonce};

fn render(md: &str) -> String {
    render_string(md).html
}

#[test]
fn javascript_url_stripped_from_anchor() {
    let out = render("[click](javascript:alert(1))");
    assert!(
        !out.to_ascii_lowercase().contains("javascript:"),
        "javascript: URL survived: {out}"
    );
}

#[test]
fn data_url_stripped_from_anchor() {
    let out = render("[click](data:text/html,<script>alert(1)</script>)");
    assert!(
        !out.contains("data:text/html"),
        "data:text/html survived on anchor: {out}"
    );
    assert!(
        !out.to_ascii_lowercase().contains("<script"),
        "script tag survived: {out}"
    );
}

#[test]
fn asset_url_stripped_from_anchor() {
    let out = render("[click](asset:///etc/passwd)");
    assert!(
        !out.contains("asset:"),
        "asset: URL survived on anchor: {out}"
    );
}

#[test]
fn data_text_html_stripped_from_image() {
    let out = render("![x](data:text/html,<script>alert(1)</script>)");
    assert!(
        !out.contains("data:text/html"),
        "data:text/html survived on img: {out}"
    );
    assert!(
        !out.to_ascii_lowercase().contains("<script"),
        "script tag survived: {out}"
    );
}

#[test]
fn safe_data_image_png_preserved_on_image() {
    let pixel = "data:image/png;base64,iVBORw0KGgo=";
    let out = render(&format!("![x]({pixel})"));
    assert!(out.contains(pixel), "safe data:image/png stripped: {out}");
}

#[test]
fn remote_http_image_stripped() {
    let out = render("![x](http://example.com/evil.png)");
    assert!(
        !out.contains("http://example.com"),
        "remote http image survived: {out}"
    );
}

#[test]
fn protocol_relative_image_stripped() {
    let out = render("![x](//host/x.png)");
    assert!(
        !out.contains("//host/x.png"),
        "protocol-relative image survived: {out}"
    );
}

#[test]
fn backslash_network_path_raw_image_src_stripped() {
    let out = clean(r#"<img src="\\host\x.png">"#);
    assert!(
        !out.contains("src="),
        "backslash network-path raw image src survived: {out}"
    );
    assert!(
        !out.contains(r#"\\host\x.png"#),
        "backslash network-path raw image URL survived: {out}"
    );
}

#[test]
fn backslash_network_path_markdown_image_src_stripped() {
    let out = render(r#"![x](<\\\host\x.png>)"#);
    assert!(
        !out.contains("src="),
        "backslash network-path markdown image src survived: {out}"
    );
    assert!(
        !out.contains(r#"\\host\x.png"#),
        "backslash network-path markdown image URL survived: {out}"
    );
}

#[test]
fn mixed_slash_backslash_network_path_image_srcs_stripped() {
    for src in [r#"/\host/x.png"#, r#"\/host/x.png"#] {
        let out = clean(&format!(r#"<img src="{src}">"#));
        assert!(
            !out.contains("src="),
            "mixed slash/backslash network-path image src survived for {src}: {out}"
        );
    }
}

#[test]
fn leading_whitespace_control_backslash_network_path_image_src_stripped() {
    let out = clean("<img src=\" \t\n\u{0001}\\\\host\\x.png\">");
    assert!(
        !out.contains("src="),
        "backslash network-path image src with leading whitespace/control survived: {out}"
    );
    assert!(
        !out.contains(r#"\\host\x.png"#),
        "backslash network-path image URL with leading whitespace/control survived: {out}"
    );
}

#[test]
fn image_html_in_alt_rendered_as_attribute_text() {
    let out = render("![<script>alert(1)</script>](rel.png)");
    assert!(
        !out.to_ascii_lowercase().contains("<script"),
        "alt-text HTML survived as live DOM: {out}"
    );
    // The escaped alt text should appear inside an alt="..." attribute, not
    // as a body child of the document.
    assert!(out.contains("alt="), "img alt attribute missing: {out}");
}

#[test]
fn formatted_image_alt_does_not_emit_empty_inline_nodes() {
    let out = render("![**bold** *em*](rel.png)");
    assert!(
        !out.contains("<strong></strong>"),
        "empty strong leaked from formatted alt text: {out}"
    );
    assert!(
        !out.contains("<em></em>"),
        "empty em leaked from formatted alt text: {out}"
    );
    assert!(
        out.contains(r#"alt="bold em""#),
        "formatted alt text was not collected into img alt: {out}"
    );
}

#[test]
fn code_block_containing_dollar_math_not_rendered_as_katex() {
    let md = "```js\nlet x = $E=mc^2$;\n```";
    let out = render(md);
    assert!(
        !out.contains("math-inline"),
        "code-block content triggered math-inline: {out}"
    );
    assert!(
        !out.contains("language-math"),
        "code-block content triggered language-math: {out}"
    );
    assert!(
        out.contains("$E=mc^2$"),
        "literal dollar math missing from code block: {out}"
    );
}

#[test]
fn indented_code_containing_dollar_math_not_rendered_as_katex() {
    let md = "    let x = $E=mc^2$;";
    let out = render(md);
    assert!(
        !out.contains("math-inline"),
        "indented code content triggered math-inline: {out}"
    );
    assert!(
        !out.contains("language-math"),
        "indented code content triggered language-math: {out}"
    );
    assert!(
        !out.contains("math-block"),
        "indented code content triggered math-block: {out}"
    );
    assert!(
        out.contains("$E=mc^2$"),
        "literal dollar math missing from indented code block: {out}"
    );
}

#[test]
fn trusted_mermaid_fence_carries_render_nonce_marker() {
    let result = render_string("```mermaid\ngraph TD; A-->B\n```");
    assert!(
        !result.render_nonce.is_empty(),
        "render nonce was empty: {result:?}"
    );
    assert!(
        result
            .html
            .contains(&format!(r#"data-pmd-nonce="{}""#, result.render_nonce)),
        "trusted mermaid fence did not carry current render nonce: {result:?}"
    );
}

#[test]
fn raw_mermaid_div_does_not_carry_renderer_attrs() {
    let raw = r#"<div class="pmd-mermaid" data-mermaid-source="graph TD; A--&gt;B">x</div>"#;
    let out = clean(raw);
    assert!(
        !out.contains("pmd-mermaid"),
        "pmd-mermaid class survived raw HTML: {out}"
    );
    assert!(
        !out.contains("data-mermaid-source"),
        "data-mermaid-source survived raw HTML: {out}"
    );
}

#[test]
fn raw_mermaid_language_code_does_not_carry_render_nonce_marker() {
    let raw = r#"<pre><code class="language-mermaid" data-pmd-nonce="attacker">graph TD; A--&gt;B</code></pre>"#;
    let out = clean(raw);
    assert!(
        !out.contains("data-pmd-nonce"),
        "raw mermaid language code carried render nonce marker: {out}"
    );
}

#[test]
fn matching_render_nonce_on_untrusted_elements_is_stripped() {
    let nonce = "0123456789abcdef0123456789abcdef";
    let raw = format!(
        r#"<div data-pmd-nonce="{nonce}">x</div><div class="language-mermaid" data-pmd-nonce="{nonce}">y</div><code data-pmd-nonce="{nonce}">z</code>"#
    );
    let out = clean_with_render_nonce(&raw, nonce);
    assert!(
        !out.contains("data-pmd-nonce"),
        "matching render nonce survived on untrusted elements: {out}"
    );
}

#[test]
fn matching_render_nonce_is_preserved_on_trusted_code_shapes() {
    let nonce = "0123456789abcdef0123456789abcdef";
    for class in ["language-mermaid", "language-math", "math-block"] {
        let raw = format!(r#"<code class="{class}" data-pmd-nonce="{nonce}">x</code>"#);
        let out = clean_with_render_nonce(&raw, nonce);
        assert!(
            out.contains(&format!(r#"data-pmd-nonce="{nonce}""#)),
            "matching render nonce stripped from trusted {class} code: {out}"
        );
    }
    let out = clean_with_render_nonce(
        &format!(r#"<code data-pmd-nonce="{nonce}" class="language-math">x</code>"#),
        nonce,
    );
    assert!(
        out.contains(&format!(r#"data-pmd-nonce="{nonce}""#)),
        "matching render nonce stripped when trusted class followed nonce: {out}"
    );
}

#[test]
fn raw_math_span_does_not_carry_renderer_attrs() {
    let raw =
        r#"<span class="math-inline" data-math-source="\\href{javascript:alert(1)}{x}">x</span>"#;
    let out = clean(raw);
    assert!(
        !out.contains("math-inline"),
        "math-inline class survived raw HTML: {out}"
    );
    assert!(
        !out.contains("data-math-source"),
        "data-math-source survived raw HTML: {out}"
    );
}

#[test]
fn raw_language_math_code_does_not_carry_render_nonce_marker() {
    let raw = r#"<code class="language-math" data-pmd-nonce="attacker">x</code>"#;
    let out = clean(raw);
    assert!(
        !out.contains("data-pmd-nonce"),
        "raw language-math code carried render nonce marker: {out}"
    );
}

#[test]
fn raw_math_block_code_does_not_carry_render_nonce_marker() {
    let raw = r#"<code class="math-block" data-pmd-nonce="attacker">x</code>"#;
    let out = clean(raw);
    assert!(
        !out.contains("data-pmd-nonce"),
        "raw math-block code carried render nonce marker: {out}"
    );
}

#[test]
fn raw_math_display_does_not_carry_renderer_attrs() {
    let raw = r#"<span class="math-display pmd-math" data-math-source="x">x</span>"#;
    let out = clean(raw);
    assert!(
        !out.contains("math-display"),
        "math-display class survived raw HTML: {out}"
    );
    assert!(
        !out.contains("pmd-math"),
        "pmd-math class survived raw HTML: {out}"
    );
    assert!(
        !out.contains("data-math-source"),
        "data-math-source survived raw HTML: {out}"
    );
}

#[test]
fn safe_anchor_schemes_preserved() {
    let out = render("[a](https://example.com) [b](mailto:x@y) [c](relative.md)");
    assert!(out.contains("https://example.com"), "https stripped: {out}");
    assert!(out.contains("mailto:x@y"), "mailto stripped: {out}");
    assert!(out.contains("relative.md"), "relative stripped: {out}");
}

#[test]
fn code_fence_with_html_dollar_math_no_katex_artifacts() {
    let md = "```\nrun $alert(1)$ now\n```";
    let out = render(md);
    assert!(
        !out.contains("language-math"),
        "language-math leaked into plain code fence: {out}"
    );
}
