export interface BlockRef {
  key: string;
  base_line: number;
}

// Thrown by reconcileBlocks when the block manifest does not align 1:1 with the
// fragment's root elements. The caller treats this as a signal to fall back to a
// full innerHTML replace rather than risk a garbled / frozen preview.
export class ReconcileDesyncError extends Error {}

// Reconcile #pmd-content's direct children (keyed by data-pmd-block) against a
// freshly-parsed detached fragment. Returns the list of nodes that were newly
// inserted or replaced (for scoped post-processing). Unchanged-key nodes are
// kept in place (preserving rendered mermaid/katex); if their base_line shifted,
// their descendants' data-src-* are patched in place.
//
// Invariant: `blocks[i]` corresponds to `fragment.children[i]`. The backend
// emits exactly one manifest entry per root element; if that ever breaks
// (count mismatch) we throw ReconcileDesyncError so the caller can rebuild the
// whole preview instead of indexing past the end of the fragment.
export function reconcileBlocks(
  live: HTMLElement,
  fragment: HTMLElement,
  blocks: BlockRef[],
): HTMLElement[] {
  if (fragment.children.length !== blocks.length) {
    throw new ReconcileDesyncError(
      `block manifest (${blocks.length}) != fragment roots (${fragment.children.length})`,
    );
  }
  const liveByKey = new Map<string, HTMLElement[]>();
  for (const child of Array.from(live.children)) {
    const k = (child as HTMLElement).dataset.pmdBlock;
    if (k) {
      const queue = liveByKey.get(k);
      if (queue) queue.push(child as HTMLElement);
      else liveByKey.set(k, [child as HTMLElement]);
    }
  }

  const fragChildren = Array.from(fragment.children) as HTMLElement[];
  const changed: HTMLElement[] = [];
  const desired: HTMLElement[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const { key, base_line } = blocks[i];
    const queue = liveByKey.get(key);
    const existing = queue && queue.length ? queue.shift() : undefined;
    const fresh = fragChildren[i];
    if (existing && existing.dataset.pmdBlock === key) {
      const prevBase = Number(existing.dataset.pmdBase ?? base_line);
      if (prevBase !== base_line) {
        shiftDataSrc(existing, base_line - prevBase);
      }
      existing.dataset.pmdBase = String(base_line);
      desired.push(existing);
      // queue is mutated in-place (shift); empty queues are harmless
    } else {
      fresh.dataset.pmdBase = String(base_line);
      desired.push(fresh);
      changed.push(fresh);
    }
  }

  const desiredSet = new Set<Node>(desired);
  // Remove every child NODE that isn't a desired block — not just element
  // children. `live` ships with a literal "Loading..." text node (index.html's
  // #pmd-content placeholder); iterating `live.children` skipped it, so the
  // first reconcile render stranded it as a trailing text node ("...Loading").
  // Iterating childNodes clears text/comment nodes too, so reconcile fully owns
  // the preview root's contents.
  for (const child of Array.from(live.childNodes)) {
    if (!desiredSet.has(child)) child.remove();
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
