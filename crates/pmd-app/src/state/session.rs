//! The persisted editing session: open files, untitled docs, and unsaved
//! buffer contents, restored verbatim on the next launch.
//!
//! Unlike [`recents`](super::recents) and [`settings`](super::settings) — which
//! serialise TOML and rewrite **in place** — the session is serialised as JSON
//! (`serde_json`) and written with an **atomic temp+rename**: the payload is
//! larger (it can carry full buffer contents), so a torn write from a crash
//! mid-rewrite would corrupt the whole session. Writing `session.json.tmp` then
//! renaming it over `session.json` makes the replace atomic.
//!
//! The config-dir resolution and `fs2` advisory locking mirror `recents.rs` /
//! `settings.rs` exactly: a missing/unparseable file is treated as an empty
//! default (warn-logged, never a panic, never deleted).

use anyhow::Result;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::{
    fs::OpenOptions,
    io::{Read, Write},
    path::PathBuf,
};

/// Current on-disk schema version. Bump when the shape changes incompatibly.
pub const SESSION_VERSION: u32 = 1;

/// The full persisted session.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Session {
    /// Schema version, starts at 1.
    pub version: u32,
    /// Open documents, in tab order.
    pub docs: Vec<SessionDoc>,
    /// Which tab was focused (a doc index or the file-browser tab).
    #[serde(default)]
    pub active: Option<ActiveTab>,
    /// Whether the file-browser tab was open.
    #[serde(default)]
    pub browser_tab: bool,
}

impl Default for Session {
    fn default() -> Self {
        Self {
            version: SESSION_VERSION,
            docs: Vec::new(),
            active: None,
            browser_tab: false,
        }
    }
}

/// Which tab was focused last session.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActiveTab {
    /// Index into [`Session::docs`].
    Doc(usize),
    /// The file-browser tab.
    Browser,
}

/// One persisted document.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionDoc {
    /// Absolute path for saved docs; `None` for untitled docs.
    #[serde(default)]
    pub path: Option<String>,
    /// Editor mode, serialised exactly as the frontend supplies it.
    pub mode: String,
    /// Present iff there are edits to preserve: untitled docs (always) and
    /// saved docs with unsaved edits. Absent for clean saved docs (reopened
    /// from disk on restore).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unsaved: Option<UnsavedBuffer>,
}

/// The unsaved buffer payload carried for untitled / dirty docs.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnsavedBuffer {
    /// The live buffer text to restore.
    pub content: String,
    /// For saved docs: the merge-ancestor text (the registry `base_content` at
    /// save time) so restore can rebuild the exact merge baseline. `None` for
    /// untitled docs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub baseline_content: Option<String>,
}

/// Resolve the session file path, mirroring `recents::recents_path`'s graceful
/// fallback when XDG resolution fails.
pub fn session_path() -> PathBuf {
    xdg::BaseDirectories::with_prefix("btr-md")
        .ok()
        .and_then(|b| b.place_config_file("session.json").ok())
        .unwrap_or_else(|| PathBuf::from("session.json"))
}

fn tmp_path() -> PathBuf {
    let p = session_path();
    // `session.json` -> `session.json.tmp`, preserving the directory.
    let mut s = p.into_os_string();
    s.push(".tmp");
    PathBuf::from(s)
}

/// Read + parse the session. Missing / corrupt / unparseable input yields an
/// empty [`Session::default`] (warn-logged); the file is never deleted and this
/// never panics.
pub fn load_session() -> Session {
    let path = session_path();
    let mut f = match OpenOptions::new().read(true).open(&path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Session::default(),
        Err(e) => {
            eprintln!(
                "[btr-md] could not open session.json ({}); starting with an empty session",
                e
            );
            return Session::default();
        }
    };
    #[allow(clippy::incompatible_msrv)]
    if let Err(e) = f.lock_shared() {
        eprintln!(
            "[btr-md] could not lock session.json for reading ({}); starting empty",
            e
        );
        return Session::default();
    }
    let mut body = String::new();
    let read = f.read_to_string(&mut body);
    let _ = fs2::FileExt::unlock(&f);
    if let Err(e) = read {
        eprintln!(
            "[btr-md] could not read session.json ({}); starting with an empty session",
            e
        );
        return Session::default();
    }
    if body.trim().is_empty() {
        return Session::default();
    }
    match serde_json::from_str::<Session>(&body) {
        Ok(s) => s,
        Err(e) => {
            eprintln!(
                "[btr-md] session.json is malformed ({}); starting with an empty session",
                e
            );
            Session::default()
        }
    }
}

