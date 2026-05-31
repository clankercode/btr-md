use pmd_core::emit::render_string;
use pmd_core::incremental::render_incremental;
use proptest::prelude::*;

fn strip_block_attr(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let needle = " data-pmd-block=\"";
    let mut i = 0;
    while let Some(p) = html[i..].find(needle) {
        let s = i + p;
        out.push_str(&html[i..s]);
        let after = s + needle.len();
        let end = html[after..]
            .find('"')
            .map(|q| after + q + 1)
            .unwrap_or(html.len());
        i = end;
    }
    out.push_str(&html[i..]);
    out
}

// Compare html with each render's own per-render nonce normalized away,
// and data-pmd-block attrs stripped (only present in incremental path).
fn norm(r: &pmd_core::emit::RenderResult) -> String {
    strip_block_attr(&r.html.replace(&r.render_nonce, "NONCE"))
}

// A markdown generator that avoids fallback triggers (no raw HTML, footnotes,
// or reference-link definitions) so the incremental fast path is exercised.
fn block_strategy() -> impl Strategy<Value = String> {
    let inline = prop::collection::vec(
        prop_oneof![
            "[a-zA-Z0-9 ]{1,20}",
            "[a-zA-Z0-9 ]{0,8}".prop_map(|s| format!("**{s}**")),
            "[a-zA-Z0-9 ]{0,8}".prop_map(|s| format!("*{s}*")),
            "[a-zA-Z0-9 ]{0,8}".prop_map(|s| format!("`{s}`")),
            Just("$x^2$".to_string()),
        ],
        1..6,
    )
    .prop_map(|parts| parts.join(" "));

    prop_oneof![
        inline.clone(),
        inline.clone().prop_map(|s| format!("# {s}")),
        inline.clone().prop_map(|s| format!("> {s}")),
        inline.clone().prop_map(|s| format!("- {s}\n- more")),
        Just("```rust\nfn main() {}\n```".to_string()),
        Just("| a | b |\n|---|---|\n| 1 | 2 |".to_string()),
        Just("---".to_string()),
    ]
}

fn doc_strategy() -> impl Strategy<Value = String> {
    prop::collection::vec(block_strategy(), 1..12).prop_map(|blocks| {
        let mut s = blocks.join("\n\n");
        s.push('\n');
        s
    })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(400))]

    #[test]
    fn incremental_matches_full(md in doc_strategy()) {
        let inc = render_incremental(&md);
        let full = render_string(&md);
        prop_assert_eq!(norm(&inc), norm(&full));
        prop_assert_eq!(&inc.source_map, &full.source_map);
    }

    #[test]
    fn incremental_matches_full_after_edit(
        md in doc_strategy(),
        extra in block_strategy(),
    ) {
        let _ = render_incremental(&md); // warm cache
        let edited = format!("{md}\n{extra}\n");
        let inc = render_incremental(&edited);
        let full = render_string(&edited);
        prop_assert_eq!(norm(&inc), norm(&full));
        prop_assert_eq!(&inc.source_map, &full.source_map);
    }
}
