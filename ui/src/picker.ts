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
}

let currentState: PickerState | null = null;

function renderCard(theme: ThemeInfo, index: number, isSelected: boolean): HTMLElement {
  const card = document.createElement('div');
  card.className = 'pmd-picker-card';
  card.dataset.slug = theme.slug;
  card.dataset.index = String(index);
  card.dataset.mode = theme.mode;
  card.setAttribute('role', 'option');
  card.tabIndex = 0;
  card.ariaSelected = String(isSelected);
  if (isSelected) {
    card.dataset.selected = 'true';
  }

  const bg = theme.preview_bg || (theme.mode === 'dark' ? '#1f2328' : '#ffffff');
  const bgElevated = theme.preview_bg_elevated || bg;
  const fg = theme.preview_fg || (theme.mode === 'dark' ? '#e6edf3' : '#1f2328');
  const accent = theme.preview_accent || (theme.mode === 'dark' ? '#7aa2f7' : '#0969da');

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
  card.appendChild(preview);

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

  const actions = document.createElement('div');
  actions.className = 'pmd-picker-actions';
  const lightBtn = document.createElement('button');
  lightBtn.className = 'pmd-picker-action pmd-picker-action--light';
  lightBtn.dataset.slug = theme.slug;
  lightBtn.dataset.mode = 'light';
  lightBtn.title = 'Use as light theme (auto-switch)';
  lightBtn.textContent = 'As light';
  const darkBtn = document.createElement('button');
  darkBtn.className = 'pmd-picker-action pmd-picker-action--dark';
  darkBtn.dataset.slug = theme.slug;
  darkBtn.dataset.mode = 'dark';
  darkBtn.title = 'Use as dark theme (auto-switch)';
  darkBtn.textContent = 'As dark';
  actions.appendChild(lightBtn);
  actions.appendChild(darkBtn);
  info.appendChild(actions);

  card.appendChild(info);
  return card;
}

function renderPicker(state: PickerState): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'pmd-picker-overlay';
  overlay.id = 'theme-picker-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'pmd-picker-dialog';
  dialog.role = 'dialog';
  dialog.ariaLabel = 'Theme picker';

  const header = document.createElement('div');
  header.className = 'pmd-picker-header';

  const title = document.createElement('h2');
  title.className = 'pmd-picker-title';
  title.textContent = 'Choose Theme';
  header.appendChild(title);

  const searchWrapper = document.createElement('div');
  searchWrapper.className = 'pmd-picker-search-wrapper';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'pmd-picker-search';
  searchInput.placeholder = 'Filter themes... (press / to focus)';
  searchInput.ariaLabel = 'Filter themes';
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
  grid.setAttribute('role', 'listbox');
  grid.id = 'theme-grid';

  state.filteredThemes.forEach((theme, index) => {
    grid.appendChild(renderCard(theme, index, index === state.selectedIndex));
  });

  dialog.appendChild(grid);
  overlay.appendChild(dialog);
  return overlay;
}

function updateGrid(state: PickerState): void {
  const grid = document.getElementById('theme-grid');
  if (!grid) return;
  grid.innerHTML = '';
  state.filteredThemes.forEach((theme, index) => {
    grid.appendChild(renderCard(theme, index, index === state.selectedIndex));
  });
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
  const newIndex = currentState.selectedIndex + delta;
  currentState.selectedIndex = Math.max(0, Math.min(newIndex, currentState.filteredThemes.length - 1));
  updateGrid(currentState);
  scrollSelectedIntoView();
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
    currentState.onSelect(theme.slug);
    closePicker();
  }
}

function closePicker(): void {
  const overlay = document.getElementById('theme-picker-overlay');
  if (overlay) {
    overlay.remove();
  }
  document.removeEventListener('keydown', handlePickerKeydown);
  currentState = null;
}

function handlePickerKeydown(e: KeyboardEvent): void {
  if (!currentState) return;

  if (e.key === '/') {
    e.preventDefault();
    const searchInput = document.getElementById('theme-filter-input') as HTMLInputElement;
    searchInput?.focus();
    searchInput?.select();
    return;
  }

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      moveSelection(1);
      break;
    case 'ArrowUp':
      e.preventDefault();
      moveSelection(-1);
      break;
    case 'ArrowRight':
      e.preventDefault();
      moveSelection(3);
      break;
    case 'ArrowLeft':
      e.preventDefault();
      moveSelection(-3);
      break;
    case 'Enter':
      e.preventDefault();
      selectCurrent();
      break;
    case 'Escape':
      e.preventDefault();
      closePicker();
      break;
  }
}

export function openThemePicker(themes: ThemeInfo[], onSelect: (slug: string, mode?: 'light' | 'dark') => void): void {
  if (currentState) {
    closePicker();
  }

  const filteredThemes = filterThemes(themes, '');

  currentState = {
    themes,
    filteredThemes,
    selectedIndex: 0,
    filter: '',
    onSelect,
    onClose: closePicker,
  };

  const overlay = renderPicker(currentState);
  document.body.appendChild(overlay);

  const searchInput = document.getElementById('theme-filter-input') as HTMLInputElement;
  searchInput?.focus();

  searchInput?.addEventListener('input', () => {
    if (!currentState) return;
    currentState.filter = searchInput.value;
    currentState.filteredThemes = filterThemes(currentState.themes, currentState.filter);
    currentState.selectedIndex = 0;
    updateGrid(currentState);
  });

  overlay.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;

    if (target.classList.contains('pmd-picker-action--light') ||
        target.classList.contains('pmd-picker-action--dark')) {
      e.stopPropagation();
      const slug = target.dataset.slug;
      const mode = target.dataset.mode as 'light' | 'dark' | undefined;
      if (slug) {
        onSelect(slug, mode);
        closePicker();
      }
      return;
    }

    const card = target.closest('.pmd-picker-card');
    if (card) {
      const index = parseInt(card.getAttribute('data-index') || '0', 10);
      if (!isNaN(index) && currentState) {
        currentState.selectedIndex = index;
        updateGrid(currentState);
        selectCurrent();
      }
      return;
    }

    if (target.classList.contains('pmd-picker-overlay')) {
      closePicker();
    }
  });

  document.addEventListener('keydown', handlePickerKeydown);
}

export function isPickerOpen(): boolean {
  return currentState !== null && document.getElementById('theme-picker-overlay') !== null;
}

export function closeThemePicker(): void {
  if (currentState) {
    closePicker();
  }
}
