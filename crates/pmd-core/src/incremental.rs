//! Block-incremental rendering: memoize sanitized HTML per top-level block,
//! keyed by block source text, falling back to whole-document render_string for
//! cross-block constructs. Output is byte-identical to render_string.

use std::sync::OnceLock;

/// A process-stable random token used as the render nonce inside cached blocks.
/// Never returned to the frontend; substituted for the real per-render nonce at
/// assembly. Random so it cannot appear in document content.
#[allow(dead_code)]
fn placeholder_nonce() -> &'static str {
    static P: OnceLock<String> = OnceLock::new();
    P.get_or_init(crate::emit::generate_render_nonce)
}
