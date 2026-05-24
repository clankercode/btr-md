mod helpers;

use std::collections::BTreeMap;

use helpers::WebDriverSession;

struct RequiredDirective {
    name: &'static str,
    values: &'static [&'static str],
    allow_extra_values: bool,
}

const REQUIRED_CSP_DIRECTIVES: &[RequiredDirective] = &[
    RequiredDirective {
        name: "default-src",
        values: &["'self'"],
        allow_extra_values: false,
    },
    RequiredDirective {
        name: "script-src",
        values: &["'self'", "'wasm-unsafe-eval'"],
        allow_extra_values: true,
    },
    RequiredDirective {
        name: "style-src",
        values: &["'self'", "'unsafe-inline'"],
        allow_extra_values: true,
    },
    RequiredDirective {
        name: "img-src",
        values: &["'self'", "data:", "asset:", "http://asset.localhost"],
        allow_extra_values: true,
    },
    RequiredDirective {
        name: "connect-src",
        values: &["'self'", "ipc:", "http://ipc.localhost"],
        allow_extra_values: true,
    },
    RequiredDirective {
        name: "object-src",
        values: &["'none'"],
        allow_extra_values: false,
    },
    RequiredDirective {
        name: "frame-src",
        values: &["'none'"],
        allow_extra_values: false,
    },
    RequiredDirective {
        name: "base-uri",
        values: &["'self'"],
        allow_extra_values: false,
    },
];

const SMOKE_SCREENSHOT_PATH: &str = "tests/screenshots/run-smoke/window.png";

#[test]
fn smoke_window_opens_renders_app_text_and_emits_required_csp() {
    let session = WebDriverSession::new().expect("open WebDriver session");

    let url = session.url().expect("read page URL");
    assert_eq!(url, "tauri://localhost", "unexpected app URL");

    let title = session.title().expect("read page title");
    assert_eq!(title, "preview-md", "unexpected page title");

    let source = session.source().expect("read page source");
    assert!(
        source.contains(r#"<main id="preview-pane""#),
        "page source missing preview pane: {source}"
    );

    session
        .screenshot_to(SMOKE_SCREENSHOT_PATH)
        .expect("write smoke screenshot");

    let csp = session.fetch_csp().expect("resolve runtime CSP");
    let directives = parse_csp(&csp).expect("parse CSP without duplicate directives");
    for required in REQUIRED_CSP_DIRECTIVES {
        let actual = directives.get(required.name).unwrap_or_else(|| {
            panic!(
                "CSP missing `{}` directive (full CSP: `{csp}`)",
                required.name
            )
        });
        if required.allow_extra_values {
            for required_value in required.values {
                assert!(
                    actual.iter().any(|v| v == required_value),
                    "CSP directive `{}` missing required value `{}` (full CSP: `{}`)",
                    required.name,
                    required_value,
                    csp
                );
            }
        } else {
            assert!(
                actual
                    .iter()
                    .map(String::as_str)
                    .eq(required.values.iter().copied()),
                "CSP directive `{}` mismatch: expected `{} {}`, got `{} {}` (full CSP: `{}`)",
                required.name,
                required.name,
                required.values.join(" "),
                required.name,
                actual.join(" "),
                csp
            );
        }
    }

    session.close().expect("close WebDriver session");
}

fn parse_csp(csp: &str) -> Result<BTreeMap<String, Vec<String>>, String> {
    let mut parsed = BTreeMap::new();
    for (index, directive) in csp.split(';').enumerate() {
        if let Some((name, values)) = {
            let mut parts = directive.split_whitespace();
            let name = parts.next();
            let values = parts.map(ToOwned::to_owned).collect::<Vec<_>>();
            name.map(|name| (name.to_owned(), values))
        } {
            if parsed.insert(name.clone(), values).is_some() {
                return Err(format!("duplicate CSP directive `{name}` at index {index}"));
            }
        }
    }
    Ok(parsed)
}
