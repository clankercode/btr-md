use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use pmd_core::facts::{CoreDocumentFacts, LinkKind};

use crate::preview::contracts::{
    DocumentDiagnostics, DocumentIssue, IssueCategory, IssueSeverity, LinkValidationSummary,
};

#[derive(Debug, Clone)]
pub struct ValidationLimits {
    pub max_facts_per_render: usize,
    pub max_distinct_cross_file_targets: usize,
    pub max_single_file_bytes: u64,
    pub max_total_bytes: u64,
    pub max_concurrent_checks: usize,
}

impl Default for ValidationLimits {
    fn default() -> Self {
        Self {
            max_facts_per_render: 512,
            max_distinct_cross_file_targets: 64,
            max_single_file_bytes: 1024 * 1024,
            max_total_bytes: 8 * 1024 * 1024,
            max_concurrent_checks: 4,
        }
    }
}

pub struct ValidationRequest {
    pub doc_id: u64,
    pub version: u64,
    pub doc_path: PathBuf,
    pub markdown: String,
    pub initial_diagnostics: DocumentDiagnostics,
    pub is_current: Arc<dyn Fn(u64, u64) -> bool + Send + Sync>,
}

#[derive(Default)]
struct CrossFileAnchorCache {
    anchors_by_path: BTreeMap<PathBuf, CachedAnchorFacts>,
    paths_by_doc: BTreeMap<u64, BTreeSet<PathBuf>>,
}

struct CachedAnchorFacts {
    modified: Option<std::time::SystemTime>,
    len: u64,
    anchors: Vec<String>,
}

impl CrossFileAnchorCache {
    async fn get_or_read(
        &mut self,
        doc_id: u64,
        path: &Path,
        budget: &mut ValidationBudget<'_>,
        fs_gate: &tokio::sync::Semaphore,
    ) -> Result<Option<Vec<String>>, String> {
        let _permit = fs_gate.acquire().await.map_err(|err| err.to_string())?;
        let canonical = match tokio::fs::canonicalize(path).await {
            Ok(path) => path,
            Err(err) => return Err(err.to_string()),
        };
        if !budget.try_cross_file_target(&canonical) {
            return Ok(None);
        }
        self.paths_by_doc
            .entry(doc_id)
            .or_default()
            .insert(canonical.clone());
        let metadata = tokio::fs::metadata(&canonical)
            .await
            .map_err(|err| err.to_string())?;
        if !budget.reserve_file_read(metadata.len()) {
            return Ok(None);
        }
        let modified = metadata.modified().ok();
        if let Some(cached) = self.anchors_by_path.get(&canonical) {
            if cached.modified == modified && cached.len == metadata.len() {
                return Ok(Some(cached.anchors.clone()));
            }
        }
        let markdown = tokio::fs::read_to_string(&canonical)
            .await
            .map_err(|err| err.to_string())?;
        let facts = pmd_core::emit::render_string(&markdown).facts;
        let anchors = facts
            .anchors
            .into_iter()
            .map(|anchor| anchor.slug)
            .collect::<Vec<_>>();
        self.anchors_by_path.insert(
            canonical,
            CachedAnchorFacts {
                modified,
                len: metadata.len(),
                anchors: anchors.clone(),
            },
        );
        Ok(Some(anchors))
    }

    fn invalidate_path(&mut self, path: &Path) {
        let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        self.anchors_by_path.remove(&canonical);
    }

    fn invalidate_doc(&mut self, doc_id: u64) {
        if let Some(paths) = self.paths_by_doc.remove(&doc_id) {
            for path in paths {
                self.anchors_by_path.remove(&path);
            }
        }
    }
}

struct ValidationBudget<'a> {
    limits: &'a ValidationLimits,
    remaining_fact_checks: usize,
    skipped_facts: usize,
    distinct_cross_file_targets: BTreeSet<PathBuf>,
    total_read_bytes: u64,
    skipped_cross_file_targets: usize,
    skipped_oversized_files: usize,
    skipped_total_bytes: usize,
}

