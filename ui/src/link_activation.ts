export type ActivationKind = 'primary' | 'keyboard' | 'auxiliary' | 'context_menu' | 'drag';

export interface CurrentPreviewDoc {
  doc_id: number;
  version: number;
}

export interface LinkActivationResponse {
  kind: 'scroll_to_block' | 'open_document' | 'open_default_app' | 'external_confirmation' | 'denied';
  block_id?: string | null;
  opened_document?: OpenedDocumentFromLink | null;
  normalized_url?: string | null;
  scheme?: string | null;
  host?: string | null;
  label_text?: string | null;
  action_token?: string | null;
  message?: string | null;
}

export interface OpenedDocumentFromLink {
  doc_id: number;
  path: string;
  contents: string;
  state: unknown;
  trust_context?: unknown;
}

export interface ExternalConfirmationDialog {
  show(response: LinkActivationResponse, onConfirm: () => Promise<void>): void;
}

export interface PreviewLinkActivationOptions {
  currentDoc: () => CurrentPreviewDoc | null;
  invoke: (command: string, payload: unknown) => Promise<unknown>;
  handleResponse?: (response: LinkActivationResponse, doc: CurrentPreviewDoc) => Promise<void> | void;
}

declare global {
  interface Window {
    __pmdE2e?: unknown;
  }
}

const NAVIGATION_ATTRS = ['href', 'target', 'download', 'ping'];

export function attachPreviewLinkActivation(
  root: HTMLElement,
  options: PreviewLinkActivationOptions
): () => void {
  const activate = async (event: Event, activationKind: ActivationKind) => {
    const link = previewLinkFromEvent(event);
    if (!link) return;
    event.preventDefault();
    if ('stopPropagation' in event) event.stopPropagation();
    stripNavigationAttrs(link);
    const doc = options.currentDoc();
    if (!doc) return;
    const linkId = link.getAttribute('data-pmd-link-id');
    if (!linkId) return;
    emitE2e('pmd-link-activation', { activationKind });
    const response = (await options.invoke('prepare_link_activation', {
      docId: doc.doc_id,
      version: doc.version,
      linkId,
      activationKind,
    })) as LinkActivationResponse;
    await options.handleResponse?.(response, doc);
  };

  const click = (event: Event) => void activate(event, 'primary');
  const keydown = (event: Event) => {
    const key = (event as KeyboardEvent).key;
    if (key === 'Enter' || key === ' ') void activate(event, 'keyboard');
  };
  const auxclick = (event: Event) => void activate(event, 'auxiliary');
  const contextmenu = (event: Event) => void activate(event, 'context_menu');
  const dragstart = (event: Event) => void activate(event, 'drag');

  root.addEventListener('click', click);
  root.addEventListener('keydown', keydown);
  root.addEventListener('auxclick', auxclick);
  root.addEventListener('contextmenu', contextmenu);
  root.addEventListener('dragstart', dragstart);

  return () => {
    root.removeEventListener('click', click);
    root.removeEventListener('keydown', keydown);
    root.removeEventListener('auxclick', auxclick);
    root.removeEventListener('contextmenu', contextmenu);
    root.removeEventListener('dragstart', dragstart);
  };
}

export async function handleLinkActivationResponse(options: {
  response: LinkActivationResponse;
  docId: number;
  version: number;
  invoke: (command: string, payload: unknown) => Promise<unknown>;
  scrollToBlock: (blockId: string) => void;
  openDocument: (document: OpenedDocumentFromLink) => void | Promise<void>;
  showMessage: (message: string) => void;
  externalConfirmation: ExternalConfirmationDialog;
}): Promise<void> {
  const { response } = options;
  if (response.kind === 'scroll_to_block' && response.block_id) {
    options.scrollToBlock(response.block_id);
    return;
  }
  if (response.kind === 'open_document' && response.opened_document) {
    await options.openDocument(response.opened_document);
    return;
  }
  if (response.kind === 'open_default_app') {
    options.showMessage(response.message ?? 'Opened local file in the default application.');
    return;
  }
  if (response.kind === 'denied') {
    options.showMessage(response.message ?? 'Preview link blocked.');
    return;
  }
  if (response.kind === 'external_confirmation' && response.action_token) {
    options.externalConfirmation.show(response, async () => {
      await options.invoke('confirm_external_open', {
        docId: options.docId,
        version: options.version,
        actionToken: response.action_token,
      });
      emitE2e('pmd-external-open', {
        url: response.normalized_url
          ?? response.host
          ?? response.scheme
          ?? 'external',
      });
    });
  }
}

export function createExternalConfirmationDialog(): ExternalConfirmationDialog {
  return {
    show(response, onConfirm) {
      const dialog = document.createElement('div');
      dialog.className = 'pmd-modal-backdrop';
      dialog.dataset.testid = 'confirm-external-open';
      dialog.innerHTML = `
        <div class="pmd-modal" role="dialog" aria-modal="true" aria-label="Open external link">
          <p></p>
          <div class="pmd-modal-actions">
            <button type="button" data-action="cancel">Cancel</button>
            <button type="button" data-action="confirm">Open</button>
          </div>
        </div>
      `;
      const message = dialog.querySelector('p');
      if (message) {
        const destination = response.normalized_url ?? response.host ?? response.scheme ?? 'external link';
        const label = response.label_text ? ` from "${response.label_text}"` : '';
        const scheme = response.scheme ? ` (${response.scheme})` : '';
        message.textContent = `Open ${destination}${scheme}${label} outside the app?`;
      }
      const close = () => dialog.remove();
      dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', close);
      dialog.querySelector('[data-action="confirm"]')?.addEventListener('click', () => {
        onConfirm()
          .catch(() => {})
          .finally(close);
      });
      document.body.appendChild(dialog);
    },
  };
}

function previewLinkFromEvent(event: Event): HTMLElement | null {
  const target = event.target;
  if (!target || typeof (target as Element).closest !== 'function') return null;
  const link = (target as Element).closest('[data-pmd-link-id]');
  if (!link || typeof (link as HTMLElement).getAttribute !== 'function') return null;
  return link as HTMLElement;
}

function stripNavigationAttrs(link: HTMLElement): void {
  for (const attr of NAVIGATION_ATTRS) link.removeAttribute(attr);
}

function emitE2e(name: string, detail: unknown): void {
  if (typeof window !== 'undefined' && window.__pmdE2e) {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  }
}
