import { HEAD_LINE } from '../layout/nodes';
import type { SceneItem } from '../layout/scene';
import type { BlockModel, InterfaceMember, NetworkModel } from '../model/types';
import { createCollector, type AddHit, type ObjectHits } from './hits';
import type { Matcher } from './matcher';

export type { ObjectHits, SearchField, SearchHit } from './hits';

type TextItem = Extract<SceneItem, { t: 'text' }>;

/** The rows `[0]`, `[1]`, ... that the models add for the elements of an array. */
const ELEMENT_ROW = /^\[.*\]$/;

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
  const { add, result } = createCollector(matcher, maxHits);
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
  return result(model.kind, model.name);
}
