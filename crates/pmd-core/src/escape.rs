/// Append `s` to `out`, HTML-escaping `&`, `<`, `>`, and `"` in a single pass.
///
/// Equivalent to the old `s.replace('&', "&amp;").replace('<', "&lt;")…` chain
/// but with one pass and no intermediate allocations. Order matches the chain:
/// `&` is escaped to `&amp;` and the entities we emit contain no `<`, `>`, or
/// `"`, so the output is byte-identical. The matched bytes are all ASCII, so
/// slicing on their offsets never splits a multi-byte char.
pub fn escape_html_into(out: &mut String, s: &str) {
    let mut last = 0;
    for (i, byte) in s.bytes().enumerate() {
        let replacement: &str = match byte {
            b'&' => "&amp;",
            b'<' => "&lt;",
            b'>' => "&gt;",
            b'"' => "&quot;",
            _ => continue,
        };
        out.push_str(&s[last..i]);
        out.push_str(replacement);
        last = i + 1;
    }
    out.push_str(&s[last..]);
}

pub fn escape_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    escape_html_into(&mut out, s);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // Reference implementation: the original sequential replace chain. The
    // single-pass version must match it byte-for-byte for all inputs.
    fn escape_reference(s: &str) -> String {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
    }

    #[test]
    fn escapes_each_special_char() {
        assert_eq!(escape_html("a & b"), "a &amp; b");
        assert_eq!(escape_html("a < b"), "a &lt; b");
        assert_eq!(escape_html("a > b"), "a &gt; b");
        assert_eq!(escape_html("say \"hi\""), "say &quot;hi&quot;");
    }

    #[test]
    fn does_not_double_escape_entities() {
        // `&` is escaped to `&amp;`; the emitted entities must not be re-escaped.
        assert_eq!(escape_html("<a href=\"x&y\">"), "&lt;a href=&quot;x&amp;y&quot;&gt;");
    }

    #[test]
    fn leaves_plain_and_unicode_text_untouched() {
        assert_eq!(escape_html("plain text 123"), "plain text 123");
        assert_eq!(escape_html("café — π ✓ 日本語"), "café — π ✓ 日本語");
    }

    #[test]
    fn empty_input() {
        assert_eq!(escape_html(""), "");
    }

    #[test]
    fn matches_reference_on_mixed_and_adjacent_specials() {
        for s in [
            "",
            "&&&",
            "<<>>",
            "\"\"\"",
            "&<>\"",
            "a&b<c>d\"e",
            "<script>alert(\"x\" & 'y')</script>",
            "no specials here",
            "unicode π & <ok>",
            "trailing &",
            "& leading",
        ] {
            assert_eq!(escape_html(s), escape_reference(s), "mismatch for {s:?}");
        }
    }

    #[test]
    fn into_appends_without_clearing() {
        let mut out = String::from("PREFIX:");
        escape_html_into(&mut out, "a<b");
        assert_eq!(out, "PREFIX:a&lt;b");
    }
}
