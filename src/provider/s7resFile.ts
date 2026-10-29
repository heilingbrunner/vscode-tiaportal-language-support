import * as vscode from 'vscode';
import { parseS7res, type TextTable } from '../parser/s7res';

const MAX_RES_BYTES = 20 * 1024 * 1024;

/**
 * The file next to `uri` (same folder, same name) with another extension. A `git:` revision keeps the path of its
 * file in the query, which the git file system reads instead of the uri path, so both are swapped.
 */
function siblingUri(uri: vscode.Uri, extension: RegExp, replacement: string): vscode.Uri {
  const swap = (path: string): string => path.replace(extension, replacement);
  if (uri.scheme === 'git') {
    try {
      const query = JSON.parse(uri.query) as Record<string, unknown>;
      if (typeof query.path === 'string') {
        return uri.with({ path: swap(uri.path), query: JSON.stringify({ ...query, path: swap(query.path) }) });
      }
    } catch {
      // not the query shape of the git extension: fall back to swapping the uri path only
    }
  }
  return uri.with({ path: swap(uri.path) });
}

/** The `.s7res` next to a `.s7dcl`. */
export const s7resUriOf = (uri: vscode.Uri): vscode.Uri => siblingUri(uri, /\.s7dcl$/i, '.s7res');

/** The `.s7dcl` next to a `.s7res`. */
export const s7dclUriOf = (uri: vscode.Uri): vscode.Uri => siblingUri(uri, /\.s7res$/i, '.s7dcl');

/** Texts of the `.s7res` that belongs to a `.s7dcl`; undefined when there is none (blocks without texts have no file). */
export async function readS7res(uri: vscode.Uri, culture: string): Promise<TextTable | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(s7resUriOf(uri));
    return bytes.byteLength > MAX_RES_BYTES ? undefined : parseS7res(new TextDecoder('utf-8').decode(bytes), culture);
  } catch {
    return undefined;
  }
}
