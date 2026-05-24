use anyhow::Result;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::{
    fs::OpenOptions,
    io::{Read, Seek, SeekFrom, Write},
    path::PathBuf,
};

#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct Settings {
    pub active_theme: Option<String>,
    pub light_theme: Option<String>,
    pub dark_theme: Option<String>,
    pub auto_switch: bool,
    pub default_mode: Option<String>,
}

pub fn path() -> PathBuf {
    let base = xdg::BaseDirectories::with_prefix("preview-md").unwrap();
    base.place_config_file("state.toml").unwrap()
}

pub fn rmw<F: FnOnce(Settings) -> Settings>(merge: F) -> Result<()> {
    if let Some(parent) = path().parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut f = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path())?;
    f.lock_exclusive()?;
    let mut s = String::new();
    f.read_to_string(&mut s)?;
    let current: Settings = if s.is_empty() {
        Settings::default()
    } else {
        toml::from_str(&s)?
    };
    let next = merge(current);
    let out = toml::to_string_pretty(&next)?;
    f.set_len(0)?;
    f.seek(SeekFrom::Start(0))?;
    f.write_all(out.as_bytes())?;
    f.sync_all()?;
    fs2::FileExt::unlock(&f)?;
    Ok(())
}
