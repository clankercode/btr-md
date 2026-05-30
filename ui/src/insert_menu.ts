// "Insert" toolbar dropdown: GitHub alerts + footnotes (Phase 4). Self-contained
// (appends its own trigger to the toolbar). The actual editor mutation is done
// by the caller via the deps (which use editor_insert + footnotes.ts), so this
// module stays DOM-only and decoupled from CodeMirror.

export type AlertType = 'note' | 'tip' | 'important' | 'warning' | 'caution';

const ALERT_TYPES: { type: AlertType; label: string }[] = [
  { type: 'note', label: 'Note' },
  { type: 'tip', label: 'Tip' },
  { type: 'important', label: 'Important' },
  { type: 'warning', label: 'Warning' },
  { type: 'caution', label: 'Caution' },
];

const LAST_ALERT_KEY = 'pmd:last-alert';

export interface InsertMenuDeps {
  insertAlert: (type: AlertType) => void;
  insertFootnote: () => void;
}

export interface InsertMenuInstance {
  el: HTMLElement;
  /** Enable/disable (no insert target when the active tab is not a document). */
  setEnabled: (enabled: boolean) => void;
}

function loadLastAlert(): AlertType {
  const v = localStorage.getItem(LAST_ALERT_KEY);
  return ALERT_TYPES.some((a) => a.type === v) ? (v as AlertType) : 'note';
}

export function createInsertMenu(toolbar: HTMLElement, deps: InsertMenuDeps): InsertMenuInstance {
  let lastAlert: AlertType = loadLastAlert();

  const wrapper = document.createElement('div');
  wrapper.className = 'pmd-dropdown';

  const btn = document.createElement('button');
  btn.className = 'pmd-btn pmd-btn-ghost pmd-btn-sm';
  btn.type = 'button';
  btn.textContent = 'Insert ▾';
  btn.title = 'Insert a footnote or GitHub alert';

  const menu = document.createElement('ul');
  menu.className = 'pmd-dropdown-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('data-align', 'end');
  menu.style.display = 'none';

  const close = (): void => {
    menu.style.display = 'none';
  };

  const item = (label: string, onClick: () => void): HTMLLIElement => {
    const li = document.createElement('li');
    li.className = 'pmd-dropdown-item';
    li.setAttribute('role', 'menuitem');
    li.textContent = label;
    li.addEventListener('click', () => {
      close();
      onClick();
    });
    return li;
  };

  menu.appendChild(
    item('Footnote', () => deps.insertFootnote())
  );
  const divider = document.createElement('li');
  divider.className = 'pmd-dropdown-divider';
  divider.setAttribute('role', 'separator');
  menu.appendChild(divider);

  for (const { type, label } of ALERT_TYPES) {
    menu.appendChild(
      item(`Alert: ${label}`, () => {
        lastAlert = type;
        localStorage.setItem(LAST_ALERT_KEY, type);
        deps.insertAlert(type);
      })
    );
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (btn.disabled) return;
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  });
  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target as Node)) close();
  });

  wrapper.appendChild(btn);
  wrapper.appendChild(menu);
  toolbar.appendChild(wrapper);

  // Touch lastAlert so it's retained for a future split-button (and not an
  // unused-variable error under strict tsc).
  void lastAlert;

  return {
    el: wrapper,
    setEnabled: (enabled: boolean) => {
      btn.disabled = !enabled;
      if (!enabled) close();
    },
  };
}
