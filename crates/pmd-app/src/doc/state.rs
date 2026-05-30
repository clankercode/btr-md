//! The per-document file-lifecycle state machine.
//!
//! # The compile-fail guarantee
//!
//! [`FileState::apply`] is a *total*, *pure* function of `(state, event)`. It is
//! written as a `match` over the state, then over the event, **with no bare `_`
//! arm anywhere**. Adding a new [`FileState`] variant makes the outer match
//! non-exhaustive; adding a new [`DocEvent`] variant makes every inner match
//! non-exhaustive — either way the crate fails to compile until the new
//! `(state, event)` pairs are considered explicitly. That compiler error *is*
//! the safety property: no lifecycle transition can be silently forgotten.
//!
//! Do **not** add a `_ =>` arm to `apply` (or to any `match` over `FileState` /
//! `DocEvent` that is meant to be exhaustive). If several arms truly behave
//! identically, group them with `|`; never collapse them with `_`.
//!
//! # Digests, not text
//!
//! State transitions only ever compare content *digests* (blake3). The full
//! text needed for saving and 3-way merge lives outside the state machine, in
//! the registry's `DocEntry` (`base_content`) and in the command payloads.
//! Keeping text out of the state keeps `apply` cheap, `Clone`, and trivially
//! testable.

use serde::{Deserialize, Serialize};

/// A content digest. blake3 of some UTF-8 buffer. Serialised to/from a
/// lowercase hex string so the frontend mirror can treat it as an opaque
/// `string` (it never needs the bytes — only variant identity matters to the
/// UI).
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct Digest(pub [u8; 32]);

impl Digest {
    /// Hash a UTF-8 buffer.
    pub fn of(content: &str) -> Self {
        Digest(*blake3::hash(content.as_bytes()).as_bytes())
    }

    pub fn to_hex(self) -> String {
        let mut s = String::with_capacity(64);
        for b in self.0 {
            use std::fmt::Write;
            let _ = write!(s, "{b:02x}");
        }
        s
    }

    fn from_hex(s: &str) -> Option<Self> {
        if s.len() != 64 {
            return None;
        }
        let mut out = [0u8; 32];
        for (i, byte) in out.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).ok()?;
        }
        Some(Digest(out))
    }
}

impl std::fmt::Debug for Digest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Short form keeps test failure output readable.
        write!(f, "Digest({}…)", &self.to_hex()[..8])
    }
}

impl Serialize for Digest {
    fn serialize<S: serde::Serializer>(&self, ser: S) -> Result<S::Ok, S::Error> {
        ser.serialize_str(&self.to_hex())
    }
}

impl<'de> Deserialize<'de> for Digest {
    fn deserialize<D: serde::Deserializer<'de>>(de: D) -> Result<Self, D::Error> {
        let s = String::deserialize(de)?;
        Digest::from_hex(&s).ok_or_else(|| serde::de::Error::custom("invalid blake3 hex digest"))
    }
}

/// Opaque, process-unique document identifier. Minted by the registry's
/// `AtomicU64`; never reused within a process.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize)]
pub struct DocId(pub u64);

/// The lifecycle state of one document, relative to its backing file (if any).
///
/// Invariants the producers maintain (the state machine assumes, never checks):
/// - `Clean`     : mem == base == disk
/// - `Dirty`     : mem != base, disk == base   (only local edits)
/// - `DiskChangedClean` : mem == base, disk != base   (only external edits)
/// - `DiskChangedDirty` : mem != base, disk != base   (conflict)
/// - `Removed`   : the backing file vanished; `mem` is the live buffer digest
/// - `SaveInProgress` : a write is in flight; carries the intent to reconcile
///   on success/failure (`base` = pre-save base, `None` if it was untitled;
///   `target` = digest being written; `edited_during` = a digest the user
///   typed while the async write was outstanding; `disk_during` = the digest
///   of an external disk change observed while the write was in flight, so
///   that a `SaveFailed` can correctly land in `DiskChangedClean/Dirty`
///   rather than silently losing the external change).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FileState {
    Untitled,
    Clean {
        base: Digest,
    },
    Dirty {
        base: Digest,
        mem: Digest,
    },
    DiskChangedClean {
        base: Digest,
        disk: Digest,
    },
    DiskChangedDirty {
        base: Digest,
        mem: Digest,
        disk: Digest,
    },
    Removed {
        base: Digest,
        mem: Digest,
    },
    SaveInProgress {
        base: Option<Digest>,
        target: Digest,
        edited_during: Option<Digest>,
        /// If an external disk change was observed mid-save, its digest is
        /// recorded here. On `SaveFailed`, this lets us land in
        /// `DiskChangedClean` / `DiskChangedDirty` rather than losing the
        /// external change. `None` = no external change seen during the write.
        disk_during: Option<Digest>,
    },
}

