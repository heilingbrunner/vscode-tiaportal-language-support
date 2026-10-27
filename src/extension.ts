import * as vscode from 'vscode';
import { TiaBlockEditorProvider, VIEW_TYPE } from './provider/tiaBlockEditor';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, new TiaBlockEditorProvider(context.extensionUri), {
      supportsMultipleEditorsPerDocument: true,
    }),
    vscode.commands.registerCommand('tia.openBlockView', async (resource?: vscode.Uri) => {
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
