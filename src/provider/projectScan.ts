import * as vscode from 'vscode';
import type { BlockModel } from '../model/types';
import { parseBlock } from '../parser/blockParser';
import { parseDataBlock } from '../parser/dbParser';
import { parseS7dclModel } from '../parser/s7dclParser';
import type { TextTable } from '../parser/s7res';
import { parseAwl, parseScl } from '../parser/sclParser';
import { isTagTableSource, parseTagTable } from '../parser/tagTableParser';
import { parseUdtModel } from '../parser/udtParser';
import type { ObjectHits, SearchHit, SearchKind } from '../search/hits';
import { compileMatcher, type Matcher } from '../search/matcher';
import { searchModel } from '../search/modelSearch';
import { longestWordRun, mayContain } from '../search/prefilter';
import { displayPath } from '../search/resultPath';
import { searchTagTable } from '../search/tagSearch';
import { readS7res } from './s7resFile';

/** One object (block, data block, type or tag table) with its hits, as it is sent to the search view. */
export interface FoundObject {
  uri: string;
  kind: SearchKind;
  name: string;
  path: string;
  /** The first hits of the object. */
  hits: SearchHit[];
  /** All hits of the object, also those beyond the first `MAX_HITS_PER_OBJECT`. */
  total: number;
}

/** Where a running scan reports to. */
export interface ScanSink {
  found(objects: FoundObject[]): void;
  progress(scanned: number, total: number): void;
}

export interface ScanSummary {
  /** Source files looked at. */
  files: number;
  objects: number;
  matches: number;
  /** Files that could not be read or parsed. */
  failed: number;
  /** The search stopped at a limit (file count or object count) before it was through. */
  truncated: boolean;
}

const SOURCE_EXTENSIONS = ['.xml', '.db', '.udt', '.scl', '.awl', '.stl', '.s7dcl'];
const SKIPPED_FOLDERS = new Set(['.git', 'node_modules']);
const MAX_FILES = 20000;
const MAX_FOLDERS = 20000;
const MAX_OBJECTS = 5000;
/** A block with thousands of matching lines must not flood the result list. */
const MAX_HITS_PER_OBJECT = 500;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const BATCH = 8;

const EMPTY_SUMMARY: ScanSummary = { files: 0, objects: 0, matches: 0, failed: 0, truncated: false };

interface FileScan {
  folder: vscode.Uri;
  matcher: Matcher;
  /** Longest word run of the term, to skip files that cannot match without parsing them. */
  run: string;
  culture: string;
}

/** A found object, a file that failed, or nothing for a file without hits. */
type FileOutcome = FoundObject | 'failed' | undefined;

const hasExtension = (name: string, extension: string): boolean => name.toLowerCase().endsWith(extension);

/** All source files below a folder, in path order. Symbolic links are not followed, so a link cycle cannot hang the scan. */
async function listSources(folder: vscode.Uri, token: vscode.CancellationToken): Promise<{ uris: vscode.Uri[]; truncated: boolean }> {
  const uris: vscode.Uri[] = [];
  const pending = [folder];
  let truncated = false;
  let folders = 0;
  while (!token.isCancellationRequested) {
    const dir = pending.pop();
    if (!dir) {
      break;
    }
    if (++folders > MAX_FOLDERS) {
      // searching a drive root must end somewhere
      truncated = true;
      break;
    }
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dir);
    } catch {
      // an unreadable folder only means its files are not searched
      continue;
    }
    for (const [name, type] of entries) {
      if (type & vscode.FileType.SymbolicLink) {
        continue;
      }
      if (type & vscode.FileType.Directory) {
        if (!SKIPPED_FOLDERS.has(name)) {
          pending.push(vscode.Uri.joinPath(dir, name));
        }
      } else if (SOURCE_EXTENSIONS.some((extension) => hasExtension(name, extension))) {
        if (uris.length < MAX_FILES) {
          uris.push(vscode.Uri.joinPath(dir, name));
        } else {
          truncated = true;
        }
      }
    }
  }
  uris.sort((a, b) => a.path.localeCompare(b.path));
  return { uris, truncated };
}