/// Things that happen to a document. Each carries the digest(s) the transition
/// needs — `apply` never recomputes a hash.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DocEvent {
    /// The in-memory buffer changed; `mem` is its new digest.
    Edited { mem: Digest },
    /// The watcher observed the file change on disk; `disk` is its new digest.
    DiskModified { disk: Digest },
    /// The watcher observed the file disappear.
    DiskRemoved,
    /// The watcher observed the file (re)appear; `disk` is its digest.
    DiskCreated { disk: Digest },
    /// A save was initiated; `target` is the digest being written.
    SaveStarted { target: Digest },
    /// The in-flight save completed successfully.
    SaveSucceeded,
    /// The in-flight save failed (the file on disk is unchanged by us).
    SaveFailed,
    /// The buffer was reconciled with disk (reload or merge-apply). `disk` is
    /// the new ancestor (becomes base); `mem` is the resulting buffer digest.
    SyncedFromDisk { disk: Digest, mem: Digest },
}

impl FileState {
    /// Digest of the last-loaded / last-saved content (the merge ancestor), if
    /// the document is file-backed and has one in this state.
    pub fn base(&self) -> Option<Digest> {
        match self {
            FileState::Untitled => None,
            FileState::Clean { base }
            | FileState::Dirty { base, .. }
            | FileState::DiskChangedClean { base, .. }
            | FileState::DiskChangedDirty { base, .. }
            | FileState::Removed { base, .. } => Some(*base),
            FileState::SaveInProgress { base, .. } => *base,
        }
    }

