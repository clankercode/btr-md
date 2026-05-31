import type { EditorHandle } from './editor.js';
import { createPreviewFind, type PreviewFind } from './find_preview.js';
import {
  setSourceQuery,
  setSourceReplaceQuery,
  sourceReplaceNext,
  sourceReplaceAll,
} from './find_source.js';
import {
  initialFindReplaceState,
  buildReplaceQuery,
  canReplace,
  type FindReplaceState,
} from './find_replace.js';
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
  /** Open the find bar with the replace row revealed (Ctrl+H). Replace is
   *  source-scoped; in preview/split-preview the row is shown but disabled. */
  openReplace(): void;
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

  // The find row and the (collapsible) replace row.
  const findRow = document.createElement('div');
  findRow.className = 'pmd-find-row';
  const replaceRow = document.createElement('div');
  replaceRow.className = 'pmd-find-row pmd-find-replace-row';
  replaceRow.hidden = true;

  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'pmd-find-input';
  input.setAttribute('aria-label', 'Find in document');
  input.placeholder = 'Find';

  const countEl = document.createElement('span');
  countEl.className = 'pmd-find-count';
  countEl.textContent = '0/0';

  // Case / regex toggles. They affect SOURCE find + replace (CodeMirror's
  // SearchQuery honours them); preview find stays plain case-insensitive.
  const caseBtn = makeToggleBtn('Aa', 'Match case');
  const regexBtn = makeToggleBtn('.*', 'Regular expression');

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

  findRow.append(input, countEl, caseBtn, regexBtn, scopeGroup, prevBtn, nextBtn, closeBtn);

  const replaceInput = document.createElement('input');
  replaceInput.type = 'search';
  // Distinct class from the find input so `.pmd-find-input` selects exactly one
  // element (the find field) — shared visual styling is applied via the grouped
  // CSS selector below.
  replaceInput.className = 'pmd-find-replace-input';
  replaceInput.setAttribute('aria-label', 'Replace with');
  replaceInput.placeholder = 'Replace';

  const replaceBtn = makeTextBtn('Replace', 'Replace next match (source only)');
  const replaceAllBtn = makeTextBtn('All', 'Replace all matches (source only)');

  replaceRow.append(replaceInput, replaceBtn, replaceAllBtn);

  bar.append(findRow, replaceRow);

  // Pure replace-query state mirrors the input fields + toggles; CodeMirror
  // search state is derived from it on every change.
  let rstate: FindReplaceState = initialFindReplaceState();

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
  function makeToggleBtn(label: string, title: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pmd-find-btn pmd-find-toggle';
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-pressed', 'false');
    return b;
  }
  function makeTextBtn(label: string, title: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pmd-find-btn pmd-find-text-btn';
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

  /** Sync the pure replace state from the live inputs/toggles. */
  function syncState(): void {
    rstate = {
      search: input.value,
      replace: replaceInput.value,
      caseSensitive: caseBtn.getAttribute('aria-pressed') === 'true',
      regexp: regexBtn.getAttribute('aria-pressed') === 'true',
    };
  }

  /** Push the typed query (+ case/regex toggles + replacement) into
   *  CodeMirror's search state so the source pane searches/replaces correctly.
   *  When the replace row is open we push the full query (so replaceNext/All
   *  see the replacement); otherwise a find-only query. */
  function pushSourceQuery(): void {
    const ed = deps.getEditor();
    if (!ed) return;
    if (!replaceRow.hidden) {
      setSourceReplaceQuery(ed.view, buildReplaceQuery(rstate));
    } else if (rstate.caseSensitive || rstate.regexp) {
      // Find-only but with toggles active: still need the full query options.
      setSourceReplaceQuery(ed.view, buildReplaceQuery({ ...rstate, replace: '' }));
    } else {
      setSourceQuery(ed.view, input.value);
    }
  }

  function applyQuery(): void {
    syncState();
    if (impliedScope() === 'preview') {
      // Preview find is plain case-insensitive; toggles only affect source.
      preview.setQuery(input.value);
    } else {
      preview.clear();
      pushSourceQuery();
    }
    updateReplaceUi();
    updateCount();
  }

  function updateReplaceUi(): void {
    // Replace is source-scoped only. Disable the controls outside source scope
    // (preview DOM is sanitized output we never mutate) or with no search term.
    const sourceScope = impliedScope() === 'source';
    const enabled = sourceScope && canReplace(rstate);
    replaceBtn.disabled = !enabled;
    replaceAllBtn.disabled = !enabled;
    replaceInput.disabled = !sourceScope;
    replaceInput.title = sourceScope ? '' : 'Replace works in the source editor only';
  }

  function doReplace(all: boolean): void {
    if (impliedScope() !== 'source') return;
    syncState();
    if (!canReplace(rstate)) return;
    const ed = deps.getEditor();
    if (!ed) return;
    // Ensure CM's search state matches the current fields before replacing.
    setSourceReplaceQuery(ed.view, buildReplaceQuery(rstate));
    if (all) sourceReplaceAll(ed.view);
    else sourceReplaceNext(ed.view);
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

  function toggle(btn: HTMLButtonElement): void {
    const next = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(next));
    btn.classList.toggle('data-active', next);
    applyQuery();
  }
  caseBtn.addEventListener('click', () => toggle(caseBtn));
  regexBtn.addEventListener('click', () => toggle(regexBtn));

  replaceInput.addEventListener('input', syncState);
  replaceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doReplace(false); }
    else if (e.key === 'Escape') { e.preventDefault(); api.close(); }
  });
  replaceBtn.addEventListener('click', () => doReplace(false));
  replaceAllBtn.addEventListener('click', () => doReplace(true));

  function reveal(withReplace: boolean): void {
    bar.hidden = false;
    replaceRow.hidden = !withReplace;
    scope = impliedScope();
    updateScopeUi();
    input.focus();
    input.select();
    if (impliedScope() === 'source') deps.getEditor()?.openSearch();
    applyQuery(); // applyQuery pushes the query to CM when scope is source
  }

  const api: FindController = {
    element: bar,
    open(): void {
      reveal(false);
    },
    openReplace(): void {
      reveal(true);
    },
    close(): void {
      replaceRow.hidden = true;
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
