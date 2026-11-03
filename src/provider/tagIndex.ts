import * as vscode from 'vscode';
import { buildAddressResolver, type AddressResolver } from '../parser/tagAddresses';
import { isTagTableSource, parseTagTable, type TagTable } from '../parser/tagTableParser';

const MAX_FILES = 5000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const READ_BATCH = 16;
/** File events (a `git checkout` touches many files) are coalesced into one rebuild. */
const DEBOUNCE_MS = 250;

/** Workspace index of the PLC tag tables (Openness XML), used for the absolute addresses next to operands. */
export class TagIndex implements vscode.Disposable {
  private loading: Promise<AddressResolver> | undefined;
  /** The XML files that turned out to be tag tables: only a change of one of them (or a new XML) invalidates the index. */
  private tableFiles = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];

  readonly onDidChange = this.changed.event;

  constructor() {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.xml');
    const invalidate = (uri: vscode.Uri, isNew: boolean): void => {
      if (!isNew && !this.tableFiles.has(uri.toString())) {
        return;
      }
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.loading = undefined;
        this.changed.fire();
      }, DEBOUNCE_MS);
    };
    this.disposables.push(
      watcher,
      watcher.onDidChange((uri) => invalidate(uri, false)),
      watcher.onDidDelete((uri) => invalidate(uri, false)),
      watcher.onDidCreate((uri) => invalidate(uri, true)),
      this.changed,
    );
  }

  async resolver(): Promise<AddressResolver> {
    this.loading ??= this.build().catch(() => {
      // do not cache a failed scan: the next render tries again, and operands stay without address meanwhile
      this.loading = undefined;
      return () => undefined;
    });
    return this.loading;
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.disposables.forEach((d) => d.dispose());
  }

  private async readTable(uri: vscode.Uri): Promise<TagTable | undefined> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.byteLength > MAX_FILE_BYTES) {
        return undefined;
      }
      const text = new TextDecoder('utf-8').decode(bytes);
      // block exports share the extension: only a tag table counts
      return isTagTableSource(text) ? parseTagTable(text, '') : undefined;
    } catch {
      // an unreadable or malformed table only means its tags stay without address
      return undefined;
    }
  }

  private async build(): Promise<AddressResolver> {
    const uris = await vscode.workspace.findFiles('**/*.xml', '**/node_modules/**', MAX_FILES);
    // sorted so that a tag defined twice resolves the same way every time (first path wins)
    uris.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
    const tables: TagTable[] = [];
    const files = new Set<string>();
    for (let i = 0; i < uris.length; i += READ_BATCH) {
      const batch = uris.slice(i, i + READ_BATCH);
      const parsed = await Promise.all(batch.map((uri) => this.readTable(uri)));
      parsed.forEach((table, j) => {
        if (table) {
          tables.push(table);
          files.add((batch[j] as vscode.Uri).toString());
        }
      });
    }
    this.tableFiles = files;
    return buildAddressResolver(tables);
  }
}
