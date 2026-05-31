// Return `root` (if it matches `sel`) plus all descendants matching `sel`.
export function selfAndDescendants<E extends Element>(root: Element, sel: string): E[] {
  const out: E[] = [];
  if (root.matches(sel)) out.push(root as E);
  root.querySelectorAll<E>(sel).forEach((el) => out.push(el));
  return out;
}
