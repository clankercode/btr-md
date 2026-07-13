//! pmd-core: pure markdown pipeline + theme parsing for btr-md.
//! No I/O, no async. Tests live in tests/.

#![forbid(unsafe_code)]
#![warn(clippy::all)]

pub mod config_doc;
pub mod document_kind;
pub mod emit;
pub mod escape;
pub mod facts;
pub mod html;
pub mod incremental;
pub mod parse;
pub mod sanitize;
pub mod source_map;
pub mod theme;

pub use config_doc::render_config_document;
pub use document_kind::{detect_document_kind, looks_like_html, DocumentKind};
pub use emit::RenderResult;
pub use html::{
    render_html_document, render_html_document_with_options, HtmlRenderExtras, HtmlRenderOptions,
};