/// Serialise + persist `session` atomically (write `session.json.tmp` under an
/// exclusive lock, fsync, then rename over `session.json`). The lock is held on
/// the real file for the duration so concurrent writers serialise.
pub fn save_session(session: &Session) -> Result<()> {
    let path = session_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    // Lock the canonical file (creating it if absent) to serialise writers,
    // then write the temp file and rename it into place.
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&path)?;
    lock.lock_exclusive()?;

    let result = (|| -> Result<()> {
        let tmp = tmp_path();
        let body = serde_json::to_string_pretty(session)?;
        {
            let mut f = OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .open(&tmp)?;
            f.write_all(body.as_bytes())?;
            f.sync_all()?;
        }
        std::fs::rename(&tmp, &path)?;
        Ok(())
    })();

    let _ = fs2::FileExt::unlock(&lock);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::config_env_lock;
    use std::{env, ffi::OsString};

    struct ConfigHomeGuard {
        previous: Option<OsString>,
        _dir: tempfile::TempDir,
    }

    impl ConfigHomeGuard {
        fn new() -> Self {
            let dir = tempfile::tempdir().expect("create temp config home");
            let previous = env::var_os("XDG_CONFIG_HOME");
            env::set_var("XDG_CONFIG_HOME", dir.path());
            Self {
                previous,
                _dir: dir,
            }
        }
    }

    impl Drop for ConfigHomeGuard {
        fn drop(&mut self) {
            if let Some(previous) = &self.previous {
                env::set_var("XDG_CONFIG_HOME", previous);
            } else {
                env::remove_var("XDG_CONFIG_HOME");
            }
        }
    }

    fn sample_session() -> Session {
        Session {
            version: SESSION_VERSION,
            docs: vec![
                // untitled: content, no baseline.
                SessionDoc {
                    path: None,
                    mode: "source".into(),
                    unsaved: Some(UnsavedBuffer {
                        content: "untitled body".into(),
                        baseline_content: None,
                    }),
                },
                // clean saved: no unsaved buffer.
                SessionDoc {
                    path: Some("/tmp/clean.md".into()),
                    mode: "preview".into(),
                    unsaved: None,
                },
                // dirty saved: content + baseline.
                SessionDoc {
                    path: Some("/tmp/dirty.md".into()),
                    mode: "source".into(),
                    unsaved: Some(UnsavedBuffer {
                        content: "edited body".into(),
                        baseline_content: Some("ancestor body".into()),
                    }),
                },
            ],
            active: Some(ActiveTab::Doc(2)),
            browser_tab: true,
        }
    }

    #[test]
    fn roundtrips_untitled_clean_and_dirty_docs() {
        let _lock = config_env_lock();
        let _config_home = ConfigHomeGuard::new();

        let original = sample_session();
        save_session(&original).expect("save session");
        let loaded = load_session();
        assert_eq!(loaded, original);
    }

    #[test]
    fn clean_doc_omits_unsaved_in_serialized_json() {
        let session = Session {
            version: SESSION_VERSION,
            docs: vec![SessionDoc {
                path: Some("/tmp/clean.md".into()),
                mode: "source".into(),
                unsaved: None,
            }],
            active: None,
            browser_tab: false,
        };
        let json = serde_json::to_string(&session).expect("serialize");
        assert!(
            !json.contains("unsaved"),
            "clean doc must omit `unsaved`: {json}"
        );
    }

    #[test]
    fn save_leaves_no_tmp_and_preserves_existing_valid_file() {
        let _lock = config_env_lock();
        let _config_home = ConfigHomeGuard::new();

        save_session(&sample_session()).expect("first save");
        assert!(!tmp_path().exists(), "no leftover .tmp after write");

        // A second write must not corrupt the prior valid file: it stays
        // parseable throughout (atomic rename never leaves a torn file).
        let second = Session {
            version: SESSION_VERSION,
            docs: vec![SessionDoc {
                path: Some("/tmp/only.md".into()),
                mode: "preview".into(),
                unsaved: None,
            }],
            active: Some(ActiveTab::Browser),
            browser_tab: false,
        };
        save_session(&second).expect("second save");
        assert!(!tmp_path().exists(), "no leftover .tmp after rewrite");
        assert_eq!(load_session(), second);
    }

    #[test]
    fn missing_file_loads_empty_default() {
        let _lock = config_env_lock();
        let _config_home = ConfigHomeGuard::new();
        assert_eq!(load_session(), Session::default());
    }

    #[test]
    fn corrupt_file_recovers_to_empty_default_without_deletion() {
        let _lock = config_env_lock();
        let _config_home = ConfigHomeGuard::new();

        if let Some(parent) = session_path().parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(session_path(), "{ this is not valid json ::::").expect("plant garbage");

        assert_eq!(load_session(), Session::default());
        // The corrupt file is left in place (not deleted), matching recents.
        assert!(
            session_path().exists(),
            "corrupt session.json must not be deleted"
        );
    }
}
