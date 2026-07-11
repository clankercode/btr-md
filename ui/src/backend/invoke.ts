// The single Tauri `invoke` seam. Every backend command flows through `call()`,
// typed against `CommandMap`, so command names, argument shapes and result
// shapes are checked at compile time. This is the ONLY module in `ui/src` that
// imports the raw `invoke` from `@tauri-apps/api/core`.

import { invoke, type InvokeArgs } from '@tauri-apps/api/core';
import type { CommandMap } from './commands.js';

/**
 * Invoke a backend command with a compile-time-checked payload and result.
 * Commands whose args are typed `void` may be called without a second argument.
 */
export function call<K extends keyof CommandMap>(
  cmd: K,
  args: CommandMap[K]['args'],
): Promise<CommandMap[K]['result']> {
  return invoke(cmd as string, args as unknown as InvokeArgs | undefined) as Promise<
    CommandMap[K]['result']
  >;
}
