use pmd_core::emit;
use pmd_core::facts::{CoreDocumentFacts, FrontmatterSyntax};
use serde::{Deserialize, Serialize};

use crate::preview::resource_policy::ResourcePolicyResolution;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RenderResult {
    pub doc_id: u64,
    pub version: u64,
    pub html: String,
    pub source_map: Vec<(u32, u32)>,
    pub render_nonce: String,
    #[serde(default)]
    pub blocks: Vec<emit::BlockRef>,
    pub facts: DocumentFacts,
    pub diagnostics: DocumentDiagnostics,
}

impl RenderResult {
    pub fn from_core_and_policy(
        doc_id: u64,
        version: u64,
        core: emit::RenderResult,
        policy: ResourcePolicyResolution,
    ) -> Self {
        let mut issues = frontmatter_issues(doc_id, version, &core.facts);
        issues.extend(policy.issues);
        Self {
            doc_id,
            version,
            html: policy.safe_html,
            source_map: core.source_map,
            render_nonce: core.render_nonce,
            blocks: core.blocks,
            facts: DocumentFacts {
                doc_id,
                version,
                core: core.facts,
            },
            diagnostics: DocumentDiagnostics {
                doc_id,
                version,
                phase: DiagnosticPhase::Initial,
                issues,
                resources: policy.report,
                link_summary: LinkValidationSummary::default(),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DocumentFacts {
    pub doc_id: u64,
    pub version: u64,
    #[serde(flatten)]
    pub core: CoreDocumentFacts,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DocumentDiagnostics {
    pub doc_id: u64,
    pub version: u64,
    pub phase: DiagnosticPhase,
    pub issues: Vec<DocumentIssue>,
    pub resources: ResourcePolicyReport,
    pub link_summary: LinkValidationSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DocumentIssue {
    pub id: String,
    pub severity: IssueSeverity,
    pub category: IssueCategory,
    pub line_start: Option<u32>,
    pub line_end: Option<u32>,
    pub block_id: Option<String>,
    pub message: String,
    pub detail: Option<String>,
    pub primary_action: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticPhase {
    Initial,
    Enriched,
}

impl DiagnosticPhase {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Initial => "initial",
            Self::Enriched => "enriched",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IssueSeverity {
    Error,
    Blocked,
    Warning,
    Info,
}

impl IssueSeverity {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Error => "error",
            Self::Blocked => "blocked",
            Self::Warning => "warning",
            Self::Info => "info",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IssueCategory {
    Link,
    Anchor,
    Image,
    ResourcePolicy,
    Frontmatter,
    Security,
    Accessibility,
    Filesystem,
    Command,
}

impl IssueCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Link => "link",
            Self::Anchor => "anchor",
            Self::Image => "image",
            Self::ResourcePolicy => "resource_policy",
            Self::Frontmatter => "frontmatter",
            Self::Security => "security",
            Self::Accessibility => "accessibility",
            Self::Filesystem => "filesystem",
            Self::Command => "command",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResourcePolicyReport {
    pub doc_id: u64,
    pub version: u64,
    pub allowed_roots: Vec<String>,
    pub loaded_resources: Vec<String>,
    pub decisions: Vec<ResourceDecision>,
}

impl ResourcePolicyReport {
    pub fn empty(doc_id: u64, version: u64) -> Self {
        Self {
            doc_id,
            version,
            allowed_roots: Vec::new(),
            loaded_resources: Vec::new(),
            decisions: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResourceDecision {
    pub source_target: String,
    pub normalized_target: Option<String>,
    pub line_start: u32,
    pub line_end: u32,
    pub kind: ResourceKind,
    pub decision: ResourceDecisionKind,
    pub reason: ResourceReason,
    pub safe_url: Option<String>,
    pub placeholder_id: Option<String>,
    pub alt_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResourceKind {
    Image,
    Link,
    DataUri,
    EmbeddedRenderer,
}

impl ResourceKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::Link => "link",
            Self::DataUri => "data_uri",
            Self::EmbeddedRenderer => "embedded_renderer",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResourceDecisionKind {
    Allowed,
    Blocked,
    Missing,
    Unchecked,
}

impl ResourceDecisionKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Allowed => "allowed",
            Self::Blocked => "blocked",
            Self::Missing => "missing",
            Self::Unchecked => "unchecked",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResourceReason {
    AllowedLocalScope,
    RemoteBlocked,
    FileUrlBlocked,
    OutsideAllowedRoots,
    MissingFile,
    InvalidProtocol,
    UnsafeDataUri,
    ExternalLinkRequiresConfirmation,
    NotApplicable,
}

impl ResourceReason {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::AllowedLocalScope => "allowed_local_scope",
            Self::RemoteBlocked => "remote_blocked",
            Self::FileUrlBlocked => "file_url_blocked",
            Self::OutsideAllowedRoots => "outside_allowed_roots",
            Self::MissingFile => "missing_file",
            Self::InvalidProtocol => "invalid_protocol",
            Self::UnsafeDataUri => "unsafe_data_uri",
            Self::ExternalLinkRequiresConfirmation => "external_link_requires_confirmation",
            Self::NotApplicable => "not_applicable",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct LinkValidationSummary {
    pub checked: u32,
    pub errors: u32,
    pub warnings: u32,
    pub unchecked_external: u32,
    pub pending_async: u32,
}

fn frontmatter_issues(doc_id: u64, version: u64, facts: &CoreDocumentFacts) -> Vec<DocumentIssue> {
    let Some(frontmatter) = &facts.frontmatter else {
        return Vec::new();
    };
    if frontmatter.syntax != FrontmatterSyntax::Malformed {
        return Vec::new();
    }
    vec![DocumentIssue {
        id: format!("frontmatter:{doc_id}:{version}:{}", frontmatter.line_start),
        severity: IssueSeverity::Warning,
        category: IssueCategory::Frontmatter,
        line_start: Some(frontmatter.line_start),
        line_end: Some(frontmatter.line_end),
        block_id: None,
        message: "Frontmatter could not be parsed; previewing document body anyway.".to_string(),
        detail: Some("Fix the YAML/TOML frontmatter delimiters or syntax.".to_string()),
        primary_action: Some("Edit frontmatter".to_string()),
    }]
}
