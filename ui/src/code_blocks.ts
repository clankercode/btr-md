// Post-sanitize DOM decoration for fenced code blocks. Runs after the backend
// HTML has been injected and after mermaid/math runners have replaced their
// own nodes, so a plain `<pre><code class="language-xxx">` here is a real code
// sample (mermaid blocks are now `div.pmd-mermaid`, math carries `pmd-math`).
//
// Everything is built with createElement/textContent/setAttribute — no
// innerHTML — so no untrusted content is ever parsed as markup.

import { selfAndDescendants } from './dom_scope.js';

const REVERT_DELAY_MS = 1200;

// Classes that mark a `<code>` as something other than a copyable code sample.
const SKIP_CODE_CLASSES = ['language-mermaid', 'language-math', 'math-block'];

export function decorateCodeBlocks(root: HTMLElement): void {
  const pres = selfAndDescendants<HTMLPreElement>(root, 'pre');
  pres.forEach((pre) => {
    // Idempotent: skip blocks we've already wrapped, and mermaid `<pre>`s.
    if (pre.closest('figure.pmd-code-block')) return;
    if (pre.classList.contains('pmd-mermaid')) return;

    const code = pre.querySelector<HTMLElement>(':scope > code');
    if (!code) return;

    const classes = Array.from(code.classList);
    if (!classes.some((cls) => cls.startsWith('language-'))) return;
    if (SKIP_CODE_CLASSES.some((cls) => code.classList.contains(cls))) return;

    decoratePre(pre, code);
  });
}

function decoratePre(pre: HTMLPreElement, code: HTMLElement): void {
  const lang = deriveLanguage(code);

  const figure = document.createElement('figure');
  figure.className = 'pmd-code-block';

  const toolbar = document.createElement('div');
  toolbar.className = 'pmd-code-toolbar';

  const langLabel = document.createElement('span');
  langLabel.className = 'pmd-code-lang';
  langLabel.textContent = lang;

  toolbar.appendChild(langLabel);
  toolbar.appendChild(makeCopyButton(code));
  toolbar.appendChild(makeExpandButton(figure));

  // Insert the figure before the pre, then move toolbar + pre inside it.
  pre.parentNode?.insertBefore(figure, pre);
  figure.appendChild(toolbar);
  figure.appendChild(pre);
}

// `language-rust` -> `rust`; fall back to `text` when there's no language token.
function deriveLanguage(code: HTMLElement): string {
  const token = Array.from(code.classList).find((cls) => cls.startsWith('language-'));
  const lang = token ? token.slice('language-'.length) : '';
  return lang || 'text';
}

function makeCopyButton(code: HTMLElement): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pmd-code-btn';
  button.textContent = 'Copy';

  let revertTimer: number | undefined;
  const revertLater = (label: string) => {
    button.textContent = label;
    if (revertTimer !== undefined) clearTimeout(revertTimer);
    revertTimer = window.setTimeout(() => {
      button.textContent = 'Copy';
    }, REVERT_DELAY_MS);
  };

  button.addEventListener('click', () => {
    // `navigator.clipboard` is undefined in non-secure contexts; guard so the
    // failure surfaces as "Failed" rather than a synchronous throw.
    const clip = navigator.clipboard;
    if (!clip || typeof clip.writeText !== 'function') {
      revertLater('Failed');
      return;
    }
    clip
      .writeText(code.textContent ?? '')
      .then(() => revertLater('Copied'))
      .catch(() => revertLater('Failed'));
  });

  return button;
}

function makeExpandButton(figure: HTMLElement): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pmd-code-btn';
  button.textContent = 'Expand';
  button.setAttribute('aria-pressed', 'false');

  button.addEventListener('click', () => {
    const expanded = figure.classList.toggle('pmd-expanded');
    button.textContent = expanded ? 'Collapse' : 'Expand';
    button.setAttribute('aria-pressed', expanded ? 'true' : 'false');
  });

  return button;
}
