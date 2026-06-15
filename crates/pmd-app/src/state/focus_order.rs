//! Most-recently-focused window ordering for launch routing. Not a single source
//! of truth — `most_recent` is filtered against the set of currently-live window
//! labels and falls back to the first live label.

#[derive(Default)]
pub struct MruOrder {
    order: Vec<String>, // front = most recent
}

impl MruOrder {
    pub fn touch(&mut self, label: &str) {
        self.order.retain(|l| l != label);
        self.order.insert(0, label.to_string());
    }
    pub fn remove(&mut self, label: &str) {
        self.order.retain(|l| l != label);
    }
    /// First MRU label still live; else the first live label.
    pub fn most_recent(&self, live: &[&str]) -> Option<String> {
        self.order
            .iter()
            .find(|l| live.contains(&l.as_str()))
            .cloned()
            .or_else(|| live.first().map(|s| s.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn touch_moves_label_to_front_and_dedups() {
        let mut m = MruOrder::default();
        m.touch("main");
        m.touch("w-2");
        m.touch("main");
        assert_eq!(m.most_recent(&["main", "w-2"]), Some("main".to_string()));
        m.remove("main");
        assert_eq!(m.most_recent(&["w-2"]), Some("w-2".to_string()));
    }
    #[test]
    fn most_recent_skips_dead_labels_and_falls_back() {
        let mut m = MruOrder::default();
        m.touch("w-9"); // since closed
        assert_eq!(m.most_recent(&["main"]), Some("main".to_string()));
    }
    #[test]
    fn most_recent_none_when_no_live_windows() {
        let m = MruOrder::default();
        assert_eq!(m.most_recent(&[]), None);
    }
}
