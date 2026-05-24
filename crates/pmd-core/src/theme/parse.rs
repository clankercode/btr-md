use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Deserialize)]
pub struct Theme {
    pub meta: Meta,
    pub palette: Palette,
    #[serde(default)]
    pub fonts: Fonts,
}
#[derive(Debug, Clone, Deserialize)]
pub struct Meta {
    pub name: String,
    pub slug: String,
    pub author: String,
    pub mode: String,
    pub version: String,
    #[serde(default)]
    pub inspired_by: Option<InspiredBy>,
    #[serde(default)]
    pub notes: Option<Notes>,
}
#[derive(Debug, Clone, Deserialize)]
pub struct InspiredBy {
    pub work: Option<String>,
    pub character: Option<String>,
}
#[derive(Debug, Clone, Deserialize)]
pub struct Notes {
    pub rationale: Option<String>,
}
#[derive(Debug, Clone, Deserialize)]
pub struct Palette {
    #[serde(flatten)]
    pub colours: BTreeMap<String, String>,
    #[serde(default)]
    pub syntax: BTreeMap<String, String>,
}
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Fonts {
    pub ui: Option<String>,
    pub mono: Option<String>,
    pub serif: Option<String>,
    pub heading: Option<String>,
    pub body: Option<String>,
    #[serde(default)]
    pub fallback: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub features: BTreeMap<String, toml::Value>,
}

pub fn parse_manifest(s: &str) -> Result<Theme, toml::de::Error> {
    toml::from_str(s)
}
