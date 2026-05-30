//! Persisted, UI-visible lifecycle policy enums.
//!
//! These are serialised both into the settings file (`state.toml`, via the
//! `state::settings::Settings` struct) and across IPC to the frontend, which
//! mirrors them as TS string-literal unions. `rename_all = "snake_case"` fixes
//! the wire spelling so the mirror stays in lockstep.
//!
//! Defaults preserve today's behaviour exactly:
//! - autosave: **off** (saving is explicit)
//! - autoreload: **when clean** (auto-pull external changes only over a clean
//!   buffer — what the old `file_changed_on_disk` handler did)
//! - merge: **raise conflict** (never silently munge the user's edits)
//! - race: **defer** (the only policy implemented; the seam exists for later)

use serde::{Deserialize, Serialize};

/// When the buffer is automatically written back to disk.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutosaveMode {
    /// Never autosave (the default; saving is an explicit user action).
    #[default]
    Off,
    /// Save after a short idle following the last edit.
    OnIdle,
    /// Save when the window/editor loses focus.
    OnDefocus,
    /// Save on a fixed wall-clock interval.
    OnInterval,
}

/// When an external change is automatically pulled into the buffer.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutoreloadMode {
    /// Never auto-reload; always surface a prompt.
    Off,
    /// Auto-reload only when the buffer has no unsaved edits (today's
    /// behaviour, the default).
    #[default]
    WhenClean,
    /// Always auto-reload, discarding unsaved edits (dangerous; opt-in).
    Always,
}

/// How a disk-vs-memory conflict is resolved when a merge is run (either
/// automatically per [`AutoreloadMode`] or via the Merge button).
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MergeStrategy {
    /// Run a 3-way merge; if it conflicts, surface conflict markers and let the
    /// user resolve. The default — never silently lose edits.
    #[default]
    RaiseConflict,
    /// Same merge, raising conflict markers, but intended to be applied
    /// automatically rather than via an explicit Merge click.
    AutoMergeRaise,
    /// Run a 3-way merge; on conflict accept the marked output inline ("munge")
    /// instead of blocking.
    AutoMergeMunge,
    /// Keep the in-memory buffer, discard the disk change.
    IgnoreDisk,
    /// Take the disk content, discard local edits.
    TakeDisk,
}

/// Policy for resolving save/disk races. Only [`RacePolicy::Defer`] exists in
/// v1; the enum is the seam that keeps future race handling type-routed.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RacePolicy {
    /// Log the race and take no action (the buffer/disk are reconciled by the
    /// normal save-completion transition).
    #[default]
    Defer,
}
