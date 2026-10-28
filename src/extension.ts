import * as vscode from 'vscode';
import { HighlighterService } from './provider/highlighterService';
import { TiaViewerEditorProvider, VIEW_TYPE } from './provider/tiaViewerEditor';
import { UdtIndex } from './provider/udtIndex';

export function activate(context: vscode.ExtensionContext): void {
  const udts = new UdtIndex();
  const highlighter = new HighlighterService(context.extensionUri);
  context.subscriptions.push(
    udts,
    highlighter,
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, new TiaViewerEditorProvider(context.extensionUri, udts, highlighter), {
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
