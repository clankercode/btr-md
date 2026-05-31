// Tiny trailing-edge debounce. Shared by editor change handlers (doc_edited,
// status-bar counts) so we don't fire a backend round-trip on every keystroke.
//
// The returned function carries a `.cancel()` to drop a pending invocation
// (e.g. when a tab is closed or the editor is torn down) and a `.flush()` that
// runs the pending call immediately and returns its result (e.g. to force a
// final session save before the window closes).

export interface Debounced<A extends unknown[], R = void> {
  (...args: A): void;
  cancel(): void;
  /** Run the pending call now (if any) and return its result. No-op (returns
   *  undefined) when nothing is pending. */
  flush(): R | undefined;
}

export function debounce<A extends unknown[], R = void>(
  fn: (...args: A) => R,
  delayMs: number,
): Debounced<A, R> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: A | null = null;
  const debounced = (...args: A): void => {
    if (timer !== null) clearTimeout(timer);
    pendingArgs = args;
    timer = setTimeout(() => {
      timer = null;
      const a = pendingArgs!;
      pendingArgs = null;
      fn(...a);
    }, delayMs);
  };
  debounced.cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pendingArgs = null;
  };
  debounced.flush = (): R | undefined => {
    if (timer === null) return undefined;
    clearTimeout(timer);
    timer = null;
    const a = pendingArgs!;
    pendingArgs = null;
    return fn(...a);
  };
  return debounced;
}
