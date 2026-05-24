import katex from 'katex';
import 'katex/dist/katex.min.css';

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

export function renderMathNodes(root: HTMLElement) {
  const blocks = root.querySelectorAll<HTMLElement>(".math-inline, .math-display");
  for (const block of blocks) {
    renderMathNode(block);
  }
}

function isDisplayMath(el: HTMLElement): boolean {
  return el.classList.contains("math-display") || el.closest("pre") !== null;
}
