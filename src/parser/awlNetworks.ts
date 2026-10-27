import type { NetworkModel } from '../model/types';

const NETWORK_LINE = /^\s*NETWORK\b/i;
const TITLE_LINE = /^\s*TITLE\s*=(.*)$/i;
const LINE_COMMENT = /^\s*\/\/ ?(.*)$/;
const BLOCK_COMMENT = /^\s*\(\*\s?(.*?)\s?\*\)\s*$/;
const MAX_NETWORKS = 5_000;

const isBlank = (line: string): boolean => line.trim() === '';

function trimBlankLines(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && isBlank(lines[start] as string)) {
    start++;
  }
  while (end > start && isBlank(lines[end - 1] as string)) {
    end--;
  }
  return lines.slice(start, end);
}

/** One network: `TITLE = ...`, the comment lines directly below it, then the instructions. */
function buildNetwork(index: number, raw: readonly string[]): NetworkModel {
  const lines = trimBlankLines(raw);
  let title = '';
  const titleMatch = lines[0] === undefined ? null : TITLE_LINE.exec(lines[0]);
  if (titleMatch) {
    title = (titleMatch[1] ?? '').trim();
    lines.shift();
  }
  const comment: string[] = [];
  while (lines.length > 0) {
    const match = LINE_COMMENT.exec(lines[0] as string) ?? BLOCK_COMMENT.exec(lines[0] as string);
    if (!match) {
      break;
    }
    comment.push(match[1] ?? '');
    lines.shift();
  }
  const code = trimBlankLines(lines);
  return {
    index,
    title,
    comment: comment.join('\n'),
    language: 'STL',
    body: code.length > 0 ? { kind: 'code', language: 'STL', lines: code } : { kind: 'empty' },
  };
}

/** Splits STL code (the part after `BEGIN`) at its `NETWORK` lines. */
export function splitNetworks(codeLines: readonly string[]): NetworkModel[] {
  const groups: string[][] = [];
  let implicitFirst = false;
  for (const line of codeLines) {
    if (NETWORK_LINE.test(line)) {
      groups.push([]);
      continue;
    }
    if (groups.length === 0) {
      // instructions before the first NETWORK keyword still form a network
      groups.push([]);
      implicitFirst = true;
    }
    (groups[groups.length - 1] as string[]).push(line);
  }
  if (implicitFirst && groups[0]?.every(isBlank)) {
    groups.shift();
  }
  return groups.slice(0, MAX_NETWORKS).map((lines, i) => buildNetwork(i + 1, lines));
}
