import { renderMermaidNode } from './mermaid_runner.js';
import { renderMathNode } from './katex_runner.js';

function hasRenderNonce(el: HTMLElement, renderNonce: string): boolean {
  return renderNonce.length > 0 && el.dataset.pmdNonce === renderNonce;
}

export function markMermaidNodes(container: HTMLElement, renderNonce: string) {
  const mermaidBlocks = Array.from(
    container.querySelectorAll<HTMLElement>("pre > code.language-mermaid[data-pmd-nonce]")
  );
  // Root-inclusive: when container itself is the <pre>, querySelectorAll above
  // misses the direct child code element — check for it explicitly.
  if (container.matches('pre')) {
    const c = container.querySelector<HTMLElement>(':scope > code.language-mermaid[data-pmd-nonce]');
    if (c) mermaidBlocks.push(c);
  }
  mermaidBlocks.forEach((block) => {
    if (!hasRenderNonce(block, renderNonce)) return;
    const pre = block.parentElement;
    if (!pre) return;
    pre.classList.add('pmd-mermaid');
    pre.dataset.mermaidSource = block.textContent ?? '';
    pre.dataset.pmdNonce = renderNonce;
  });
}

// The sanitizer strips JS-added renderer classes/source attrs and only lets
// emitter-produced targets keep the current `data-pmd-nonce`. Raw HTML can
// preserve syntax classes, but it cannot match the nonce for this render.
export function markMathNodes(container: HTMLElement, renderNonce: string) {
  const inline = container.querySelectorAll<HTMLElement>("code.language-math[data-pmd-nonce]");
  inline.forEach((code) => {
    if (!hasRenderNonce(code, renderNonce)) return;
    const target = code.parentElement?.classList.contains('math-inline') ? code.parentElement : code;
    target.classList.add('pmd-math', 'math-inline');
    target.dataset.mathSource = code.textContent ?? '';
    target.dataset.pmdNonce = renderNonce;
  });
  const block = container.querySelectorAll<HTMLElement>("code.math-block[data-pmd-nonce]");
  block.forEach((code) => {
    if (!hasRenderNonce(code, renderNonce)) return;
    const target = code.parentElement?.classList.contains('math-display') ? code.parentElement : code;
    target.classList.add('pmd-math', 'math-display');
    target.dataset.mathSource = code.textContent ?? '';
    target.dataset.pmdNonce = renderNonce;
  });
}

export function markAllNodes(container: HTMLElement, renderNonce: string) {
  markMermaidNodes(container, renderNonce);
  markMathNodes(container, renderNonce);
}

export async function rerenderForThemeChange(
  root: HTMLElement,
  ctx: { vars: Record<string, string> }
) {
  // Mermaid re-init happens inside renderMermaidNode (with the active theme
  // vars), so we don't eagerly load mermaid here — a math-only document never
  // pulls in the diagram libraries on a theme change (todo #8).
  const renderNonce = root.dataset.pmdNonce ?? '';
  const targets = Array.from(root.querySelectorAll<HTMLElement>('.pmd-mermaid[data-mermaid-source][data-pmd-nonce], .pmd-math[data-math-source][data-pmd-nonce]'))
    .filter((target) => hasRenderNonce(target, renderNonce));
  for (const t of targets) {
    await new Promise<void>(r => requestAnimationFrame(() => r()));
    if (t.classList.contains('pmd-mermaid')) {
      await renderMermaidNode(t, renderNonce);
    } else {
      renderMathNode(t, renderNonce);
    }
  }
}
