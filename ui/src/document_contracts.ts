export interface RenderResult {
  doc_id: number;
  version: number;
  html: string;
  source_map: Array<[number, number]>;
  render_nonce: string;
  blocks?: BlockRef[];
  facts: DocumentFacts;
  diagnostics: DocumentDiagnostics;
}

export type TrustRootState = "unknown" | "trusted" | "declined";

export interface DocumentTrustContext {
  doc_dir: string | null;
  git_root: string | null;
  git_root_state: TrustRootState;
  should_prompt_for_repo_root: boolean;
}

export interface AssetGrant {
  id: number;
  window_label: string;
  doc_id: number;
  canonical_root: string;
}

export interface TrustRootDecision {
  canonical_root: string;
  state: TrustRootState;
}

export interface BlockRef {
  key: string;
  base_line: number;
}

export interface DocumentFacts extends CoreDocumentFacts {
  doc_id: number;
  version: number;
}

export interface CoreDocumentFacts {
  headings: HeadingFact[];
  anchors: AnchorFact[];
  links: LinkFact[];
  reference_definitions: ReferenceDefinitionFact[];
  images: ImageFact[];
  frontmatter: FrontmatterFact | null;
  blocks: BlockFact[];
  embedded: EmbeddedFacts;
  counts: StructureCounts;
}

export interface HeadingFact {
  level: number;
  text: string;
  slug: string;
  duplicate_index: number;
  line_start: number;
  line_end: number;
  block_id: string;
}

export interface AnchorFact {
  slug: string;
  line_start: number;
  line_end: number;
  block_id: string;
  source: "heading" | "explicit_id" | "footnote";
}

export interface LinkFact {
  target: string | null;
  title: string | null;
  label_text: string;
  reference_label: string | null;
  definition_id: string | null;
  line_start: number;
  line_end: number;
  kind:
    | "fragment"
    | "local_markdown"
    | "local_file"
    | "external_url"
    | "mailto"
    | "reference"
    | "unknown_scheme";
}

export interface ReferenceDefinitionFact {
  id: string;
  label: string;
  target: string;
  title: string | null;
  line_start: number;
  line_end: number;
  duplicate_index: number;
}

export interface ImageFact {
  target: string | null;
  alt_text: string;
  title: string | null;
  reference_label: string | null;
  definition_id: string | null;
  line_start: number;
  line_end: number;
}

export interface BlockFact {
  id: string;
  kind:
    | "paragraph"
    | "heading"
    | "blockquote"
    | "list"
    | "list_item"
    | "table"
    | "table_row"
    | "table_cell"
    | "code_block"
    | "html_block"
    | "footnote_definition"
    | "rule";
  line_start: number;
  line_end: number;
  parent_id: string | null;
}

export interface FrontmatterFact {
  format: "yaml" | "toml";
  line_start: number;
  line_end: number;
  raw: string;
  syntax: "valid" | "malformed" | "unsupported_format";
  metadata: CommonFrontmatter;
}

export interface CommonFrontmatter {
  title: string | null;
  description: string | null;
  slug: string | null;
  sidebar_label: string | null;
  sidebar_position: number | null;
  tags: string[];
  draft: boolean | null;
  unknown: Record<string, string>;
}

export interface EmbeddedFacts {
  code_blocks: EmbeddedSpan[];
  mermaid_blocks: EmbeddedSpan[];
  math_spans: EmbeddedSpan[];
  math_blocks: EmbeddedSpan[];
}

export interface EmbeddedSpan {
  line_start: number;
  line_end: number;
  block_id: string | null;
  language_or_kind: string | null;
}

export interface StructureCounts {
  words: number;
  bytes: number;
  sentences: number;
  paragraphs: number;
  headings: number;
  links: number;
  images: number;
  code_blocks: number;
  mermaid_blocks: number;
  math_spans: number;
  math_blocks: number;
}

export interface DocumentDiagnostics {
  doc_id: number;
  version: number;
  phase: "initial" | "enriched";
  issues: DocumentIssue[];
  resources: ResourcePolicyReport;
  link_summary: LinkValidationSummary;
}

export interface DocumentIssue {
  id: string;
  severity: "error" | "blocked" | "warning" | "info";
  category:
    | "link"
    | "anchor"
    | "image"
    | "resource_policy"
    | "frontmatter"
    | "security"
    | "accessibility"
    | "filesystem"
    | "command";
  line_start: number | null;
  line_end: number | null;
  block_id: string | null;
  message: string;
  detail: string | null;
  primary_action: string | null;
}

export interface ResourcePolicyReport {
  doc_id: number;
  version: number;
  allowed_roots: string[];
  loaded_resources: string[];
  decisions: ResourceDecision[];
}

export interface ResourceDecision {
  source_target: string;
  normalized_target: string | null;
  line_start: number;
  line_end: number;
  kind: "image" | "link" | "data_uri" | "embedded_renderer";
  decision: "allowed" | "blocked" | "missing" | "unchecked";
  reason:
    | "allowed_local_scope"
    | "remote_blocked"
    | "file_url_blocked"
    | "outside_allowed_roots"
    | "missing_file"
    | "invalid_protocol"
    | "unsafe_data_uri"
    | "external_link_requires_confirmation"
    | "not_applicable";
  safe_url: string | null;
  placeholder_id: string | null;
  alt_text: string | null;
}

export interface LinkValidationSummary {
  checked: number;
  errors: number;
  warnings: number;
  unchecked_external: number;
  pending_async: number;
}
