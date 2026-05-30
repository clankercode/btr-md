import katex from 'katex';

// Rendered-HTML cache keyed by (display mode + source). The preview DOM is
// rebuilt on every render; without caching, every math node re-runs katex on
// each keystroke. KaTeX output is theme-independent (styling is CSS/font based),
// so entries never need invalidation. Keyed string is `D:`/`I:` + source.
// Bounded so editing a formula char-by-char cannot grow memory without limit.
const HTML_CACHE_LIMIT = 512;
const htmlCache = new Map<string, string>();

function cacheHtml(key: string, html: string) {
  if (htmlCache.size >= HTML_CACHE_LIMIT) {
    const oldest = htmlCache.keys().next().value;
    if (oldest !== undefined) htmlCache.delete(oldest);
  }
  htmlCache.set(key, html);
}

export function renderMathNode(el: HTMLElement, renderNonce?: string) {
  if (renderNonce && el.dataset.pmdNonce !== renderNonce) return;
  const source = el.dataset.mathSource ?? el.textContent ?? "";
  const displayMode = isDisplayMath(el);
  const key = `${displayMode ? "D" : "I"}:${source}`;
  const cached = htmlCache.get(key);
  if (cached !== undefined) {
    el.innerHTML = cached;
    el.classList.remove("pmd-math-error");
    return;
  }
  try {
    const html = katex.renderToString(source, {
      trust: false,
      strict: "warn",
      displayMode,
    });
    cacheHtml(key, html);
    el.innerHTML = html;
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
