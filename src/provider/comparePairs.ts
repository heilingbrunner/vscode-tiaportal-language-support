import * as vscode from 'vscode';

export type CompareSide = 'old' | 'new';

/** The working copy a `git:` revision uri belongs to (VS Code encodes `{ path, ref }` in the query), if any. */
export function gitSourceFile(uri: vscode.Uri): vscode.Uri | undefined {
  if (uri.scheme !== 'git') {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(uri.query);
    const path = typeof parsed === 'object' && parsed !== null ? (parsed as { path?: unknown }).path : undefined;
    return typeof path === 'string' && path !== '' ? vscode.Uri.file(path) : undefined;
  } catch {
    return undefined;
  }
}

/** The other half of a version comparison, as seen from one of the two files. */
export interface ComparePeer {
  readonly other: vscode.Uri;
  readonly side: CompareSide;
}

/**
 * Remembers which two files are currently compared (previous Git version = `old`, current file = `new`),
 * so each viewer knows its counterpart and can mark the differences.
 */
export class ComparePairs implements vscode.Disposable {
  private readonly peers = new Map<string, ComparePeer>();
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();

  /** Fires with the uri of every file whose comparison started or ended. */
  readonly onDidChange = this.changed.event;

  pair(oldUri: vscode.Uri, newUri: vscode.Uri): void {
    this.peers.set(oldUri.toString(), { other: newUri, side: 'old' });
    this.peers.set(newUri.toString(), { other: oldUri, side: 'new' });
    this.changed.fire(oldUri);
    this.changed.fire(newUri);
  }

  get(uri: vscode.Uri): ComparePeer | undefined {
    return this.peers.get(uri.toString());
  }

  /** Ends the comparison `uri` takes part in, for example because one of its viewers was closed. */
  release(uri: vscode.Uri): void {
    const peer = this.get(uri);
    if (!peer) {
      return;
    }
    this.peers.delete(uri.toString());
    this.peers.delete(peer.other.toString());
    this.changed.fire(uri);
    this.changed.fire(peer.other);
  }

  dispose(): void {
    this.changed.dispose();
  }
}
