import { call } from './backend/invoke.js';
import type { AssetGrant, TrustRootDecision } from './document_contracts.js';

export function grantRecommendedRoot(input: {
  docId: number;
  version: number;
  canonicalRoot: string;
}): Promise<AssetGrant> {
  return call('grant_recommended_root', {
    docId: input.docId,
    version: input.version,
    canonicalRoot: input.canonicalRoot,
  });
}

export function rememberDeclinedRoot(canonicalRoot: string): Promise<void> {
  return call('remember_declined_root', { canonicalRoot });
}

export function forgetTrustRoot(canonicalRoot: string): Promise<void> {
  return call('forget_trust_root', { canonicalRoot });
}

export function listTrustRoots(): Promise<TrustRootDecision[]> {
  return call('list_trust_roots');
}
