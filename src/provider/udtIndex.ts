import * as vscode from 'vscode';
import type { RawMember } from '../parser/declParser';
import type { UdtResolver } from '../parser/memberBuilder';
import { parseS7dclUdt, s7dclBlockKeyword } from '../parser/s7dclParser';
import { parseUdt, type UdtDefinition } from '../parser/udtParser';
import { readS7res } from './s7resFile';

const MAX_FILES = 5000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const READ_BATCH = 16;
/** File events (a `git checkout` touches many files) are coalesced into one rebuild. */
const DEBOUNCE_MS = 250;

type UdtMap = Map<string, RawMember[]>;

/** `.udt` and `.s7dcl` sources (and the `.s7res` texts of the latter) that can define a type. */
const TYPE_FILES = '**/*.{udt,s7dcl,s7res}';

/** Workspace index of `*.udt` and `*.s7dcl` type sources, loaded lazily and rebuilt when one of them changes. */
export class UdtIndex implements vscode.Disposable {
  private loading: Promise<UdtMap> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];

  readonly onDidChange = this.changed.event;

  constructor() {
    const watcher = vscode.workspace.createFileSystemWatcher(TYPE_FILES);
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
      if (bytes.byteLength > MAX_FILE_BYTES) {
        return undefined;
      }
      const text = new TextDecoder('utf-8').decode(bytes);
      if (!uri.path.toLowerCase().endsWith('.s7dcl')) {
        return parseUdt(text);
      }
      // data blocks and code blocks share the extension: only types define one
      if (s7dclBlockKeyword(text) !== 'TYPE') {
        return undefined;
      }
      const culture = vscode.workspace.getConfiguration('tiaViewer').get<string>('culture', '');
      return parseS7dclUdt(text, await readS7res(uri, culture));
    } catch {
      // an unreadable or malformed UDT only means that type stays unresolved
      return undefined;
    }
  }

  private async build(): Promise<UdtMap> {
    const uris = await vscode.workspace.findFiles('**/*.{udt,s7dcl}', '**/node_modules/**', MAX_FILES);
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
