import type { DiagnosticsPresentation } from "./diagnostics.js";

const SEVERITIES = ["error", "blocked", "warning", "info"] as const;

export interface DiagnosticsPanel {
  element: HTMLElement;
  render(presentation: DiagnosticsPresentation): void;
  clear(): void;
}

export function createDiagnosticsPanel(options: {
  onToggleExpanded(): void;
  onToggleInlineDetail(): void;
}): DiagnosticsPanel {
  const element = document.createElement("section");
  element.className = "pmd-diagnostics-shell";
  element.setAttribute("aria-label", "Diagnostics");
  element.hidden = true;

  function renderCounts(presentation: DiagnosticsPresentation): string {
    return SEVERITIES
      .filter((severity) => presentation.counts[severity] > 0)
      .map((severity) => `${presentation.counts[severity]} ${severity}`)
      .join(", ");
  }

  function renderCollapsed(presentation: DiagnosticsPresentation): void {
    element.hidden = !presentation.collapsedIndicatorVisible;
    element.innerHTML = "";
    if (element.hidden) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "pmd-diagnostics-toggle";
    button.setAttribute("aria-expanded", "false");
    button.textContent = `Diagnostics: ${renderCounts(presentation)}`;
    button.addEventListener("click", options.onToggleExpanded);
    element.append(button);
  }

  function renderExpanded(presentation: DiagnosticsPresentation): void {
    element.hidden = !presentation.panelVisible;
    element.innerHTML = "";
    if (element.hidden) return;

    element.setAttribute("role", "region");
    const header = document.createElement("div");
    header.className = "pmd-diagnostics-header";

    const title = document.createElement("h2");
    title.textContent = `Diagnostics: ${renderCounts(presentation)}`;

    const actions = document.createElement("div");
    actions.className = "pmd-diagnostics-actions";

    const inlineToggle = document.createElement("button");
    inlineToggle.type = "button";
    inlineToggle.className = "pmd-btn pmd-btn-ghost pmd-btn-sm";
    inlineToggle.textContent = "Inline detail";
    inlineToggle.addEventListener("click", options.onToggleInlineDetail);

    const collapse = document.createElement("button");
    collapse.type = "button";
    collapse.className = "pmd-btn pmd-btn-ghost pmd-btn-sm";
    collapse.setAttribute("aria-expanded", "true");
    collapse.textContent = "Collapse";
    collapse.addEventListener("click", options.onToggleExpanded);

    actions.append(inlineToggle, collapse);
    header.append(title, actions);
    element.append(header);

    const list = document.createElement("div");
    list.className = "pmd-diagnostics-list";
    for (const group of presentation.groups) {
      const groupEl = document.createElement("section");
      groupEl.className = "pmd-diagnostics-group";
      const heading = document.createElement("h3");
      heading.textContent = `${group.severity} / ${group.category}`;
      groupEl.append(heading);

      for (const issue of group.issues) {
        const row = document.createElement("article");
        row.className = `pmd-diagnostic-row pmd-diagnostic-${issue.severity}`;
        const message = document.createElement("p");
        message.textContent = issue.message;
        row.append(message);
        if (issue.detail) {
          const detail = document.createElement("small");
          detail.textContent = issue.detail;
          row.append(detail);
        }
        groupEl.append(row);
      }
      list.append(groupEl);
    }
    element.append(list);
  }

  return {
    element,
    render(presentation) {
      element.removeAttribute("role");
      if (presentation.panelVisible) renderExpanded(presentation);
      else renderCollapsed(presentation);
    },
    clear() {
      element.hidden = true;
      element.innerHTML = "";
      element.removeAttribute("role");
    },
  };
}
