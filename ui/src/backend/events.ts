// Bounded backend event surface — the `listen()` half of the UI↔backend seam.
//
// Symmetric to `commands.ts`/`invoke.ts`: `EventMap` is the single source of
// truth for every backend-emitted event the UI subscribes to, and `subscribe()`
// is the only place that imports raw Tauri `listen`. Handlers receive the typed
// payload (not the Tauri `Event` envelope).
//
// `EventMap` itself lives in `event_map.ts` (no Tauri imports) so the e2e mock
// can share the contract without declaration-merge conflicts.

import {
  listen as tauriListen,
  type Event,
  type UnlistenFn,
} from '@tauri-apps/api/event';
import type { EventMap } from './event_map.js';

export type { EventMap } from './event_map.js';

export type BackendUnlisten = UnlistenFn;

/** Minimal listen shape so unit tests can inject a fake without Tauri. */
export type ListenImpl = <T>(
  event: string,
  handler: (event: Event<T>) => void,
) => Promise<UnlistenFn>;

/**
 * Build a typed `subscribe` bound to a listen implementation.
 * Production uses the default export `subscribe`; tests inject a fake.
 */
export function createSubscribe(listenFn: ListenImpl) {
  return function subscribe<K extends keyof EventMap>(
    event: K,
    handler: (payload: EventMap[K]) => void,
  ): Promise<BackendUnlisten> {
    return listenFn<EventMap[K]>(event, (e) => {
      handler(e.payload);
    });
  };
}

/** Subscribe to a backend event. Sole production importer of raw Tauri `listen`. */
export const subscribe = createSubscribe(
  tauriListen as ListenImpl,
);
