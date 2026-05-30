//! Type-backed file-lifecycle model (Phase 1 foundation).
//!
//! - [`state`]   — the `FileState`/`DocEvent` state machine (compile-fail exhaustive).
//! - [`modes`]   — persisted autosave/autoreload/merge/race policy enums.
//! - [`merge`]   — 3-way merge (in-memory only; never writes disk).
//! - [`race`]    — typed save/disk race seam (Defer stub).
//! - [`registry`]— the per-`DocId` registry + `active`-doc save authority.

pub mod merge;
pub mod modes;
pub mod race;
pub mod registry;
pub mod state;

pub use modes::{AutoreloadMode, AutosaveMode, MergeStrategy, RacePolicy};
pub use registry::{DiskEvent, DocEntry, DocRegistry};
pub use state::{Digest, DocEvent, DocId, FileState};
