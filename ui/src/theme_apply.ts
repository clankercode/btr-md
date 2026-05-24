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

export function markMathNodes(container: HTMLElement) {
  const mathBlocks = container.querySelectorAll<HTMLElement>("code.language-math, .math-inline, .math-block");
  mathBlocks.forEach((block) => {
    block.classList.add('pmd-math');
    block.dataset.mathSource = block.dataset.mathSource ?? block.textContent ?? '';
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
