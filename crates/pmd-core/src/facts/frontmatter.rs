use std::collections::BTreeMap;

use crate::facts::{CommonFrontmatter, FrontmatterFact, FrontmatterFormat, FrontmatterSyntax};

pub fn parse_frontmatter(source: &str) -> Option<FrontmatterFact> {
    let mut lines = source.lines();
    let first = lines.next()?;
    let (format, fence) = match first.trim_end() {
        "---" => (FrontmatterFormat::Yaml, "---"),
        "+++" => (FrontmatterFormat::Toml, "+++"),
        _ => return None,
    };

    let mut raw = String::new();
    let mut body = Vec::new();
    raw.push_str(first);
    raw.push('\n');

    for (idx, line) in lines.enumerate() {
        let line_number = idx + 2;
        raw.push_str(line);
        raw.push('\n');
        if line.trim_end() == fence {
            let content = body.join("\n");
            let (syntax, metadata) = parse_metadata(&format, &content);
            return Some(FrontmatterFact {
                format,
                line_start: 1,
                line_end: line_number.saturating_sub(1).try_into().unwrap_or(u32::MAX),
                raw,
                syntax,
                metadata,
            });
        }
        body.push(line);
    }

    Some(FrontmatterFact {
        format,
        line_start: 1,
        line_end: source.lines().count().try_into().unwrap_or(u32::MAX),
        raw,
        syntax: FrontmatterSyntax::Malformed,
        metadata: CommonFrontmatter::default(),
    })
}

fn parse_metadata(
    format: &FrontmatterFormat,
    content: &str,
) -> (FrontmatterSyntax, CommonFrontmatter) {
    match format {
        FrontmatterFormat::Yaml => parse_yaml_metadata(content),
        FrontmatterFormat::Toml => parse_toml_metadata(content),
    }
}

fn parse_yaml_metadata(content: &str) -> (FrontmatterSyntax, CommonFrontmatter) {
    let Ok(documents) = yaml_rust2::YamlLoader::load_from_str(content) else {
        return (FrontmatterSyntax::Malformed, CommonFrontmatter::default());
    };
    let Some(document) = documents.first() else {
        return (FrontmatterSyntax::Valid, CommonFrontmatter::default());
    };
    let Some(hash) = document.as_hash() else {
        return (FrontmatterSyntax::Valid, CommonFrontmatter::default());
    };

    let mut metadata = CommonFrontmatter::default();
    for (key, value) in hash {
        let Some(key) = key.as_str() else {
            continue;
        };
        apply_yaml_metadata_value(&mut metadata, key, value);
    }

    (FrontmatterSyntax::Valid, metadata)
}

fn apply_yaml_metadata_value(
    metadata: &mut CommonFrontmatter,
    key: &str,
    value: &yaml_rust2::Yaml,
) {
    match key {
        "title" => metadata.title = value.as_str().map(ToOwned::to_owned),
        "description" => metadata.description = value.as_str().map(ToOwned::to_owned),
        "slug" => metadata.slug = value.as_str().map(ToOwned::to_owned),
        "sidebar_label" => metadata.sidebar_label = value.as_str().map(ToOwned::to_owned),
        "sidebar_position" => metadata.sidebar_position = value.as_i64(),
        "tags" => metadata.tags = yaml_tags(value),
        "draft" => metadata.draft = value.as_bool(),
        _ => {
            if let Some(value) = yaml_scalar_string(value) {
                metadata.unknown.insert(key.to_string(), value);
            }
        }
    }
}

fn yaml_tags(value: &yaml_rust2::Yaml) -> Vec<String> {
    match value {
        yaml_rust2::Yaml::Array(items) => items
            .iter()
            .filter_map(yaml_scalar_string)
            .collect::<Vec<_>>(),
        _ => yaml_scalar_string(value).into_iter().collect(),
    }
}

fn yaml_scalar_string(value: &yaml_rust2::Yaml) -> Option<String> {
    if let Some(value) = value.as_str() {
        Some(value.to_string())
    } else if let Some(value) = value.as_i64() {
        Some(value.to_string())
    } else {
        value.as_bool().map(|value| value.to_string())
    }
}

fn parse_toml_metadata(content: &str) -> (FrontmatterSyntax, CommonFrontmatter) {
    let Ok(value) = content.parse::<toml::Value>() else {
        return (FrontmatterSyntax::Malformed, CommonFrontmatter::default());
    };
    let Some(table) = value.as_table() else {
        return (FrontmatterSyntax::Valid, CommonFrontmatter::default());
    };

    let mut metadata = CommonFrontmatter::default();
    let mut unknown = BTreeMap::new();

    for (key, value) in table {
        match key.as_str() {
            "title" => metadata.title = value.as_str().map(ToOwned::to_owned),
            "description" => metadata.description = value.as_str().map(ToOwned::to_owned),
            "slug" => metadata.slug = value.as_str().map(ToOwned::to_owned),
            "sidebar_label" => metadata.sidebar_label = value.as_str().map(ToOwned::to_owned),
            "sidebar_position" => metadata.sidebar_position = value.as_integer(),
            "tags" => metadata.tags = toml_tags(value),
            "draft" => metadata.draft = value.as_bool(),
            _ => {
                if let Some(value) = toml_scalar_string(value) {
                    unknown.insert(key.clone(), value);
                }
            }
        }
    }

    metadata.unknown = unknown;
    (FrontmatterSyntax::Valid, metadata)
}

fn toml_tags(value: &toml::Value) -> Vec<String> {
    match value {
        toml::Value::Array(items) => items
            .iter()
            .filter_map(toml_scalar_string)
            .collect::<Vec<_>>(),
        _ => toml_scalar_string(value).into_iter().collect(),
    }
}

fn toml_scalar_string(value: &toml::Value) -> Option<String> {
    if let Some(value) = value.as_str() {
        Some(value.to_string())
    } else if let Some(value) = value.as_integer() {
        Some(value.to_string())
    } else {
        value.as_bool().map(|value| value.to_string())
    }
}
