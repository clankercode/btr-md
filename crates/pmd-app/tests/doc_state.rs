//! Transition-table coverage for the file-lifecycle state machine, plus the
//! registry's save-authority primitive.

use pmd_app_lib::doc::registry::DocRegistry;
use pmd_app_lib::doc::state::{Digest, DocEvent, FileState};
use pmd_app_lib::doc::DiskEvent;

fn d(s: &str) -> Digest {
    Digest::of(s)
}

// --- core (state, event) transitions ---

#[test]
fn edit_collapses_to_clean_when_matching_base() {
    let base = d("base");
    assert_eq!(
        FileState::Clean { base }.apply(DocEvent::Edited { mem: base }),
        FileState::Clean { base }
    );
    assert_eq!(
        FileState::Dirty { base, mem: d("x") }.apply(DocEvent::Edited { mem: base }),
        FileState::Clean { base }
    );
}

#[test]
fn edit_diverging_from_base_is_dirty() {
    let base = d("base");
    let mem = d("edited");
    assert_eq!(
        FileState::Clean { base }.apply(DocEvent::Edited { mem }),
        FileState::Dirty { base, mem }
    );
}

#[test]
fn external_change_over_clean_is_disk_changed_clean_and_self_write_collapses() {
    let base = d("base");
    let disk = d("disk");
    assert_eq!(
        FileState::Clean { base }.apply(DocEvent::DiskModified { disk }),
        FileState::DiskChangedClean { base, disk }
    );
    // disk digest == base => our own write / no real change => stay Clean.
    assert_eq!(
        FileState::Clean { base }.apply(DocEvent::DiskModified { disk: base }),
        FileState::Clean { base }
    );
}

#[test]
fn external_change_over_dirty_is_conflict() {
    let base = d("base");
    let mem = d("mine");
    let disk = d("theirs");
    assert_eq!(
        FileState::Dirty { base, mem }.apply(DocEvent::DiskModified { disk }),
        FileState::DiskChangedDirty { base, mem, disk }
    );
}

#[test]
fn editing_an_externally_changed_clean_buffer_becomes_conflict() {
    let base = d("base");
    let disk = d("disk");
    let mem = d("mine");
    assert_eq!(
        FileState::DiskChangedClean { base, disk }.apply(DocEvent::Edited { mem }),
        FileState::DiskChangedDirty { base, mem, disk }
    );
}

#[test]
fn disk_reverting_to_base_clears_the_change() {
    let base = d("base");
    let disk = d("disk");
    assert_eq!(
        FileState::DiskChangedClean { base, disk }.apply(DocEvent::DiskModified { disk: base }),
        FileState::Clean { base }
    );
    let mem = d("mine");
    assert_eq!(
        FileState::DiskChangedDirty { base, mem, disk }
            .apply(DocEvent::DiskModified { disk: base }),
        FileState::Dirty { base, mem }
    );
}

#[test]
fn sync_from_disk_lands_clean_or_dirty() {
    let base = d("base");
    let disk = d("disk");
    let mem = d("mine");
    // merged buffer equals disk => Clean with disk as new base.
    assert_eq!(
        FileState::DiskChangedDirty { base, mem, disk }
            .apply(DocEvent::SyncedFromDisk { disk, mem: disk }),
        FileState::Clean { base: disk }
    );
    // merged buffer differs => Dirty against the new (disk) base.
    let merged = d("merged");
    assert_eq!(
        FileState::DiskChangedDirty { base, mem, disk }
            .apply(DocEvent::SyncedFromDisk { disk, mem: merged }),
        FileState::Dirty {
            base: disk,
            mem: merged
        }
    );
}

#[test]
fn removal_and_reappearance() {
    let base = d("base");
    assert_eq!(
        FileState::Clean { base }.apply(DocEvent::DiskRemoved),
        FileState::Removed { base, mem: base }
    );
    let mem = d("buf");
    // reappears matching the live buffer => Clean.
    assert_eq!(
        FileState::Removed { base, mem }.apply(DocEvent::DiskCreated { disk: mem }),
        FileState::Clean { base: mem }
    );
    // reappears differing => conflict.
    let disk = d("other");
    assert_eq!(
        FileState::Removed { base, mem }.apply(DocEvent::DiskCreated { disk }),
        FileState::DiskChangedDirty { base, mem, disk }
    );
}

