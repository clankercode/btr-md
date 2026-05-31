export interface BlockRef {
  key: string;
  base_line: number;
}

// Reconcile #pmd-content's direct children (keyed by data-pmd-block) against a
// freshly-parsed detached fragment. Returns the list of nodes that were newly
// inserted or replaced (for scoped post-processing). Unchanged-key nodes are
// kept in place (preserving rendered mermaid/katex); if their base_line shifted,
// their descendants' data-src-* are patched in place.
export function reconcileBlocks(
  live: HTMLElement,
  fragment: HTMLElement,
  blocks: BlockRef[],
): HTMLElement[] {
  const liveByKey = new Map<string, HTMLElement>();
  for (const child of Array.from(live.children)) {
    const k = (child as HTMLElement).dataset.pmdBlock;
    if (k) liveByKey.set(k, child as HTMLElement);
  }

  const fragChildren = Array.from(fragment.children) as HTMLElement[];
  const changed: HTMLElement[] = [];
  const desired: HTMLElement[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const { key, base_line } = blocks[i];
    const existing = liveByKey.get(key);
    const fresh = fragChildren[i];
    if (existing && existing.dataset.pmdBlock === key) {
      const prevBase = Number(existing.dataset.pmdBase ?? base_line);
      if (prevBase !== base_line) {
        shiftDataSrc(existing, base_line - prevBase);
      }
      existing.dataset.pmdBase = String(base_line);
      desired.push(existing);
      liveByKey.delete(key);
    } else {
      fresh.dataset.pmdBase = String(base_line);
      desired.push(fresh);
      changed.push(fresh);
    }
  }

  const desiredSet = new Set(desired);
  for (const child of Array.from(live.children)) {
    if (!desiredSet.has(child as HTMLElement)) child.remove();
  }
  let ref: Node | null = live.firstChild;
  for (const node of desired) {
    if (node === ref) {
      ref = node.nextSibling;
    } else {
      live.insertBefore(node, ref);
    }
  }
  return changed;
}

function shiftDataSrc(root: HTMLElement, delta: number) {
  const apply = (el: HTMLElement) => {
    const s = el.dataset.srcStart;
    const e = el.dataset.srcEnd;
    if (s !== undefined) el.dataset.srcStart = String(Number(s) + delta);
    if (e !== undefined) el.dataset.srcEnd = String(Number(e) + delta);
  };
  if (root.dataset.srcStart !== undefined) apply(root);
  root.querySelectorAll<HTMLElement>('[data-src-start]').forEach(apply);
}