impl<'a> ValidationBudget<'a> {
    fn new(limits: &'a ValidationLimits, facts: &CoreDocumentFacts) -> Self {
        let reference_facts = facts.reference_definitions.len();
        Self {
            limits,
            remaining_fact_checks: limits.max_facts_per_render.saturating_sub(reference_facts),
            skipped_facts: reference_facts.saturating_sub(limits.max_facts_per_render),
            distinct_cross_file_targets: BTreeSet::new(),
            total_read_bytes: 0,
            skipped_cross_file_targets: 0,
            skipped_oversized_files: 0,
            skipped_total_bytes: 0,
        }
    }

    fn consume_fact(&mut self) -> bool {
        if self.remaining_fact_checks == 0 {
            self.skipped_facts += 1;
            return false;
        }
        self.remaining_fact_checks -= 1;
        true
    }

    fn try_cross_file_target(&mut self, canonical: &Path) -> bool {
        if self.distinct_cross_file_targets.contains(canonical) {
            return true;
        }
        if self.distinct_cross_file_targets.len() >= self.limits.max_distinct_cross_file_targets {
            self.skipped_cross_file_targets += 1;
            return false;
        }
        self.distinct_cross_file_targets
            .insert(canonical.to_path_buf());
        true
    }

    fn reserve_file_read(&mut self, bytes: u64) -> bool {
        if bytes > self.limits.max_single_file_bytes {
            self.skipped_oversized_files += 1;
            return false;
        }
        if self.total_read_bytes.saturating_add(bytes) > self.limits.max_total_bytes {
            self.skipped_total_bytes += 1;
            return false;
        }
        self.total_read_bytes += bytes;
        true
    }

    fn append_warnings(&self, issues: &mut Vec<DocumentIssue>) {
        if self.skipped_facts > 0 {
            issues.push(issue(
                "validation-budget-facts",
                IssueSeverity::Warning,
                IssueCategory::Filesystem,
                1,
                1,
                format!(
                    "Validation skipped {} link/image/reference facts because this render exceeded the 512 fact budget.",
                    self.skipped_facts
                ),
            ));
        }
        if self.skipped_cross_file_targets > 0 {
            issues.push(issue(
                "validation-budget-targets",
                IssueSeverity::Warning,
                IssueCategory::Filesystem,
                1,
                1,
                format!(
                    "Validation skipped {} cross-file Markdown targets because this render exceeded the 64 target budget.",
                    self.skipped_cross_file_targets
                ),
            ));
        }
        if self.skipped_oversized_files > 0 || self.skipped_total_bytes > 0 {
            issues.push(issue(
                "validation-budget-bytes",
                IssueSeverity::Warning,
                IssueCategory::Filesystem,
                1,
                1,
                format!(
                    "Validation skipped {} oversized files and {} files beyond the 8 MiB total read budget.",
                    self.skipped_oversized_files, self.skipped_total_bytes
                ),
            ));
        }
    }
}

pub struct ValidationEngine {
    limits: ValidationLimits,
    cache: CrossFileAnchorCache,
}

impl ValidationEngine {
    pub fn new(limits: ValidationLimits) -> Self {
        Self {
            limits,
            cache: CrossFileAnchorCache::default(),
        }
    }

    pub async fn validate(
        &mut self,
        request: ValidationRequest,
    ) -> Result<DocumentDiagnostics, String> {
        if !(request.is_current)(request.doc_id, request.version) {
            return Ok(DocumentDiagnostics::empty_initial(
                request.doc_id,
                request.version,
            ));
        }
        let facts = pmd_core::emit::render_string(&request.markdown).facts;
        let resources = request.initial_diagnostics.resources;
        let mut issues = request.initial_diagnostics.issues;
        issues.extend(
            validate_links_images_and_refs(
                &self.limits,
                &mut self.cache,
                request.doc_id,
                &request.doc_path,
                &request.markdown,
                &facts,
            )
            .await?,
        );
        if !(request.is_current)(request.doc_id, request.version) {
            return Ok(DocumentDiagnostics::empty_initial(
                request.doc_id,
                request.version,
            ));
        }
        let mut diagnostics =
            DocumentDiagnostics::enriched(request.doc_id, request.version, issues, resources);
        diagnostics.link_summary = summarize_links(&diagnostics.issues);
        Ok(diagnostics)
    }

