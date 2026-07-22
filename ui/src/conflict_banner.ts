/**
 * Conflict banner (B011): prominent Reload / Merge / Keep mine when the
 * active document is `disk_changed_dirty` (disk + buffer both dirty).
 *
 * Pure visibility helpers live here so unit tests can exercise dismiss
 * episode keys without DOM. The factory owns the banner DOM and fires
 * actions via callbacks — main.ts wires Reload → doReload, Merge → doMerge,
 * Keep mine → soft-dismiss for this (docId, disk) episode only.
 */

import type { FileState } from './doc_state.js';

export type ConflictBannerAction = 'reload' | 'merge' | 'keep_mine';

/** Soft-dismiss key for one conflict episode (same doc + same on-disk digest). */
export interface ConflictEpisodeKey {
  docId: number;
  disk: string;
}

export const CONFLICT_BANNER_MESSAGE =
  'Conflict: file changed on disk while you have unsaved edits';

/**
 * Whether lifecycle state is a real disk-vs-memory conflict that should
 * surface the banner (when not soft-dismissed).
 */
export function isConflictState(state: FileState): boolean {
  return state.kind === 'disk_changed_dirty';
}

/**
 * Episode key for soft-dismiss. Null when state is not a conflict — callers
 * clear or ignore dismiss when the key is null.
 */
export function conflictEpisodeKey(
  docId: number,
  state: FileState,
): ConflictEpisodeKey | null {
  if (state.kind !== 'disk_changed_dirty') return null;
  return { docId, disk: state.disk };
}

export function sameConflictEpisode(
  a: ConflictEpisodeKey | null | undefined,
  b: ConflictEpisodeKey | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a.docId === b.docId && a.disk === b.disk;
}

/**
 * Whether the banner should be visible for the active document.
 * Soft-dismiss only hides the current (docId, disk) episode; a later disk
 * change (new digest) or another doc shows the banner again.
 */
export function isConflictBannerVisible(
  state: FileState,
  docId: number | null,
  dismissed: ConflictEpisodeKey | null,
): boolean {
  if (docId == null || !isConflictState(state)) return false;
  const key = conflictEpisodeKey(docId, state);
  return !sameConflictEpisode(key, dismissed);
}

export interface ConflictBannerInstance {
  el: HTMLElement;
  setVisible: (visible: boolean) => void;
  /** True when the banner is currently shown. */
  isVisible: () => boolean;
  onAction: (handler: (action: ConflictBannerAction) => void) => void;
  destroy: () => void;
}

/**
 * Create the conflict banner element. Caller appends `el` (typically inside
 * `.pmd-chrome` so tabbar's chrome-height measure includes it) and drives
 * visibility from `isConflictBannerVisible`.
 */
export function createConflictBanner(parent?: HTMLElement): ConflictBannerInstance {
  const el = document.createElement('div');
  el.className = 'pmd-conflict-banner';
  el.setAttribute('role', 'alert');
  el.setAttribute('aria-live', 'assertive');
  el.dataset.testid = 'conflict-banner';
  el.hidden = true;

  const icon = document.createElement('span');
  icon.className = 'pmd-conflict-banner-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '⚠';

  const msg = document.createElement('span');
  msg.className = 'pmd-conflict-banner-msg';
  msg.textContent = CONFLICT_BANNER_MESSAGE;

  const actions = document.createElement('div');
  actions.className = 'pmd-conflict-banner-actions';

  const handlers: ((action: ConflictBannerAction) => void)[] = [];
  const fire = (action: ConflictBannerAction): void => {
    handlers.forEach((h) => h(action));
  };

  const mkBtn = (
    action: ConflictBannerAction,
    label: string,
    className: string,
    title: string,
  ): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.textContent = label;
    btn.title = title;
    btn.dataset.action = action;
    btn.addEventListener('click', () => fire(action));
    return btn;
  };

  // Reload is destructive for in-memory edits — primary warning styling.
  const reloadBtn = mkBtn(
    'reload',
    'Reload',
    'pmd-btn pmd-btn-sm pmd-conflict-banner-reload',
    'Discard editor changes and load the file from disk',
  );
  const mergeBtn = mkBtn(
    'merge',
    'Merge',
    'pmd-btn pmd-btn-primary pmd-btn-sm',
    'Merge on-disk changes into the editor (does not save)',
  );
  const keepBtn = mkBtn(
    'keep_mine',
    'Keep mine',
    'pmd-btn pmd-btn-ghost pmd-btn-sm',
    'Keep editing; dismiss this banner until the conflict is resolved or disk changes again',
  );

  actions.append(reloadBtn, mergeBtn, keepBtn);
  el.append(icon, msg, actions);

  if (parent) parent.appendChild(el);

  const measureChrome = (): void => {
    const chrome = el.closest('.pmd-chrome') as HTMLElement | null;
    if (chrome) {
      document.documentElement.style.setProperty(
        '--pmd-chrome-h',
        `${chrome.offsetHeight}px`,
      );
    }
  };

  return {
    el,
    setVisible: (visible: boolean) => {
      el.hidden = !visible;
      // Re-measure chrome height so app padding tracks banner show/hide.
      requestAnimationFrame(measureChrome);
    },
    isVisible: () => !el.hidden,
    onAction: (handler: (action: ConflictBannerAction) => void) => {
      handlers.push(handler);
    },
    destroy: () => {
      el.remove();
    },
  };
}
