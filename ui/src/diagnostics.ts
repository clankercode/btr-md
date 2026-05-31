import type { DocumentDiagnostics, DocumentIssue } from "./document_contracts.js";

export interface DiagnosticsSettings {
  inlineDetail: boolean;
  panelExpanded: boolean;
}

export interface DiagnosticCounts {
  error: number;
  blocked: number;
  warning: number;
  info: number;
}

export interface DiagnosticIssueGroup {
  severity: DocumentIssue["severity"];
  category: DocumentIssue["category"];
  issues: DocumentIssue[];
}

export interface DiagnosticsPresentation {
  panelVisible: boolean;
  collapsedIndicatorVisible: boolean;
  counts: DiagnosticCounts;
  groups: DiagnosticIssueGroup[];
  inlineIssues: DocumentIssue[];
}

const SEVERITY_ORDER: Record<DocumentIssue["severity"], number> = {
  error: 0,
  blocked: 1,
  warning: 2,
  info: 3,
};

export function deriveDiagnosticsPresentation(
  diagnostics: DocumentDiagnostics,
  settings: DiagnosticsSettings,
): DiagnosticsPresentation {
  const counts = emptyCounts();
  for (const issue of diagnostics.issues) counts[issue.severity] += 1;

  return {
    panelVisible: diagnostics.issues.length > 0 && settings.panelExpanded,
    collapsedIndicatorVisible: diagnostics.issues.length > 0 && !settings.panelExpanded,
    counts,
    groups: groupIssues(diagnostics.issues),
    inlineIssues: settings.inlineDetail
      ? diagnostics.issues
      : diagnostics.issues.map((issue) => ({ ...issue, detail: null })),
  };
}

export function findDiagnosticIssue(
  diagnostics: DocumentDiagnostics,
  issueId: string,
): DocumentIssue | null {
  return diagnostics.issues.find((issue) => issue.id === issueId) ?? null;
}

export function groupIssues(issues: DocumentIssue[]): DiagnosticIssueGroup[] {
  const groups = new Map<string, DiagnosticIssueGroup>();
  for (const issue of issues) {
    const key = `${issue.severity}:${issue.category}`;
    const group = groups.get(key);
    if (group) {
      group.issues.push(issue);
    } else {
      groups.set(key, { severity: issue.severity, category: issue.category, issues: [issue] });
    }
  }

  return [...groups.values()].sort((left, right) => {
    const severityDelta = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
    if (severityDelta !== 0) return severityDelta;
    return left.category.localeCompare(right.category);
  });
}

function emptyCounts(): DiagnosticCounts {
  return { error: 0, blocked: 0, warning: 0, info: 0 };
}