    pub fn invalidate_for_save(&mut self, path: &Path) {
        self.cache.invalidate_path(path);
    }

    pub fn invalidate_for_watcher_change(&mut self, path: &Path) {
        self.cache.invalidate_path(path);
    }

    pub fn invalidate_for_grant_change(&mut self, doc_id: u64) {
        self.cache.invalidate_doc(doc_id);
    }

    pub fn invalidate_for_reload(&mut self, doc_id: u64) {
        self.cache.invalidate_doc(doc_id);
    }
}

pub async fn validate_for_test(
    doc_id: u64,
    version: u64,
    doc_path: &Path,
    markdown: &str,
) -> Result<DocumentDiagnostics, String> {
    let mut engine = ValidationEngine::new(ValidationLimits::default());
    engine
        .validate(ValidationRequest {
            doc_id,
            version,
            doc_path: doc_path.to_path_buf(),
            markdown: markdown.to_string(),
            initial_diagnostics: DocumentDiagnostics::empty_initial(doc_id, version),
            is_current: Arc::new(|_, _| true),
        })
        .await
}

async fn validate_links_images_and_refs(
    limits: &ValidationLimits,
    cache: &mut CrossFileAnchorCache,
    doc_id: u64,
    doc_path: &Path,
    markdown: &str,
    facts: &CoreDocumentFacts,
) -> Result<Vec<DocumentIssue>, String> {
    let mut issues = Vec::new();
    let doc_dir = doc_path.parent().unwrap_or_else(|| Path::new("."));
    let fs_gate = tokio::sync::Semaphore::new(limits.max_concurrent_checks.max(1));
    let mut budget = ValidationBudget::new(limits, facts);
    let local_anchors = facts
        .anchors
        .iter()
        .map(|anchor| anchor.slug.as_str())
        .collect::<BTreeSet<_>>();

    for link in &facts.links {
        if !budget.consume_fact() {
            continue;
        }
        let Some(target) = &link.target else {
            if link.reference_label.is_some() && link.definition_id.is_none() {
                issues.push(issue(
                    "unresolved-reference",
                    IssueSeverity::Error,
                    IssueCategory::Link,
                    link.line_start,
                    link.line_end,
                    format!(
                        "Reference link is not defined: {}",
                        link.reference_label.as_deref().unwrap_or("")
                    ),
                ));
            }
            continue;
        };
        let (path_part, fragment) = split_markdown_fragment(target);
        if path_part.is_empty() {
            if let Some(fragment) = fragment {
                if !local_anchors.contains(fragment) {
                    issues.push(issue(
                        "missing-local-anchor",
                        IssueSeverity::Error,
                        IssueCategory::Anchor,
                        link.line_start,
                        link.line_end,
                        format!("Heading anchor not found: #{fragment}"),
                    ));
                }
            }
        } else if matches!(link.kind, LinkKind::LocalMarkdown) || is_markdown_target(target) {
            let target_path = doc_dir.join(path_part);
            match cache
                .get_or_read(doc_id, &target_path, &mut budget, &fs_gate)
                .await
            {
                Ok(Some(anchors)) => {
                    if let Some(fragment) = fragment {
                        if !anchors.iter().any(|anchor| anchor == fragment) {
                            issues.push(issue(
                                "missing-cross-file-anchor",
                                IssueSeverity::Error,
                                IssueCategory::Anchor,
                                link.line_start,
                                link.line_end,
                                format!("Heading anchor not found in {path_part}: #{fragment}"),
                            ));
                        }
                    }
                }
                Ok(None) => {}
                Err(_) => issues.push(issue(
                    "missing-markdown-file",
                    IssueSeverity::Error,
                    IssueCategory::Link,
                    link.line_start,
                    link.line_end,
                    format!("Linked Markdown file not found: {path_part}"),
                )),
            }
        } else if is_local_filesystem_target(target)
            && !local_path_exists(&doc_dir.join(path_part), &fs_gate).await?
        {
            issues.push(issue(
                "missing-local-file",
                IssueSeverity::Error,
                IssueCategory::Link,
                link.line_start,
                link.line_end,
                format!("Linked local file not found: {path_part}"),
            ));
        }
    }

    for image in &facts.images {
        if !budget.consume_fact() {
            continue;
        }
        let Some(target) = &image.target else {
            issues.push(issue(
                "missing-image-reference",
                IssueSeverity::Error,
                IssueCategory::Image,
                image.line_start,
                image.line_end,
                "Image reference unresolved: define the reference or use an inline path."
                    .to_string(),
            ));
            continue;
        };
        if is_local_filesystem_target(target)
            && !local_path_exists(&doc_dir.join(target), &fs_gate).await?
        {
            issues.push(issue(
                "missing-image",
                IssueSeverity::Error,
                IssueCategory::Image,
                image.line_start,
                image.line_end,
                format!("Image file not found: {target}"),
            ));
        }
    }
    for image in scan_unresolved_reference_images(markdown, facts) {
        if !budget.consume_fact() {
            continue;
        }
        issues.push(issue(
            "missing-image-reference",
            IssueSeverity::Error,
            IssueCategory::Image,
            image.0,
            image.1,
            "Image reference unresolved: define the reference or use an inline path.".to_string(),
        ));
    }
    budget.append_warnings(&mut issues);
    Ok(issues)
}

