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

/// Maximum remembered closed windows across the app session.
const MAX_RECENTLY_CLOSED: usize = 10;

#[derive(Default)]
struct State {
    windows: Vec<SessionWindow>,
    focused: Option<String>,
    /// Set once the app is intentionally quitting (Close All / Quit). While set,
    /// `window_closing` preserves every window instead of pruning, so the whole
    /// workspace restores next launch even though the windows close one-by-one.
    quitting: bool,
    /// Windows that were deliberately closed while other windows remained live.
    /// The most recently closed is at the end of the vector.
    recently_closed: Vec<SessionWindow>,
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

    /// Mark the app as intentionally quitting (Close All / Quit). Subsequent
    /// `window_closing` calls preserve every window so the whole workspace is
    /// restored next launch, even though the windows then close one-by-one.
    pub fn begin_quit(&self) {
        self.lock().quitting = true;
    }

    /// The close transaction.
    /// - While quitting (Close All / Quit): preserve the full snapshot — every
    ///   open window is restored next launch.
    /// - Otherwise a deliberate single close: if other live windows remain,
    ///   prune this one (it is forgotten); if it is the last, preserve it.
    ///   A pruned window is pushed onto `recently_closed` so it can be reopened
    ///   with Ctrl+Shift+T or the History menu.
    pub fn window_closing(&self, label: &str) -> CloseOutcome {
        let mut s = self.lock();
        if s.quitting {
            return CloseOutcome::PreservedForQuit;
        }
        let live = s.windows.len();
        if live <= 1 {
            CloseOutcome::PreservedForQuit
        } else {
            if let Some(window) = s.windows.iter().find(|w| w.label == label).cloned() {
                s.recently_closed.push(window);
                if s.recently_closed.len() > MAX_RECENTLY_CLOSED {
                    s.recently_closed.remove(0);
                }
            }
            s.windows.retain(|w| w.label != label);
            if s.focused.as_deref() == Some(label) {
                s.focused = None;
            }
            CloseOutcome::Pruned
        }
    }

    /// Read the stack of recently closed windows (most recent last).
    pub fn recently_closed(&self) -> Vec<SessionWindow> {
        self.lock().recently_closed.clone()
    }

    /// Remove and return the recently closed window at `index` (0 = oldest).
    pub fn take_recently_closed(&self, index: usize) -> Option<SessionWindow> {
        let mut s = self.lock();
        if index >= s.recently_closed.len() {
            return None;
        }
        Some(s.recently_closed.remove(index))
    }

    /// Forget all recently closed windows.
    pub fn clear_recently_closed(&self) {
        self.lock().recently_closed.clear();
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
    fn quitting_preserves_all_windows_through_sequential_closes() {
        // Close All / Quit: every window closes one-by-one but ALL are restored.
        let store = SessionStore::new();
        store.upsert(win("main"));
        store.upsert(win("w-2"));
        store.upsert(win("w-3"));
        store.begin_quit();
        assert_eq!(store.window_closing("main"), CloseOutcome::PreservedForQuit);
        assert_eq!(store.window_closing("w-2"), CloseOutcome::PreservedForQuit);
        assert_eq!(store.window_closing("w-3"), CloseOutcome::PreservedForQuit);
        // None pruned — the whole workspace survives for next launch.
        let labels: Vec<_> = store
            .snapshot()
            .windows
            .iter()
            .map(|w| w.label.clone())
            .collect();
        assert_eq!(labels, ["main", "w-2", "w-3"]);
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

    #[test]
    fn pruning_a_window_remembers_it_as_recently_closed() {
        let store = SessionStore::new();
        store.upsert(win("main"));
        store.upsert(win("w-2"));
        assert_eq!(store.window_closing("w-2"), CloseOutcome::Pruned);
        let closed = store.recently_closed();
        assert_eq!(closed.len(), 1);
        assert_eq!(closed[0].label, "w-2");
    }

    #[test]
    fn closing_last_window_does_not_remember_recently_closed() {
        let store = SessionStore::new();
        store.upsert(win("main"));
        assert_eq!(store.window_closing("main"), CloseOutcome::PreservedForQuit);
        assert!(store.recently_closed().is_empty());
    }

    #[test]
    fn quitting_does_not_remember_recently_closed() {
        let store = SessionStore::new();
        store.upsert(win("main"));
        store.upsert(win("w-2"));
        store.begin_quit();
        assert_eq!(store.window_closing("w-2"), CloseOutcome::PreservedForQuit);
        assert!(store.recently_closed().is_empty());
    }

    #[test]
    fn recently_closed_stack_respects_capacity() {
        let store = SessionStore::new();
        for i in 1..=MAX_RECENTLY_CLOSED + 3 {
            store.upsert(win("main"));
            store.upsert(win(&format!("w-{i}")));
            assert_eq!(
                store.window_closing(&format!("w-{i}")),
                CloseOutcome::Pruned
            );
        }
        let closed = store.recently_closed();
        assert_eq!(closed.len(), MAX_RECENTLY_CLOSED);
        assert_eq!(closed[0].label, "w-4");
        assert_eq!(closed.last().unwrap().label, "w-13");
    }

    #[test]
    fn take_recently_closed_restores_in_order_and_removes_entry() {
        let store = SessionStore::new();
        store.upsert(win("main"));
        store.upsert(win("w-2"));
        store.upsert(win("w-3"));
        store.window_closing("w-2");
        store.window_closing("w-3");

        let first = store.take_recently_closed(0).unwrap();
        assert_eq!(first.label, "w-2");
        assert_eq!(store.recently_closed().len(), 1);

        let second = store.take_recently_closed(0).unwrap();
        assert_eq!(second.label, "w-3");
        assert!(store.recently_closed().is_empty());

        assert!(store.take_recently_closed(0).is_none());
    }

    #[test]
    fn clear_recently_closed_empties_stack() {
        let store = SessionStore::new();
        store.upsert(win("main"));
        store.upsert(win("w-2"));
        store.window_closing("w-2");
        store.clear_recently_closed();
        assert!(store.recently_closed().is_empty());
    }
}
