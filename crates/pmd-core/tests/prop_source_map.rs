use pmd_core::emit::render_string;
use proptest::prelude::*;

proptest! {
    #[test]
    fn source_map_entries_are_valid_pairs(s in "[\\x20-\\x7E\n]{0,2048}") {
        let r = render_string(&s);
        for (a, b) in &r.source_map {
            prop_assert!(*a <= *b, "start {} should be <= end {}", *a, *b);
            prop_assert!(*b <= 10000, "end {} seems unreasonably large", *b);
        }
    }

    #[test]
    fn sanitizer_never_emits_script(s in "(?s)[\\PC\n]{0,2048}") {
        let r = render_string(&s);
        let cleaned = pmd_core::sanitize::clean(&r.html);
        prop_assert!(!cleaned.to_ascii_lowercase().contains("<script"));
    }
}
