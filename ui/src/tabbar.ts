// The tab strip. Lives inside `.pmd-chrome`, below the toolbar. createElement
// only (no innerHTML). Re-renders from the `TabStore` on change, measures the
// chrome height into `--pmd-chrome-h`, and exposes the reusable tab-highlight
// effect.

import { uiForState, assertNever } from './doc_state.js';
import { openContextMenu } from './context_menu.js';
import { buildTabContextItems } from './tab_context_menu.js';
import type { Tab, TabId, TabStore } from './tabs.js';

// Re-exported for callers/tests that reach the builder via the tab-bar module.
export { buildTabContextItems };

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
  onRevealInFolder?: (path: string) => void;
  onCopyPath?: (path: string) => void;
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

  function focusTabByOffset(currentId: TabId, offset: number): void {
    const tabs = store.list();
    const currentIndex = tabs.findIndex((tab) => tab.id === currentId);
    if (currentIndex < 0 || tabs.length === 0) return;
    const next = tabs[(currentIndex + offset + tabs.length) % tabs.length];
    focusTab(next.id);
  }

  function focusTab(id: TabId): void {
    const tabEl = el.querySelector<HTMLElement>(`.pmd-tab[data-tab-id="${id}"]`);
    tabEl?.focus();
  }

  function makeTab(tab: Tab, active: boolean): HTMLElement {
    const tabEl = document.createElement('div');
    tabEl.className = 'pmd-tab';
    tabEl.dataset.tabId = String(tab.id);
    tabEl.dataset.kind = tab.kind;
    tabEl.setAttribute('role', 'tab');
    tabEl.setAttribute('aria-selected', String(active));
    tabEl.title = tab.kind === 'doc' && tab.filePath ? tab.filePath : tab.title;
    tabEl.tabIndex = active ? 0 : -1;
    if (active) tabEl.toggleAttribute('data-active', true);
    if (tab.kind === 'doc') tabEl.dataset.pinned = String(tab.pinned);

    const icon = document.createElement('span');
    icon.className = 'pmd-tab-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = tabIcon(tab);
    tabEl.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'pmd-tab-label pmd-truncate';
    label.textContent = tab.title;
    label.title = tab.kind === 'doc' && tab.filePath ? tab.filePath : tab.title;
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
    // Keep the tab's select/drag from eating the gesture; close on pointerup so
    // it still fires even if a re-render swaps the button between a click's
    // pointerdown and pointerup (which would strand a plain `click` listener).
    close.addEventListener('pointerdown', (e) => e.stopPropagation());
    close.addEventListener('pointerup', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      handlers.onClose(tab.id);
    });
    // Belt-and-braces for environments that deliver only `click` (e.g. keyboard
    // activation of the button): `closeTab` is idempotent on an already-closed id.
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      handlers.onClose(tab.id);
    });
    tabEl.appendChild(close);

    tabEl.addEventListener('click', () => handlers.onSelect(tab.id));
    // Right-click context menu: close this tab, plus a disabled Move-to-New-Window
    // affordance (functional move lands in a later phase).
    tabEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const filePath = tab.kind === 'doc' ? tab.filePath : null;
      openContextMenu(
        e.clientX,
        e.clientY,
        buildTabContextItems({
          onClose: () => handlers.onClose(tab.id),
          filePath,
          onRevealInFolder: filePath && handlers.onRevealInFolder
            ? () => handlers.onRevealInFolder!(filePath)
            : undefined,
          onCopyPath: filePath && handlers.onCopyPath
            ? () => handlers.onCopyPath!(filePath)
            : undefined,
        })
      );
    });
    // Middle-click closes the tab (standard browser/editor behaviour). The close
    // arrives as `auxclick`; suppress the Linux middle-click paste/autoscroll on
    // the preceding pointerdown.
    tabEl.addEventListener('pointerdown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    tabEl.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      handlers.onClose(tab.id);
    });
    tabEl.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        focusTabByOffset(tab.id, 1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        focusTabByOffset(tab.id, -1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        const first = store.list()[0];
        if (first) focusTab(first.id);
      } else if (event.key === 'End') {
        event.preventDefault();
        const tabs = store.list();
        const last = tabs[tabs.length - 1];
        if (last) focusTab(last.id);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handlers.onSelect(tab.id);
        requestAnimationFrame(() => focusTab(tab.id));
      }
    });
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

  el.addEventListener('dblclick', (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.pmd-tab, .pmd-newtab-btn, button')) return;
    handlers.onNewTab(event.shiftKey);
  });

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
