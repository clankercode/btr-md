export type Mode = 'source' | 'split' | 'preview';

const MODE_CYCLE: Mode[] = ['source', 'split', 'preview'];

export function createHotkeyHandler(
  getCurrentMode: () => Mode,
  setMode: (mode: Mode) => void,
  showOverlay: () => void
): () => void {
  return () => {
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '\\') {
        e.preventDefault();
        const current = getCurrentMode();
        const idx = MODE_CYCLE.indexOf(current);
        const next = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
        setMode(next);
        document.body.dispatchEvent(new CustomEvent('mode-change', { detail: { mode: next } }));
      }

      if (e.ctrlKey && e.key === '/') {
        e.preventDefault();
        showOverlay();
      }
    });
  };
}

export function createOverlay(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'pmd-dialog-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'pmd-hotkey-title');
  overlay.style.display = 'none';

  const content = document.createElement('div');
  content.className = 'pmd-dialog';
  content.style.maxWidth = '420px';

  content.innerHTML = `
    <div class="pmd-dialog-header">
      <div>
        <h2 class="pmd-dialog-title" id="pmd-hotkey-title">Keyboard Shortcuts</h2>
      </div>
      <button type="button" class="pmd-btn pmd-btn-ghost pmd-btn-icon" aria-label="Close">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
    <div class="pmd-dialog-content">
      <table class="pmd-hotkey-table">
        <tbody>
          <tr>
            <td><span class="pmd-kbd">Ctrl</span> <span class="pmd-kbd">\\</span></td>
            <td>Cycle mode (Source → Split → Preview)</td>
          </tr>
          <tr>
            <td><span class="pmd-kbd">Ctrl</span> <span class="pmd-kbd">/</span></td>
            <td>Show this overlay</td>
          </tr>
          <tr>
            <td><span class="pmd-kbd">Esc</span></td>
            <td>Close overlay</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  overlay.appendChild(content);

  const closeBtn = content.querySelector('.pmd-btn-icon') as HTMLButtonElement;
  const closeDialog = () => {
    overlay.style.display = 'none';
  };

  closeBtn.addEventListener('click', closeDialog);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeDialog();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.style.display !== 'none') {
      closeDialog();
    }
  });

  return overlay;
}
