import * as vscode from 'vscode';
import type { RawMember } from '../parser/declParser';
import type { UdtResolver } from '../parser/memberBuilder';
import { parseUdt, type UdtDefinition } from '../parser/udtParser';

const MAX_FILES = 5000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const READ_BATCH = 16;
/** File events (a `git checkout` touches many files) are coalesced into one rebuild. */
const DEBOUNCE_MS = 250;

type UdtMap = Map<string, RawMember[]>;

/** Workspace index of `*.udt` sources, loaded lazily and rebuilt when a `.udt` file changes. */
export class UdtIndex implements vscode.Disposable {
  private loading: Promise<UdtMap> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];

  readonly onDidChange = this.changed.event;

  constructor() {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.udt');
    const invalidate = (): void => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.loading = undefined;
        this.changed.fire();
      }, DEBOUNCE_MS);
    };
    this.disposables.push(
      watcher,
      watcher.onDidChange(invalidate),
      watcher.onDidCreate(invalidate),
      watcher.onDidDelete(invalidate),
      this.changed,
    );
  }

  async resolver(): Promise<UdtResolver> {
    this.loading ??= this.build().catch(() => {
      // do not cache a failed scan: the next render tries again, and types stay unresolved meanwhile
      this.loading = undefined;
      return new Map<string, RawMember[]>();
    });
    const map = await this.loading;
    return (name) => map.get(name.toLowerCase());
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.disposables.forEach((d) => d.dispose());
  }

  private async readDefinition(uri: vscode.Uri): Promise<UdtDefinition | undefined> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return bytes.byteLength > MAX_FILE_BYTES ? undefined : parseUdt(new TextDecoder('utf-8').decode(bytes));
    } catch {
      // an unreadable or malformed UDT only means that type stays unresolved
      return undefined;
    }
  }

  private async build(): Promise<UdtMap> {
    const uris = await vscode.workspace.findFiles('**/*.udt', '**/node_modules/**', MAX_FILES);
    // sorted so that a name defined twice resolves the same way every time (first path wins)
    uris.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
    const map: UdtMap = new Map();
    for (let i = 0; i < uris.length; i += READ_BATCH) {
      const batch = await Promise.all(uris.slice(i, i + READ_BATCH).map((uri) => this.readDefinition(uri)));
      for (const definition of batch) {
        const key = definition?.name.toLowerCase();
        if (definition && key !== undefined && !map.has(key)) {
          map.set(key, definition.members);
        }
      }
    }
    return map;
  }
}
