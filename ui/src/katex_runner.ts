export function renderMathNode(el: HTMLElement) {
  try {
    katex.render(el.textContent ?? "", el.parentElement!, {
      trust: false,
      strict: "warn",
      displayMode: el.classList.contains("math-block")
    });
  } catch (e) {
    el.classList.add("pmd-math-error");
  }
}

export function renderMathNodes(root: HTMLElement) {
  const blocks = root.querySelectorAll<HTMLElement>("code.language-math, .math-block");
  for (const code of blocks) {
    renderMathNode(code);
  }
}
