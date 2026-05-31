use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use base64::Engine;
use pmd_core::facts::{ImageFact, LinkKind};

use crate::preview::contracts::{
    DocumentIssue, IssueCategory, IssueSeverity, ResourceDecision, ResourceDecisionKind,
    ResourceKind, ResourcePolicyReport, ResourceReason,
};

pub struct ResourcePolicyContext<'a> {
    pub doc_id: u64,
    pub version: u64,
    pub doc_path: Option<&'a Path>,
    pub markdown: &'a str,
    pub rendered_html: &'a str,
    pub allowed_roots: Vec<PathBuf>,
}

pub struct ResourcePolicyResolution {
    pub safe_html: String,
    pub report: ResourcePolicyReport,
    pub issues: Vec<DocumentIssue>,
}

pub fn resolve_resources(
    context: ResourcePolicyContext<'_>,
) -> Result<ResourcePolicyResolution, String> {
    let mut report = ResourcePolicyReport::empty(context.doc_id, context.version);
    let roots = canonical_allowed_roots(&context.allowed_roots)?;
    report.allowed_roots = roots
        .iter()
        .map(|path| path.display().to_string())
        .collect();

    let facts = pmd_core::emit::render_string(context.markdown).facts;
    let mut decisions = Vec::new();

    for (index, image) in facts.images.iter().enumerate() {
        decisions.push(decide_image(&context, &roots, index, image)?);
    }
    let mut next_image_index = facts.images.len();
    for image in scan_unresolved_reference_images(context.markdown, &facts.reference_definitions) {
        decisions.push(decide_image(&context, &roots, next_image_index, &image)?);
        next_image_index += 1;
    }

    for link in &facts.links {
        if matches!(link.kind, LinkKind::ExternalUrl | LinkKind::Mailto) {
            let Some(target) = &link.target else {
                continue;
            };
            decisions.push(ResourceDecision {
                source_target: target.clone(),
                normalized_target: Some(target.clone()),
                line_start: link.line_start,
                line_end: link.line_end,
                kind: ResourceKind::Link,
                decision: ResourceDecisionKind::Unchecked,
                reason: ResourceReason::ExternalLinkRequiresConfirmation,
                safe_url: None,
                placeholder_id: None,
                alt_text: Some(link.label_text.clone()),
            });
        }
    }

    report.loaded_resources = decisions
        .iter()
        .filter_map(|decision| {
            (decision.decision == ResourceDecisionKind::Allowed)
                .then(|| decision.normalized_target.clone())
                .flatten()
        })
        .collect();
    let issues = decisions_to_issues(context.doc_id, context.version, &decisions);
    let safe_html = rewrite_html_with_placeholders(context.rendered_html, &decisions)?;
    report.decisions = decisions;

    Ok(ResourcePolicyResolution {
        safe_html,
        report,
        issues,
    })
}

pub fn resolve_for_test(
    doc_id: u64,
    version: u64,
    doc_path: &Path,
    markdown: &str,
) -> Result<ResourcePolicyResolution, String> {
    let core = pmd_core::emit::render_string(markdown);
    resolve_resources(ResourcePolicyContext {
        doc_id,
        version,
        doc_path: Some(doc_path),
        markdown,
        rendered_html: &core.html,
        allowed_roots: vec![doc_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .to_path_buf()],
    })
}

