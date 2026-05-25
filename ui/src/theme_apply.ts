import { ensureInit, renderMermaidNode } from './mermaid_runner.js';
import { renderMathNode } from './katex_runner.js';

export function markMermaidNodes(container: HTMLElement) {
  const mermaidBlocks = container.querySelectorAll<HTMLElement>("pre > code.language-mermaid");
  mermaidBlocks.forEach((block) => {
    const pre = block.parentElement;
    if (!pre) return;
    pre.classList.add('pmd-mermaid');
    pre.dataset.mermaidSource = block.textContent ?? '';
  });
}

// The sanitizer strips `pmd-math`, `math-inline`, and `math-display` class
// tokens and `data-math-source` attributes from any HTML it processes. The
// emitter-stable trusted entry points are `code.language-math` (inline) and
// `code.math-block` (display). Only nodes reachable from these emitter
// selectors get re-tagged here, so attacker raw HTML cannot opt arbitrary
// content into the KaTeX renderer.
export function markMathNodes(container: HTMLElement) {
  const inline = container.querySelectorAll<HTMLElement>("code.language-math");
  inline.forEach((code) => {
    const target = code.parentElement?.classList.contains('math-inline') ? code.parentElement : code;
    target.classList.add('pmd-math', 'math-inline');
    target.dataset.mathSource = code.textContent ?? '';
  });
  const block = container.querySelectorAll<HTMLElement>("code.math-block");
  block.forEach((code) => {
    const target = code.parentElement?.classList.contains('math-display') ? code.parentElement : code;
    target.classList.add('pmd-math', 'math-display');
    target.dataset.mathSource = code.textContent ?? '';
  });
}

export function markAllNodes(container: HTMLElement) {
  markMermaidNodes(container);
  markMathNodes(container);
}

export async function rerenderForThemeChange(
  root: HTMLElement,
  ctx: { vars: Record<string, string> }
) {
  ensureInit(ctx.vars);
  const targets = Array.from(root.querySelectorAll<HTMLElement>('.pmd-mermaid[data-mermaid-source], .pmd-math[data-math-source]'));
  for (const t of targets) {
    await new Promise<void>(r => requestAnimationFrame(() => r()));
    if (t.classList.contains('pmd-mermaid')) {
      await renderMermaidNode(t);
    } else {
      renderMathNode(t);
    }
  }
}
