import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { parseBlock } from '../parser/blockParser';
import { renderBlockHtml, renderMessageHtml, type HtmlAssets } from '../render/html';

export const VIEW_TYPE = 'tia.blockView';
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
  constructor(private readonly extensionUri: vscode.Uri) {}

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
    await render();

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
    panel.onDidDispose(() => {
      disposed = true;
      subscriptions.forEach((s) => s.dispose());
    });
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
        return renderMessageHtml('This XML file is too large for the TIA block view (limit: 50 MB).', assets);
      }
      const culture = vscode.workspace.getConfiguration('tiaBlockView').get<string>('culture', '');
      const model = parseBlock(new TextDecoder('utf-8').decode(bytes), culture);
      if (!model) {
        return renderMessageHtml('This XML file is not a TIA Portal block export (FB, FC or OB).', assets);
      }
      return renderBlockHtml(model, assets);
    } catch (error: unknown) {
      return renderMessageHtml(`The file could not be read as TIA Openness XML: ${errorMessage(error)}`, assets);
    }
  }
}
