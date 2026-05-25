pub mod allowlist;
use std::sync::OnceLock;

static BUILDER: OnceLock<ammonia::Builder<'static>> = OnceLock::new();

pub fn clean(html: &str) -> String {
    let b = BUILDER.get_or_init(allowlist::build);
    b.clean(html).to_string()
}

pub fn clean_with_render_nonce(html: &str, render_nonce: &str) -> String {
    let b = allowlist::build_with_render_nonce(render_nonce);
    b.clean(html).to_string()
}
