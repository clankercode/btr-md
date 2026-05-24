export function renderMathNodes(root: HTMLElement) {
  const blocks = root.querySelectorAll<HTMLElement>("code.language-math, .math-block");
  for (const code of blocks) {
    try {
      katex.render(code.textContent ?? "", code.parentElement!, {
        trust: false,
        strict: "warn",
        displayMode: code.classList.contains("math-block")
      });
    } catch (e) {
      code.classList.add("pmd-math-error");
    }
  }
}
