// KaTeX (~540 KB) is loaded lazily the first time a document actually contains
// math, so it never inflates app-startup parse time (todo #8). Cached after the
// first load; `renderMathNodes` awaits the load before rendering, and the
// synchronous `renderMathNode` no-ops until it is ready (math is theme-
// independent, so a theme-triggered re-render that arrives early loses nothing).
type Katex = (typeof import('katex'))['default'];
let katexMod: Katex | null = null;
let katexPromise: Promise<Katex> | null = null;

function loadKatex(): Promise<Katex> {
  if (!katexPromise) {
    katexPromise = import('katex').then((m) => {
      katexMod = m.default;
      return katexMod;
    });
  }
  return katexPromise;
}

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
  if (!katexMod) {
    // KaTeX not loaded yet — kick off the load; the awaiting renderMathNodes (or
    // the next render) will paint this node once it resolves.
    void loadKatex();
    return;
  }
  try {
    const html = katexMod.renderToString(source, {
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
export async function renderMathNodes(root: HTMLElement, renderNonce: string) {
  const blocks = root.querySelectorAll<HTMLElement>(".pmd-math[data-math-source][data-pmd-nonce]");
  if (blocks.length === 0) return; // no math → never load KaTeX
  await loadKatex();
  for (const block of blocks) {
    renderMathNode(block, renderNonce);
  }
}

function isDisplayMath(el: HTMLElement): boolean {
  return el.classList.contains("math-display") || el.closest("pre") !== null;
}
