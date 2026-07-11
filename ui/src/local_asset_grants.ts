import { call } from './backend/invoke.js';
import type { AssetGrant } from './document_contracts.js';

export function listAssetGrants(docId: number): Promise<AssetGrant[]> {
  return call('list_asset_grants', { docId });
}

export function grantAssetFolderForBlockedImage(input: {
  docId: number;
  version: number;
  placeholderId: string;
}): Promise<AssetGrant | null> {
  return call('grant_asset_folder', {
    docId: input.docId,
    version: input.version,
    placeholderId: input.placeholderId,
  });
}

export function revokeAssetGrantForDocument(input: {
  docId: number;
  grantId: number;
}): Promise<void> {
  return call('revoke_asset_grant', {
    docId: input.docId,
    grantId: input.grantId,
  });
}

/** What `import_image_asset` returns when bytes were written. */
export interface ImportedImage {
  /** Document-relative path to embed (e.g. `images/Notes/x.png`). */
  relative_path: string;
  /** Absolute canonical path on disk. */
  absolute_path: string;
}

/**
 * Copy pasted/dropped image bytes into `images/<doc-stem>/` beside the saved
 * document and extend its asset grant. Returns `null` when the per-document
 * image folder does not yet exist and `confirmNewFolder` was false — the caller
 * should then confirm the first write and retry with `confirmNewFolder: true`.
 */
export function importImageAsset(input: {
  docId: number;
  fileName: string;
  bytes: number[] | Uint8Array;
  confirmNewFolder: boolean;
}): Promise<ImportedImage | null> {
  return call('import_image_asset', {
    docId: input.docId,
    fileName: input.fileName,
    bytes: Array.from(input.bytes),
    confirmNewFolder: input.confirmNewFolder,
  });
}

/** Convert untrusted clipboard HTML to Markdown (sanitized backend-side). */
export function pasteHtmlAsMarkdown(html: string): Promise<string> {
  return call('paste_html_as_markdown', { html });
}
