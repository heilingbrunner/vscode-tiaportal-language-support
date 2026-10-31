import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { renderSearchHtml } from '../render/searchHtml';
import { scanFolder } from './projectScan';
import { VIEW_TYPE } from './tiaViewerEditor';

export const SEARCH_VIEW_TYPE = 'tia.search';
const TITLE = 'Search in project';

type Incoming =
  | { type: 'ready' }
  | { type: 'stop' }
  | { type: 'browse' }
  | { type: 'search'; term: string; exact: boolean; folder: string }
  | { type: 'open'; uri: string; asText: boolean; needle: string };

/** Reads a message of the webview; anything that is not one of ours is dropped. */
function parseIncoming(message: unknown): Incoming | undefined {
  if (typeof message !== 'object' || message === null) {
    return undefined;
  }
  const m = message as Record<string, unknown>;
  if (m.type === 'ready' || m.type === 'stop' || m.type === 'browse') {
    return { type: m.type };
  }
  if (m.type === 'search' && typeof m.term === 'string' && typeof m.exact === 'boolean' && typeof m.folder === 'string') {
    return { type: 'search', term: m.term, exact: m.exact, folder: m.folder };
  }
  if (m.type === 'open' && typeof m.uri === 'string' && typeof m.asText === 'boolean' && typeof m.needle === 'string') {
    return { type: 'open', uri: m.uri, asText: m.asText, needle: m.needle };
  }
  return undefined;
}

const folderText = (uri: vscode.Uri | undefined): string => (!uri ? '' : uri.scheme === 'file' ? uri.fsPath : uri.toString());

/**
 * The "Search in project" view: a single webview tab that searches the TIA sources below a folder and lists the hits
 * like TIA Portal's search does. The view itself only shows; the folder is scanned here.
 */
export class SearchPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private folder: vscode.Uri | undefined;
  private ready = false;
  private running: vscode.CancellationTokenSource | undefined;
  /** Counts the searches that were asked for, to tell a superseded one apart while it awaits. */
  private searches = 0;
  /** The objects the view was told about: only these can be opened from it. */
  private readonly known = new Set<string>();

  constructor(private readonly extensionUri: vscode.Uri) {}

  /** Opens the view (or brings it forward) and points it at `folder`, by default the first workspace folder. */
  show(folder?: vscode.Uri): void {
    this.folder = folder ?? this.folder ?? vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!this.panel) {
      this.panel = this.create();
      return;
    }
    this.panel.reveal(undefined, false);
    if (this.ready) {
      this.post({ type: 'folder', folder: folderText(this.folder) });
    }
  }

  dispose(): void {
    this.running?.cancel();
    this.panel?.dispose();
  }

  private create(): vscode.WebviewPanel {
    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, 'media');
    const panel = vscode.window.createWebviewPanel(SEARCH_VIEW_TYPE, TITLE, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [mediaRoot],
    });
    panel.webview.html = renderSearchHtml({
      cspSource: panel.webview.cspSource,
      nonce: randomBytes(16).toString('base64'),
      styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'search.css')).toString(),
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'search.js')).toString(),
    });
    panel.webview.onDidReceiveMessage((message: unknown) => void this.handle(message));
    panel.onDidDispose(() => {
      this.running?.cancel();
      this.running = undefined;
      this.panel = undefined;
      this.ready = false;
      this.known.clear();
    });
    return panel;
  }

  private post(message: Record<string, unknown>): void {
    void this.panel?.webview.postMessage(message);
  }

  private async handle(raw: unknown): Promise<void> {
    const message = parseIncoming(raw);
    if (!message) {
      return;
    }
    switch (message.type) {
      case 'ready':
        this.ready = true;
        this.post({
          type: 'init',
          folder: folderText(this.folder),
          folders: (vscode.workspace.workspaceFolders ?? []).map((f) => folderText(f.uri)),
        });
        return;
      case 'stop':
        this.running?.cancel();
        return;
      case 'browse':
        await this.browse();
        return;
      case 'search':
        await this.search(message.term, message.exact, message.folder);
        return;
      case 'open':
        await this.open(message.uri, message.asText, message.needle);
        return;
    }
  }

  private async browse(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      defaultUri: this.folder,
      openLabel: 'Search in this folder',
    });
    if (picked?.[0]) {
      this.folder = picked[0];
      this.post({ type: 'folder', folder: folderText(this.folder) });
    }
  }

  /** The folder the user typed; the text of the current folder maps back to its uri (remote folders have no plain path). */
  private resolveFolder(text: string): vscode.Uri {
    const typed = text.trim();
    if (this.folder && typed === folderText(this.folder)) {
      return this.folder;
    }
    return /^[a-z][a-z0-9+.-]+:\/\//i.test(typed) ? vscode.Uri.parse(typed) : vscode.Uri.file(typed);
  }

  private async isFolder(uri: vscode.Uri): Promise<boolean> {
    try {
      return ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.Directory) !== 0;
    } catch {
      return false;
    }
  }

  private async search(term: string, exact: boolean, folderInput: string): Promise<void> {
    this.running?.cancel();
    const ticket = ++this.searches;
    if (term.trim() === '') {
      this.post({ type: 'failed', message: 'Enter a text to search for.' });
      return;
    }
    const target = this.resolveFolder(folderInput);
    if (!(await this.isFolder(target))) {
      this.post({ type: 'failed', message: `The folder "${folderInput.trim()}" does not exist.` });
      return;
    }
    if (ticket !== this.searches) {
      // a newer search started while the folder was being checked
      return;
    }
    const source = new vscode.CancellationTokenSource();
    this.running = source;
    this.folder = target;
    this.known.clear();
    this.post({ type: 'started' });
    try {
      const summary = await scanFolder(target, term, exact, source.token, {
        // only the current search reports: a superseded one must not write into the next one's results
        found: (objects) => {
          if (this.running !== source) {
            return;
          }
          objects.forEach((o) => this.known.add(o.uri));
          this.post({ type: 'found', objects });
        },
        progress: (scanned, total) => {
          if (this.running === source) {
            this.post({ type: 'progress', scanned, total });
          }
        },
      });
      if (this.running === source) {
        this.post({ type: 'done', summary, cancelled: source.token.isCancellationRequested });
      }
    } finally {
      if (this.running === source) {
        this.running = undefined;
      }
      source.dispose();
    }
  }

  private async open(uriText: string, asText: boolean, needle: string): Promise<void> {
    if (!this.known.has(uriText)) {
      return;
    }
    const uri = vscode.Uri.parse(uriText);
    try {
      if (!asText) {
        await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE, vscode.ViewColumn.Beside);
        return;
      }
      const document = await vscode.workspace.openTextDocument(uri);
      const lower = needle.toLowerCase();
      for (let line = 0; line < document.lineCount; line++) {
        const column = document.lineAt(line).text.toLowerCase().indexOf(lower);
        if (column >= 0) {
          const range = new vscode.Range(line, column, line, column + needle.length);
          await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, selection: range });
          return;
        }
      }
      await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside });
    } catch (error: unknown) {
      void vscode.window.showErrorMessage(`Could not open the file: ${error instanceof Error ? error.message : 'Unexpected error'}`);
    }
  }
}