fn scan_unresolved_reference_images(markdown: &str, facts: &CoreDocumentFacts) -> Vec<(u32, u32)> {
    let defined_labels = facts
        .reference_definitions
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
                let line_number = (line_index + 1).try_into().unwrap_or(u32::MAX);
                images.push((line_number, line_number));
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

async fn local_path_exists(path: &Path, fs_gate: &tokio::sync::Semaphore) -> Result<bool, String> {
    let _permit = fs_gate.acquire().await.map_err(|err| err.to_string())?;
    Ok(tokio::fs::metadata(path).await.is_ok())
}

fn split_markdown_fragment(target: &str) -> (&str, Option<&str>) {
    target
        .split_once('#')
        .map_or((target, None), |(path, fragment)| (path, Some(fragment)))
}

fn is_markdown_target(target: &str) -> bool {
    let (path, _) = split_markdown_fragment(target);
    let path = path
        .split_once('?')
        .map_or(path, |(without_query, _)| without_query);
    path.ends_with(".md") || path.ends_with(".markdown")
}

fn is_local_filesystem_target(target: &str) -> bool {
    !target.starts_with("http://")
        && !target.starts_with("https://")
        && !target.starts_with("mailto:")
        && !target.starts_with("file://")
        && !target.starts_with("//")
        && !target.contains(':')
}

fn issue(
    prefix: &str,
    severity: IssueSeverity,
    category: IssueCategory,
    line_start: u32,
    line_end: u32,
    message: String,
) -> DocumentIssue {
    DocumentIssue {
        id: format!("{prefix}:{line_start}:{line_end}"),
        severity,
        category,
        line_start: Some(line_start),
        line_end: Some(line_end),
        block_id: None,
        message,
        detail: None,
        primary_action: None,
    }
}

fn summarize_links(issues: &[DocumentIssue]) -> LinkValidationSummary {
    let relevant = |issue: &&DocumentIssue| {
        matches!(issue.category, IssueCategory::Link | IssueCategory::Anchor)
    };
    LinkValidationSummary {
        checked: issues.iter().filter(relevant).count() as u32,
        errors: issues
            .iter()
            .filter(relevant)
            .filter(|issue| issue.severity == IssueSeverity::Error)
            .count() as u32,
        warnings: issues
            .iter()
            .filter(relevant)
            .filter(|issue| issue.severity == IssueSeverity::Warning)
            .count() as u32,
        unchecked_external: 0,
        pending_async: 0,
    }
}
