import type { Fold, Region } from '../model/types';

const KEYWORD = /\b(END_IF|END_CASE|END_FOR|END_WHILE|END_REPEAT|END_REGION|IF|CASE|FOR|WHILE|REPEAT|REGION)\b/gi;
const CLOSES: Record<string, string> = {
  END_IF: 'IF',
  END_CASE: 'CASE',
  END_FOR: 'FOR',
  END_WHILE: 'WHILE',
  END_REPEAT: 'REPEAT',
  END_REGION: 'REGION',
};
const MAX_LINES = 200_000;
/** Bounds for hostile input: nesting depth and the number of reported regions and folds. */
const MAX_OPEN = 256;
const MAX_REGIONS = 5_000;
const MAX_FOLDS = 20_000;

export interface ScannedLine {
  /** The line with comments and string literals replaced by blanks. */
  clean: string;
  /** True when the line ends inside an open `(* ... *)` comment. */
  inBlockComment: boolean;
}

/** End (exclusive) of the string or name that starts at `start`; `$` escapes a character in `'strings'`. */
function stringEnd(line: string, start: number): number {
  const quote = line[start];
  for (let i = start + 1; i < line.length; i++) {
    if (line[i] === '$' && quote === "'") {
      i++;
    } else if (line[i] === quote) {
      return i + 1;
    }
  }
  return line.length;
}

/** Blanks out comments, `'strings'` and `"names"` so keywords inside them are never matched. */
export function scanLine(line: string, startsInComment: boolean): ScannedLine {
  let clean = '';
  let inComment = startsInComment;
  let p = 0;
  while (p < line.length) {
    if (inComment) {
      const end = line.indexOf('*)', p);
      const stop = end < 0 ? line.length : end + 2;
      clean += ' '.repeat(stop - p);
      p = stop;
      inComment = end < 0;
      continue;
    }
    const c = line[p] as string;
    if (c === '/' && line[p + 1] === '/') {
      clean += ' '.repeat(line.length - p);
      break;
    }
    if (c === '(' && line[p + 1] === '*') {
      inComment = true;
      clean += '  ';
      p += 2;
    } else if (c === "'" || c === '"') {
      const stop = stringEnd(line, p);
      clean += ' '.repeat(stop - p);
      p = stop;
    } else {
      clean += c;
      p++;
    }
  }
  return { clean, inBlockComment: inComment };
}

const regionName = (line: string): string =>
  line.replace(/^\s*REGION\b/i, '').replace(/\/\/.*$/, '').trim();

/**
 * Finds the REGION outline and the foldable ranges (IF/CASE/FOR/WHILE/REPEAT/REGION blocks and
 * multi-line comments) of SCL code. Line numbers are 1-based. Unbalanced blocks are ignored.
 */
export function analyzeStructure(lines: readonly string[]): { regions: Region[]; folds: Fold[] } {
  const regions: Region[] = [];
  const folds: Fold[] = [];
  const open: Array<{ kind: string; line: number }> = [];
  let commentStart = 0;
  let inComment = false;
  let regionDepth = 0;

  for (let i = 0; i < Math.min(lines.length, MAX_LINES); i++) {
    const line = lines[i] as string;
    const lineNo = i + 1;
    const wasInComment = inComment;
    const scanned = scanLine(line, inComment);
    inComment = scanned.inBlockComment;
    if (!wasInComment && inComment) {
      commentStart = lineNo;
    } else if (wasInComment && !inComment && lineNo > commentStart && folds.length < MAX_FOLDS) {
      folds.push({ from: commentStart, to: lineNo });
    }
    for (const match of scanned.clean.matchAll(KEYWORD)) {
      const word = (match[1] as string).toUpperCase();
      const opens = CLOSES[word];
      if (opens === undefined) {
        if (open.length >= MAX_OPEN) {
          continue;
        }
        if (word === 'REGION') {
          if (regions.length < MAX_REGIONS) {
            regions.push({ name: regionName(line), line: lineNo, depth: regionDepth });
          }
          regionDepth++;
        }
        open.push({ kind: word, line: lineNo });
        continue;
      }
      const at = open.map((o) => o.kind).lastIndexOf(opens);
      if (at >= 0) {
        const closed = open.splice(at);
        regionDepth -= closed.filter((o) => o.kind === 'REGION').length;
        const opener = closed[0];
        if (opener && lineNo > opener.line && folds.length < MAX_FOLDS) {
          folds.push({ from: opener.line, to: lineNo });
        }
      }
    }
  }
  folds.sort((a, b) => a.from - b.from || b.to - a.to);
  return { regions, folds };
}
