import * as vscode from 'vscode';
import { ComparePairs } from './provider/comparePairs';
import { HighlighterService } from './provider/highlighterService';
import { SearchPanel } from './provider/searchPanel';
import { TiaViewerEditorProvider, VIEW_TYPE } from './provider/tiaViewerEditor';
import { UdtIndex } from './provider/udtIndex';

export function activate(context: vscode.ExtensionContext): void {
  const udts = new UdtIndex();
  const highlighter = new HighlighterService(context.extensionUri);
  const pairs = new ComparePairs();
  const search = new SearchPanel(context.extensionUri);
  context.subscriptions.push(
    udts,
    highlighter,
    pairs,
    search,
    // from the Explorer the folder is passed in; from the command palette the view opens on the workspace folder
    vscode.commands.registerCommand('tia.searchInFolder', (folder?: vscode.Uri) => search.show(folder)),
    vscode.commands.registerCommand('tia.searchInProject', () => search.show()),
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, new TiaViewerEditorProvider(context.extensionUri, udts, highlighter, pairs), {
      supportsMultipleEditorsPerDocument: true,
    }),
    vscode.commands.registerCommand('tia.openViewer', async (resource?: vscode.Uri) => {
      const uri = resource ?? vscode.window.activeTextEditor?.document.uri;
      if (!uri) {
        void vscode.window.showInformationMessage('Open a TIA Openness XML file first.');
        return;
      }
      await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE, vscode.ViewColumn.Beside);
    }),
  );
}

export function deactivate(): void {
  // nothing to clean up: all disposables are registered on the extension context
}