/** Parses a source like the viewer does, but without expanding types from other files and without highlighting. */
function parseSource(uri: vscode.Uri, text: string, culture: string, texts: TextTable | undefined): BlockModel | undefined {
  const name = uri.path;
  if (hasExtension(name, '.db')) {
    return parseDataBlock(text);
  }
  if (hasExtension(name, '.udt')) {
    return parseUdtModel(text);
  }
  if (hasExtension(name, '.scl')) {
    return parseScl(text);
  }
  if (hasExtension(name, '.awl') || hasExtension(name, '.stl')) {
    return parseAwl(text);
  }
  if (hasExtension(name, '.s7dcl')) {
    return parseS7dclModel(text, texts);
  }
  return parseBlock(text, culture);
}

/** Searches one source: a PLC tag table export, or a block, data block or type. XML is parsed once, by what it holds. */
function searchSource(uri: vscode.Uri, text: string, scan: FileScan, texts: TextTable | undefined): ObjectHits | undefined {
  if (hasExtension(uri.path, '.xml') && isTagTableSource(text)) {
    const table = parseTagTable(text, scan.culture);
    return table && searchTagTable(table, scan.matcher, MAX_HITS_PER_OBJECT);
  }
  const model = parseSource(uri, text, scan.culture, texts);
  return model && searchModel(model, scan.matcher, MAX_HITS_PER_OBJECT);
}

async function scanFile(uri: vscode.Uri, scan: FileScan): Promise<FileOutcome> {
  try {
    // the size is checked first: a huge file must not be read into memory just to be turned down
    if ((await vscode.workspace.fs.stat(uri)).size > MAX_FILE_BYTES) {
      return 'failed';
    }
    const text = new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri));
    // the titles and comments of an `.s7dcl` live in its `.s7res`
    const texts = hasExtension(uri.path, '.s7dcl') ? await readS7res(uri, scan.culture) : undefined;
    const mayMatch = mayContain(text, scan.run) || (texts !== undefined && [...texts.values()].some((t) => mayContain(t, scan.run)));
    if (!mayMatch) {
      return undefined;
    }
    const result = searchSource(uri, text, scan, texts);
    if (!result) {
      return undefined;
    }
    const fileName = uri.path.slice(uri.path.lastIndexOf('/') + 1);
    return {
      uri: uri.toString(),
      kind: result.kind,
      name: result.name || fileName,
      path: displayPath(scan.folder.path, uri.path),
      hits: result.hits,
      total: result.total,
    };
  } catch {
    // a file that does not parse is counted, not fatal: one broken export must not hide the other hits
    return 'failed';
  }
}

/**
 * Searches all TIA sources below `folder` for `term` and reports the objects found, batch by batch, so the view can
 * show results while the scan runs. Stops early when `token` is cancelled.
 */
export async function scanFolder(
  folder: vscode.Uri,
  term: string,
  exact: boolean,
  token: vscode.CancellationToken,
  sink: ScanSink,
): Promise<ScanSummary> {
  const matcher = compileMatcher(term, exact);
  if (!matcher) {
    return EMPTY_SUMMARY;
  }
  const { uris, truncated } = await listSources(folder, token);
  const scan: FileScan = {
    folder,
    matcher,
    run: longestWordRun(term),
    culture: vscode.workspace.getConfiguration('tiaViewer').get<string>('culture', ''),
  };
  let objects = 0;
  let matches = 0;
  let failed = 0;
  let stoppedAtLimit = truncated;
  for (let at = 0; at < uris.length && !token.isCancellationRequested; at += BATCH) {
    const outcomes = await Promise.all(uris.slice(at, at + BATCH).map((uri) => scanFile(uri, scan)));
    if (token.isCancellationRequested) {
      // a batch that was in flight when the search was cancelled must not report into the next search
      break;
    }
    const found = outcomes.filter((o): o is FoundObject => typeof o === 'object');
    failed += outcomes.filter((o) => o === 'failed').length;
    objects += found.length;
    matches += found.reduce((sum, o) => sum + o.total, 0);
    if (found.length > 0) {
      sink.found(found);
    }
    sink.progress(Math.min(at + BATCH, uris.length), uris.length);
    if (objects >= MAX_OBJECTS) {
      stoppedAtLimit = true;
      break;
    }
  }
  return { files: uris.length, objects, matches, failed, truncated: stoppedAtLimit };
}
