import mermaid from 'mermaid';

let initialised = false;
let currentThemeVars: Record<string, string> = {};

export function ensureInit(vars?: Record<string, string>) {
  if (vars) {
    currentThemeVars = vars;
  }
  if (!initialised) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      themeVariables: currentThemeVars,
    });
    initialised = true;
  }
}

export async function renderMermaidNodes(root: HTMLElement) {
  ensureInit();
  const targets = collectMermaidTargets(root);
  for (const target of targets) {
    await renderMermaidNode(target);
  }
}

export async function renderMermaidNode(target: HTMLElement) {
  ensureInit();
  const container = ensureMermaidContainer(target);
  const source = container.dataset.mermaidSource ?? "";
  try {
    const id = `m-${Math.random().toString(36).slice(2)}`;
    const { svg } = await mermaid.render(id, source);
    container.classList.remove("pmd-mermaid-error");
    container.innerHTML = svg;
  } catch (e) {
    container.classList.add("pmd-mermaid-error");
    container.textContent = source;
  }
}

// Only render nodes that `markMermaidNodes` flagged. The sanitizer strips the
// `pmd-mermaid` class and `data-mermaid-source` attribute from raw HTML, so
// reaching this collection requires the trusted emitter path
// (`pre > code.language-mermaid` upgraded by `markMermaidNodes`).
function collectMermaidTargets(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(".pmd-mermaid[data-mermaid-source]"));
}

function ensureMermaidContainer(target: HTMLElement): HTMLElement {
  if (target.classList.contains("pmd-mermaid")) {
    return target;
  }

  const code = target.matches("code.language-mermaid")
    ? target
    : target.querySelector<HTMLElement>("code.language-mermaid");
  const container = document.createElement("div");
  container.className = "pmd-mermaid";
  container.dataset.mermaidSource = code?.textContent ?? target.textContent ?? "";
  copySourceRange(target, container);
  target.replaceWith(container);
  return container;
}

function copySourceRange(from: HTMLElement, to: HTMLElement) {
  if (from.dataset.srcStart) {
    to.dataset.srcStart = from.dataset.srcStart;
  }
  if (from.dataset.srcEnd) {
    to.dataset.srcEnd = from.dataset.srcEnd;
  }
}
