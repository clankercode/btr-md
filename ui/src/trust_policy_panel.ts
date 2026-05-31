import type { DocumentIssue, ResourcePolicyReport } from "./document_contracts.js";
import { describeResourcePolicy, type TrustStatus } from "./resource_policy.js";

export interface TrustPolicyPanel {
  element: HTMLElement;
  render(input: {
    status: TrustStatus;
    report: ResourcePolicyReport;
    issues: DocumentIssue[];
  }): void;
  clear(): void;
}

export function createTrustPolicyPanel(): TrustPolicyPanel {
  const element = document.createElement("section");
  element.className = "pmd-trust-panel";
  element.setAttribute("aria-label", "Preview trust");

  function render(input: {
    status: TrustStatus;
    report: ResourcePolicyReport;
    issues: DocumentIssue[];
  }): void {
    element.innerHTML = "";
    element.dataset.trustStatus = input.status;

    const status = document.createElement("button");
    status.type = "button";
    status.className = "pmd-trust-status";
    status.setAttribute("aria-expanded", "false");
    status.textContent = input.status;

    const details = document.createElement("div");
    details.className = "pmd-trust-details";
    details.hidden = true;
    details.setAttribute("role", "region");
    details.setAttribute("aria-label", "Resource policy");

    const list = document.createElement("ul");
    for (const row of describeResourcePolicy(input.report)) {
      const item = document.createElement("li");
      item.textContent = row.label;
      item.dataset.status = row.status;
      list.append(item);
    }

    const blocked = input.issues.filter(
      (issue) => issue.severity === "blocked" && issue.category === "resource_policy"
    );
    for (const issue of blocked) {
      const item = document.createElement("li");
      item.textContent = issue.message;
      item.dataset.status = "blocked";
      list.append(item);
    }

    status.addEventListener("click", () => {
      const expanded = details.hidden;
      details.hidden = !expanded;
      status.setAttribute("aria-expanded", String(expanded));
    });

    details.append(list);
    element.append(status, details);
  }

  return {
    element,
    render,
    clear() {
      element.innerHTML = "";
      element.removeAttribute("data-trust-status");
    },
  };
}
