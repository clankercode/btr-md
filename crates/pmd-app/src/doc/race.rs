//! The save/disk race seam.
//!
//! When a file changes on disk *while we are mid-save*, two writers have
//! interleaved. v1 does not attempt clever reconciliation — [`RacePolicy::Defer`]
//! logs the race and lets the normal save-completion transition stand (our
//! write wins; the external change is reported but dropped). The point of this
//! module is that every such race is already *typed and routed* through
//! [`handle`], so a future policy (e.g. re-merge-after-save) is a local change
//! here rather than a scattered rewrite.

use crate::doc::modes::RacePolicy;
use crate::doc::state::{Digest, DocId};

/// A race observed against an in-flight save.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RaceEvent {
    /// An external writer modified the file while our save was outstanding.
    ExternalWriteDuringSave { doc: DocId, disk: Digest },
    /// The file was removed while our save was outstanding.
    ExternalRemoveDuringSave { doc: DocId },
}

/// What the caller should do about a race.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RaceResolution {
    /// Take no corrective action (let the save-completion transition stand).
    Defer,
}

/// Resolve a race per `policy`. Exhaustive over both [`RacePolicy`] and
/// [`RaceEvent`] so new policies/events force a decision here.
pub fn handle(policy: RacePolicy, event: RaceEvent) -> RaceResolution {
    match policy {
        RacePolicy::Defer => {
            match event {
                RaceEvent::ExternalWriteDuringSave { doc, disk } => {
                    eprintln!(
                        "[preview-md] race(defer): external write to doc {} during save (disk {}); our save wins",
                        doc.0,
                        disk.to_hex()
                    );
                }
                RaceEvent::ExternalRemoveDuringSave { doc } => {
                    eprintln!(
                        "[preview-md] race(defer): doc {} removed on disk during save; our save wins",
                        doc.0
                    );
                }
            }
            RaceResolution::Defer
        }
    }
}
