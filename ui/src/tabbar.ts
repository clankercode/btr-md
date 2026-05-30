// The tab strip. Lives inside `.pmd-chrome`, below the toolbar. createElement
// only (no innerHTML). Re-renders from the `TabStore` on change, measures the
// chrome height into `--pmd-chrome-h`, and exposes the reusable tab-highlight
// effect.

import { uiForState, assertNever } from './doc_state.js';
import type { Tab, TabId, TabStore } from './tabs.js';

const HIGHLIGHT_CLASS = 'pmd-tab-highlight';

const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Re-trigger the grow/shake highlight on `el` (reflow + animationend cleanup). */
export function triggerTabHighlight(el: HTMLElement): void {
  if (prefersReducedMotion()) return;
  el.classList.remove(HIGHLIGHT_CLASS);
  // Force reflow so removing + re-adding the class restarts the animation.
  void el.offsetWidth;
  el.classList.add(HIGHLIGHT_CLASS);
  const clear = (): void => {
    el.classList.remove(HIGHLIGHT_CLASS);
    el.removeEventListener('animationend', clear);
  };
  el.addEventListener('animationend', clear);
}

export interface TabBarHandlers {
  onSelect: (id: TabId) => void;
  onClose: (id: TabId) => void;
  onNewTab: (shiftKey: boolean) => void;
}

export interface TabBarInstance {
  el: HTMLElement;
  render: () => void;
  triggerHighlight: (id: TabId) => void;
}

function tabIcon(tab: Tab): string {
  switch (tab.kind) {
    case 'doc':
      return '◧';
    case 'empty':
      return '＋';
    case 'browser':
      return '🗀';
    default:
      return assertNever(tab);
  }
}

function isModifiedTab(tab: Tab): boolean {
  return tab.kind === 'doc' ? uiForState(tab.fileState).modified : false;
}

export function createTabBar(store: TabStore, handlers: TabBarHandlers): TabBarInstance {
  const el = document.createElement('div');
  el.className = 'pmd-tabbar';
  el.setAttribute('role', 'tablist');

  const measureChrome = (): void => {
    const chrome = el.closest('.pmd-chrome') as HTMLElement | null;
    if (chrome) {
      document.documentElement.style.setProperty('--pmd-chrome-h', `${chrome.offsetHeight}px`);
    }
  };

  function makeTab(tab: Tab, active: boolean): HTMLElement {
    const tabEl = document.createElement('div');
    tabEl.className = 'pmd-tab';
    tabEl.dataset.tabId = String(tab.id);
    tabEl.dataset.kind = tab.kind;
    tabEl.setAttribute('role', 'tab');
    tabEl.setAttribute('aria-selected', String(active));
    if (active) tabEl.toggleAttribute('data-active', true);

    const icon = document.createElement('span');
    icon.className = 'pmd-tab-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = tabIcon(tab);
    tabEl.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'pmd-tab-label pmd-truncate';
    label.textContent = tab.title;
    label.title = tab.title;
    tabEl.appendChild(label);

    if (isModifiedTab(tab)) {
      const dot = document.createElement('span');
      dot.className = 'pmd-tab-dot';
      dot.setAttribute('aria-hidden', 'true');
      dot.textContent = '●';
      tabEl.appendChild(dot);
    }

    const close = document.createElement('button');
    close.className = 'pmd-tab-close';
    close.type = 'button';
    close.textContent = '×';
    close.title = 'Close tab';
    close.setAttribute('aria-label', `Close ${tab.title}`);
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      handlers.onClose(tab.id);
    });
    tabEl.appendChild(close);

    tabEl.addEventListener('click', () => handlers.onSelect(tab.id));
    return tabEl;
  }

  function render(): void {
    el.replaceChildren();
    for (const tab of store.list()) {
      el.appendChild(makeTab(tab, tab.id === store.activeId()));
    }

    const newBtn = document.createElement('button');
    newBtn.className = 'pmd-newtab-btn';
    newBtn.type = 'button';
    newBtn.textContent = '+';
    newBtn.title = 'New tab (Shift-click: open in background)';
    newBtn.setAttribute('aria-label', 'New tab');
    newBtn.addEventListener('click', (e) => handlers.onNewTab(e.shiftKey));
    el.appendChild(newBtn);

    requestAnimationFrame(measureChrome);
  }

  store.onChange(render);
  render();

  return {
    el,
    render,
    triggerHighlight: (id: TabId) => {
      const tabEl = el.querySelector(`.pmd-tab[data-tab-id="${id}"]`);
      if (tabEl instanceof HTMLElement) triggerTabHighlight(tabEl);
    },
  };
}
