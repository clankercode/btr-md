import mermaid from 'mermaid';

let initialised = false;
let currentThemeVars: Record<string, string> = {};

function shallowEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

export function ensureInit(vars?: Record<string, string>) {
  let shouldInitialize = !initialised;
  if (vars) {
    if (!shallowEqual(currentThemeVars, vars)) {
      currentThemeVars = { ...vars };
      shouldInitialize = true;
    }
  }
  if (shouldInitialize) {
    mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      securityLevel: "strict",
      themeVariables: currentThemeVars,
    });
    initialised = true;
  }
}

export async function renderMermaidNodes(root: HTMLElement, renderNonce: string) {
  ensureInit();
  const targets = collectMermaidTargets(root, renderNonce);
  for (const target of targets) {
    await renderMermaidNode(target, renderNonce);
  }
}

export async function renderMermaidNode(target: HTMLElement, renderNonce?: string) {
  ensureInit();
  const container = ensureMermaidContainer(target, renderNonce);
  if (!container) return;
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

// Only render nodes that `markMermaidNodes` flagged for the current backend
// render nonce. Raw HTML can preserve syntax classes, but it cannot pre-seed
// the JS-added renderer source/class pair with the matching nonce.
function collectMermaidTargets(root: HTMLElement, renderNonce: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(".pmd-mermaid[data-mermaid-source][data-pmd-nonce]"))
    .filter((target) => target.dataset.pmdNonce === renderNonce);
}

function ensureMermaidContainer(target: HTMLElement, renderNonce?: string): HTMLElement | null {
  if (target.classList.contains("pmd-mermaid")) {
    if (renderNonce && target.dataset.pmdNonce !== renderNonce) return null;
    return target;
  }

  const code = target.matches("code.language-mermaid")
    ? target
    : target.querySelector<HTMLElement>("code.language-mermaid");
  if (renderNonce && code?.dataset.pmdNonce !== renderNonce) return null;
  const container = document.createElement("div");
  container.className = "pmd-mermaid";
  container.dataset.mermaidSource = code?.textContent ?? target.textContent ?? "";
  if (code?.dataset.pmdNonce) {
    container.dataset.pmdNonce = code.dataset.pmdNonce;
  }
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
