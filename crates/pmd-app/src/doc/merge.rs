//! 3-way merge of a document against its disk version.
//!
//! **The merge only ever produces text for the in-memory buffer — it never
//! writes to disk.** The caller (`cmd::doc::resolve_disk_change`) applies the
//! result with `editor.setValue` on the frontend; persisting is always a
//! separate, explicit save. This is a hard user requirement: a merge must not
//! silently mutate the file.
//!
//! `base` is the last-loaded / last-saved text (`DocEntry::base_content`) — the
//! common ancestor that makes this a real 3-way merge rather than a 2-way
//! overwrite.

use crate::doc::modes::MergeStrategy;

/// Outcome of a merge. `Conflicted` still carries a fully-formed buffer (with
/// `<<<<<<< / ======= / >>>>>>>` markers) so the editor can show it for manual
/// resolution; the distinction tells the UI whether to flag a conflict.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum MergeOutcome {
    Clean(String),
    Conflicted { merged: String },
}

impl MergeOutcome {
    /// The buffer text to load, regardless of conflict status.
    pub fn text(&self) -> &str {
        match self {
            MergeOutcome::Clean(s) => s,
            MergeOutcome::Conflicted { merged } => merged,
        }
    }

    pub fn is_conflicted(&self) -> bool {
        matches!(self, MergeOutcome::Conflicted { .. })
    }
}

/// Resolve a disk-vs-memory divergence into a single buffer per `strat`.
///
/// Exhaustive over [`MergeStrategy`] — adding a variant forces a decision here.
pub fn three_way(base: &str, ours: &str, theirs: &str, strat: MergeStrategy) -> MergeOutcome {
    match strat {
        // Discard the disk change, keep our buffer.
        MergeStrategy::IgnoreDisk => MergeOutcome::Clean(ours.to_string()),
        // Discard local edits, take disk.
        MergeStrategy::TakeDisk => MergeOutcome::Clean(theirs.to_string()),
        // Attempt a real 3-way merge; on conflict, surface markers for the user.
        MergeStrategy::RaiseConflict | MergeStrategy::AutoMergeRaise => {
            match diffy::merge(base, ours, theirs) {
                Ok(merged) => MergeOutcome::Clean(merged),
                Err(conflicted) => MergeOutcome::Conflicted { merged: conflicted },
            }
        }
        // Attempt a merge; on conflict accept the marked output inline instead
        // of flagging — the buffer is never blocked.
        MergeStrategy::AutoMergeMunge => match diffy::merge(base, ours, theirs) {
            Ok(merged) | Err(merged) => MergeOutcome::Clean(merged),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn take_disk_yields_disk_text() {
        let out = three_way("base", "ours", "theirs", MergeStrategy::TakeDisk);
        assert_eq!(out, MergeOutcome::Clean("theirs".into()));
    }

    #[test]
    fn ignore_disk_yields_our_text() {
        let out = three_way("base", "ours", "theirs", MergeStrategy::IgnoreDisk);
        assert_eq!(out, MergeOutcome::Clean("ours".into()));
    }

    #[test]
    fn non_overlapping_edits_merge_cleanly() {
        // ours edits line 1, theirs edits line 3 — disjoint, should merge clean.
        let base = "one\ntwo\nthree\n";
        let ours = "ONE\ntwo\nthree\n";
        let theirs = "one\ntwo\nTHREE\n";
        let out = three_way(base, ours, theirs, MergeStrategy::RaiseConflict);
        assert_eq!(out, MergeOutcome::Clean("ONE\ntwo\nTHREE\n".into()));
    }

    #[test]
    fn overlapping_edits_conflict_under_raise() {
        let base = "one\ntwo\nthree\n";
        let ours = "one\nOURS\nthree\n";
        let theirs = "one\nTHEIRS\nthree\n";
        let out = three_way(base, ours, theirs, MergeStrategy::RaiseConflict);
        assert!(
            out.is_conflicted(),
            "overlapping edits must conflict: {out:?}"
        );
        assert!(out.text().contains("OURS"));
        assert!(out.text().contains("THEIRS"));
    }

    #[test]
    fn munge_never_conflicts() {
        let base = "one\ntwo\nthree\n";
        let ours = "one\nOURS\nthree\n";
        let theirs = "one\nTHEIRS\nthree\n";
        let out = three_way(base, ours, theirs, MergeStrategy::AutoMergeMunge);
        assert!(!out.is_conflicted());
    }

    #[test]
    fn identical_edits_are_clean() {
        let base = "one\ntwo\n";
        let same = "one\nTWO\n";
        let out = three_way(base, same, same, MergeStrategy::RaiseConflict);
        assert_eq!(out, MergeOutcome::Clean(same.into()));
    }
}
