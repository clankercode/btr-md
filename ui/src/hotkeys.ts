import type { ActionSpec } from './actions.ts';

export function shortcutSummary(actions: ActionSpec[]): Array<{ label: string; shortcuts: string[] }> {
  return actions
    .filter((action) => action.defaultShortcuts.length > 0)
    .map((action) => ({ label: action.label, shortcuts: [...action.defaultShortcuts] }));
}
