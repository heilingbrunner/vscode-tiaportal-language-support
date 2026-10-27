import * as vscode from 'vscode';
import { createSclHighlighter, type SclHighlighter } from '../render/sclHighlighter';

/** Lazily creates the SCL highlighter from files shipped with the extension; failures fall back to plain code. */
export class HighlighterService implements vscode.Disposable {
  private instance: Promise<SclHighlighter | undefined> | undefined;
  private log: vscode.OutputChannel | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  get(): Promise<SclHighlighter | undefined> {
    this.instance ??= this.create();
    return this.instance;
  }

  dispose(): void {
    this.log?.dispose();
  }

  private async read(...segments: string[]): Promise<Uint8Array> {
    return vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.extensionUri, ...segments));
  }

  private async create(): Promise<SclHighlighter | undefined> {
    try {
      return await createSclHighlighter({
        readGrammar: async () => new TextDecoder('utf-8').decode(await this.read('syntaxes', 'scl.tmLanguage.json')),
        readWasm: async () => {
          const bytes = await this.read('dist', 'onig.wasm');
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        },
      });
    } catch (error: unknown) {
      this.log ??= vscode.window.createOutputChannel('TIA Block View');
      this.log.appendLine(`SCL syntax highlighting is unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }
}
