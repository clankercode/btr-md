export type ActionCategory =
  | "File"
  | "History"
  | "Document"
  | "Edit"
  | "View"
  | "Navigate"
  | "Theme"
  | "Diagnostics"
  | "Trust"
  | "Assets"
  | "Share"
  | "Settings";

export type ActionId =
  | "file.new"
  | "file.open"
  | "file.save"
  | "file.saveAs"
  | "file.closeTab"
  | "window.new"
  | "window.reopenLastClosed"
  | "window.closeAll"
  | "app.quit"
  | "edit.find"
  | "edit.replace"
  | "edit.pasteAsMarkdown"
  | "edit.findNext"
  | "edit.findPrevious"
  | "view.zoomIn"
  | "view.zoomOut"
  | "view.zoomReset"
  | "view.cycleMode"
  | "view.toggleWordWrap"
  | "view.toggleSidebar"
  | "navigate.commandOverlay"
  | "navigate.outline"
  | "diagnostics.togglePanel"
  | "theme.pick"
  | "settings.open"
  | "help.shortcuts"
  | "menu.focus"
  | "file.revealInFolder"
  | "file.openDefaultApp"
  | "file.copyPath"
  | "file.copyFilename"
  | "file.copyFileUrl"
  | "file.clearRecent"
  | "document.reloadFromDisk"
  | "document.mergeDiskChanges"
  | "document.editFrontmatter"
  | "document.export.pdf"
  | "document.export.html"
  | "view.setDiffMode"
  | "navigate.fileBrowser"
  | "navigate.tabNext"
  | "navigate.tabPrevious"
  | "share.openGist"
  | "share.copyGistMarkdown"
  | "settings.pickBaseFolder"
  | "settings.selectMonoFont"
  | "settings.setDefaultHandler"
  | "asset.grantFolder"
  | "asset.trustRepositoryRoot"
  | "asset.declineRepositoryRoot"
  | "settings.removeTrustRoot"
  | "asset.revokeGrant"
  | "history.clearRecentlyClosed";

export interface ActionContext {
  run(id: ActionId): void | Promise<void>;
  isEnabled(id: ActionId): boolean;
  isVisible(id: ActionId): boolean;
}

export interface ActionSpec {
  id: ActionId;
  label: string;
  category: ActionCategory;
  description: string;
  defaultShortcuts: string[];
  enabledWhen: string;
  visibleWhen: string;
  run: (context: ActionContext) => void | Promise<void>;
}

export const DEFAULT_ACTION_SHORTCUTS: Record<string, string[]> = {
  "file.new": ["Ctrl+N"],
  "file.open": ["Ctrl+O"],
  "file.save": ["Ctrl+S"],
  "file.saveAs": ["Shift+Ctrl+S"],
  "file.closeTab": ["Ctrl+W"],
  "window.new": ["Ctrl+Shift+N"],
  "window.reopenLastClosed": ["Ctrl+Shift+T"],
  "app.quit": ["Ctrl+Q"],
  "edit.find": ["Ctrl+F"],
  "edit.replace": ["Ctrl+H"],
  "edit.pasteAsMarkdown": ["Ctrl+Shift+V"],
  "edit.findNext": ["Ctrl+G"],
  "edit.findPrevious": ["Shift+Ctrl+G"],
  "view.zoomIn": ["Ctrl++"],
  "view.zoomOut": ["Ctrl+-"],
  "view.zoomReset": ["Ctrl+0"],
  "view.cycleMode": ["Ctrl+\\"],
  "view.toggleWordWrap": ["Alt+Z"],
  "view.toggleSidebar": ["Ctrl+B"],
  "navigate.commandOverlay": ["Ctrl+P"],
  "navigate.outline": ["Ctrl+Shift+O"],
  "diagnostics.togglePanel": ["Ctrl+Shift+M"],
  "theme.pick": ["Ctrl+T"],
  "settings.open": ["Ctrl+,"],
  "help.shortcuts": ["Ctrl+?"],
  "menu.focus": ["F10"],
  "navigate.tabNext": ["Ctrl+PageDown"],
  "navigate.tabPrevious": ["Ctrl+PageUp"],
};

export const NO_DEFAULT_ACTION_IDS: ActionId[] = [
  "window.closeAll",
  "file.revealInFolder",
  "file.openDefaultApp",
  "file.copyPath",
  "file.copyFilename",
  "file.copyFileUrl",
  "file.clearRecent",
  "document.reloadFromDisk",
  "document.mergeDiskChanges",
  "document.editFrontmatter",
  "document.export.pdf",
  "document.export.html",
  "view.setDiffMode",
  "navigate.fileBrowser",
  "share.openGist",
  "share.copyGistMarkdown",
  "settings.pickBaseFolder",
  "settings.selectMonoFont",
  "settings.setDefaultHandler",
  "asset.grantFolder",
  "asset.trustRepositoryRoot",
  "asset.declineRepositoryRoot",
  "settings.removeTrustRoot",
  "asset.revokeGrant",
  "history.clearRecentlyClosed",
];

function spec(
  id: ActionId,
  label: string,
  category: ActionCategory,
  description: string,
  defaultShortcuts = DEFAULT_ACTION_SHORTCUTS[id] ?? []
): ActionSpec {
  return {
    id,
    label,
    category,
    description,
    defaultShortcuts,
    enabledWhen: "default",
    visibleWhen: "default",
    run: (context) => context.run(id),
  };
}

