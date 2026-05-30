//! GitHub-alert + footnote rendering (Phase 4). Structural + security
//! assertions (golden files are avoided because the exact `data-src-*` offsets
//! are brittle; these check the invariants that matter).

use pmd_core::emit;

fn render(md: &str) -> String {
    emit::render_string(md).html
}

#[test]
fn note_alert_gets_class_title_and_strips_marker() {
    let html = render("> [!NOTE]\n> Body text here.\n");
    assert!(
        html.contains("class=\"pmd-alert pmd-alert-note\""),
        "missing alert class: {html}"
    );
    assert!(
        html.contains("<p class=\"pmd-alert-title\">Note</p>"),
        "missing alert title: {html}"
    );
    assert!(html.contains("Body text here."), "missing body: {html}");
    assert!(!html.contains("[!NOTE]"), "marker not stripped: {html}");
}

#[test]
fn all_five_alert_kinds_render() {
    for (marker, slug, label) in [
        ("NOTE", "note", "Note"),
        ("TIP", "tip", "Tip"),
        ("IMPORTANT", "important", "Important"),
        ("WARNING", "warning", "Warning"),
        ("CAUTION", "caution", "Caution"),
    ] {
        let html = render(&format!("> [!{marker}]\n> Body.\n"));
        assert!(
            html.contains(&format!("pmd-alert-{slug}")),
            "{marker}: missing pmd-alert-{slug}: {html}"
        );
        assert!(
            html.contains(&format!("<p class=\"pmd-alert-title\">{label}</p>")),
            "{marker}: missing title {label}: {html}"
        );
    }
}

#[test]
fn plain_blockquote_is_not_an_alert() {
    let html = render("> Just a normal quote.\n");
    assert!(html.contains("<blockquote"), "{html}");
    assert!(
        !html.contains("pmd-alert"),
        "plain quote got alert class: {html}"
    );
    assert!(html.contains("Just a normal quote."), "{html}");
}

#[test]
fn marker_with_trailing_text_is_not_an_alert() {
    // GitHub requires the marker alone on the first line.
    let html = render("> [!NOTE] this is not a marker line\n");
    assert!(!html.contains("pmd-alert"), "{html}");
}

#[test]
fn alert_body_is_still_sanitized() {
    // The alert path must not bypass the sanitizer.
    let html = render("> [!WARNING]\n> Be careful <script>alert(1)</script> and **bold**.\n");
    assert!(
        !html.contains("<script>"),
        "script survived in alert: {html}"
    );
    assert!(html.contains("pmd-alert-warning"), "{html}");
    assert!(
        html.contains("<strong>bold</strong>"),
        "bold not rendered: {html}"
    );
}

#[test]
fn footnote_reference_and_definition_render_as_section() {
    let html = render("Text with a note[^1].\n\n[^1]: The footnote body.\n");
    // Reference: numbered superscript linking to the definition. (ammonia
    // injects rel="noopener noreferrer" on anchors, so assert pieces.)
    assert!(
        html.contains("class=\"pmd-fnref\""),
        "missing fnref class: {html}"
    );
    assert!(html.contains("id=\"fnref-1\""), "missing fnref id: {html}");
    assert!(html.contains("href=\"#fn-1\""), "missing ref link: {html}");
    assert!(html.contains(">1</a></sup>"), "missing ref number: {html}");
    // Definition rendered in a back-linked footnotes section.
    assert!(
        html.contains("<section class=\"pmd-footnotes\""),
        "missing section: {html}"
    );
    assert!(
        html.contains("<li id=\"fn-1\">"),
        "missing definition li: {html}"
    );
    assert!(html.contains("The footnote body."), "missing body: {html}");
    assert!(
        html.contains("href=\"#fnref-1\""),
        "missing back-link: {html}"
    );
}

#[test]
fn footnotes_are_numbered_by_reference_order() {
    let html = render("First[^a] then second[^b].\n\n[^a]: Alpha.\n[^b]: Beta.\n");
    assert!(
        html.contains("href=\"#fn-1\"") && html.contains(">1</a>"),
        "{html}"
    );
    assert!(
        html.contains("href=\"#fn-2\"") && html.contains(">2</a>"),
        "{html}"
    );
    // Alpha (ref 1) precedes Beta (ref 2) in the section.
    let alpha = html.find("Alpha.").expect("alpha");
    let beta = html.find("Beta.").expect("beta");
    assert!(alpha < beta, "footnotes out of order: {html}");
}

#[test]
fn footnote_definition_is_not_emitted_inline() {
    // The definition body must live only in the section, not where it appeared.
    let html = render("Body paragraph.\n\n[^1]: hidden inline?\n\nText[^1].\n");
    let section = html.find("pmd-footnotes").expect("section present");
    let inline = html.find("hidden inline?").expect("body present");
    // The only occurrence of the body text is within the section.
    assert!(
        inline > section || html.matches("hidden inline?").count() == 1,
        "{html}"
    );
}
