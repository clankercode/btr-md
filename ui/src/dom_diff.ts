export function domDiff(oldRoot: HTMLElement, newRoot: HTMLElement) {
  if (oldRoot.innerHTML === newRoot.innerHTML) return;
  diffChildren(oldRoot, newRoot);
}

function diffChildren(oldParent: HTMLElement, newParent: HTMLElement) {
  const oldChildren = Array.from(oldParent.childNodes) as HTMLElement[];
  const newChildren = Array.from(newParent.childNodes) as HTMLElement[];
  const maxLen = Math.max(oldChildren.length, newChildren.length);
  for (let i = 0; i < maxLen; i++) {
    const oldChild = oldChildren[i];
    const newChild = newChildren[i];
    if (!oldChild || !newChild) {
      if (newChild) {
        oldParent.appendChild(newChild.cloneNode(true));
      } else if (oldChild) {
        oldChild.remove();
      }
      continue;
    }
    if (oldChild.nodeType !== newChild.nodeType || oldChild.nodeName !== newChild.nodeName) {
      oldParent.replaceChild(newChild.cloneNode(true), oldChild);
      continue;
    }
    if (oldChild.nodeType === Node.ELEMENT_NODE) {
      if (oldChild.outerHTML !== newChild.outerHTML) {
        oldParent.replaceChild(newChild.cloneNode(true), oldChild);
      } else {
        diffChildren(oldChild, newChild as HTMLElement);
      }
    }
  }
}