fn decide_image(
    context: &ResourcePolicyContext<'_>,
    roots: &[PathBuf],
    index: usize,
    image: &ImageFact,
) -> Result<ResourceDecision, String> {
    let placeholder_id = Some(format!("image-{index}"));
    let Some(target) = &image.target else {
        return Ok(image_decision(
            image,
            format!(
                "reference:{}",
                image.reference_label.as_deref().unwrap_or("<missing>")
            ),
            None,
            ResourceDecisionKind::Missing,
            ResourceReason::MissingFile,
            None,
            placeholder_id,
        ));
    };

    if target.starts_with("http://") || target.starts_with("https://") || target.starts_with("//") {
        return Ok(image_decision(
            image,
            target.clone(),
            Some(target.clone()),
            ResourceDecisionKind::Blocked,
            ResourceReason::RemoteBlocked,
            None,
            placeholder_id,
        ));
    }

    if target.starts_with("file://") {
        return Ok(image_decision(
            image,
            target.clone(),
            Some(target.clone()),
            ResourceDecisionKind::Blocked,
            ResourceReason::FileUrlBlocked,
            None,
            placeholder_id,
        ));
    }

    if target.starts_with("data:") {
        let allowed = is_safe_data_image(target);
        return Ok(image_decision(
            image,
            target.clone(),
            Some(target.clone()),
            if allowed {
                ResourceDecisionKind::Allowed
            } else {
                ResourceDecisionKind::Blocked
            },
            if allowed {
                ResourceReason::AllowedLocalScope
            } else {
                ResourceReason::UnsafeDataUri
            },
            allowed.then(|| target.clone()),
            placeholder_id,
        ));
    }

    if has_url_scheme(target) {
        return Ok(image_decision(
            image,
            target.clone(),
            Some(target.clone()),
            ResourceDecisionKind::Blocked,
            ResourceReason::InvalidProtocol,
            None,
            placeholder_id,
        ));
    }

    let Some(doc_path) = context.doc_path else {
        return Ok(image_decision(
            image,
            target.clone(),
            None,
            ResourceDecisionKind::Blocked,
            ResourceReason::OutsideAllowedRoots,
            None,
            placeholder_id,
        ));
    };
    let Some(doc_dir) = doc_path.parent() else {
        return Ok(image_decision(
            image,
            target.clone(),
            None,
            ResourceDecisionKind::Blocked,
            ResourceReason::OutsideAllowedRoots,
            None,
            placeholder_id,
        ));
    };

    let candidate = normalize_path(doc_dir.join(target))?;
    if candidate.exists() {
        let canonical = canonical_existing_path(&candidate)?;
        if roots.iter().any(|root| is_within(root, &canonical)) {
            match data_url_for_local_image(&canonical) {
                Ok(safe_url) => Ok(image_decision(
                    image,
                    target.clone(),
                    Some(canonical.display().to_string()),
                    ResourceDecisionKind::Allowed,
                    ResourceReason::AllowedLocalScope,
                    Some(safe_url),
                    placeholder_id,
                )),
                Err(_) => Ok(image_decision(
                    image,
                    target.clone(),
                    Some(canonical.display().to_string()),
                    ResourceDecisionKind::Blocked,
                    ResourceReason::InvalidProtocol,
                    None,
                    placeholder_id,
                )),
            }
        } else {
            Ok(image_decision(
                image,
                target.clone(),
                Some(canonical.display().to_string()),
                ResourceDecisionKind::Blocked,
                ResourceReason::OutsideAllowedRoots,
                None,
                placeholder_id,
            ))
        }
    } else if roots.iter().any(|root| is_within(root, &candidate)) {
        Ok(image_decision(
            image,
            target.clone(),
            Some(candidate.display().to_string()),
            ResourceDecisionKind::Missing,
            ResourceReason::MissingFile,
            None,
            placeholder_id,
        ))
    } else {
        Ok(image_decision(
            image,
            target.clone(),
            Some(candidate.display().to_string()),
            ResourceDecisionKind::Blocked,
            ResourceReason::OutsideAllowedRoots,
            None,
            placeholder_id,
        ))
    }
}

fn scan_unresolved_reference_images(
    markdown: &str,
    definitions: &[pmd_core::facts::ReferenceDefinitionFact],
) -> Vec<ImageFact> {
    let defined_labels = definitions
        .iter()
        .map(|definition| normalize_reference_label(&definition.label))
        .collect::<BTreeSet<_>>();
    let mut images = Vec::new();

    for (line_index, line) in markdown.lines().enumerate() {
        let mut cursor = 0;
        while let Some(open_rel) = line[cursor..].find("![") {
            let open = cursor + open_rel;
            let Some(alt_close_rel) = line[open + 2..].find(']') else {
                break;
            };
            let alt_close = open + 2 + alt_close_rel;
            if line.as_bytes().get(alt_close + 1) != Some(&b'[') {
                cursor = alt_close + 1;
                continue;
            }
            let Some(ref_close_rel) = line[alt_close + 2..].find(']') else {
                break;
            };
            let ref_close = alt_close + 2 + ref_close_rel;
            let label = &line[alt_close + 2..ref_close];
            let normalized = normalize_reference_label(label);
            if !normalized.is_empty() && !defined_labels.contains(&normalized) {
                images.push(ImageFact {
                    target: None,
                    alt_text: line[open + 2..alt_close].to_string(),
                    title: None,
                    reference_label: Some(label.to_string()),
                    definition_id: None,
                    line_start: (line_index + 1).try_into().unwrap_or(u32::MAX),
                    line_end: (line_index + 1).try_into().unwrap_or(u32::MAX),
                });
            }
            cursor = ref_close + 1;
        }
    }

    images
}

