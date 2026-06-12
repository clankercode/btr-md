//! Math content is sliced raw from the markdown source, so LaTeX commands keep
//! their single backslash even when pulldown-cmark would otherwise treat
//! `\<punct>` as a CommonMark escape and drop it. A `$…$`/`$$…$$` span split
//! across several text events by such an escape is still captured as one span.

use pmd_core::emit;

fn render(md: &str) -> String {
    emit::render_string(md).html
}

#[test]
fn inline_math_thin_space_escape_survives() {
    // `\;` (a KaTeX thin space) must reach the renderer verbatim, not as `;`.
    let html = render(r"Inline $a \; b$ done");
    assert!(
        html.contains(r"a \; b"),
        "thin-space escape stripped from inline math: {html}"
    );
    assert!(
        html.contains("language-math"),
        "inline math split by the escape failed to render as math: {html}"
    );
}

#[test]
fn block_math_single_line_escape_survives() {
    let html = render(r"$$ x = y \; z $$");
    assert!(
        html.contains(r"x = y \; z"),
        "escape stripped from single-line block math: {html}"
    );
    assert!(html.contains("math-block"), "block math did not render: {html}");
}

#[test]
fn block_math_multiline_with_less_than_and_escape() {
    // The user's reported case: multiline display math with `<` and `\;`.
    let html = render("$$\n\\; a < b\n$$\n");
    assert!(
        html.contains(r"\; a"),
        "escape stripped from multiline block math: {html}"
    );
    assert!(
        html.contains("&lt;"),
        "`<` inside block math was not preserved/escaped: {html}"
    );
}

#[test]
fn escaped_braces_inside_inline_math_survive() {
    let html = render(r"E $\{a\}$ c");
    assert!(
        html.contains(r"\{a\}"),
        "escaped braces stripped from inline math: {html}"
    );
}

#[test]
fn unterminated_inline_dollar_is_literal_not_swallowed() {
    // A lone `$` with no closer must not consume the following paragraph.
    let html = render("price is $5 today\n\nnext paragraph");
    assert!(
        html.contains("next paragraph"),
        "unterminated `$` swallowed the next block: {html}"
    );
    assert!(
        !html.contains("language-math"),
        "lone `$` wrongly rendered as math: {html}"
    );
}

#[test]
fn plain_inline_math_without_escapes_still_renders() {
    let html = render(r"see $E = mc^2$ here");
    assert!(html.contains("E = mc^2"), "plain inline math broke: {html}");
    assert!(html.contains("language-math"), "no math span emitted: {html}");
}

#[test]
fn math_inside_blockquote_first_line_keeps_escape() {
    // Blockquote first lines route through the GitHub-alert marker scan; math
    // there must still capture raw source.
    let html = render(r"> note with $a \; b$ inline");
    assert!(
        html.contains(r"a \; b"),
        "escape stripped from blockquote-first-line math: {html}"
    );
}
