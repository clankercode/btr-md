//! In-memory, single-writer store of the live per-window session. Each renderer
//! pushes its own window slice (`upsert`); the backend merges by label and is the
//! sole writer to `session.json`. The close transaction implements the
//! "last-window-keeps-snapshot" policy race-free (see the design spec section 3).

use std::sync::Mutex;

use crate::state::session::{self, Session, SessionWindow, SESSION_VERSION};

#[derive(Debug, PartialEq, Eq)]
pub enum CloseOutcome {
    /// Other windows remain — this one is forgotten (not restored next launch).
    Pruned,
    /// This was the last live window (app quitting) — full snapshot preserved.
    PreservedForQuit,
}

pub struct SessionStore {
    inner: Mutex<State>,
}

#[derive(Default)]
struct State {
    windows: Vec<SessionWindow>,
    focused: Option<String>,
}

impl Default for SessionStore {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionStore {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(State::default()),
        }
    }

    /// Seed the store from a loaded session (startup) so restored windows are
    /// already "live" and a later prune behaves correctly.
    pub fn seed(&self, session: Session) {
        let mut s = self.lock();
        s.windows = session.windows;
        s.focused = session.focused_label;
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Insert or replace one window's slice, preserving first-seen order.
    pub fn upsert(&self, window: SessionWindow) {
        let mut s = self.lock();
        match s.windows.iter_mut().find(|w| w.label == window.label) {
            Some(existing) => *existing = window,
            None => s.windows.push(window),
        }
    }

    pub fn set_focused(&self, label: &str) {
        self.lock().focused = Some(label.to_string());
    }

    /// The close transaction. If other live windows remain, prune this one
    /// (deliberate single close). If it is the last, keep the full snapshot so
    /// the whole workspace restores next launch.
    pub fn window_closing(&self, label: &str) -> CloseOutcome {
        let mut s = self.lock();
        let live = s.windows.len();
        if live <= 1 {
            CloseOutcome::PreservedForQuit
        } else {
            s.windows.retain(|w| w.label != label);
            if s.focused.as_deref() == Some(label) {
                s.focused = None;
            }
            CloseOutcome::Pruned
        }
    }

    /// A consistent copy of the current persisted shape.
    pub fn snapshot(&self) -> Session {
        let s = self.lock();
        Session {
            version: SESSION_VERSION,
            windows: s.windows.clone(),
            focused_label: s.focused.clone(),
        }
    }

    /// Persist the current snapshot atomically (single writer).
    pub fn persist(&self) -> anyhow::Result<()> {
        session::save_session(&self.snapshot())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::session::{SessionWindow, WindowGeometry};

    fn win(label: &str) -> SessionWindow {
        SessionWindow {
            label: label.into(),
            geometry: WindowGeometry::default(),
            docs: vec![],
            active: None,
            browser_tab: false,
        }
    }

    #[test]
    fn upsert_merges_by_label_and_keeps_order() {
        let store = SessionStore::new();
        store.upsert(win("main"));
        store.upsert(win("w-2"));
        store.upsert(SessionWindow {
            browser_tab: true,
            ..win("main")
        }); // update
        let snap = store.snapshot();
        assert_eq!(
            snap.windows
                .iter()
                .map(|w| w.label.clone())
                .collect::<Vec<_>>(),
            ["main", "w-2"]
        );
        assert!(snap.windows[0].browser_tab); // merged update, original position
    }

    #[test]
    fn closing_a_non_last_window_prunes_it() {
        let store = SessionStore::new();
        store.upsert(win("main"));
        store.upsert(win("w-2"));
        let outcome = store.window_closing("w-2");
        assert_eq!(outcome, CloseOutcome::Pruned);
        let labels: Vec<_> = store
            .snapshot()
            .windows
            .iter()
            .map(|w| w.label.clone())
            .collect();
        assert_eq!(labels, ["main"]);
    }

    #[test]
    fn closing_the_last_window_preserves_full_snapshot() {
        let store = SessionStore::new();
        store.upsert(win("main"));
        store.upsert(win("w-2"));
        assert_eq!(store.window_closing("w-2"), CloseOutcome::Pruned);
        assert_eq!(store.window_closing("main"), CloseOutcome::PreservedForQuit);
        assert_eq!(store.snapshot().windows.len(), 1);
    }

    #[test]
    fn set_focused_is_reflected_in_snapshot() {
        let store = SessionStore::new();
        store.upsert(win("main"));
        store.set_focused("main");
        assert_eq!(store.snapshot().focused_label.as_deref(), Some("main"));
    }
}