fn normalize_reference_label(label: &str) -> String {
    label
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

fn image_decision(
    image: &ImageFact,
    source_target: String,
    normalized_target: Option<String>,
    decision: ResourceDecisionKind,
    reason: ResourceReason,
    safe_url: Option<String>,
    placeholder_id: Option<String>,
) -> ResourceDecision {
    ResourceDecision {
        source_target,
        normalized_target,
        line_start: image.line_start,
        line_end: image.line_end,
        kind: ResourceKind::Image,
        decision,
        reason,
        safe_url,
        placeholder_id,
        alt_text: Some(image.alt_text.clone()),
    }
}

fn decisions_to_issues(
    doc_id: u64,
    version: u64,
    decisions: &[ResourceDecision],
) -> Vec<DocumentIssue> {
    decisions
        .iter()
        .filter(|decision| decision.kind == ResourceKind::Image)
        .filter(|decision| {
            matches!(
                decision.decision,
                ResourceDecisionKind::Blocked | ResourceDecisionKind::Missing
            )
        })
        .map(|decision| DocumentIssue {
            id: format!(
                "resource:{doc_id}:{version}:{}:{}",
                decision.kind.as_str(),
                decision.line_start
            ),
            severity: if decision.decision == ResourceDecisionKind::Missing {
                IssueSeverity::Error
            } else {
                IssueSeverity::Blocked
            },
            category: if decision.kind == ResourceKind::Image {
                IssueCategory::Image
            } else {
                IssueCategory::ResourcePolicy
            },
            line_start: Some(decision.line_start),
            line_end: Some(decision.line_end),
            block_id: None,
            message: issue_message(decision),
            detail: decision.normalized_target.clone(),
            primary_action: grant_action_for(decision),
        })
        .collect()
}

fn rewrite_html_with_placeholders(
    rendered_html: &str,
    decisions: &[ResourceDecision],
) -> Result<String, String> {
    let mut html = strip_navigation_fields(rendered_html);
    for decision in decisions
        .iter()
        .filter(|decision| decision.kind == ResourceKind::Image)
    {
        let replacement = match decision.decision {
            ResourceDecisionKind::Allowed => {
                if let Some(safe_url) = &decision.safe_url {
                    format!(
                        "<img src=\"{}\" alt=\"{}\" data-pmd-resource=\"allowed\">",
                        html_escape(safe_url),
                        html_escape(decision.alt_text.as_deref().unwrap_or(""))
                    )
                } else {
                    blocked_placeholder(decision)
                }
            }
            ResourceDecisionKind::Blocked | ResourceDecisionKind::Missing => {
                blocked_placeholder(decision)
            }
            ResourceDecisionKind::Unchecked => continue,
        };
        if let Some(id) = &decision.placeholder_id {
            html = replace_image_marker(&html, id, &replacement);
        }
    }
    Ok(html)
}

fn replace_image_marker(html: &str, placeholder_id: &str, replacement: &str) -> String {
    let marker = format!("data-pmd-image-id=\"{placeholder_id}\"");
    let Some(marker_pos) = html.find(&marker) else {
        return html.to_string();
    };
    let Some(start_rel) = html[..marker_pos].rfind("<span") else {
        return html.to_string();
    };
    let Some(end_rel) = html[marker_pos..].find("</span>") else {
        return html.to_string();
    };
    let end = marker_pos + end_rel + "</span>".len();

    let mut rewritten = String::with_capacity(html.len() + replacement.len());
    rewritten.push_str(&html[..start_rel]);
    rewritten.push_str(replacement);
    rewritten.push_str(&html[end..]);
    rewritten
}

fn blocked_placeholder(decision: &ResourceDecision) -> String {
    format!(
        "<span class=\"pmd-image-placeholder pmd-resource-blocked\" data-pmd-resource=\"blocked\" role=\"img\" aria-label=\"{}\">Content Blocked: {}</span>",
        html_escape(decision.alt_text.as_deref().unwrap_or("blocked image")),
        html_escape(&issue_message(decision))
    )
}

fn strip_navigation_fields(html: &str) -> String {
    html.replace(" href=", " data-pmd-stripped-href=")
        .replace(" target=", " data-pmd-stripped-target=")
        .replace(" download=", " data-pmd-stripped-download=")
        .replace(" ping=", " data-pmd-stripped-ping=")
}

fn is_safe_data_image(target: &str) -> bool {
    target.starts_with("data:image/png;base64,")
        || target.starts_with("data:image/jpeg;base64,")
        || target.starts_with("data:image/gif;base64,")
        || target.starts_with("data:image/webp;base64,")
}

fn data_url_for_local_image(path: &Path) -> Result<String, String> {
    let mime = match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        _ => {
            return Err(format!(
                "Unsupported local image type for {}",
                path.display()
            ))
        }
    };
    let bytes =
        std::fs::read(path).map_err(|err| format!("Could not read {}: {err}", path.display()))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

fn has_url_scheme(target: &str) -> bool {
    let Some(colon) = target.find(':') else {
        return false;
    };
    let scheme = &target[..colon];
    !scheme.is_empty()
        && scheme
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '+' | '-' | '.'))
}

