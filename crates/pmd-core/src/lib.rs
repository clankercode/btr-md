//! pmd-core: pure markdown pipeline + theme parsing for preview-md.
//! No I/O, no async. Tests live in tests/.

#![forbid(unsafe_code)]
#![warn(clippy::all)]

pub mod emit;
pub mod parse;
pub mod sanitize;
pub mod source_map;
pub mod theme;

pub use emit::RenderResult;
