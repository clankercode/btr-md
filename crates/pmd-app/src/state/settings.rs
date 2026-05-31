use crate::doc::modes::{AutoreloadMode, AutosaveMode, DiffMode, MergeStrategy};
use anyhow::Result;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
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
    /// Lifecycle policies (Phase 1). `#[serde(default)]` keeps old `state.toml`
    /// files (written before these existed) parsing into the safe defaults.
    #[serde(default)]
    pub autosave_mode: AutosaveMode,
    #[serde(default)]
    pub autoreload_mode: AutoreloadMode,
    #[serde(default)]
    pub merge_strategy: MergeStrategy,
    /// The file-browser's trusted base directory (Phase 2). Admitted via the OS
    /// folder picker; re-admitted to the directory allowlist on startup.
    #[serde(default)]
    pub browser_base_dir: Option<PathBuf>,
    // Phase 5 settings.
    #[serde(default)]
    pub gist_enabled: bool,
    #[serde(default)]
    pub diff_mode: DiffMode,
    #[serde(default)]
    pub dont_ask_default_handler: bool,
    /// Selected mono/editor font (a downloaded Nerd Font family name), if any.
    #[serde(default)]
    pub mono_font: Option<String>,
    #[serde(default)]
    pub shortcut_overrides: BTreeMap<String, Vec<String>>,
}

/// Read the current settings from disk, falling back to defaults if the file is
/// missing or unreadable. Convenience for read-only callers (e.g. the merge
/// command) that don't need the locking read-modify-write path.
pub fn load() -> Settings {
    let p = path();
    if !p.exists() {
        return Settings::default();
    }
    std::fs::read_to_string(&p)
        .map(|s| parse_or_default(&s))
        .unwrap_or_default()
}

pub fn path() -> PathBuf {
    // See [`crate::state::recents::recents_path`] for the same fallback
    // rationale: missing HOME / unable-to-create config dir must not panic.
    xdg::BaseDirectories::with_prefix("btr-md")
        .ok()
        .and_then(|b| b.place_config_file("state.toml").ok())
        .unwrap_or_else(|| PathBuf::from("state.toml"))
}

pub fn parse_or_default(body: &str) -> Settings {
    if body.is_empty() {
        return Settings::default();
    }
    match toml::from_str::<Settings>(body) {
        Ok(settings) => settings,
        Err(e) => {
            eprintln!(
                "[btr-md] state.toml is malformed ({}); treating settings as defaults",
                e
            );
            Settings::default()
        }
    }
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
    let current = parse_or_default(&s);
    let next = merge(current);
    let out = toml::to_string_pretty(&next)?;
    f.set_len(0)?;
    f.seek(SeekFrom::Start(0))?;
    f.write_all(out.as_bytes())?;
    f.sync_all()?;
    fs2::FileExt::unlock(&f)?;
    Ok(())
}
