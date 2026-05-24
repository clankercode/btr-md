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
  overlay.className = 'pmd-hotkey-overlay';
  overlay.innerHTML = `
    <div class="pmd-hotkey-content">
      <h2>Keyboard Shortcuts</h2>
      <table>
        <tr><td><kbd>Ctrl</kbd> + <kbd>\\</kbd></td><td>Cycle mode (Source → Split → Preview)</td></tr>
        <tr><td><kbd>Ctrl</kbd> + <kbd>/</kbd></td><td>Show this overlay</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>Close overlay</td></tr>
      </table>
      <button class="pmd-overlay-close">Close</button>
    </div>
  `;

  const closeBtn = overlay.querySelector('.pmd-overlay-close') as HTMLButtonElement;
  closeBtn.addEventListener('click', () => {
    overlay.hidden = true;
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.hidden = true;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) {
      overlay.hidden = true;
    }
  });

  return overlay;
}
