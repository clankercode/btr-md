export function domDiff(oldRoot: HTMLElement, newRoot: HTMLElement) {
  if (oldRoot.innerHTML === newRoot.innerHTML) return;
  diffChildren(oldRoot, newRoot);
}

function diffChildren(oldParent: Node, newParent: Node) {
  const oldChildren = Array.from(oldParent.childNodes);
  const newChildren = Array.from(newParent.childNodes);
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
    diffNode(oldParent, oldChild, newChild);
  }
}

function diffNode(parent: Node, oldNode: Node, newNode: Node) {
  if (oldNode.nodeType !== newNode.nodeType || oldNode.nodeName !== newNode.nodeName) {
    parent.replaceChild(newNode.cloneNode(true), oldNode);
    return;
  }

  if (oldNode.nodeType === Node.TEXT_NODE || oldNode.nodeType === Node.COMMENT_NODE) {
    if (oldNode.nodeValue !== newNode.nodeValue) {
      oldNode.nodeValue = newNode.nodeValue;
    }
    return;
  }

  if (oldNode.nodeType !== Node.ELEMENT_NODE || newNode.nodeType !== Node.ELEMENT_NODE) {
    return;
  }

  const oldEl = oldNode as HTMLElement;
  const newEl = newNode as HTMLElement;
  syncAttributes(oldEl, newEl);
  diffChildren(oldEl, newEl);
}

function syncAttributes(oldEl: HTMLElement, newEl: HTMLElement) {
  for (const attr of Array.from(oldEl.attributes)) {
    if (!newEl.hasAttribute(attr.name)) {
      oldEl.removeAttribute(attr.name);
    }
  }

  for (const attr of Array.from(newEl.attributes)) {
    if (oldEl.getAttribute(attr.name) !== attr.value) {
      oldEl.setAttribute(attr.name, attr.value);
    }
  }
}
