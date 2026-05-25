import katex from 'katex';

export function renderMathNode(el: HTMLElement) {
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

// Only nodes that `markMathNodes` flagged are rendered. Selecting on the
// JS-added `.pmd-math` class (stripped from raw HTML by the sanitizer) means
// attacker markup cannot reach the renderer through this path.
export function renderMathNodes(root: HTMLElement) {
  const blocks = root.querySelectorAll<HTMLElement>(".pmd-math[data-math-source]");
  for (const block of blocks) {
    renderMathNode(block);
  }
}

function isDisplayMath(el: HTMLElement): boolean {
  return el.classList.contains("math-display") || el.closest("pre") !== null;
}
