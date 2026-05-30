use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CoreDocumentFacts {
    pub headings: Vec<HeadingFact>,
    pub anchors: Vec<AnchorFact>,
    pub links: Vec<LinkFact>,
    pub reference_definitions: Vec<ReferenceDefinitionFact>,
    pub images: Vec<ImageFact>,
    pub frontmatter: Option<FrontmatterFact>,
    pub blocks: Vec<BlockFact>,
    pub embedded: EmbeddedFacts,
    pub counts: StructureCounts,
}

impl CoreDocumentFacts {
    pub fn empty() -> Self {
        Self {
            headings: Vec::new(),
            anchors: Vec::new(),
            links: Vec::new(),
            reference_definitions: Vec::new(),
            images: Vec::new(),
            frontmatter: None,
            blocks: Vec::new(),
            embedded: EmbeddedFacts::default(),
            counts: StructureCounts::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadingFact {
    pub level: u8,
    pub text: String,
    pub slug: String,
    pub duplicate_index: u32,
    pub line_start: u32,
    pub line_end: u32,
    pub block_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AnchorFact {
    pub slug: String,
    pub line_start: u32,
    pub line_end: u32,
    pub block_id: String,
    pub source: AnchorSource,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LinkFact {
    pub target: Option<String>,
    pub title: Option<String>,
    pub label_text: String,
    pub reference_label: Option<String>,
    pub definition_id: Option<String>,
    pub line_start: u32,
    pub line_end: u32,
    pub kind: LinkKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReferenceDefinitionFact {
    pub id: String,
    pub label: String,
    pub target: String,
    pub title: Option<String>,
    pub line_start: u32,
    pub line_end: u32,
    pub duplicate_index: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImageFact {
    pub target: Option<String>,
    pub alt_text: String,
    pub title: Option<String>,
    pub reference_label: Option<String>,
    pub definition_id: Option<String>,
    pub line_start: u32,
    pub line_end: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BlockFact {
    pub id: String,
    pub kind: BlockKind,
    pub line_start: u32,
    pub line_end: u32,
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FrontmatterFact {
    pub format: FrontmatterFormat,
    pub line_start: u32,
    pub line_end: u32,
    pub raw: String,
    pub syntax: FrontmatterSyntax,
    pub metadata: CommonFrontmatter,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct CommonFrontmatter {
    pub title: Option<String>,
    pub description: Option<String>,
    pub slug: Option<String>,
    pub sidebar_label: Option<String>,
    pub sidebar_position: Option<i64>,
    pub tags: Vec<String>,
    pub draft: Option<bool>,
    pub unknown: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct EmbeddedFacts {
    pub code_blocks: Vec<EmbeddedSpan>,
    pub mermaid_blocks: Vec<EmbeddedSpan>,
    pub math_spans: Vec<EmbeddedSpan>,
    pub math_blocks: Vec<EmbeddedSpan>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EmbeddedSpan {
    pub line_start: u32,
    pub line_end: u32,
    pub block_id: Option<String>,
    pub language_or_kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct StructureCounts {
    pub words: u32,
    pub bytes: u32,
    pub sentences: u32,
    pub paragraphs: u32,
    pub headings: u32,
    pub links: u32,
    pub images: u32,
    pub code_blocks: u32,
    pub mermaid_blocks: u32,
    pub math_spans: u32,
    pub math_blocks: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AnchorSource {
    Heading,
    ExplicitId,
    Footnote,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BlockKind {
    Paragraph,
    Heading,
    Blockquote,
    List,
    ListItem,
    Table,
    TableRow,
    TableCell,
    CodeBlock,
    HtmlBlock,
    FootnoteDefinition,
    Rule,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FrontmatterFormat {
    Yaml,
    Toml,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FrontmatterSyntax {
    Valid,
    Malformed,
    UnsupportedFormat,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LinkKind {
    Fragment,
    LocalMarkdown,
    LocalFile,
    ExternalUrl,
    Mailto,
    Reference,
    UnknownScheme,
}

impl LinkKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Fragment => "fragment",
            Self::LocalMarkdown => "local_markdown",
            Self::LocalFile => "local_file",
            Self::ExternalUrl => "external_url",
            Self::Mailto => "mailto",
            Self::Reference => "reference",
            Self::UnknownScheme => "unknown_scheme",
        }
    }
}
