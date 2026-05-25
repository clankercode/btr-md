export interface ThemeInfo {
  slug: string;
  name: string;
  mode: 'light' | 'dark';
  inspired_by?: string;
  preview_bg?: string;
  preview_fg?: string;
  preview_accent?: string;
  preview_bg_elevated?: string;
}

interface PickerState {
  themes: ThemeInfo[];
  filteredThemes: ThemeInfo[];
  selectedIndex: number;
  filter: string;
  onSelect: (slug: string, mode?: 'light' | 'dark') => void;
  onClose: () => void;
  previousFocus: HTMLElement | null;
}

let currentState: PickerState | null = null;

function renderCard(theme: ThemeInfo, index: number, isSelected: boolean): HTMLElement {
  const card = document.createElement('div');
  card.className = 'pmd-picker-card';
  card.dataset.slug = theme.slug;
  card.dataset.index = String(index);
  card.dataset.mode = theme.mode;
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', `${theme.name} (${theme.mode})`);
  if (isSelected) {
    card.dataset.selected = 'true';
  }

  const bg = theme.preview_bg || (theme.mode === 'dark' ? '#1f2328' : '#ffffff');
  const bgElevated = theme.preview_bg_elevated || bg;
  const fg = theme.preview_fg || (theme.mode === 'dark' ? '#e6edf3' : '#1f2328');
  const accent = theme.preview_accent || (theme.mode === 'dark' ? '#7aa2f7' : '#0969da');

  // Primary apply button — entire visual card, including preview swatch and name row,
  // sits inside this button so a single click/Enter/Space applies the theme.
  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'pmd-picker-card-apply';
  applyBtn.dataset.slug = theme.slug;
  applyBtn.dataset.index = String(index);
  applyBtn.setAttribute('aria-label', `Apply ${theme.name}`);
  applyBtn.tabIndex = isSelected ? 0 : -1;

  const preview = document.createElement('div');
  preview.className = 'pmd-picker-preview';
  preview.style.background = bg;
  preview.style.color = fg;

  const previewInner = document.createElement('div');
  previewInner.className = 'pmd-picker-preview-inner';
  previewInner.style.background = bgElevated;
  previewInner.style.color = fg;

  const previewHeading = document.createElement('span');
  previewHeading.className = 'pmd-picker-preview-heading';
  previewHeading.textContent = 'Aa';

  const previewAccent = document.createElement('span');
  previewAccent.className = 'pmd-picker-preview-accent';
  previewAccent.style.background = accent;

  previewInner.appendChild(previewHeading);
  previewInner.appendChild(previewAccent);
  preview.appendChild(previewInner);
  applyBtn.appendChild(preview);

  const info = document.createElement('div');
  info.className = 'pmd-picker-info';

  const nameRow = document.createElement('div');
  nameRow.className = 'pmd-picker-name-row';

  const name = document.createElement('span');
  name.className = 'pmd-picker-name';
  name.textContent = theme.name;
  nameRow.appendChild(name);

  const modeBadge = document.createElement('span');
  modeBadge.className = 'pmd-picker-mode-badge';
  modeBadge.dataset.mode = theme.mode;
  modeBadge.textContent = theme.mode;
  nameRow.appendChild(modeBadge);

  info.appendChild(nameRow);

  if (theme.inspired_by) {
    const rationale = document.createElement('span');
    rationale.className = 'pmd-picker-rationale';
    rationale.textContent = `Inspired by ${theme.inspired_by}`;
    info.appendChild(rationale);
  }

  applyBtn.appendChild(info);
  card.appendChild(applyBtn);

  // Sibling action buttons — outside the apply button so they're independently
  // focusable / clickable without bubbling through the apply target.
  const actions = document.createElement('div');
  actions.className = 'pmd-picker-actions';
  const lightBtn = document.createElement('button');
  lightBtn.type = 'button';
  lightBtn.className = 'pmd-picker-action pmd-picker-action--light';
  lightBtn.dataset.slug = theme.slug;
  lightBtn.dataset.mode = 'light';
  lightBtn.title = 'Use as light theme (auto-switch)';
  lightBtn.setAttribute('aria-label', `Set ${theme.name} as auto-switch light theme`);
  lightBtn.textContent = 'As light';
  const darkBtn = document.createElement('button');
  darkBtn.type = 'button';
  darkBtn.className = 'pmd-picker-action pmd-picker-action--dark';
  darkBtn.dataset.slug = theme.slug;
  darkBtn.dataset.mode = 'dark';
  darkBtn.title = 'Use as dark theme (auto-switch)';
  darkBtn.setAttribute('aria-label', `Set ${theme.name} as auto-switch dark theme`);
  darkBtn.textContent = 'As dark';
  actions.appendChild(lightBtn);
  actions.appendChild(darkBtn);
  card.appendChild(actions);

  return card;
}