#[test]
fn save_round_trip_from_dirty() {
    let base = d("base");
    let target = d("saved");
    let sip = FileState::Dirty { base, mem: target }.apply(DocEvent::SaveStarted { target });
    assert_eq!(
        sip,
        FileState::SaveInProgress {
            base: Some(base),
            target,
            edited_during: None
        }
    );
    assert_eq!(
        sip.clone().apply(DocEvent::SaveSucceeded),
        FileState::Clean { base: target }
    );
    // a failed save restores the dirty buffer against the old base.
    assert_eq!(
        sip.apply(DocEvent::SaveFailed),
        FileState::Dirty { base, mem: target }
    );
}

#[test]
fn edit_during_save_lands_dirty_on_success() {
    let base = d("base");
    let target = d("saved");
    let later = d("typed-more");
    let state = FileState::Dirty { base, mem: target }
        .apply(DocEvent::SaveStarted { target })
        .apply(DocEvent::Edited { mem: later })
        .apply(DocEvent::SaveSucceeded);
    assert_eq!(
        state,
        FileState::Dirty {
            base: target,
            mem: later
        }
    );
}

#[test]
fn save_as_from_untitled() {
    let target = d("first-save");
    let sip = FileState::Untitled.apply(DocEvent::SaveStarted { target });
    assert_eq!(
        sip,
        FileState::SaveInProgress {
            base: None,
            target,
            edited_during: None
        }
    );
    assert_eq!(
        sip.clone().apply(DocEvent::SaveSucceeded),
        FileState::Clean { base: target }
    );
    // a failed first save stays untitled.
    assert_eq!(sip.apply(DocEvent::SaveFailed), FileState::Untitled);
}

#[test]
fn untitled_ignores_disk_events() {
    assert_eq!(
        FileState::Untitled.apply(DocEvent::DiskModified { disk: d("x") }),
        FileState::Untitled
    );
    assert_eq!(
        FileState::Untitled.apply(DocEvent::Edited { mem: d("x") }),
        FileState::Untitled
    );
}

#[test]
fn serde_round_trips_with_snake_case_tags() {
    let s = FileState::DiskChangedDirty {
        base: d("a"),
        mem: d("b"),
        disk: d("c"),
    };
    let json = serde_json::to_string(&s).unwrap();
    assert!(json.contains("\"kind\":\"disk_changed_dirty\""), "{json}");
    let back: FileState = serde_json::from_str(&json).unwrap();
    assert_eq!(s, back);
}

// --- registry lifecycle + save authority ---

#[test]
fn registry_lifecycle_round_trip() {
    let reg = DocRegistry::new();
    let path = std::path::PathBuf::from("/tmp/doc.md");
    let (id, st) = reg.register(Some(path), "hello".to_string());
    assert_eq!(st, FileState::Clean { base: d("hello") });

    assert_eq!(
        reg.edited(id, "hello world"),
        Some(FileState::Dirty {
            base: d("hello"),
            mem: d("hello world")
        })
    );
    assert_eq!(
        reg.edited(id, "hello"),
        Some(FileState::Clean { base: d("hello") })
    );

    reg.save_started(id, "hello world");
    assert_eq!(
        reg.save_succeeded(id, "hello world".to_string()),
        Some(FileState::Clean {
            base: d("hello world")
        })
    );
    assert_eq!(reg.base_content_of(id).as_deref(), Some("hello world"));
}

#[test]
fn registry_disk_and_sync() {
    let reg = DocRegistry::new();
    let (id, _) = reg.register(Some("/tmp/x.md".into()), "base".to_string());
    assert_eq!(
        reg.on_disk_event(id, DiskEvent::Modified(d("changed"))),
        Some(FileState::DiskChangedClean {
            base: d("base"),
            disk: d("changed")
        })
    );
    assert_eq!(
        reg.synced_from_disk(id, "changed".to_string(), "changed"),
        Some(FileState::Clean { base: d("changed") })
    );
    assert_eq!(reg.base_content_of(id).as_deref(), Some("changed"));
}

#[test]
fn only_the_active_doc_is_a_save_target() {
    // The primitive `save_doc` enforces: a write is only authorised for the
    // active document. Background docs are never writable.
    let reg = DocRegistry::new();
    let (a, _) = reg.register(Some("/tmp/a.md".into()), "a".to_string());
    let (b, _) = reg.register(Some("/tmp/b.md".into()), "b".to_string());

    reg.set_active(a);
    assert!(reg.is_active(a));
    assert!(!reg.is_active(b), "a background doc must not be writable");

    reg.set_active(b);
    assert!(reg.is_active(b));
    assert!(!reg.is_active(a), "activation moves save authority");

    // dropping the active doc clears authority entirely.
    reg.drop_doc(b);
    assert!(!reg.is_active(b));
    assert_eq!(reg.active(), None);
}
