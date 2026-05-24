import mermaid from 'mermaid';

let initialised = false;
let currentThemeVars: Record<string, string> = {};

export function ensureInit(vars?: Record<string, string>) {
  if (vars) {
    currentThemeVars = vars;
  }
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    themeVariables: currentThemeVars,
  });
  initialised = true;
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

function collectMermaidTargets(root: HTMLElement): HTMLElement[] {
  const targets = new Set<HTMLElement>();
  root.querySelectorAll<HTMLElement>(".pmd-mermaid[data-mermaid-source]").forEach((el) => {
    targets.add(el);
  });
  root.querySelectorAll<HTMLElement>("pre > code.language-mermaid").forEach((code) => {
    if (code.parentElement) {
      targets.add(code.parentElement);
    }
  });
  return Array.from(targets);
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
