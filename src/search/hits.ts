import type { BlockKind } from '../model/types';
import type { Matcher, Range } from './matcher';

/**
 * What a hit was found in. Name, author, comment, interface and code are the parts of blocks and types; tag and
 * constant are the parts of a tag table. These are the areas TIA lets you limit a search to.
 */
export type SearchField = 'name' | 'author' | 'comment' | 'interface' | 'code' | 'tag' | 'constant';

/** The kind of object a result row stands for: a block, data block or type, or a PLC tag table. */
export type SearchKind = BlockKind | 'TAGS';

export interface SearchHit {
  field: SearchField;
  /** Where the hit is, in the style of TIA's result paths: `Interface\Input\Ib_Start\Name`. */
  path: string;
  /** The text around the match, trimmed and shortened. */
  text: string;
  /** The matched parts of `text`. */
  marks: Range[];
}

export interface ObjectHits {
  kind: SearchKind;
  name: string;
  /** The first hits, at most the limit that was asked for. */
  hits: SearchHit[];
  /** All hits in the object, also those beyond the limit. */
  total: number;
}

/** Offers a text for matching: a hit is recorded when it contains the term. */
export type AddHit = (field: SearchField, path: string, source: string) => void;

const SNIPPET_MAX = 200;
const SNIPPET_LEAD = 50;
const ELLIPSIS = '…';

/**
 * Makes a hit text fit one result line: line breaks and tabs become spaces (one for one, so the marks stay where
 * they are), the text is trimmed and a long one is cut down to a window around its first match.
 */
function snippet(source: string, marks: Range[]): { text: string; marks: Range[] } {
  const flat = source.replace(/[\r\n\t]/g, ' ');
  const lead = flat.length - flat.trimStart().length;
  const text = flat.trim();
  const shifted = marks.map(([from, to]): Range => [from - lead, to - lead]);
  if (text.length <= SNIPPET_MAX) {
    return { text, marks: shifted };
  }
  const start = Math.max(0, shifted[0][0] - SNIPPET_LEAD);
  const end = Math.min(text.length, start + SNIPPET_MAX);
  const head = start > 0 ? ELLIPSIS : '';
  const tail = end < text.length ? ELLIPSIS : '';
  const clipped = shifted
    .filter(([from]) => from < end)
    .map(([from, to]): Range => [Math.max(from, start) - start + head.length, Math.min(to, end) - start + head.length]);
  return { text: head + text.slice(start, end) + tail, marks: clipped };
}

export interface HitCollector {
  add: AddHit;
  /** The collected hits as an object result; undefined when nothing matched. */
  result(kind: SearchKind, name: string): ObjectHits | undefined;
}

/**
 * Collects the hits of one object. Only the first `maxHits` are kept, so one huge block cannot flood the result
 * list; `total` still counts them all.
 */
export function createCollector(matcher: Matcher, maxHits: number): HitCollector {
  const hits: SearchHit[] = [];
  let total = 0;
  return {
    add: (field, path, source) => {
      const marks = matcher(source);
      if (marks.length === 0) {
        return;
      }
      total++;
      if (hits.length < maxHits) {
        hits.push({ field, path, ...snippet(source, marks) });
      }
    },
    result: (kind, name) => (total > 0 ? { kind, name, hits, total } : undefined),
  };
}
