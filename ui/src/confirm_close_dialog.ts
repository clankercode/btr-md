export type ConfirmCloseChoice = 'save' | 'discard' | 'cancel';

export interface ConfirmCloseDialogOptions {
  title: string;
  /** The number of modified documents being closed together. */
  count: number;
}

/**
 * Show a modal confirmation for closing one or more modified documents.
 * Resolves with the user's choice: save, discard, or cancel the close.
 */
export function showConfirmCloseDialog(
  options: ConfirmCloseDialogOptions,
): Promise<ConfirmCloseChoice> {
  const { title, count } = options;
  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement;

    const overlay = document.createElement('div');
    overlay.className = 'pmd-dialog-overlay';
    overlay.dataset.testid = 'confirm-close-dialog';

    const dialog = document.createElement('div');
    dialog.className = 'pmd-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Save changes?');

    const header = document.createElement('div');
    header.className = 'pmd-dialog-header';
    const heading = document.createElement('h2');
    heading.className = 'pmd-dialog-title';
    heading.textContent = count > 1 ? `Save changes to ${count} documents?` : 'Save changes?';
    header.appendChild(heading);
    dialog.appendChild(header);

    const content = document.createElement('div');
    content.className = 'pmd-dialog-content';
    const body = document.createElement('p');
    body.id = 'confirm-close-description';
    body.textContent =
      count > 1
        ? `There are unsaved changes in ${count} documents. Do you want to save them before closing?`
        : `There are unsaved changes in “${title}”. Do you want to save them before closing?`;
    content.appendChild(body);
    dialog.appendChild(content);
    dialog.setAttribute('aria-describedby', body.id);

    const footer = document.createElement('div');
    footer.className = 'pmd-dialog-footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'pmd-btn pmd-btn-ghost';
    cancelBtn.dataset.action = 'cancel';
    cancelBtn.textContent = 'Cancel';

    const discardBtn = document.createElement('button');
    discardBtn.type = 'button';
    discardBtn.className = 'pmd-btn pmd-btn-ghost';
    discardBtn.dataset.action = 'discard';
    discardBtn.textContent = count > 1 ? "Don't Save All" : "Don't Save";

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'pmd-btn pmd-btn-primary';
    saveBtn.dataset.action = 'save';
    saveBtn.textContent = count > 1 ? 'Save All' : 'Save';

    // Default focus on Cancel to prevent accidental destructive actions.
    footer.appendChild(cancelBtn);
    footer.appendChild(discardBtn);
    footer.appendChild(saveBtn);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const focusableSelector =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

    function trapFocus(e: KeyboardEvent): void {
      if (e.key !== 'Tab') return;
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    const cleanup = (choice: ConfirmCloseChoice): void => {
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('keydown', trapFocus);
      overlay.remove();
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
      resolve(choice);
    };

    cancelBtn.addEventListener('click', () => cleanup('cancel'));
    discardBtn.addEventListener('click', () => cleanup('discard'));
    saveBtn.addEventListener('click', () => cleanup('save'));

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup('cancel');
    });

    const keydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup('cancel');
      }
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('keydown', trapFocus);

    requestAnimationFrame(() => cancelBtn.focus());
  });
}
