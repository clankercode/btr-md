use anyhow::Result;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::{
    fs::OpenOptions,
    io::{Read, Seek, SeekFrom, Write},
    path::PathBuf,
};

const MAX_RECENTS: usize = 20;

#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct Recents {
    files: Vec<PathBuf>,
}

impl Recents {
    pub fn push(&mut self, path: &PathBuf) {
        self.files.retain(|p| p != path);
        self.files.insert(0, path.clone());
        if self.files.len() > MAX_RECENTS {
            self.files.truncate(MAX_RECENTS);
        }
    }

    pub fn files(&self) -> &[PathBuf] {
        &self.files
    }
}

pub fn recents_path() -> PathBuf {
    // `BaseDirectories::with_prefix` can fail when neither `HOME` nor the
    // XDG base envs resolve; `place_config_file` can fail when the config
    // dir cannot be created. Fall back to a relative path in both cases so
    // a missing home directory becomes a recoverable I/O error in the
    // calling rmw/get/clear, not a process-wide panic.
    xdg::BaseDirectories::with_prefix("preview-md")
        .ok()
        .and_then(|b| b.place_config_file("recents.toml").ok())
        .unwrap_or_else(|| PathBuf::from("recents.toml"))
}

/// Parse the recents TOML body, treating malformed input as an empty list.
///
/// The previous implementation propagated `toml::from_str` errors. That made
/// a corrupt recents file fatal for every open-file command (`push` was
/// called inside the request path), which could brick the app on a single
/// corrupt-on-disk read. We log and overwrite instead.
fn parse_or_empty(body: &str) -> Recents {
    if body.is_empty() {
        return Recents::default();
    }
    match toml::from_str::<Recents>(body) {
        Ok(r) => r,
        Err(e) => {
            eprintln!(
                "[preview-md] recents.toml is malformed ({}); treating as empty",
                e
            );
            Recents::default()
        }
    }
}

pub fn push(file_path: &PathBuf) -> Result<()> {
    if let Some(parent) = recents_path().parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut f = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(recents_path())?;
    f.lock_exclusive()?;
    let mut s = String::new();
    f.read_to_string(&mut s)?;
    let mut recents = parse_or_empty(&s);
    recents.push(file_path);
    let out = toml::to_string_pretty(&recents)?;
    f.set_len(0)?;
    f.seek(SeekFrom::Start(0))?;
    f.write_all(out.as_bytes())?;
    f.sync_all()?;
    fs2::FileExt::unlock(&f)?;
    Ok(())
}

pub fn path() -> std::io::Result<PathBuf> {
    Ok(recents_path())
}

pub fn clear() -> Result<()> {
    if let Some(parent) = recents_path().parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut f = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(recents_path())?;
    f.lock_exclusive()?;
    let recents = Recents::default();
    let out = toml::to_string_pretty(&recents)?;
    f.set_len(0)?;
    f.seek(SeekFrom::Start(0))?;
    f.write_all(out.as_bytes())?;
    f.sync_all()?;
    fs2::FileExt::unlock(&f)?;
    Ok(())
}

pub fn get() -> Result<Vec<PathBuf>> {
    if let Some(parent) = recents_path().parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let mut f = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(recents_path())?;
    #[allow(clippy::incompatible_msrv)]
    f.lock_shared()?;
    let mut s = String::new();
    let _ = f.read_to_string(&mut s);
    let recents = parse_or_empty(&s);
    fs2::FileExt::unlock(&f)?;
    Ok(recents.files.into_iter().collect())
}

/// Return only entries that still exist on disk and rewrite the file to drop
/// any that don't. This is the entry point the renderer hits for the
/// File-menu recent list; cleaning here keeps the list from accruing dead
/// references over time.
pub fn get_existing() -> Result<Vec<PathBuf>> {
    let all = get()?;
    let (alive, removed): (Vec<_>, Vec<_>) = all.into_iter().partition(|p| p.exists());
    if !removed.is_empty() {
        // Best-effort rewrite — if writing fails (e.g. config dir read-only),
        // we still return the in-memory cleaned list.
        if let Err(e) = rewrite(&alive) {
            eprintln!("[preview-md] could not prune recents.toml: {}", e);
        }
    }
    Ok(alive)
}

fn rewrite(files: &[PathBuf]) -> Result<()> {
    if let Some(parent) = recents_path().parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut f = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(recents_path())?;
    f.lock_exclusive()?;
    let recents = Recents {
        files: files.to_vec(),
    };
    let out = toml::to_string_pretty(&recents)?;
    f.set_len(0)?;
    f.seek(SeekFrom::Start(0))?;
    f.write_all(out.as_bytes())?;
    f.sync_all()?;
    fs2::FileExt::unlock(&f)?;
    Ok(())
}

/// True if an already-canonical `path` appears in the recents list.
///
/// Used by `request_open_file` to admit paths the user previously chose
/// through a trusted entry point (dialog / CLI / drag-drop). Comparing
/// canonical-vs-canonical avoids spoofing via odd path expressions.
pub fn contains_canonical_eq(canon: &std::path::Path) -> bool {
    let Ok(list) = get() else {
        return false;
    };
    list.iter()
        .any(|p| std::fs::canonicalize(p).ok().as_deref() == Some(canon))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        env,
        ffi::OsString,
        sync::{Mutex, OnceLock},
    };

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

    fn config_env_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
    }

    #[test]
    fn push_persists_multiple_recent_files_in_most_recent_order() {
        let _lock = config_env_lock();
        let _config_home = ConfigHomeGuard::new();
        let first = PathBuf::from("/tmp/first.md");
        let second = PathBuf::from("/tmp/second.md");

        push(&first).expect("push first recent file");
        push(&second).expect("push second recent file");

        assert_eq!(get().expect("read recent files"), vec![second, first]);
    }

    #[test]
    fn push_tolerates_corrupt_file() {
        let _lock = config_env_lock();
        let _config_home = ConfigHomeGuard::new();

        // Plant garbage so `parse_or_empty` has something to recover from.
        if let Some(parent) = recents_path().parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(recents_path(), "this is not valid toml = = =")
            .expect("plant corrupt recents file");

        let target = PathBuf::from("/tmp/recovered.md");
        push(&target).expect("push must succeed even when prior file is corrupt");

        assert_eq!(get().expect("read recent files"), vec![target]);
    }

    #[test]
    fn get_existing_filters_missing_files() {
        let _lock = config_env_lock();
        let _config_home = ConfigHomeGuard::new();
        let tmp = tempfile::tempdir().expect("temp dir");
        let alive = tmp.path().join("alive.md");
        let dead = tmp.path().join("dead.md");
        std::fs::write(&alive, "hi").expect("write alive");

        push(&dead).expect("push dead");
        push(&alive).expect("push alive");

        let existing = get_existing().expect("get_existing");
        assert_eq!(existing, vec![alive]);
        // The on-disk file should also have been pruned.
        assert_eq!(get().expect("get after prune").len(), 1);
    }
}
