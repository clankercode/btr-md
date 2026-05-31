// Drag-to-open visual overlay.
//
// Owns a single fixed, full-window overlay element that appears while a drag is
// in progress over the window, indicating whether the payload looks like
// markdown (valid -> "Drop to open") or not (reject -> "Not a markdown file").
//
// The actual open logic lives in main.ts and is injected via callbacks, so this
// module has no import cycle with main.ts.

export type DragValidity = 'valid' | 'reject';

// MIME types we treat as markdown-ish during dragover. File names are NOT
// available during dragover (only on drop), so detection is by `kind`/`type`.
const MARKDOWN_MIME = new Set(['text/markdown', 'text/x-markdown', 'text/plain']);

// Image detection kept self-contained here (drag-overlay is unit-tested in
// isolation, so it must not import sibling source modules). The richer embed
// helpers live in `image_embed.ts` and are used by the wiring in main.ts.
const IMAGE_FILE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);

function isImageMime(type: string | null | undefined): boolean {
  if (!type) return false;
  const lower = type.toLowerCase();
  return lower.startsWith('image/') && lower !== 'image/svg+xml';
}

function isImageFileName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot >= 0 && IMAGE_FILE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/**
 * Compute drag validity from a DataTransfer's items during `dragover`.
 *
 * Rule (per spec "Detection caveat"):
 *  - VALID when at least one item is `kind === 'file'` and its `type` is empty
 *    or matches a markdown-ish MIME.
 *  - REJECT only when file items are present and ALL of them have a
 *    non-markdown MIME (e.g. image/*, application/pdf).
 *  - When undeterminable (no file items) -> VALID; the drop handler does the
 *    real extension gate.
 *
 * Any exception defaults to VALID.
 */
export function computeValidity(
  items: DataTransferItemList | null | undefined
): DragValidity {
  try {
    if (!items) return 'valid';
    let sawFile = false;
    let sawMarkdown = false;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it || it.kind !== 'file') continue;
      sawFile = true;
      const type = (it.type || '').toLowerCase();
      // Markdown-ish or an image we can embed → a valid drop target.
      if (type === '' || MARKDOWN_MIME.has(type) || isImageMime(type)) {
        sawMarkdown = true;
      }
    }
    if (!sawFile) return 'valid'; // undeterminable -> let drop decide
    return sawMarkdown ? 'valid' : 'reject';
  } catch {
    return 'valid';
  }
}

/**
 * Drag-counter to avoid `dragleave` flicker as the pointer crosses child
 * elements. Incremented on `dragenter`, decremented on `dragleave`; the drag is
 * `active` while the count is > 0.
 */
export class DragCounter {
  private count = 0;

  get active(): boolean {
    return this.count > 0;
  }

  enter(): void {
    this.count += 1;
  }

  leave(): void {
    this.count = Math.max(0, this.count - 1);
  }

  reset(): void {
    this.count = 0;
  }
}

export interface DragOverlayCallbacks {
  // Open files identified by absolute path. The first opens focused, the rest
  // in the background.
  onOpenFiles: (paths: string[]) => void;
  // Open a webview-provided blob (no `.path`): register it as an in-memory doc.
  onOpenBlob: (name: string, contents: string) => Promise<void> | void;
  // Embed a dropped image file into the active (saved) document. The handler
  // reads the bytes, copies them beside the document and inserts a relative
  // Markdown image. Distinct from opening a .md file.
  onEmbedImage?: (file: File) => Promise<void> | void;
  // Surface an error to the user (status/toast).
  showError: (message: string) => void;
}

const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd'];

function isMarkdownFileName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return MARKDOWN_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase());
}

let overlayEl: HTMLElement | null = null;

function ensureOverlay(): HTMLElement {
  if (overlayEl) return overlayEl;
  const el = document.createElement('div');
  el.className = 'pmd-drag-overlay';
  el.setAttribute('aria-hidden', 'true');
  const zone = document.createElement('div');
  zone.className = 'pmd-drag-zone';
  const label = document.createElement('div');
  label.className = 'pmd-drag-label';
  zone.appendChild(label);
  el.appendChild(zone);
  document.body.appendChild(el);
  overlayEl = el;
  return el;
}

function showOverlay(validity: DragValidity): void {
  const el = ensureOverlay();
  const label = el.querySelector('.pmd-drag-label') as HTMLElement | null;
  if (validity === 'reject') {
    el.classList.add('pmd-drag-overlay--reject');
    if (label) label.textContent = 'Not a markdown file';
  } else {
    el.classList.remove('pmd-drag-overlay--reject');
    if (label) label.textContent = 'Drop to open';
  }
  el.classList.add('pmd-drag-overlay--visible');
}

function hideOverlay(): void {
  if (!overlayEl) return;
  overlayEl.classList.remove('pmd-drag-overlay--visible');
  overlayEl.classList.remove('pmd-drag-overlay--reject');
}

/**
 * Install the drag-to-open overlay and its drag state machine on `document`.
 * Open logic is provided via `cbs` so this module never imports main.ts.
 */
export function installDragOverlay(cbs: DragOverlayCallbacks): void {
  const counter = new DragCounter();

  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    counter.enter();
    showOverlay(computeValidity(e.dataTransfer?.items));
  });

  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const validity = computeValidity(e.dataTransfer?.items);
    if (validity === 'reject' && e.dataTransfer) {
      e.dataTransfer.dropEffect = 'none';
    }
    // Keep the overlay in sync even if no dragenter fired first.
    if (counter.active) showOverlay(validity);
  });

  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    counter.leave();
    if (!counter.active) hideOverlay();
  });

  document.addEventListener('dragend', () => {
    counter.reset();
    hideOverlay();
  });

  document.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    counter.reset();
    hideOverlay();
    void handleDrop(e, cbs);
  });
}

async function handleDrop(e: DragEvent, cbs: DragOverlayCallbacks): Promise<void> {
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;

  const pathsToOpen: string[] = [];
  const blobs: File[] = [];
  const imagesToEmbed: File[] = [];
  let sawUnsupported = false;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (isImageMime(file.type) || isImageFileName(file.name)) {
      imagesToEmbed.push(file);
      continue;
    }
    if (!isMarkdownFileName(file.name)) {
      sawUnsupported = true;
      continue;
    }
    const path = (file as unknown as { path?: string }).path;
    if (path) pathsToOpen.push(path);
    else blobs.push(file);
  }

  if (pathsToOpen.length > 0) {
    cbs.onOpenFiles(pathsToOpen);
  }

  for (const file of blobs) {
    try {
      const contents = await file.text();
      await cbs.onOpenBlob(file.name, contents);
    } catch (err) {
      cbs.showError(`Open failed: ${String(err)}`);
    }
  }

  for (const file of imagesToEmbed) {
    if (!cbs.onEmbedImage) {
      cbs.showError('Image embedding is unavailable');
      continue;
    }
    try {
      await cbs.onEmbedImage(file);
    } catch (err) {
      cbs.showError(`Embed failed: ${String(err)}`);
    }
  }

  if (
    sawUnsupported &&
    pathsToOpen.length === 0 &&
    blobs.length === 0 &&
    imagesToEmbed.length === 0
  ) {
    cbs.showError('Not a markdown or image file');
  }
}
