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
    let base = xdg::BaseDirectories::with_prefix("preview-md").unwrap();
    base.place_config_file("recents.toml").unwrap()
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
    let mut recents: Recents = if s.is_empty() {
        Recents::default()
    } else {
        toml::from_str(&s)?
    };
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

pub fn clear() -> std::io::Result<()> {
    let path = path()?;
    if path.exists() {
        std::fs::remove_file(path)?;
    }
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
    let recents: Recents = if s.is_empty() {
        Recents::default()
    } else {
        toml::from_str(&s).unwrap_or_default()
    };
    fs2::FileExt::unlock(&f)?;
    Ok(recents.files.into_iter().collect())
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
}