    /// The total transition function. See the module docs for the compile-fail
    /// guarantee — **do not introduce a `_` arm**.
    pub fn apply(self, event: DocEvent) -> FileState {
        match self {
            FileState::Untitled => match event {
                // An untitled buffer has no backing file: edits and disk events
                // leave it untitled (content is tracked in the registry).
                DocEvent::Edited { .. }
                | DocEvent::DiskModified { .. }
                | DocEvent::DiskRemoved
                | DocEvent::DiskCreated { .. }
                | DocEvent::SaveSucceeded
                | DocEvent::SaveFailed
                | DocEvent::SyncedFromDisk { .. } => FileState::Untitled,
                DocEvent::SaveStarted { target } => FileState::SaveInProgress {
                    base: None,
                    target,
                    edited_during: None,
                    disk_during: None,
                },
            },

            FileState::Clean { base } => match event {
                DocEvent::Edited { mem } => clean_or_dirty(base, mem),
                DocEvent::DiskModified { disk } | DocEvent::DiskCreated { disk } => {
                    if disk == base {
                        FileState::Clean { base }
                    } else {
                        FileState::DiskChangedClean { base, disk }
                    }
                }
                DocEvent::DiskRemoved => FileState::Removed { base, mem: base },
                DocEvent::SaveStarted { target } => FileState::SaveInProgress {
                    base: Some(base),
                    target,
                    edited_during: None,
                    disk_during: None,
                },
                DocEvent::SaveSucceeded | DocEvent::SaveFailed => FileState::Clean { base },
                DocEvent::SyncedFromDisk { disk, mem } => synced(disk, mem),
            },

            FileState::Dirty { base, mem } => match event {
                DocEvent::Edited { mem: m2 } => clean_or_dirty(base, m2),
                DocEvent::DiskModified { disk } | DocEvent::DiskCreated { disk } => {
                    if disk == base {
                        FileState::Dirty { base, mem }
                    } else {
                        FileState::DiskChangedDirty { base, mem, disk }
                    }
                }
                DocEvent::DiskRemoved => FileState::Removed { base, mem },
                DocEvent::SaveStarted { target } => FileState::SaveInProgress {
                    base: Some(base),
                    target,
                    edited_during: None,
                    disk_during: None,
                },
                DocEvent::SaveSucceeded | DocEvent::SaveFailed => FileState::Dirty { base, mem },
                DocEvent::SyncedFromDisk { disk, mem: m2 } => synced(disk, m2),
            },

            FileState::DiskChangedClean { base, disk } => match event {
                DocEvent::Edited { mem } => {
                    if mem == base {
                        FileState::DiskChangedClean { base, disk }
                    } else {
                        FileState::DiskChangedDirty { base, mem, disk }
                    }
                }
                DocEvent::DiskModified { disk: d2 } | DocEvent::DiskCreated { disk: d2 } => {
                    if d2 == base {
                        FileState::Clean { base }
                    } else {
                        FileState::DiskChangedClean { base, disk: d2 }
                    }
                }
                DocEvent::DiskRemoved => FileState::Removed { base, mem: base },
                DocEvent::SaveStarted { target } => FileState::SaveInProgress {
                    base: Some(base),
                    target,
                    edited_during: None,
                    // Preserve the disk change so SaveFailed can recover it.
                    disk_during: Some(disk),
                },
                DocEvent::SaveSucceeded | DocEvent::SaveFailed => {
                    FileState::DiskChangedClean { base, disk }
                }
                DocEvent::SyncedFromDisk { disk: d2, mem } => synced(d2, mem),
            },

            FileState::DiskChangedDirty { base, mem, disk } => match event {
                DocEvent::Edited { mem: m2 } => {
                    if m2 == base {
                        FileState::DiskChangedClean { base, disk }
                    } else {
                        FileState::DiskChangedDirty {
                            base,
                            mem: m2,
                            disk,
                        }
                    }
                }
                DocEvent::DiskModified { disk: d2 } | DocEvent::DiskCreated { disk: d2 } => {
                    if d2 == base {
                        FileState::Dirty { base, mem }
                    } else {
                        FileState::DiskChangedDirty {
                            base,
                            mem,
                            disk: d2,
                        }
                    }
                }
                DocEvent::DiskRemoved => FileState::Removed { base, mem },
                DocEvent::SaveStarted { target } => FileState::SaveInProgress {
                    base: Some(base),
                    target,
                    edited_during: None,
                    // Preserve the disk change so SaveFailed can recover it.
                    disk_during: Some(disk),
                },
                DocEvent::SaveSucceeded | DocEvent::SaveFailed => {
                    FileState::DiskChangedDirty { base, mem, disk }
                }
                DocEvent::SyncedFromDisk { disk: d2, mem: m2 } => synced(d2, m2),
            },

            FileState::Removed { base, mem } => match event {
                DocEvent::Edited { mem: m2 } => FileState::Removed { base, mem: m2 },
                // The file reappeared. Reconcile the live buffer against it.
                DocEvent::DiskModified { disk } | DocEvent::DiskCreated { disk } => {
                    if disk == mem {
                        FileState::Clean { base: disk }
                    } else {
                        FileState::DiskChangedDirty { base, mem, disk }
                    }
                }
                DocEvent::DiskRemoved => FileState::Removed { base, mem },
                DocEvent::SaveStarted { target } => FileState::SaveInProgress {
                    base: Some(base),
                    target,
                    edited_during: None,
                    disk_during: None,
                },
                DocEvent::SaveSucceeded | DocEvent::SaveFailed => FileState::Removed { base, mem },
                DocEvent::SyncedFromDisk { disk, mem: m2 } => synced(disk, m2),
            },

            FileState::SaveInProgress {
                base,
                target,
                edited_during,
                disk_during,
            } => match event {
                // The user kept typing during the async write — remember the
                // latest digest so we land in Dirty (not Clean) on success.
                DocEvent::Edited { mem } => FileState::SaveInProgress {
                    base,
                    target,
                    edited_during: Some(mem),
                    disk_during,
                },
                // Disk events mid-save: the caller routes them through the race
                // seam (self-write vs external). Record the latest external disk
                // digest so SaveFailed can recover the DiskChanged* state.
                // Self-writes (digest == target) are not external races, but
                // we still record them in disk_during so we can distinguish on
                // failure — the self-write case resolves to Clean anyway.
                DocEvent::DiskModified { disk } | DocEvent::DiskCreated { disk } => {
                    FileState::SaveInProgress {
                        base,
                        target,
                        edited_during,
                        disk_during: Some(disk),
                    }
                }
                DocEvent::DiskRemoved => FileState::SaveInProgress {
                    base,
                    target,
                    edited_during,
                    // Sentinel: disk_during = None with DiskRemoved is handled
                    // by SaveFailed landing in Removed, but that state is already
                    // Removed if we came from there. For other origins, losing
                    // the removal is acceptable — the watcher will re-emit.
                    disk_during,
                },
                // A re-issued save (e.g. save-as picked a new target).
                DocEvent::SaveStarted { target: t2 } => FileState::SaveInProgress {
                    base,
                    target: t2,
                    edited_during,
                    disk_during,
                },
                DocEvent::SaveSucceeded => {
                    let buffer = edited_during.unwrap_or(target);
                    // On success, the file was written. If an external change
                    // also happened during the write and its digest differs
                    // from what we just wrote, surface it.
                    let succeeded_base = target;
                    match disk_during {
                        Some(d) if d != succeeded_base => {
                            // External change landed during our write.
                            if buffer == succeeded_base {
                                FileState::DiskChangedClean {
                                    base: succeeded_base,
                                    disk: d,
                                }
                            } else {
                                FileState::DiskChangedDirty {
                                    base: succeeded_base,
                                    mem: buffer,
                                    disk: d,
                                }
                            }
                        }
                        _ => {
                            // Self-write or no mid-save disk event: normal landing.
                            if buffer == succeeded_base {
                                FileState::Clean { base: succeeded_base }
                            } else {
                                FileState::Dirty {
                                    base: succeeded_base,
                                    mem: buffer,
                                }
                            }
                        }
                    }
                }
                DocEvent::SaveFailed => {
                    let buffer = edited_during.unwrap_or(target);
                    match base {
                        None => FileState::Untitled,
                        Some(b) => {
                            // If an external disk change was observed during the
                            // (now-failed) write, recover to the appropriate
                            // DiskChanged* state rather than losing it.
                            match disk_during {
                                Some(d) => {
                                    if buffer == b {
                                        FileState::DiskChangedClean { base: b, disk: d }
                                    } else {
                                        FileState::DiskChangedDirty {
                                            base: b,
                                            mem: buffer,
                                            disk: d,
                                        }
                                    }
                                }
                                None => clean_or_dirty(b, buffer),
                            }
                        }
                    }
                }
                DocEvent::SyncedFromDisk { disk, mem } => synced(disk, mem),
            },
        }
    }
}

/// Collapse to `Clean` when the buffer matches base, else `Dirty`.
fn clean_or_dirty(base: Digest, mem: Digest) -> FileState {
    if mem == base {
        FileState::Clean { base }
    } else {
        FileState::Dirty { base, mem }
    }
}

/// Result of reconciling the buffer with disk: `disk` becomes the new ancestor.
fn synced(disk: Digest, mem: Digest) -> FileState {
    if mem == disk {
        FileState::Clean { base: disk }
    } else {
        FileState::Dirty { base: disk, mem }
    }
}
