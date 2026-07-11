// Links domain client — the two backend-mediated link commands. Typed wrappers
// over `call()`, plus an adapter matching link_activation.ts's injected
// `invoke(command, payload)` dependency (that module keeps its generic,
// unit-tested DI shape; main.ts injects this adapter instead of raw invoke).

import { call } from './invoke.js';
import type { ActivationKind, LinkActivationResponse } from '../link_activation.js';

export function prepareLinkActivation(args: {
  docId: number;
  version: number;
  linkId: string;
  activationKind: ActivationKind;
}): Promise<LinkActivationResponse> {
  return call('prepare_link_activation', args);
}

export function confirmExternalOpen(args: {
  docId: number;
  version: number;
  actionToken: string;
}): Promise<void> {
  return call('confirm_external_open', args);
}

/**
 * Adapter matching `PreviewLinkActivationOptions.invoke` / the `invoke` field of
 * `handleLinkActivationResponse`: routes the two link commands through the typed
 * seam so main.ts no longer passes the raw `invoke`.
 */
export function linkActivationInvoke(
  command: string,
  payload: unknown,
): Promise<unknown> {
  if (command === 'prepare_link_activation') {
    return prepareLinkActivation(payload as Parameters<typeof prepareLinkActivation>[0]);
  }
  if (command === 'confirm_external_open') {
    return confirmExternalOpen(payload as Parameters<typeof confirmExternalOpen>[0]);
  }
  return Promise.reject(new Error(`links: unexpected command "${command}"`));
}
