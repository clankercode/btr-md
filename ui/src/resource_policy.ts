import type {
  DocumentIssue,
  ResourcePolicyReport,
} from "./document_contracts.js";

export type TrustStatus = "Safe Preview" | "Content Blocked";
export type ResourcePolicyRowStatus = "enabled" | "allowed_root";

export interface ResourcePolicyRow {
  label: string;
  status: ResourcePolicyRowStatus;
}

export interface ExternalConfirmationAction {
  normalized_url: string;
  scheme: string;
  host: string;
  label_text: string;
}

export interface ExternalConfirmationModel {
  normalizedUrl: string;
  scheme: string;
  host: string;
  labelText: string;
}

const BASE_POLICY_ROWS: ResourcePolicyRow[] = [
  { label: "Raw HTML stripped", status: "enabled" },
  { label: "Scripts disabled", status: "enabled" },
  { label: "Remote images blocked", status: "enabled" },
  { label: "Local images scoped", status: "enabled" },
  { label: "Mermaid strict", status: "enabled" },
  { label: "KaTeX untrusted", status: "enabled" },
];

export function deriveTrustStatus(
  report: ResourcePolicyReport,
  issues: DocumentIssue[],
): TrustStatus {
  return report.decisions.some((decision) => decision.decision === "blocked")
    || issues.some(
      (issue) => issue.severity === "blocked" && issue.category === "resource_policy",
    )
    ? "Content Blocked"
    : "Safe Preview";
}

export function describeResourcePolicy(report: ResourcePolicyReport): ResourcePolicyRow[] {
  return [
    ...BASE_POLICY_ROWS,
    ...report.allowed_roots.map((root) => ({ label: root, status: "allowed_root" as const })),
  ];
}

export function buildExternalConfirmationModel(
  action: ExternalConfirmationAction,
): ExternalConfirmationModel {
  return {
    normalizedUrl: action.normalized_url,
    scheme: action.scheme,
    host: action.host,
    labelText: action.label_text,
  };
}
