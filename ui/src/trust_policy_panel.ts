import type {
  AssetGrant,
  DocumentIssue,
  DocumentTrustContext,
  ResourcePolicyReport,
} from "./document_contracts.js";
import { describeResourcePolicy, type TrustStatus } from "./resource_policy.js";

export interface TrustPolicyPanel {
  element: HTMLElement;
  setActiveGrants(grants: AssetGrant[]): void;
  setTrustContext(context: DocumentTrustContext | null): void;
  setHandlers(handlers: {
    trustRepositoryRoot?: (root: string) => void | Promise<void>;
    declineRepositoryRoot?: (root: string) => void | Promise<void>;
    revokeGrant?: (grantId: number) => void | Promise<void>;
  }): void;
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
  let activeGrants: AssetGrant[] = [];
  let trustContext: DocumentTrustContext | null = null;
  let handlers: {
    trustRepositoryRoot?: (root: string) => void | Promise<void>;
    declineRepositoryRoot?: (root: string) => void | Promise<void>;
    revokeGrant?: (grantId: number) => void | Promise<void>;
  } = {};

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
    const repoRoot = trustContext?.git_root ?? null;
    if (repoRoot && trustContext?.should_prompt_for_repo_root) {
      const item = document.createElement("li");
      item.dataset.status = "blocked";
      const text = document.createElement("span");
      text.textContent = `Repository root available: ${repoRoot}`;
      const trust = document.createElement("button");
      trust.type = "button";
      trust.textContent = "Trust root";
      trust.addEventListener("click", () => handlers.trustRepositoryRoot?.(repoRoot));
      const decline = document.createElement("button");
      decline.type = "button";
      decline.textContent = "Not now";
      decline.addEventListener("click", () => handlers.declineRepositoryRoot?.(repoRoot));
      item.append(text, trust, decline);
      list.append(item);
    }
    for (const grant of activeGrants) {
      const item = document.createElement("li");
      item.dataset.status = "allowed";
      const text = document.createElement("span");
      text.textContent = `Asset grant: ${grant.canonical_root}`;
      const revoke = document.createElement("button");
      revoke.type = "button";
      revoke.textContent = "Revoke";
      revoke.addEventListener("click", () => handlers.revokeGrant?.(grant.id));
      item.append(text, revoke);
      list.append(item);
    }
    for (const row of describeResourcePolicy(input.report)) {
      const item = document.createElement("li");
      item.textContent = row.label;
      item.dataset.status = row.status;
      list.append(item);
    }

    const blocked = input.issues.filter((issue) => issue.severity === "blocked");
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
    setActiveGrants(grants) {
      activeGrants = grants.slice();
    },
    setTrustContext(context) {
      trustContext = context;
    },
    setHandlers(nextHandlers) {
      handlers = nextHandlers;
    },
    render,
    clear() {
      element.innerHTML = "";
      element.removeAttribute("data-trust-status");
    },
  };
}
