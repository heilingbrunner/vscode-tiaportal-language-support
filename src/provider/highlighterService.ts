import * as vscode from 'vscode';
import { createHighlighter, type HighlightLanguage, type SclHighlighter } from '../render/sclHighlighter';

/** Lazily creates the highlighters from grammars shipped with the extension; failures fall back to plain code. */
export class HighlighterService implements vscode.Disposable {
  private readonly instances = new Map<HighlightLanguage, Promise<SclHighlighter | undefined>>();
  private log: vscode.OutputChannel | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  get(language: HighlightLanguage): Promise<SclHighlighter | undefined> {
    let instance = this.instances.get(language);
    if (!instance) {
      instance = this.create(language);
      this.instances.set(language, instance);
    }
    return instance;
  }

  dispose(): void {
    this.log?.dispose();
  }

  private async read(...segments: string[]): Promise<Uint8Array> {
    return vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.extensionUri, ...segments));
  }

  private async create(language: HighlightLanguage): Promise<SclHighlighter | undefined> {
    try {
      return await createHighlighter(language, {
        readGrammar: async (requested) =>
          new TextDecoder('utf-8').decode(await this.read('syntaxes', `${requested}.tmLanguage.json`)),
        readWasm: async () => {
          const bytes = await this.read('dist', 'onig.wasm');
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        },
      });
    } catch (error: unknown) {
      this.log ??= vscode.window.createOutputChannel('TIA Viewer');
      this.log.appendLine(
        `${language.toUpperCase()} syntax highlighting is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }
}
