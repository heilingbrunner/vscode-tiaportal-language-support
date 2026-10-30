import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { parseBlock } from '../parser/blockParser';
import { parseDataBlock } from '../parser/dbParser';
import { parseS7dclModel } from '../parser/s7dclParser';
import { parseAwl, parseScl } from '../parser/sclParser';
import { parseUdtModel } from '../parser/udtParser';
import { diffModels } from '../diff/modelDiff';
import type { BlockModel } from '../model/types';
import { renderBlockHtml, renderMessageHtml, type HtmlAssets } from '../render/html';
import { withHighlighting } from '../render/sclHighlighter';
import { gitSourceFile, type ComparePairs } from './comparePairs';
import type { HighlighterService } from './highlighterService';
import { readS7res, s7dclUriOf, s7resUriOf } from './s7resFile';
import type { UdtIndex } from './udtIndex';

export const VIEW_TYPE = 'tia.viewer';

const hasExtension = (uri: vscode.Uri, extension: string): boolean => uri.path.toLowerCase().endsWith(extension);
const isStlFile = (uri: vscode.Uri): boolean => hasExtension(uri, '.awl') || hasExtension(uri, '.stl');
const isS7dclFile = (uri: vscode.Uri): boolean => hasExtension(uri, '.s7dcl');
/** An `.s7res` is shown as the `.s7dcl` it belongs to. */
const isS7resFile = (uri: vscode.Uri): boolean => hasExtension(uri, '.s7res');
/** Text sources (`.db`, `.udt`, `.s7dcl`, `.scl`, `.awl`, `.stl`) resolve UDT members from the workspace; XML exports do not. */
const usesUdts = (uri: vscode.Uri): boolean =>
  hasExtension(uri, '.db') ||
  hasExtension(uri, '.udt') ||
  isS7dclFile(uri) ||
  isS7resFile(uri) ||
  hasExtension(uri, '.scl') ||
  isStlFile(uri);
const MAX_FILE_BYTES = 50 * 1024 * 1024;

class BlockDocument implements vscode.CustomDocument {
  constructor(readonly uri: vscode.Uri) {}

  dispose(): void {
    // nothing to release: the document is read-only and re-read from disk on demand
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}

/** Calls `onChange` when the file changes on disk; other schemes (for example `git:` revisions) are immutable. */
function watchFile(uri: vscode.Uri, onChange: () => void): vscode.Disposable[] {
  if (uri.scheme !== 'file') {
    return [];
  }
  const folder = vscode.Uri.joinPath(uri, '..');
  const name = uri.path.slice(uri.path.lastIndexOf('/') + 1);
  // file names are matched as a glob: escape glob metacharacters such as [ ] { } * ?
  const pattern = name.replace(/[*?{}[\]]/g, (c) => `[${c}]`);
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, pattern));
  return [watcher, watcher.onDidChange(onChange), watcher.onDidCreate(onChange)];
}

type ModelResult = { model: BlockModel } | { message: string };

