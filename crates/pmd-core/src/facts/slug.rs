use std::collections::BTreeMap;

#[derive(Debug, Default)]
pub struct Slugger {
    seen: BTreeMap<String, u32>,
}

impl Slugger {
    pub fn slug_for(&mut self, text: &str) -> (String, u32) {
        let base = github_style_base_slug(text);
        self.slug_from_base(base)
    }

    pub fn slug_explicit(&mut self, explicit_id: String) -> (String, u32) {
        self.slug_from_base(explicit_id)
    }

    fn slug_from_base(&mut self, base: String) -> (String, u32) {
        let duplicate_index = self.seen.get(&base).copied().unwrap_or(0);
        self.seen
            .insert(base.clone(), duplicate_index.saturating_add(1));

        if duplicate_index == 0 {
            (base, duplicate_index)
        } else {
            (format!("{base}-{duplicate_index}"), duplicate_index)
        }
    }
}

pub fn github_style_base_slug(text: &str) -> String {
    let mut slug = String::new();
    let mut last_was_separator = false;

    for ch in text.chars().flat_map(char::to_lowercase) {
        if ch.is_alphanumeric() {
            slug.push(ch);
            last_was_separator = false;
        } else if (ch.is_whitespace() || ch == '-') && !slug.is_empty() && !last_was_separator {
            slug.push('-');
            last_was_separator = true;
        }
    }

    while slug.ends_with('-') {
        slug.pop();
    }

    slug
}
