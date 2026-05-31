import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attachPreviewLinkActivation,
  handleLinkActivationResponse,
  type LinkActivationResponse,
} from './link_activation.ts';

class FakeLink extends EventTarget {
  private attrs = new Map<string, string>();

  constructor(attrs: Record<string, string>) {
    super();
    for (const [key, value] of Object.entries(attrs)) this.attrs.set(key, value);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }

  closest(selector: string): FakeLink | null {
    return selector === '[data-pmd-link-id]' ? this : null;
  }
}

class FakeRoot extends EventTarget {
  private link: FakeLink;

  constructor(link: FakeLink) {
    super();
    this.link = link;
  }

  querySelector(_selector: string): FakeLink {
    return this.link;
  }

  dispatchFromLink(event: Event): void {
    Object.defineProperty(event, 'target', { value: this.link });
    this.dispatchEvent(event);
  }
}

test('preview links activate through backend command only', async () => {
  const calls: unknown[] = [];
  const root = new FakeRoot(
    new FakeLink({ 'data-pmd-link-id': 'link-0', role: 'link', tabindex: '0' })
  );
  attachPreviewLinkActivation(root as unknown as HTMLElement, {
    currentDoc: () => ({ doc_id: 7, version: 12 }),
    invoke: async (command, payload) => {
      calls.push({ command, payload });
      return { kind: 'denied' };
    },
  });

  root.dispatchFromLink(new Event('click', { bubbles: true }));
  const keyEvent = new Event('keydown', { bubbles: true });
  Object.defineProperty(keyEvent, 'key', { value: 'Enter' });
  root.dispatchFromLink(keyEvent);
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(calls, [
    {
      command: 'prepare_link_activation',
      payload: { docId: 7, version: 12, linkId: 'link-0', activationKind: 'primary' },
    },
    {
      command: 'prepare_link_activation',
      payload: { docId: 7, version: 12, linkId: 'link-0', activationKind: 'keyboard' },
    },
  ]);
});

test('middle click context menu and drag route through backend mediation', async () => {
  const calls: unknown[] = [];
  const link = new FakeLink({ 'data-pmd-link-id': 'link-0', href: 'https://evil.test' });
  const root = new FakeRoot(link);
  attachPreviewLinkActivation(root as unknown as HTMLElement, {
    currentDoc: () => ({ doc_id: 7, version: 12 }),
    invoke: async (command, payload) => {
      calls.push({ command, payload });
      return { kind: 'denied' };
    },
  });

  root.dispatchFromLink(new Event('auxclick', { bubbles: true }));
  root.dispatchFromLink(new Event('contextmenu', { bubbles: true }));
  root.dispatchFromLink(new Event('dragstart', { bubbles: true }));
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(calls, [
    {
      command: 'prepare_link_activation',
      payload: { docId: 7, version: 12, linkId: 'link-0', activationKind: 'auxiliary' },
    },
    {
      command: 'prepare_link_activation',
      payload: { docId: 7, version: 12, linkId: 'link-0', activationKind: 'context_menu' },
    },
    {
      command: 'prepare_link_activation',
      payload: { docId: 7, version: 12, linkId: 'link-0', activationKind: 'drag' },
    },
  ]);
  assert.equal(link.getAttribute('href'), null);
});

test('local open responses use backend-owned payloads', async () => {
  const opened: unknown[] = [];
  const messages: string[] = [];
  await handleLinkActivationResponse({
    response: {
      kind: 'open_document',
      opened_document: {
        doc_id: 8,
        path: '/trusted/doc.md',
        contents: '# Linked',
        state: { kind: 'clean' },
      },
    },
    docId: 7,
    version: 12,
    invoke: async () => assert.fail('should not invoke another open command'),
    scrollToBlock: () => assert.fail('should not scroll'),
    openDocument: async (document) => opened.push(document),
    showMessage: (message) => messages.push(message),
    externalConfirmation: { show: () => assert.fail('should not confirm') },
  });

  assert.equal(opened.length, 1);

  await handleLinkActivationResponse({
    response: { kind: 'open_default_app', message: 'Opened report.pdf' },
    docId: 7,
    version: 12,
    invoke: async () => assert.fail('should not invoke another open command'),
    scrollToBlock: () => assert.fail('should not scroll'),
    openDocument: async () => assert.fail('should not open a document'),
    showMessage: (message) => messages.push(message),
    externalConfirmation: { show: () => assert.fail('should not confirm') },
  });

  assert.deepEqual(messages, ['Opened report.pdf']);
});

test('external confirmation waits for explicit confirm before opening', async () => {
  const calls: unknown[] = [];
  let confirm: (() => Promise<void>) | null = null;
  const response: LinkActivationResponse = {
    kind: 'external_confirmation',
    normalized_url: 'https://example.com/path',
    scheme: 'https',
    host: 'example.com',
    label_text: 'Open',
    action_token: 'token-1',
  };
  await handleLinkActivationResponse({
    response,
    docId: 7,
    version: 12,
    invoke: async (command, payload) => calls.push({ command, payload }),
    scrollToBlock: () => assert.fail('should not scroll'),
    openDocument: async () => assert.fail('should not open a document'),
    showMessage: () => assert.fail('should not show denial'),
    externalConfirmation: {
      show: (_response, onConfirm) => {
        confirm = onConfirm;
      },
    },
  });

  assert.deepEqual(calls, []);
  assert.ok(confirm);
  await confirm();
  assert.deepEqual(calls, [
    {
      command: 'confirm_external_open',
      payload: { docId: 7, version: 12, actionToken: 'token-1' },
    },
  ]);
});
