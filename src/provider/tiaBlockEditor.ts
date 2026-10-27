import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { parseBlock } from '../parser/blockParser';
import { parseDataBlock } from '../parser/dbParser';
import { parseScl } from '../parser/sclParser';
import type { BlockModel } from '../model/types';
import { renderBlockHtml, renderMessageHtml, type HtmlAssets } from '../render/html';
import { withHighlighting } from '../render/sclHighlighter';
import type { HighlighterService } from './highlighterService';
import type { UdtIndex } from './udtIndex';

export const VIEW_TYPE = 'tia.blockView';

const hasExtension = (uri: vscode.Uri, extension: string): boolean => uri.path.toLowerCase().endsWith(extension);
/** Text sources (`.db`, `.scl`) resolve UDT members from the workspace; XML exports do not. */
const usesUdts = (uri: vscode.Uri): boolean => hasExtension(uri, '.db') || hasExtension(uri, '.scl');
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

/** Read-only custom editor that shows a TIA Openness block export as a TIA-style view. */
export class TiaBlockEditorProvider implements vscode.CustomReadonlyEditorProvider<BlockDocument> {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly udts: UdtIndex,
    private readonly highlighter: HighlighterService,
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
    const folder = vscode.Uri.joinPath(document.uri, '..');
    const name = document.uri.path.slice(document.uri.path.lastIndexOf('/') + 1);
    // file names are matched as a glob: escape glob metacharacters such as [ ] { } * ?
    const pattern = name.replace(/[*?{}[\]]/g, (c) => `[${c}]`);
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, pattern));
    const subscriptions = [
      watcher,
      watcher.onDidChange(() => void render()),
      watcher.onDidCreate(() => void render()),
    ];
    if (usesUdts(document.uri)) {
      // a changed UDT can change the expanded members of this data block
      subscriptions.push(this.udts.onDidChange(() => void render()));
    }
    panel.onDidDispose(() => {
      disposed = true;
      subscriptions.forEach((s) => s.dispose());
    });
    await render();
  }

  private async buildHtml(uri: vscode.Uri, webview: vscode.Webview, mediaRoot: vscode.Uri): Promise<string> {
    const assets: HtmlAssets = {
      cspSource: webview.cspSource,
      nonce: randomBytes(16).toString('base64'),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'viewer.css')).toString(),
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'viewer.js')).toString(),
    };
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.byteLength > MAX_FILE_BYTES) {
        return renderMessageHtml('This file is too large for the TIA block view (limit: 50 MB).', assets);
      }
      const text = new TextDecoder('utf-8').decode(bytes);
      const model = await this.parse(uri, text);
      if (!model) {
        return renderMessageHtml('This file is not a TIA Portal block export (FB, FC or OB).', assets);
      }
      return renderBlockHtml(model, assets);
    } catch (error: unknown) {
      const what = hasExtension(uri, '.db')
        ? 'TIA data block source'
        : hasExtension(uri, '.scl')
          ? 'TIA SCL source'
          : 'TIA Openness XML';
      return renderMessageHtml(`The file could not be read as ${what}: ${errorMessage(error)}`, assets);
    }
  }

  private async parse(uri: vscode.Uri, text: string): Promise<BlockModel | undefined> {
    if (hasExtension(uri, '.db')) {
      return parseDataBlock(text, await this.udts.resolver());
    }
    if (hasExtension(uri, '.scl')) {
      const model = parseScl(text, await this.udts.resolver());
      return this.highlight(model);
    }
    const culture = vscode.workspace.getConfiguration('tiaBlockView').get<string>('culture', '');
    return parseBlock(text, culture);
  }

  /** Adds syntax highlighting; any highlighter problem leaves the code as plain text instead of failing the view. */
  private async highlight(model: BlockModel): Promise<BlockModel> {
    try {
      const highlighter = await this.highlighter.get();
      return highlighter ? withHighlighting(model, highlighter) : model;
    } catch {
      return model;
    }
  }
}