fn normalize_path(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let mut normalized = PathBuf::new();
    for component in path.as_ref().components() {
        match component {
            std::path::Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            std::path::Component::RootDir => normalized.push(component.as_os_str()),
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                if !normalized.pop() {
                    return Err("Path escapes above the document root".to_string());
                }
            }
            std::path::Component::Normal(part) => normalized.push(part),
        }
    }
    Ok(normalized)
}

fn canonical_existing_path(path: &Path) -> Result<PathBuf, String> {
    path.canonicalize()
        .map_err(|err| format!("Could not canonicalize {}: {err}", path.display()))
}

fn canonical_allowed_roots(roots: &[PathBuf]) -> Result<Vec<PathBuf>, String> {
    roots
        .iter()
        .map(|root| canonical_existing_path(root))
        .collect()
}

fn is_within(root: &Path, child: &Path) -> bool {
    child == root || child.starts_with(root)
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn issue_message(decision: &ResourceDecision) -> String {
    if decision.kind == ResourceKind::Image && decision.source_target.starts_with("reference:") {
        return "Image reference unresolved: define the reference or use an inline path."
            .to_string();
    }
    match decision.reason {
        ResourceReason::RemoteBlocked => {
            "Remote image blocked: use a local file or open the URL outside the preview."
                .to_string()
        }
        ResourceReason::FileUrlBlocked => {
            "file:// resource blocked: use a relative local path and grant the containing folder."
                .to_string()
        }
        ResourceReason::OutsideAllowedRoots => {
            "Image blocked: grant the containing folder or move it under the document folder."
                .to_string()
        }
        ResourceReason::MissingFile => {
            "Image missing: fix the path or move the file next to the document.".to_string()
        }
        ResourceReason::UnsafeDataUri => {
            "Unsafe data URI blocked: use a PNG, JPEG, or GIF data image.".to_string()
        }
        ResourceReason::InvalidProtocol => {
            "Resource blocked: unsupported or unsafe URL scheme.".to_string()
        }
        ResourceReason::ExternalLinkRequiresConfirmation => {
            "External link requires confirmation before opening outside the app.".to_string()
        }
        ResourceReason::AllowedLocalScope | ResourceReason::NotApplicable => {
            "Resource allowed.".to_string()
        }
    }
}

fn grant_action_for(decision: &ResourceDecision) -> Option<String> {
    if decision.kind == ResourceKind::Image
        && matches!(
            decision.reason,
            ResourceReason::OutsideAllowedRoots | ResourceReason::FileUrlBlocked
        )
    {
        Some("asset.grantFolder".to_string())
    } else {
        None
    }
}