function renderPicker(state: PickerState): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'pmd-picker-overlay';
  overlay.id = 'theme-picker-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'pmd-picker-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'theme-picker-title');

  const header = document.createElement('div');
  header.className = 'pmd-picker-header';

  const title = document.createElement('h2');
  title.className = 'pmd-picker-title';
  title.id = 'theme-picker-title';
  title.textContent = 'Choose Theme';
  header.appendChild(title);

  const searchWrapper = document.createElement('div');
  searchWrapper.className = 'pmd-picker-search-wrapper';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'pmd-picker-search';
  searchInput.placeholder = 'Filter themes... (press / to focus)';
  searchInput.setAttribute('aria-label', 'Filter themes');
  searchInput.value = state.filter;
  searchInput.id = 'theme-filter-input';
  searchWrapper.appendChild(searchInput);
  header.appendChild(searchWrapper);

  const hint = document.createElement('div');
  hint.className = 'pmd-picker-hint';
  hint.textContent = 'Click a card to apply now, or use "As light" / "As dark" to set auto-switch slots.';
  header.appendChild(hint);

  dialog.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'pmd-picker-grid';
  grid.id = 'theme-grid';

  state.filteredThemes.forEach((theme, index) => {
    grid.appendChild(renderCard(theme, index, index === state.selectedIndex));
  });

  dialog.appendChild(grid);

  // Live region announces selection changes for screen readers.
  const liveRegion = document.createElement('div');
  liveRegion.id = 'theme-picker-live';
  liveRegion.className = 'pmd-sr-only';
  liveRegion.setAttribute('aria-live', 'polite');
  liveRegion.setAttribute('aria-atomic', 'true');
  dialog.appendChild(liveRegion);

  overlay.appendChild(dialog);
  return overlay;
}

function rebuildGrid(state: PickerState): void {
  const grid = document.getElementById('theme-grid');
  if (!grid) return;
  grid.innerHTML = '';
  state.filteredThemes.forEach((theme, index) => {
    grid.appendChild(renderCard(theme, index, index === state.selectedIndex));
  });
}

function updateSelection(state: PickerState): void {
  const grid = document.getElementById('theme-grid');
  if (!grid) return;
  const cards = Array.from(grid.querySelectorAll<HTMLElement>('.pmd-picker-card'));
  cards.forEach((card, idx) => {
    const isSelected = idx === state.selectedIndex;
    if (isSelected) {
      card.dataset.selected = 'true';
    } else {
      delete card.dataset.selected;
    }
    const applyBtn = card.querySelector<HTMLButtonElement>('.pmd-picker-card-apply');
    if (applyBtn) applyBtn.tabIndex = isSelected ? 0 : -1;
  });
  announceSelection(state);
}

function announceSelection(state: PickerState): void {
  const live = document.getElementById('theme-picker-live');
  const theme = state.filteredThemes[state.selectedIndex];
  if (live && theme) {
    live.textContent = `${theme.name}, ${theme.mode}, ${state.selectedIndex + 1} of ${state.filteredThemes.length}`;
  }
}

function filterThemes(themes: ThemeInfo[], filter: string): ThemeInfo[] {
  if (!filter.trim()) return themes;
  const lower = filter.toLowerCase();
  return themes.filter(t =>
    t.name.toLowerCase().includes(lower) ||
    t.slug.toLowerCase().includes(lower) ||
    (t.inspired_by && t.inspired_by.toLowerCase().includes(lower))
  );
}

function moveSelection(delta: number): void {
  if (!currentState) return;
  if (currentState.filteredThemes.length === 0) return;
  const newIndex = currentState.selectedIndex + delta;
  currentState.selectedIndex = Math.max(0, Math.min(newIndex, currentState.filteredThemes.length - 1));
  updateSelection(currentState);
  scrollSelectedIntoView();
  focusSelectedCard();
}

function focusSelectedCard(): void {
  const grid = document.getElementById('theme-grid');
  if (!grid) return;
  const selectedCard = grid.querySelector<HTMLElement>('.pmd-picker-card[data-selected="true"]');
  const applyBtn = selectedCard?.querySelector<HTMLButtonElement>('.pmd-picker-card-apply');
  applyBtn?.focus();
}

