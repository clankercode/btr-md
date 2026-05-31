//! GitHub-parity fixture corpus (Slice D). Each `<name>.md` under
//! `tests/fixtures/github-parity/` renders through the real pmd-core pipeline
//! and is locked against its `<name>.expected.html` golden. The goldens were
//! generated from the current pipeline output, so this is a *regression* lock,
//! not bit-for-bit GitHub equality — known, intentional deviations from GitHub
//! are documented in `docs/github-parity.md`.
//!
//! To regenerate a golden after an intentional renderer change, render the
//! fixture through `emit::render_string`, run the result through
//! `strip_render_nonce_attrs`, and write it to the `.expected.html` file (the
//! per-render nonce is stripped so the goldens stay deterministic).

use pmd_core::emit;

fn strip_render_nonce_attrs(s: &str) -> String {
    let attr = " data-pmd-nonce=\"";
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(start) = rest.find(attr) {
        out.push_str(&rest[..start]);
        let value = &rest[start + attr.len()..];
        let Some(end) = value.find('"') else {
            break;
        };
        rest = &value[end + 1..];
    }
    out.push_str(rest);
    out
}

fn fixture_dir() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/github-parity")
}

fn fixture_names() -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(fixture_dir())
        .expect("fixtures/github-parity dir")
        .flatten()
        .filter_map(|e| {
            e.file_name()
                .into_string()
                .ok()
                .and_then(|n| n.strip_suffix(".md").map(str::to_string))
        })
        .collect();
    names.sort();
    names
}

fn golden_one(name: &str) {
    let dir = fixture_dir();
    let md = std::fs::read_to_string(dir.join(format!("{name}.md"))).unwrap();
    let golden_path = dir.join(format!("{name}.expected.html"));
    let got = emit::render_string(&md);
    let got_html = strip_render_nonce_attrs(&got.html);
    if std::env::var_os("PMD_UPDATE_GITHUB_PARITY_GOLDENS").is_some() {
        std::fs::write(golden_path, &got_html).unwrap();
        return;
    }
    let want = std::fs::read_to_string(golden_path).unwrap();
    assert_eq!(got_html, want, "github-parity/{name}");
}

#[test]
fn all_parity_goldens_match() {
    let names = fixture_names();
    assert!(
        names.len() >= 8,
        "expected the full parity corpus: {names:?}"
    );
    for name in names {
        golden_one(&name);
    }
}

/// btr.md emits GitHub-style duplicate-heading slugs in `facts`, not as `id=`
/// attributes on the rendered headings (a documented deviation). Lock the slug
/// suffixing behaviour here since it is not visible in the HTML golden.
#[test]
fn duplicate_heading_slugs_are_suffixed() {
    let md = std::fs::read_to_string(fixture_dir().join("04-duplicate-anchors.md")).unwrap();
    let result = emit::render_string(&md);
    let slugs: Vec<&str> = result
        .facts
        .headings
        .iter()
        .map(|h| h.slug.as_str())
        .collect();
    assert_eq!(slugs, ["hello-world", "hello-world-1", "hello-world-2"]);
}

/// The raw-HTML/security fixture is btr.md's deliberate divergence from
/// GitHub: scripts, event handlers, javascript: URLs, and remote images are
/// all stripped by the sanitizer. Lock that they never survive into output.
#[test]
fn raw_html_security_deviations_are_sanitized() {
    let md = std::fs::read_to_string(fixture_dir().join("08-raw-html-security.md")).unwrap();
    assert!(md.contains("<script>"), "fixture lost script payload");
    assert!(
        md.contains("javascript:"),
        "fixture lost javascript: payload"
    );
    assert!(
        md.contains("onerror="),
        "fixture lost event-handler payload"
    );
    assert!(
        md.contains("https://example.com/remote.png"),
        "fixture lost remote image payload"
    );

    let rendered = emit::render_string(&md).html;
    let html = rendered.to_ascii_lowercase();
    assert!(html.contains("dangerous payload"), "fixture did not render");
    assert!(
        html.contains(">click</a>"),
        "safe link text was unexpectedly removed"
    );
    assert!(!html.contains("<script"), "script survived: {html}");
    assert!(
        !html.contains("javascript:"),
        "javascript: URL survived: {html}"
    );
    assert!(!html.contains("onerror"), "event handler survived: {html}");
    assert!(
        !html.contains("https://example.com/remote.png"),
        "remote image URL survived: {html}"
    );
    assert!(!html.contains("src="), "remote image src survived: {html}");
}

/// Lock the documented KaTeX fidelity gap: pulldown-cmark consumes `\,` as a
/// punctuation escape before our math emitter sees it.
#[test]
fn math_thin_space_escape_is_consumed_before_katex() {
    let md = std::fs::read_to_string(fixture_dir().join("06-math.md")).unwrap();
    assert!(md.contains(r"\,dx"), "fixture lost thin-space math command");
    let html = emit::render_string(&md).html;
    assert!(
        html.contains(r"e^{-x^2},dx"),
        "thin-space escape was not consumed as documented: {html}"
    );
    assert!(
        !html.contains(r"\,dx"),
        "thin-space escape unexpectedly survived: {html}"
    );
}
