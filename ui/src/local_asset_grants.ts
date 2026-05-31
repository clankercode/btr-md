import { invoke } from '@tauri-apps/api/core';
import type { AssetGrant } from './document_contracts.js';

export function listAssetGrants(docId: number): Promise<AssetGrant[]> {
  return invoke<AssetGrant[]>('list_asset_grants', { docId });
}

export function grantAssetFolderForBlockedImage(input: {
  docId: number;
  version: number;
  placeholderId: string;
}): Promise<AssetGrant | null> {
  return invoke<AssetGrant | null>('grant_asset_folder', {
    docId: input.docId,
    version: input.version,
    placeholderId: input.placeholderId,
  });
}

export function revokeAssetGrantForDocument(input: {
  docId: number;
  grantId: number;
}): Promise<void> {
  return invoke('revoke_asset_grant', {
    docId: input.docId,
    grantId: input.grantId,
  });
}