function scrollSelectedIntoView(): void {
  const grid = document.getElementById('theme-grid');
  const selected = grid?.querySelector('[data-selected="true"]');
  selected?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function selectCurrent(): void {
  if (!currentState) return;
  const theme = currentState.filteredThemes[currentState.selectedIndex];
  if (theme) {
    const onSelect = currentState.onSelect;
    closePicker();
    onSelect(theme.slug);
  }
}

function closePicker(): void {
  const previousFocus = currentState?.previousFocus ?? null;
  const overlay = document.getElementById('theme-picker-overlay');
  if (overlay) {
    overlay.remove();
  }
  document.removeEventListener('keydown', handlePickerKeydown, true);
  currentState = null;
  // Restore focus to the element that was focused before the picker opened.
  if (previousFocus && document.contains(previousFocus)) {
    previousFocus.focus();
  }
}

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((el) => {
    if (el.hasAttribute('disabled')) return false;
    if (el.tabIndex < 0) return false;
    // offsetParent is null for display:none ancestors.
    if (el.offsetParent === null) return false;
    // visibility:hidden / collapse keeps layout but removes the element from
    // sequential focus navigation — exclude so the focus trap doesn't try
    // to focus an invisible action button.
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (style.display === 'none') return false;
    return true;
  });
}

function trapFocus(e: KeyboardEvent): void {
  const overlay = document.getElementById('theme-picker-overlay');
  if (!overlay) return;
  const focusable = getFocusableElements(overlay);
  if (focusable.length === 0) {
    e.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (e.shiftKey) {
    if (active === first || !overlay.contains(active)) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (active === last || !overlay.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }
}

function handlePickerKeydown(e: KeyboardEvent): void {
  if (!currentState) return;

  if (e.key === 'Tab') {
    trapFocus(e);
    return;
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    closePicker();
    return;
  }

  // Only intercept "/" when focus is not in the search input.
  if (e.key === '/' && !(e.target instanceof HTMLInputElement)) {
    e.preventDefault();
    const searchInput = document.getElementById('theme-filter-input') as HTMLInputElement;
    searchInput?.focus();
    searchInput?.select();
    return;
  }

  // Arrow / Enter navigation should fire when focus is on a card OR the search input,
  // but if the user types arrows in the input we still want to move the grid selection.
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      moveSelection(3);
      break;
    case 'ArrowUp':
      e.preventDefault();
      moveSelection(-3);
      break;
    case 'ArrowRight':
      e.preventDefault();
      moveSelection(1);
      break;
    case 'ArrowLeft':
      e.preventDefault();
      moveSelection(-1);
      break;
    case 'Enter':
      // Let Enter on action buttons activate them normally; only auto-select
      // when focus is on the search input or apply button.
      if (e.target instanceof HTMLInputElement || (e.target instanceof HTMLElement && e.target.classList.contains('pmd-picker-card-apply'))) {
        e.preventDefault();
        selectCurrent();
      }
      break;
  }
}

export function openThemePicker(themes: ThemeInfo[], onSelect: (slug: string, mode?: 'light' | 'dark') => void): void {
  if (currentState) {
    closePicker();
  }

  const filteredThemes = filterThemes(themes, '');
  const previousFocus = document.activeElement as HTMLElement | null;

  currentState = {
    themes,
    filteredThemes,
    selectedIndex: 0,
    filter: '',
    onSelect,
    onClose: closePicker,
    previousFocus,
  };

  const overlay = renderPicker(currentState);
  document.body.appendChild(overlay);

  const searchInput = document.getElementById('theme-filter-input') as HTMLInputElement;
  searchInput?.focus();
  announceSelection(currentState);

  searchInput?.addEventListener('input', () => {
    if (!currentState) return;
    currentState.filter = searchInput.value;
    currentState.filteredThemes = filterThemes(currentState.themes, currentState.filter);
    currentState.selectedIndex = 0;
    rebuildGrid(currentState);
    announceSelection(currentState);
  });

  overlay.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;

    const actionBtn = target.closest<HTMLElement>('.pmd-picker-action');
    if (actionBtn) {
      e.stopPropagation();
      const slug = actionBtn.dataset.slug;
      const mode = actionBtn.dataset.mode as 'light' | 'dark' | undefined;
      if (slug && currentState) {
        const cb = currentState.onSelect;
        closePicker();
        cb(slug, mode);
      }
      return;
    }

    const applyBtn = target.closest<HTMLElement>('.pmd-picker-card-apply');
    if (applyBtn) {
      const index = parseInt(applyBtn.dataset.index || '0', 10);
      if (!isNaN(index) && currentState) {
        currentState.selectedIndex = index;
        selectCurrent();
      }
      return;
    }

    // Click on the overlay background (outside the dialog) closes the picker.
    if (target === overlay) {
      closePicker();
    }
  });

  // Capture-phase keydown so the picker handles keys even when the editor
  // (CodeMirror) is focused underneath.
  document.addEventListener('keydown', handlePickerKeydown, true);
}

export function isPickerOpen(): boolean {
  return currentState !== null && document.getElementById('theme-picker-overlay') !== null;
}

export function closeThemePicker(): void {
  if (currentState) {
    closePicker();
  }
}