/** Read-only custom editor that shows a TIA Openness block export as a TIA-style view. */
export class TiaViewerEditorProvider implements vscode.CustomReadonlyEditorProvider<BlockDocument> {
  /** Open viewer panels by document uri. */
  private readonly openPanels = new Map<string, vscode.WebviewPanel[]>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly udts: UdtIndex,
    private readonly highlighter: HighlighterService,
    private readonly pairs: ComparePairs,
  ) {}

  openCustomDocument(uri: vscode.Uri): BlockDocument {
    return new BlockDocument(uri);
  }

  async resolveCustomEditor(document: BlockDocument, panel: vscode.WebviewPanel): Promise<void> {
    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, 'media');
    panel.webview.options = { enableScripts: true, localResourceRoots: [mediaRoot] };

    let disposed = false;
    let latest = 0;
    const render = async (): Promise<void> => {
      const ticket = ++latest;
      const html = await this.buildHtml(document.uri, panel.webview, mediaRoot);
      if (!disposed && ticket === latest) {
        panel.webview.html = html;
      }
    };

    // subscriptions and the dispose handler exist before the first (async) render, so closing the panel
    // while it is still rendering cannot leak the watcher or write to a disposed webview
    const rerender = (): void => void render();
    const subscriptions: vscode.Disposable[] = watchFile(document.uri, rerender);
    if (isS7dclFile(document.uri)) {
      // the texts of an `.s7dcl` (comments, titles) live in its `.s7res`
      subscriptions.push(...watchFile(s7resUriOf(document.uri), rerender));
    } else if (isS7resFile(document.uri)) {
      // an `.s7res` is shown through the `.s7dcl` it belongs to
      subscriptions.push(...watchFile(s7dclUriOf(document.uri), rerender));
    }
    // the compared counterpart is watched too: this viewer's marks depend on its content
    let peerWatch: { key: string; disposables: vscode.Disposable[] } | undefined;
    const syncPeerWatch = (): void => {
      const peer = this.pairs.get(document.uri);
      const key = peer?.other.scheme === 'file' ? peer.other.toString() : '';
      if (peerWatch?.key === key) {
        return;
      }
      peerWatch?.disposables.forEach((d) => d.dispose());
      peerWatch = peer && key ? { key, disposables: watchFile(peer.other, rerender) } : undefined;
    };
    syncPeerWatch();
    subscriptions.push(
      this.pairs.onDidChange((changed) => {
        if (changed.toString() === document.uri.toString()) {
          syncPeerWatch();
          rerender();
        }
      }),
    );
    if (usesUdts(document.uri)) {
      // a changed UDT can change the expanded members of this data block
      subscriptions.push(this.udts.onDidChange(rerender));
    }
    subscriptions.push(panel.webview.onDidReceiveMessage((message: unknown) => this.relayScroll(document.uri, message)));
    const key = document.uri.toString();
    this.openPanels.set(key, [...(this.openPanels.get(key) ?? []), panel]);
    panel.onDidDispose(() => {
      disposed = true;
      subscriptions.forEach((s) => s.dispose());
      peerWatch?.disposables.forEach((d) => d.dispose());
      const remaining = (this.openPanels.get(key) ?? []).filter((p) => p !== panel);
      if (remaining.length > 0) {
        this.openPanels.set(key, remaining);
      } else {
        this.openPanels.delete(key);
        // closing one side ends the comparison, so the other viewer shows its file without marks again
        this.pairs.release(document.uri);
      }
    });
    this.pairWithOpenRevision(document.uri);
    await render();
  }

  /**
   * VS Code's own diff editor (for example "Open Changes" with this viewer as the editor for the file type) opens a
   * `git:` revision and the file on disk without going through the compare command: pair them as soon as both are open.
   */
  private pairWithOpenRevision(uri: vscode.Uri): void {
    const isRevision = uri.scheme === 'git';
    const fileUri = isRevision ? gitSourceFile(uri) : uri;
    if (!fileUri || (!isRevision && uri.scheme !== 'file') || this.pairs.get(uri)) {
      return;
    }
    const fileKey = fileUri.toString();
    if (isRevision) {
      if (this.openPanels.has(fileKey) && !this.pairs.get(fileUri)) {
        this.pairs.pair(uri, fileUri);
      }
      return;
    }
    for (const key of this.openPanels.keys()) {
      const revision = vscode.Uri.parse(key);
      if (gitSourceFile(revision)?.toString() === fileKey && !this.pairs.get(revision)) {
        this.pairs.pair(revision, uri);
        return;
      }
    }
  }

  /** Forwards a scroll position of one viewer of a comparison to the viewers of its counterpart. */
  private relayScroll(uri: vscode.Uri, message: unknown): void {
    const peer = this.pairs.get(uri);
    if (!peer || typeof message !== 'object' || message === null) {
      return;
    }
    const { type, target, left, top } = message as Record<string, unknown>;
    if (type !== 'scroll' || typeof target !== 'string' || typeof left !== 'number' || typeof top !== 'number') {
      return;
    }
    for (const other of this.openPanels.get(peer.other.toString()) ?? []) {
      void other.webview.postMessage({ type, target, left, top });
    }
  }

  private async buildHtml(uri: vscode.Uri, webview: vscode.Webview, mediaRoot: vscode.Uri): Promise<string> {
    const assets: HtmlAssets = {
      cspSource: webview.cspSource,
      nonce: randomBytes(16).toString('base64'),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'viewer.css')).toString(),
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'viewer.js')).toString(),
    };
    const result = await this.readModel(uri);
    if ('message' in result) {
      return renderMessageHtml(result.message, assets);
    }
    const peer = this.pairs.get(uri);
    if (!peer) {
      return renderBlockHtml(result.model, assets);
    }
    // an unreadable counterpart only costs the marks: this file is still shown
    const other = await this.readModel(peer.other);
    if ('message' in other) {
      return renderBlockHtml(result.model, assets);
    }
    const diffed = peer.side === 'old' ? diffModels(result.model, other.model) : diffModels(other.model, result.model);
    return renderBlockHtml(peer.side === 'old' ? diffed.oldModel : diffed.newModel, assets);
  }

  private async readModel(opened: vscode.Uri): Promise<ModelResult> {
    const uri = isS7resFile(opened) ? s7dclUriOf(opened) : opened;
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.byteLength > MAX_FILE_BYTES) {
        return { message: 'This file is too large for the TIA viewer (limit: 50 MB).' };
      }
      const text = new TextDecoder('utf-8').decode(bytes);
      const model = await this.parse(uri, text);
      if (!model) {
        return { message: 'This file is not a TIA Portal block export (FB, FC or OB).' };
      }
      return { model };
    } catch (error: unknown) {
      const what = hasExtension(uri, '.db')
        ? 'TIA data block source'
        : hasExtension(uri, '.udt')
          ? 'TIA UDT source'
          : isS7dclFile(uri)
            ? 'TIA S7 declaration source'
            : hasExtension(uri, '.scl')
              ? 'TIA SCL source'
              : isStlFile(uri)
                ? 'TIA STL source'
                : 'TIA Openness XML';
      return { message: `The file could not be read as ${what}: ${errorMessage(error)}` };
    }
  }

  private async parse(uri: vscode.Uri, text: string): Promise<BlockModel | undefined> {
    if (hasExtension(uri, '.db')) {
      return parseDataBlock(text, await this.udts.resolver());
    }
    if (hasExtension(uri, '.udt')) {
      return parseUdtModel(text, await this.udts.resolver());
    }
    if (isS7dclFile(uri)) {
      const culture = vscode.workspace.getConfiguration('tiaViewer').get<string>('culture', '');
      const model = parseS7dclModel(text, await readS7res(uri, culture), await this.udts.resolver());
      return this.highlight(model);
    }
    if (hasExtension(uri, '.scl')) {
      const model = parseScl(text, await this.udts.resolver());
      return this.highlight(model);
    }
    if (isStlFile(uri)) {
      return this.highlight(parseAwl(text, await this.udts.resolver()));
    }
    const culture = vscode.workspace.getConfiguration('tiaViewer').get<string>('culture', '');
    const model = parseBlock(text, culture);
    // SCL and STL networks of XML exports are highlighted too
    return model ? this.highlight(model) : undefined;
  }

  /** Adds syntax highlighting; any highlighter problem leaves the code as plain text instead of failing the view. */
  private async highlight(model: BlockModel): Promise<BlockModel> {
    if (!model.code && !model.networks.some((n) => n.body.kind === 'code')) {
      return model;
    }
    try {
      // the `.s7dcl` grammar is only loaded for blocks with LAD source text
      const hasLadText = model.networks.some((n) => n.body.kind === 'code' && (n.body.language === 'LAD' || n.body.language === 'FBD'));
      const [scl, awl, s7dcl] = await Promise.all([
        this.highlighter.get('scl'),
        this.highlighter.get('awl'),
        hasLadText ? this.highlighter.get('s7dcl') : undefined,
      ]);
      return withHighlighting(model, { scl, awl, s7dcl });
    } catch {
      return model;
    }
  }
}
