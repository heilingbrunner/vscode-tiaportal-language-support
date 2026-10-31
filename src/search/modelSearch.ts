import { HEAD_LINE } from '../layout/nodes';
import type { SceneItem } from '../layout/scene';
import type { BlockKind, BlockModel, InterfaceMember, NetworkModel } from '../model/types';
import type { Matcher, Range } from './matcher';

/** What a hit was found in; these are the properties TIA lets you limit a search to. */
export type SearchField = 'name' | 'author' | 'comment' | 'interface' | 'code';

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
  kind: BlockKind;
  name: string;
  /** The first hits, at most the limit that was asked for. */
  hits: SearchHit[];
  /** All hits in the object, also those beyond the limit. */
  total: number;
}

type TextItem = Extract<SceneItem, { t: 'text' }>;
type AddHit = (field: SearchField, path: string, source: string) => void;

const SNIPPET_MAX = 200;
const SNIPPET_LEAD = 50;
const ELLIPSIS = '…';
/** The rows `[0]`, `[1]`, ... that the models add for the elements of an array. */
const ELEMENT_ROW = /^\[.*\]$/;

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

const memberPath = (parent: string, name: string): string =>
  parent === '' ? name : ELEMENT_ROW.test(name) ? `${parent}${name}` : `${parent}.${name}`;

/**
 * Searches the interface. Array element rows and the members below the later elements of a struct array repeat
 * the declaration, so only their start values (which the source may set per element) are searched. Type defaults
 * that TIA shows greyed are not part of the source either.
 */
function searchMembers(
  members: InterfaceMember[],
  root: string,
  parent: string,
  declared: boolean,
  valueLabel: string,
  add: AddHit,
): void {
  members.forEach((member, index) => {
    const isElement = ELEMENT_ROW.test(member.name);
    const path = memberPath(parent, member.name);
    const where = (what: string): string => `${root}${path}\\${what}`;
    if (declared && !isElement) {
      add('interface', where('Name'), member.name);
      add('interface', where('Data type'), member.datatype);
      add('comment', where('Comment'), member.comment);
    }
    if (!member.startIsDefault) {
      add('interface', where(valueLabel), member.startValue);
    }
    const childrenDeclared = isElement ? declared && index === 0 : declared;
    searchMembers(member.children, root, path, childrenDeclared, valueLabel, add);
  });
}

/**
 * The texts of a LAD diagram that stand for source: operands, the instance or operand above a box and the name of a
 * called block. Operands of contacts and coils are wrapped over several lines, which are joined again here.
 */
function ladTexts(items: SceneItem[]): string[] {
  const texts: string[] = [];
  let previous: TextItem | undefined;
  for (const item of items) {
    if (item.t !== 'text') {
      continue;
    }
    const wanted = item.cls === 'operand' || item.cls === 'head' || (item.cls === 'title' && item.s.startsWith('"'));
    if (!wanted) {
      continue;
    }
    const continuesOperand =
      previous?.cls === 'operand' &&
      item.cls === 'operand' &&
      previous.anchor === 'middle' &&
      item.anchor === 'middle' &&
      previous.x === item.x &&
      Math.abs(item.y - previous.y - HEAD_LINE) < 0.5;
    if (continuesOperand) {
      texts[texts.length - 1] += item.s;
    } else {
      texts.push(item.s);
    }
    previous = item;
  }
  return texts;
}

function searchNetwork(network: NetworkModel, add: AddHit): void {
  const where = `Network ${network.index}`;
  add('comment', `${where}\\Title`, network.title);
  add('comment', `${where}\\Comment`, network.comment);
  const { body } = network;
  if (body.kind === 'lad') {
    for (const text of new Set(ladTexts(body.scene.items))) {
      add('code', `${where}\\Program code`, text);
    }
  } else if (body.kind === 'code' || (body.kind === 'text' && body.language !== 'error')) {
    body.lines.forEach((line, i) => add('code', `${where}\\Program code\\Line ${i + 1}`, line));
  }
}

/**
 * Finds the hits of a matcher in a parsed block, data block or type; undefined when there are none. Only the first
 * `maxHits` hits are kept, so one huge block cannot flood the result list; `total` still counts them all.
 */
export function searchModel(model: BlockModel, matcher: Matcher, maxHits = Infinity): ObjectHits | undefined {
  const hits: SearchHit[] = [];
  let total = 0;
  const add: AddHit = (field, path, source) => {
    const marks = matcher(source);
    if (marks.length === 0) {
      return;
    }
    total++;
    if (hits.length < maxHits) {
      hits.push({ field, path, ...snippet(source, marks) });
    }
  };
  add('name', 'Name', model.name);
  add('author', 'Author', model.dataBlock?.author ?? '');
  add('comment', 'Title', model.title);
  add('comment', 'Comment', model.comment);
  const valueLabel = model.kind === 'DB' ? 'Start value' : 'Default value';
  for (const section of model.sections) {
    const root = section.name === '' ? 'Interface\\' : `Interface\\${section.name}\\`;
    searchMembers(section.members, root, '', true, valueLabel, add);
  }
  model.code?.lines.forEach((line, i) => add('code', `Program code\\Line ${i + 1}`, line));
  model.networks.forEach((network) => searchNetwork(network, add));
  return total > 0 ? { kind: model.kind, name: model.name, hits, total } : undefined;
}
