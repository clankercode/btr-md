// Pure helpers for the image paste / drag-and-drop embed workflow (Slice C #5).
//
// Kept free of DOM / Tauri imports so the filename-synthesis, embed-vs-open
// decision and Markdown-building logic are unit-testable. The wiring in
// main.ts / drag_overlay.ts calls these, reads the dropped/pasted bytes, and
// invokes the `import_image_asset` backend command.

// Image MIME types we accept for embedding. Matches the backend's extension
// mapping; anything outside this set is treated as non-image.
const IMAGE_MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
};

const IMAGE_FILE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
]);

/** True if `type` (a DataTransfer/File MIME) names an image we can embed. */
export function isImageMime(type: string | null | undefined): boolean {
  if (!type) return false;
  const lower = type.toLowerCase();
  if (lower === 'image/svg+xml') return false;
  return lower.startsWith('image/');
}

/** True if `name` has an image file extension. */
export function isImageFileName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return IMAGE_FILE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/**
 * Decide what a dropped/pasted file should do:
 *  - `'embed'` for an image (by MIME or extension),
 *  - `'open'` for an openable document (markdown or HTML),
 *  - `'ignore'` for anything else.
 * Document detection mirrors `drag_overlay.ts` (extension-based on drop).
 */
export function classifyDroppedFile(
  name: string,
  type: string | null | undefined
): 'embed' | 'open' | 'ignore' {
  if (isImageMime(type) || isImageFileName(name)) return 'embed';
  const dot = name.lastIndexOf('.');
  if (dot >= 0) {
    const ext = name.slice(dot + 1).toLowerCase();
    if (['md', 'markdown', 'mdown', 'mkd', 'html', 'htm'].includes(ext)) return 'open';
  }
  return 'ignore';
}

/**
 * Synthesize a file name for a pasted clipboard image from its MIME type.
 * `index` disambiguates multiple pastes in a session (`pasted-1.png`, …);
 * the backend still collision-suffixes on disk, so this only needs to be a
 * reasonable default. Unknown image MIME falls back to `.png`.
 */
export function clipboardImageName(mime: string, index: number): string {
  const ext = IMAGE_MIME_EXT[mime.trim().toLowerCase()] ?? 'png';
  return `pasted-${index}.${ext}`;
}

/**
 * Build the relative Markdown image to insert at the cursor. `relativePath` is
 * the document-relative path the backend returned (e.g. `images/Notes/x.png`).
 * `alt` defaults to empty per the spec (`![](…)`).
 */
export function buildImageMarkdown(relativePath: string, alt = ''): string {
  return `![${alt}](${relativePath})`;
}
