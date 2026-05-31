import { invoke } from '@tauri-apps/api/core';
import type { AssetGrant, TrustRootDecision } from './document_contracts.js';

export function grantRecommendedRoot(input: {
  docId: number;
  version: number;
  canonicalRoot: string;
}): Promise<AssetGrant> {
  return invoke<AssetGrant>('grant_recommended_root', {
    docId: input.docId,
    version: input.version,
    canonicalRoot: input.canonicalRoot,
  });
}

export function rememberDeclinedRoot(canonicalRoot: string): Promise<void> {
  return invoke('remember_declined_root', { canonicalRoot });
}

export function forgetTrustRoot(canonicalRoot: string): Promise<void> {
  return invoke('forget_trust_root', { canonicalRoot });
}

export function listTrustRoots(): Promise<TrustRootDecision[]> {
  return invoke<TrustRootDecision[]>('list_trust_roots');
}
