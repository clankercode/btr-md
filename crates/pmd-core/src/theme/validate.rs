use super::{parse::Theme, schema};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ValidationError {
    #[error("missing required palette keys: {0:?}")]
    MissingPalette(Vec<String>),
    #[error("missing required syntax keys: {0:?}")]
    MissingSyntax(Vec<String>),
    #[error("invalid hex colour for key `{key}`: `{value}`")]
    BadHex { key: String, value: String },
    #[error("contrast {ratio:.2}:1 fails AA on pair `{a}`/`{b}` (needs {min}:1)")]
    Contrast {
        a: String,
        b: String,
        ratio: f64,
        min: f64,
    },
}

impl ValidationError {
    /// True for structural / schema-level errors that callers should treat as
    /// fatal (theme cannot be safely rendered). False for the contrast check,
    /// which is a quality warning and not a correctness problem.
    pub fn is_fatal(&self) -> bool {
        matches!(
            self,
            Self::MissingPalette(_) | Self::MissingSyntax(_) | Self::BadHex { .. }
        )
    }
}

pub fn validate(t: &Theme) -> Result<(), ValidationError> {
    let req = schema::required_palette_keys();
    let missing: Vec<String> = req
        .iter()
        .filter(|k| !t.palette.colours.contains_key(**k))
        .map(|s| s.to_string())
        .collect();
    if !missing.is_empty() {
        return Err(ValidationError::MissingPalette(missing));
    }

    let sreq = schema::required_syntax_keys();
    let smissing: Vec<String> = sreq
        .iter()
        .filter(|k| !t.palette.syntax.contains_key(**k))
        .map(|s| s.to_string())
        .collect();
    if !smissing.is_empty() {
        return Err(ValidationError::MissingSyntax(smissing));
    }

    for (k, v) in &t.palette.colours {
        if super::mix::parse_hex(v).is_none() {
            return Err(ValidationError::BadHex {
                key: k.clone(),
                value: v.clone(),
            });
        }
    }

    // Syntax colours are emitted into CSS the same way palette colours are;
    // a non-hex value would let arbitrary text break out of the property
    // declaration.
    for (k, v) in &t.palette.syntax {
        if super::mix::parse_hex(v).is_none() {
            return Err(ValidationError::BadHex {
                key: format!("syntax.{k}"),
                value: v.clone(),
            });
        }
    }

    let text_pairs = [
        ("fg", "bg", 4.5),
        ("link", "bg", 4.5),
        ("fg_muted", "bg", 4.5),
        ("inline_code_fg", "inline_code_bg", 4.5),
        ("code_block_fg", "code_block_bg", 4.5),
        ("selection_fg", "selection_bg", 4.5),
    ];
    let nontext_pairs = [
        ("accent", "bg", 3.0),
        ("focus_ring", "bg", 3.0),
        ("selection_bg", "bg", 3.0),
        ("border", "bg", 3.0),
    ];
    for (a, b, min) in text_pairs.iter().chain(nontext_pairs.iter()) {
        let ratio = contrast_ratio(&t.palette.colours[*a], &t.palette.colours[*b]);
        if ratio < *min {
            return Err(ValidationError::Contrast {
                a: (*a).to_string(),
                b: (*b).to_string(),
                ratio,
                min: *min,
            });
        }
    }
    Ok(())
}

fn relative_luminance(hex: &str) -> f64 {
    // Callers in this module only reach here after BadHex validation, but
    // treat malformed input as black (luminance 0) instead of panicking so
    // the function stays defensive if reused.
    let (r, g, b) = super::mix::parse_hex(hex).unwrap_or((0, 0, 0));
    fn ch(v: u8) -> f64 {
        let s = (v as f64) / 255.0;
        if s <= 0.03928 {
            s / 12.92
        } else {
            ((s + 0.055) / 1.055).powf(2.4)
        }
    }
    0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}

fn contrast_ratio(a: &str, b: &str) -> f64 {
    let la = relative_luminance(a);
    let lb = relative_luminance(b);
    let (l1, l2) = if la > lb { (la, lb) } else { (lb, la) };
    (l1 + 0.05) / (l2 + 0.05)
}