export const defaultActionSpecs: ActionSpec[] = [
  spec("file.new", "New file", "File", "Create a new Markdown file"),
  spec("file.open", "Open file", "File", "Open a Markdown file"),
  spec("file.save", "Save", "File", "Save the active file"),
  spec("file.saveAs", "Save as", "File", "Save the active file to a new path"),
  spec("file.closeTab", "Close tab", "File", "Close the active tab"),
  spec("window.new", "New Window", "File", "Open a new window"),
  spec("window.reopenLastClosed", "Reopen Last Closed Window", "History", "Restore the most recently closed window"),
  spec("window.closeAll", "Close All Windows", "File", "Close every open window (restored next launch)"),
  spec("app.quit", "Quit", "File", "Quit preview-md"),
  spec("edit.find", "Find", "Edit", "Find text in the editor"),
  spec("edit.replace", "Find and replace", "Edit", "Find and replace text in the source editor"),
  spec("edit.pasteAsMarkdown", "Paste as Markdown", "Edit", "Convert clipboard HTML to Markdown and insert it"),
  spec("edit.findNext", "Find next", "Edit", "Move to the next search result"),
  spec("edit.findPrevious", "Find previous", "Edit", "Move to the previous search result"),
  spec("view.zoomIn", "Zoom in", "View", "Increase zoom"),
  spec("view.zoomOut", "Zoom out", "View", "Decrease zoom"),
  spec("view.zoomReset", "Reset zoom", "View", "Reset zoom"),
  spec("view.cycleMode", "Cycle mode", "View", "Cycle source split preview modes"),
  spec("view.toggleWordWrap", "Toggle word wrap", "View", "Toggle editor word wrapping"),
  spec("view.toggleSidebar", "Toggle sidebar", "View", "Show or hide the folder sidebar"),
  spec("navigate.commandOverlay", "Command overlay", "Navigate", "Open the command overlay"),
  spec("navigate.outline", "Show outline", "Navigate", "Show document outline"),
  spec("diagnostics.togglePanel", "Toggle diagnostics", "Diagnostics", "Show or hide diagnostics"),
  spec("theme.pick", "Pick theme", "Theme", "Open the theme picker"),
  spec("settings.open", "Settings", "Settings", "Open settings"),
  spec("help.shortcuts", "Keyboard shortcuts", "Settings", "Show keyboard shortcuts"),
  spec("menu.focus", "Focus menu", "Navigate", "Focus the application menu"),
  spec("file.revealInFolder", "Reveal in folder", "File", "Reveal the active file in the file manager"),
  spec("file.openDefaultApp", "Open in default app", "File", "Open the active file in the default application"),
  spec("file.copyPath", "Copy path", "File", "Copy the active file path"),
  spec("file.copyFilename", "Copy filename", "File", "Copy the active file name"),
  spec("file.copyFileUrl", "Copy file URL", "File", "Copy the active file URL"),
  spec("file.clearRecent", "Clear recent files", "File", "Clear the recent file list"),
  spec("document.reloadFromDisk", "Reload from disk", "Document", "Reload the active document"),
  spec("document.mergeDiskChanges", "Merge disk changes", "Document", "Merge disk changes into the active document"),
  spec("document.editFrontmatter", "Edit frontmatter", "Document", "Inspect and edit document frontmatter", []),
  spec("document.export.pdf", "Export to PDF", "Document", "Print the rendered document (Save as PDF)", []),
  spec("document.export.html", "Export to HTML", "Document", "Export the rendered document as a self-contained HTML file", []),
  spec("view.setDiffMode", "Set diff mode", "View", "Select the diff mode"),
  spec("navigate.fileBrowser", "File browser", "Navigate", "Open the file browser tab"),
  spec("navigate.tabNext", "Next tab", "Navigate", "Switch to the next tab"),
  spec("navigate.tabPrevious", "Previous tab", "Navigate", "Switch to the previous tab"),
  spec("share.openGist", "Open Gist", "Share", "Open the document Gist"),
  spec("share.copyGistMarkdown", "Copy Gist Markdown", "Share", "Copy Gist Markdown"),
  spec("settings.pickBaseFolder", "Pick file-browser folder", "Settings", "Pick the file-browser base folder"),
  spec("settings.selectMonoFont", "Select editor font", "Settings", "Select the editor font"),
  spec("settings.setDefaultHandler", "Set as Markdown default", "Settings", "Set preview-md as the Markdown default handler"),
  spec("asset.grantFolder", "Grant folder", "Assets", "Grant a folder for blocked local assets", []),
  spec("asset.trustRepositoryRoot", "Trust repository root", "Assets", "Trust the repository root for local assets", []),
  spec("asset.declineRepositoryRoot", "Decline repository root", "Assets", "Hide the repository-root asset grant recommendation", []),
  spec("asset.revokeGrant", "Revoke grant", "Assets", "Revoke a local asset folder grant", []),
  spec("settings.removeTrustRoot", "Remove trusted root", "Settings", "Remove a stored asset-root trust decision", []),
  spec("history.clearRecentlyClosed", "Clear recently closed windows", "History", "Forget all recently closed windows"),
];

export interface ActionRegistry {
  actions: ActionSpec[];
  runAction(id: ActionId): Promise<boolean>;
}

export function createActionRegistry(
  actions: ActionSpec[],
  context: ActionContext
): ActionRegistry {
  const byId = new Map(actions.map((action) => [action.id, action]));
  return {
    actions,
    runAction: async (id: ActionId) => {
      const action = byId.get(id);
      if (!action || !context.isVisible(id) || !context.isEnabled(id)) return false;
      await action.run(context);
      return true;
    },
  };
}

export function searchActions(actions: ActionSpec[], query: string): ActionSpec[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return actions;
  return actions.filter((action) =>
    [action.id, action.label, action.category, action.description].some((value) =>
      value.toLowerCase().includes(needle)
    )
  );
}
