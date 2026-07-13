// Documents domain client — registration, render, edit/save lifecycle, disk
// pull/merge, dirty-doc restore, open/export, and the CLI initial path. Thin
// typed wrappers over `call()`.

import { call } from './invoke.js';
import type { OpenedDoc, RegisteredDoc } from './commands.js';
import type { FileState } from '../doc_state.js';
import type { RenderResult } from '../document_contracts.js';
import type { OpenedDocResult } from '../session.js';
import type { HtmlExportPayload } from '../export_document.js';

export function registerDoc(args: {
  path: string | null;
  contents: string;
}): Promise<RegisteredDoc> {
  return call('register_doc', args);
}

export function renderCmd(args: {
  docId: number;
  version: number;
  markdown: string;
  allowDocumentStyles?: boolean;
}): Promise<RenderResult> {
  return call('render_cmd', args);
}

export function docEdited(docId: number, contents: string): Promise<FileState> {
  return call('doc_edited', { docId, contents });
}

export function saveDoc(args: {
  docId: number;
  contents: string;
  path: string | null;
}): Promise<FileState> {
  return call('save_doc', args);
}

export function dropDoc(docId: number): Promise<void> {
  return call('drop_doc', { docId });
}

export function setActiveDoc(docId: number): Promise<void> {
  return call('set_active_doc', { docId });
}

export function pullFromDisk(
  docId: number,
): Promise<{ contents: string; state: FileState }> {
  return call('pull_from_disk', { docId });
}

export function resolveDiskChange(args: {
  docId: number;
  oursText: string;
  diskDigestSeen: string;
}): Promise<{ merged: string; state: FileState; conflicted: boolean }> {
  return call('resolve_disk_change', args);
}

export function restoreDirtyDoc(args: {
  path: string;
  content: string;
  baselineContent: string;
  background: boolean;
}): Promise<OpenedDocResult> {
  return call('restore_dirty_doc', args);
}

export function requestOpenFile(args: {
  path: string;
  background: boolean;
}): Promise<OpenedDoc> {
  return call('request_open_file', args);
}

export function exportHtml(args: {
  payload: HtmlExportPayload;
  suggestedName: string;
}): Promise<string | null> {
  return call('export_html', args);
}

export function getInitialPath(): Promise<string | null> {
  return call('get_initial_path');
}
