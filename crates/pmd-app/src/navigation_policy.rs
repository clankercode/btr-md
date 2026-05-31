use std::sync::atomic::{AtomicBool, Ordering};

use tauri::Url;

/// One-shot navigation sentinel for the app shell.
///
/// Tauri loads the bundled app at startup. After that initial document load,
/// markdown-authored links, images, or scriptable DOM state must not be able to
/// navigate the application webview away from the shell.
pub struct NavigationGate {
    app_shell_url: Url,
    initial_shell_load_available: AtomicBool,
}

impl NavigationGate {
    pub fn new(app_shell_url: Url) -> Self {
        Self {
            app_shell_url,
            initial_shell_load_available: AtomicBool::new(true),
        }
    }

    pub fn should_allow_navigation(&self, url: &Url) -> bool {
        if !same_url_without_fragment(&self.app_shell_url, url) {
            return false;
        }
        self.initial_shell_load_available
            .compare_exchange(true, false, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }
}

fn same_url_without_fragment(expected: &Url, candidate: &Url) -> bool {
    expected.scheme() == candidate.scheme()
        && expected.username() == candidate.username()
        && expected.password() == candidate.password()
        && expected.host_str() == candidate.host_str()
        && expected.port_or_known_default() == candidate.port_or_known_default()
        && expected.path() == candidate.path()
        && expected.query() == candidate.query()
}
