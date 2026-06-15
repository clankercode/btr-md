pub mod focus_order;
pub mod recents;
pub mod session;
pub mod settings;
pub mod window_session;

/// A single process-wide lock guarding tests that mutate `XDG_CONFIG_HOME`.
///
/// Several state modules (`recents`, `session`) and command tests
/// (`cmd::session`) point the config dir at a temp directory by mutating the
/// `XDG_CONFIG_HOME` env var. `cargo test` runs these in parallel threads, so
/// they MUST serialise on one shared mutex — otherwise overlapping
/// `set_var`/`remove_var` calls race (and a panic inside one guard poisons a
/// per-module mutex). Test-only.
#[cfg(test)]
pub(crate) fn config_env_lock() -> std::sync::MutexGuard<'static, ()> {
    use std::sync::{Mutex, OnceLock};
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|p| p.into_inner())
}
