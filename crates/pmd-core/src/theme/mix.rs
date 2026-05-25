pub fn parse_hex(h: &str) -> Option<(u8, u8, u8)> {
    // Strip at most one leading `#`. `trim_start_matches` previously stripped
    // any number of `#`s, so a malformed value like `##123456` would parse
    // ok and then be emitted verbatim into CSS as `##123456` — which the
    // browser rejects. Require the canonical `#RRGGBB` (or bare `RRGGBB`).
    let h = h.strip_prefix('#').unwrap_or(h);
    // Require exactly 6 ASCII hex bytes so byte-indexed slicing below cannot
    // land inside a multi-byte UTF-8 codepoint and panic.
    if h.len() != 6 || !h.is_ascii() {
        return None;
    }
    let r = u8::from_str_radix(&h[0..2], 16).ok()?;
    let g = u8::from_str_radix(&h[2..4], 16).ok()?;
    let b = u8::from_str_radix(&h[4..6], 16).ok()?;
    Some((r, g, b))
}

pub fn mix(a: (u8, u8, u8), b: (u8, u8, u8), t: f64) -> (u8, u8, u8) {
    let lerp = |x: u8, y: u8| ((x as f64) * (1.0 - t) + (y as f64) * t).round() as u8;
    (lerp(a.0, b.0), lerp(a.1, b.1), lerp(a.2, b.2))
}

pub fn to_hex(c: (u8, u8, u8)) -> String {
    format!("#{:02x}{:02x}{:02x}", c.0, c.1, c.2)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_hex_accepts_six_ascii_hex_chars() {
        assert_eq!(parse_hex("#ff8800"), Some((0xff, 0x88, 0x00)));
        assert_eq!(parse_hex("aabbcc"), Some((0xaa, 0xbb, 0xcc)));
    }

    #[test]
    fn parse_hex_rejects_non_ascii_six_byte_string() {
        // Each "€" is three UTF-8 bytes, so "€€" has length 6 but is not
        // ASCII; a naive byte slice would panic mid-codepoint.
        assert_eq!(parse_hex("€€"), None);
    }

    #[test]
    fn parse_hex_rejects_wrong_length() {
        assert_eq!(parse_hex("#fff"), None);
        assert_eq!(parse_hex("#fffffff"), None);
        assert_eq!(parse_hex(""), None);
    }

    #[test]
    fn parse_hex_rejects_non_hex_chars() {
        assert_eq!(parse_hex("zzzzzz"), None);
    }

    #[test]
    fn parse_hex_rejects_multiple_leading_hashes() {
        // Only one `#` may be stripped; a doubled prefix is not a valid CSS
        // hex colour and must be rejected by validation.
        assert_eq!(parse_hex("##abcdef"), None);
    }
}
