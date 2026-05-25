import katex from 'katex';

export function renderMathNode(el: HTMLElement, renderNonce?: string) {
  if (renderNonce && el.dataset.pmdNonce !== renderNonce) return;
  const source = el.dataset.mathSource ?? el.textContent ?? "";
  try {
    katex.render(source, el, {
      trust: false,
      strict: "warn",
      displayMode: isDisplayMath(el)
    });
    el.classList.remove("pmd-math-error");
  } catch (e) {
    el.classList.add("pmd-math-error");
  }
}

// Only nodes that `markMathNodes` flagged for this render nonce are rendered.
export function renderMathNodes(root: HTMLElement, renderNonce: string) {
  const blocks = root.querySelectorAll<HTMLElement>(".pmd-math[data-math-source][data-pmd-nonce]");
  for (const block of blocks) {
    renderMathNode(block, renderNonce);
  }
}

function isDisplayMath(el: HTMLElement): boolean {
  return el.classList.contains("math-display") || el.closest("pre") !== null;
}
