export function markMermaidNodes(container: HTMLElement) {
  const mermaidBlocks = container.querySelectorAll<HTMLElement>("pre > code.language-mermaid");
  mermaidBlocks.forEach(block => {
    block.classList.add('pmd-mermaid');
  });
}

export function markMathNodes(container: HTMLElement) {
  const mathBlocks = container.querySelectorAll<HTMLElement>("code.language-math, .math-block");
  mathBlocks.forEach(block => {
    block.classList.add('pmd-math');
  });
}

export function markAllNodes(container: HTMLElement) {
  markMermaidNodes(container);
  markMathNodes(container);
}

export function ensureInit(vars: Record<string, string>) {
  if (typeof window === 'undefined' || !('mermaid' in window)) return;
  const m = (window as unknown as { mermaid: { initialize: (opts: unknown) => void } }).mermaid;
  m.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    themeVariables: vars,
  });
}

export async function rerenderForThemeChange(
  root: HTMLElement,
  ctx: { vars: Record<string, string> }
) {
  ensureInit(ctx.vars);
  const targets = Array.from(root.querySelectorAll('.pmd-mermaid, .pmd-math'));
  for (const t of targets) {
    await new Promise<void>(r => requestAnimationFrame(() => r()));
    if (t.classList.contains('pmd-mermaid')) {
      const { renderMermaidNodes } = await import('./mermaid_runner.js');
      await renderMermaidNodes(t.parentElement!);
    } else {
      const { renderMathNodes } = await import('./katex_runner.js');
      await renderMathNodes(root);
    }
  }
}
