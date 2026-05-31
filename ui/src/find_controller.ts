import type { EditorHandle } from './editor.js';
import { createPreviewFind, type PreviewFind } from './find_preview.js';
import { setSourceQuery } from './find_source.js';
import type { Mode } from './chrome.js';

export type FindScope = 'source' | 'preview';

export interface FindControllerDeps {
  getEditor: () => EditorHandle | null;
  previewContent: HTMLElement;
  getMode: () => Mode;
}

export interface FindController {
  element: HTMLElement;
  /** Open the find bar; routes to the implied scope for the current mode. */
  open(): void;
  close(): void;
  next(): void;
  previous(): void;
  /** Recompute the preview overlay against the freshly rendered DOM. */
  refreshPreview(): void;
  isOpen(): boolean;
}

export function createFindController(deps: FindControllerDeps): FindController {
  const preview: PreviewFind = createPreviewFind(deps.previewContent);

  const bar = document.createElement('div');
  bar.className = 'pmd-find-bar';
  bar.hidden = true;
  bar.setAttribute('role', 'search');

  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'pmd-find-input';
  input.setAttribute('aria-label', 'Find in document');
  input.placeholder = 'Find';

  const countEl = document.createElement('span');
  countEl.className = 'pmd-find-count';
  countEl.textContent = '0/0';

  const scopeGroup = document.createElement('div');
  scopeGroup.className = 'pmd-find-scope';
  scopeGroup.setAttribute('role', 'tablist');
  const scopeButtons: Record<FindScope, HTMLButtonElement> = {
    source: makeScopeBtn('Source', 'source'),
    preview: makeScopeBtn('Preview', 'preview'),
  };
  scopeGroup.append(scopeButtons.source, scopeButtons.preview);

  const prevBtn = makeIconBtn('‹', 'Previous match');
  const nextBtn = makeIconBtn('›', 'Next match');
  const closeBtn = makeIconBtn('×', 'Close find');

  bar.append(input, countEl, scopeGroup, prevBtn, nextBtn, closeBtn);

  let scope: FindScope = 'preview';

  function makeScopeBtn(label: string, value: FindScope): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pmd-find-scope-btn';
    b.textContent = label;
    b.dataset.scope = value;
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => setScope(value));
    return b;
  }
  function makeIconBtn(label: string, title: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pmd-find-btn';
    b.textContent = label;
    b.title = title;
    return b;
  }

  function impliedScope(): FindScope {
    const mode = deps.getMode();
    if (mode === 'source') return 'source';
    if (mode === 'preview') return 'preview';
    return scope; // split: user choice
  }

  function updateScopeUi(): void {
    const splitMode = deps.getMode() === 'split';
    scopeGroup.hidden = !splitMode;
    for (const value of ['source', 'preview'] as FindScope[]) {
      scopeButtons[value].setAttribute('aria-selected', String(value === scope));
      scopeButtons[value].classList.toggle('data-active', value === scope);
    }
  }

  function updateCount(): void {
    if (impliedScope() === 'preview') {
      countEl.textContent = `${preview.currentIndex()}/${preview.count()}`;
      const none = preview.count() === 0;
      prevBtn.disabled = none;
      nextBtn.disabled = none;
    } else {
      // Source counts/highlighting come from CodeMirror's own panel.
      countEl.textContent = '';
      prevBtn.disabled = false;
      nextBtn.disabled = false;
    }
  }

  /** Push the typed query into CodeMirror's search state so the source pane
   *  actually searches for it (one input drives both panes). */
  function pushSourceQuery(): void {
    const ed = deps.getEditor();
    if (ed) setSourceQuery(ed.view, input.value);
  }

  function applyQuery(): void {
    if (impliedScope() === 'preview') {
      preview.setQuery(input.value);
    } else {
      preview.clear();
      pushSourceQuery();
    }
    updateCount();
  }

  function setScope(next: FindScope): void {
    scope = next;
    updateScopeUi();
    if (next === 'source') {
      preview.clear();
      const ed = deps.getEditor();
      ed?.openSearch();
      pushSourceQuery();
    }
    applyQuery();
  }

  input.addEventListener('input', applyQuery);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); api.next(); }
    else if (e.key === 'Escape') { e.preventDefault(); api.close(); }
  });
  prevBtn.addEventListener('click', () => api.previous());
  nextBtn.addEventListener('click', () => api.next());
  closeBtn.addEventListener('click', () => api.close());

  const api: FindController = {
    element: bar,
    open(): void {
      bar.hidden = false;
      scope = impliedScope();
      updateScopeUi();
      input.focus();
      input.select();
      if (impliedScope() === 'source') deps.getEditor()?.openSearch();
      applyQuery(); // applyQuery pushes the query to CM when scope is source
    },
    close(): void {
      bar.hidden = true;
      preview.clear();
      deps.getEditor()?.focus();
    },
    next(): void {
      if (impliedScope() === 'preview') { preview.next(); updateCount(); }
      else deps.getEditor()?.searchNext();
    },
    previous(): void {
      if (impliedScope() === 'preview') { preview.previous(); updateCount(); }
      else deps.getEditor()?.searchPrevious();
    },
    refreshPreview(): void {
      if (bar.hidden) return;
      if (impliedScope() !== 'preview') return;
      preview.recompute();
      updateCount();
    },
    isOpen: () => !bar.hidden,
  };
  return api;
}
