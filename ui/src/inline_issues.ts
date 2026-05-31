import type { DocumentIssue } from "./document_contracts.js";

const INLINE_CLASS = "pmd-inline-issue";
const SUMMARY_CLASS = "pmd-inline-issues-summary";

function existingIssues(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`.${SUMMARY_CLASS}, .${INLINE_CLASS}`));
}

function targetForIssue(root: HTMLElement, issue: DocumentIssue): Element | null {
  if (issue.block_id) {
    const escaped = typeof CSS !== "undefined" && CSS.escape
      ? CSS.escape(issue.block_id)
      : issue.block_id.replace(/["\\]/g, "\\$&");
    return root.querySelector(`[data-pmd-block-id="${escaped}"]`);
  }
  if (issue.category === "image") {
    return root.querySelector("[data-pmd-resource-state]");
  }
  if (issue.category === "resource_policy") {
    return root.querySelector(".pmd-image-placeholder");
  }
  return null;
}

function issueText(issue: DocumentIssue): string {
  return issue.detail ? `${issue.message} ${issue.detail}` : issue.message;
}

function buildIssue(issue: DocumentIssue): HTMLElement {
  const marker = document.createElement("div");
  marker.className = `${INLINE_CLASS} ${INLINE_CLASS}-${issue.severity}`;
  marker.setAttribute("role", issue.severity === "error" || issue.severity === "blocked" ? "alert" : "status");
  marker.textContent = issueText(issue);
  return marker;
}

export function renderInlineIssues(previewRoot: HTMLElement, issues: DocumentIssue[]): void {
  for (const issue of existingIssues(previewRoot)) issue.remove();
  if (issues.length === 0) return;

  const fallback = document.createElement("div");
  fallback.className = SUMMARY_CLASS;
  fallback.setAttribute("aria-label", "Inline issues");

  for (const issue of issues) {
    const marker = buildIssue(issue);
    const target = targetForIssue(previewRoot, issue);
    if (target?.parentElement) {
      target.insertAdjacentElement("afterend", marker);
    } else {
      fallback.append(marker);
    }
  }

  if (fallback.childElementCount > 0) {
    previewRoot.prepend(fallback);
  }
}
