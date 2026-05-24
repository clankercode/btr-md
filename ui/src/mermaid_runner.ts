let initialised = false;

export function ensureInit(vars: Record<string, string>) {
  if (initialised) { mermaid.initialize({ themeVariables: vars }); return; }
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", themeVariables: vars });
  initialised = true;
}

export async function renderMermaidNodes(root: HTMLElement) {
  const blocks = root.querySelectorAll<HTMLElement>("pre > code.language-mermaid");
  for (const code of blocks) {
    try {
      const id = `m-${Math.random().toString(36).slice(2)}`;
      const { svg } = await mermaid.render(id, code.textContent ?? "");
      code.parentElement!.outerHTML = svg;
    } catch (e) {
      code.parentElement!.classList.add("pmd-mermaid-error");
    }
  }
}
