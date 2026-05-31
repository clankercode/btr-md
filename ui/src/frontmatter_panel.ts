import type { CommonFrontmatter, FrontmatterFact } from './document_contracts.ts';
import { clampMenuPosition } from './context_menu.ts';

export interface FrontmatterPanelDeps {
  onEditValue: (key: string, value: string) => void;
  onAddEntry: (key: string, value: string) => void;
}

const RECOGNIZED: Array<keyof CommonFrontmatter> = [
  'title',
  'description',
  'slug',
  'sidebar_label',
  'sidebar_position',
  'tags',
  'draft',
];

let openPanelEl: HTMLElement | null = null;

export function closeFrontmatterPanel(): void {
  if (!openPanelEl) return;
  openPanelEl.remove();
  openPanelEl = null;
}

export function openFrontmatterPanel(
  x: number,
  y: number,
  fm: FrontmatterFact | null,
  deps: FrontmatterPanelDeps,
): void {
  closeFrontmatterPanel();

  const panel = document.createElement('div');
  panel.className = 'pmd-dropdown-menu pmd-frontmatter-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Frontmatter');

  const editable = fm !== null && fm.syntax === 'valid';
  panel.append(headerFor(fm));

  if (fm && fm.syntax !== 'valid') {
    const hint = document.createElement('p');
    hint.className = 'pmd-frontmatter-hint';
    hint.textContent = 'Fix the frontmatter in source to enable editing.';
    panel.append(hint);
  }

  if (fm && fm.syntax === 'valid') {
    const list = document.createElement('div');
    list.className = 'pmd-frontmatter-fields';
    for (const key of RECOGNIZED) {
      list.append(fieldRow(key, metadataValue(fm.metadata, key), editable, deps));
    }
    for (const [key, value] of Object.entries(fm.metadata.unknown)) {
      list.append(fieldRow(key, value, editable, deps));
    }
    panel.append(list);
  }

  if (editable || fm === null) panel.append(addEntryRow(deps));

  panel.style.position = 'fixed';
  panel.style.visibility = 'hidden';
  document.body.appendChild(panel);
  const rect = panel.getBoundingClientRect();
  const { left, top } = clampMenuPosition(
    { x, y },
    { w: rect.width, h: rect.height },
    { w: window.innerWidth, h: window.innerHeight },
  );
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.visibility = 'visible';
  openPanelEl = panel;

  const dismiss = (ev: Event): void => {
    if (ev.type === 'mousedown' && panel.contains(ev.target as Node)) return;
    if (ev.type === 'keydown' && (ev as KeyboardEvent).key !== 'Escape') return;
    closeFrontmatterPanel();
    window.removeEventListener('mousedown', dismiss, true);
    window.removeEventListener('keydown', dismiss, true);
  };
  window.addEventListener('mousedown', dismiss, true);
  window.addEventListener('keydown', dismiss, true);
}

function headerFor(fm: FrontmatterFact | null): HTMLElement {
  const header = document.createElement('div');
  header.className = 'pmd-frontmatter-header';
  if (!fm) {
    header.textContent = 'No frontmatter';
    return header;
  }

  header.textContent = `Frontmatter (${fm.format.toUpperCase()})`;
  if (fm.syntax !== 'valid') {
    const badge = document.createElement('span');
    badge.className = 'pmd-frontmatter-badge';
    badge.textContent = 'malformed';
    header.append(' ', badge);
  }
  return header;
}

function metadataValue(metadata: CommonFrontmatter, key: keyof CommonFrontmatter): string {
  const raw = metadata[key];
  if (key === 'tags') return (raw as string[]).join(', ');
  if (raw === null || raw === undefined) return '';
  return String(raw);
}

function fieldRow(
  key: string,
  value: string,
  editable: boolean,
  deps: FrontmatterPanelDeps,
): HTMLElement {
  const row = document.createElement('label');
  row.className = 'pmd-frontmatter-field';

  const name = document.createElement('span');
  name.className = 'pmd-frontmatter-key';
  name.textContent = key;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'pmd-frontmatter-value';
  input.value = value;
  input.disabled = !editable;
  input.addEventListener('change', () => deps.onEditValue(key, input.value));

  row.append(name, input);
  return row;
}

function addEntryRow(deps: FrontmatterPanelDeps): HTMLElement {
  const row = document.createElement('div');
  row.className = 'pmd-frontmatter-add';

  const keyInput = document.createElement('input');
  keyInput.type = 'text';
  keyInput.placeholder = 'key';
  keyInput.className = 'pmd-frontmatter-add-key';

  const valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.placeholder = 'value';
  valueInput.className = 'pmd-frontmatter-add-value';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'pmd-btn pmd-btn-ghost pmd-btn-sm';
  addBtn.textContent = 'Add';
  addBtn.addEventListener('click', () => {
    const key = keyInput.value.trim();
    if (!key) return;
    deps.onAddEntry(key, valueInput.value);
  });

  row.append(keyInput, valueInput, addBtn);
  return row;
}
