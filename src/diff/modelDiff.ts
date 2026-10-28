import type { LadScene, SceneItem } from '../layout/scene';
import type { DiffMark, LineMarks } from '../model/diff';
import type { BlockModel, InterfaceMember, InterfaceSection, NetworkBody, NetworkModel } from '../model/types';
import { alignSequences } from './align';

const OLD: DiffMark = 'del';
const NEW: DiffMark = 'add';

export interface DiffedModels {
  oldModel: BlockModel;
  newModel: BlockModel;
}

/** Both-sided result of comparing one part: the marked old and new part, and whether they differ. */
interface Pair<T> {
  old: T;
  new: T;
  changed: boolean;
}

/** Compares two versions of a block and returns copies whose differing parts carry red (`del`) / green (`add`) marks. */
export function diffModels(oldModel: BlockModel, newModel: BlockModel): DiffedModels {
  const sections = diffSections(oldModel.sections, newModel.sections);
  const networks = diffNetworks(oldModel.networks, newModel.networks);
  const title = oldModel.title !== newModel.title;
  const comment = oldModel.comment !== newModel.comment;
  const code = oldModel.code && newModel.code ? diffCode(oldModel.code.lines, newModel.code.lines) : undefined;
  return {
    oldModel: {
      ...oldModel,
      sections: sections.old,
      networks: networks.old,
      ...(title ? { titleDiff: OLD } : {}),
      ...(comment ? { commentDiff: OLD } : {}),
      ...(oldModel.code && code ? { code: { ...oldModel.code, lineMarks: code.old } } : {}),
    },
    newModel: {
      ...newModel,
      sections: sections.new,
      networks: networks.new,
      ...(title ? { titleDiff: NEW } : {}),
      ...(comment ? { commentDiff: NEW } : {}),
      ...(newModel.code && code ? { code: { ...newModel.code, lineMarks: code.new } } : {}),
    },
  };
}

// ---------------------------------------------------------------------------------------------- interface

const MEMBER_FIELDS: ReadonlyArray<readonly [string, (m: InterfaceMember) => unknown]> = [
  ['datatype', (m) => m.datatype],
  ['start', (m) => m.startValue],
  ['retain', (m) => `${m.retain}|${m.retainChecked ?? ''}`],
  ['accessible', (m) => m.accessible],
  ['writable', (m) => m.writable],
  ['visible', (m) => m.visible],
  ['setpoint', (m) => m.setpoint],
  ['comment', (m) => m.comment],
];

const changedFields = (a: InterfaceMember, b: InterfaceMember): string[] =>
  MEMBER_FIELDS.filter(([, get]) => get(a) !== get(b)).map(([name]) => name);

function markMember(member: InterfaceMember, mark: DiffMark): InterfaceMember {
  return { ...member, diff: { mark }, children: member.children.map((c) => markMember(c, mark)) };
}

/** Members are matched by name (the n-th member of a name with the n-th of the same name). */
function diffMembers(oldList: InterfaceMember[], newList: InterfaceMember[]): Pair<InterfaceMember[]> {
  const candidates = new Map<string, number[]>();
  newList.forEach((m, j) => candidates.set(m.name, [...(candidates.get(m.name) ?? []), j]));
  const newOut = newList.map((m) => markMember(m, NEW));
  const matchedNew = new Set<number>();
  let changed = false;
  const oldOut = oldList.map((member) => {
    const j = candidates.get(member.name)?.shift();
    const partner = j === undefined ? undefined : newList[j];
    if (j === undefined || !partner) {
      changed = true;
      return markMember(member, OLD);
    }
    matchedNew.add(j);
    const fields = changedFields(member, partner);
    const children = diffMembers(member.children, partner.children);
    changed ||= fields.length > 0 || children.changed;
    newOut[j] = {
      ...partner,
      children: children.new,
      ...(fields.length > 0 ? { diff: { mark: NEW, fields } } : {}),
      ...(children.changed ? { diffInside: NEW } : {}),
    };
    return {
      ...member,
      children: children.old,
      ...(fields.length > 0 ? { diff: { mark: OLD, fields } } : {}),
      ...(children.changed ? { diffInside: OLD } : {}),
    };
  });
  changed ||= matchedNew.size < newList.length;
  return { old: oldOut, new: newOut, changed };
}

function markSection(section: InterfaceSection, mark: DiffMark): InterfaceSection {
  return { ...section, diffInside: mark, members: section.members.map((m) => markMember(m, mark)) };
}

function diffSections(oldList: InterfaceSection[], newList: InterfaceSection[]): Pair<InterfaceSection[]> {
  const newByName = new Map(newList.map((s) => [s.name, s] as const));
  const oldNames = new Set(oldList.map((s) => s.name));
  const newOut = new Map<string, InterfaceSection>();
  let changed = false;
  const oldOut = oldList.map((section) => {
    const partner = newByName.get(section.name);
    if (!partner) {
      changed = true;
      return markSection(section, OLD);
    }
    const members = diffMembers(section.members, partner.members);
    changed ||= members.changed;
    newOut.set(section.name, { ...partner, members: members.new, ...(members.changed ? { diffInside: NEW } : {}) });
    return { ...section, members: members.old, ...(members.changed ? { diffInside: OLD } : {}) };
  });
  const newResult = newList.map((section) => {
    if (!oldNames.has(section.name)) {
      changed = true;
      return markSection(section, NEW);
    }
    return newOut.get(section.name) ?? section;
  });
  return { old: oldOut, new: newResult, changed };
}

// ------------------------------------------------------------------------------------------------- code

const trimEnd = (line: string): string => line.trimEnd();

function diffCode(oldLines: readonly string[], newLines: readonly string[]): Pair<LineMarks> {
  const oldMarks: Array<DiffMark | undefined> = oldLines.map(() => OLD);
  const newMarks: Array<DiffMark | undefined> = newLines.map(() => NEW);
  for (const [i, j] of alignSequences(oldLines.map(trimEnd), newLines.map(trimEnd))) {
    oldMarks[i] = undefined;
    newMarks[j] = undefined;
  }
  return { old: oldMarks, new: newMarks, changed: oldMarks.some(Boolean) || newMarks.some(Boolean) };
}

// ---------------------------------------------------------------------------------------------- networks

const signature = (n: NetworkModel): string => JSON.stringify([n.title, n.comment, n.body]);

/**
 * Networks are aligned on their full content; networks between two identical ones are paired in order
 * (changed), and leftovers are removed (old) or added (new).
 */
function diffNetworks(oldList: NetworkModel[], newList: NetworkModel[]): Pair<NetworkModel[]> {
  const anchors = alignSequences(oldList.map(signature), newList.map(signature));
  const oldOut = [...oldList];
  const newOut = [...newList];
  let changed = false;
  let oi = 0;
  let ni = 0;
  for (const [ao, an] of [...anchors, [oldList.length, newList.length] as [number, number]]) {
    const gap = Math.max(ao - oi, an - ni);
    for (let k = 0; k < gap; k++) {
      const o = oi + k < ao ? oldList[oi + k] : undefined;
      const n = ni + k < an ? newList[ni + k] : undefined;
      if (o && n) {
        const result = diffNetwork(o, n);
        oldOut[oi + k] = result.old;
        newOut[ni + k] = result.new;
        changed ||= result.changed;
      } else if (o) {
        oldOut[oi + k] = markNetwork(o, OLD);
        changed = true;
      } else if (n) {
        newOut[ni + k] = markNetwork(n, NEW);
        changed = true;
      }
    }
    oi = ao + 1;
    ni = an + 1;
  }
  return { old: oldOut, new: newOut, changed };
}

function markNetwork(network: NetworkModel, mark: DiffMark): NetworkModel {
  const { body } = network;
  const lines = (count: number): LineMarks => Array.from({ length: count }, () => mark);
  let marked: NetworkBody = body;
  if (body.kind === 'lad') {
    marked = { ...body, scene: { ...body.scene, items: body.scene.items.map((i) => (isRail(i) ? i : { ...i, diff: mark })) } };
  } else if (body.kind === 'code' || body.kind === 'text') {
    marked = { ...body, lineMarks: lines(body.lines.length) };
  }
  return { ...network, body: marked, diff: mark };
}

function diffNetwork(o: NetworkModel, n: NetworkModel): Pair<NetworkModel> {
  const body = diffBody(o.body, n.body);
  const title = o.title !== n.title;
  const comment = o.comment !== n.comment;
  const changed = body.changed || title || comment;
  if (!changed) {
    return { old: o, new: n, changed };
  }
  return {
    old: { ...o, body: body.old, diff: OLD, ...(title ? { titleDiff: OLD } : {}), ...(comment ? { commentDiff: OLD } : {}) },
    new: { ...n, body: body.new, diff: NEW, ...(title ? { titleDiff: NEW } : {}), ...(comment ? { commentDiff: NEW } : {}) },
    changed,
  };
}

function diffBody(o: NetworkBody, n: NetworkBody): Pair<NetworkBody> {
  if (o.kind === 'lad' && n.kind === 'lad') {
    const scenes = diffScenes(o.scene, n.scene);
    return { old: { ...o, scene: scenes.old }, new: { ...n, scene: scenes.new }, changed: scenes.changed };
  }
  if ((o.kind === 'code' && n.kind === 'code') || (o.kind === 'text' && n.kind === 'text')) {
    const lines = diffCode(o.lines, n.lines);
    return { old: { ...o, lineMarks: lines.old }, new: { ...n, lineMarks: lines.new }, changed: lines.changed };
  }
  return { old: o, new: n, changed: o.kind !== n.kind };
}

// ------------------------------------------------------------------------------------------------ LAD scene

const isRail = (item: SceneItem): boolean => item.t === 'line' && item.cls === 'rail';

const relativePoints = (pts: ReadonlyArray<readonly [number, number]>): string => {
  const [x0, y0] = pts[0] ?? [0, 0];
  return pts.map(([x, y]) => `${x - x0},${y - y0}`).join(';');
};

/** Key including the position: an item that stayed where it was. */
function exactKey(item: SceneItem): string {
  switch (item.t) {
    case 'line':
      return `l|${item.cls}|${item.pts.join(';')}`;
    case 'text':
      return `t|${item.x}|${item.y}|${item.cls}|${item.anchor}|${item.s}`;
    case 'box':
      return `b|${item.x}|${item.y}|${item.w}|${item.h}|${item.headH}`;
    case 'contact':
      return `c|${item.cx}|${item.y}|${item.negated}|${item.edge}`;
    case 'coil':
      return `k|${item.cx}|${item.y}|${item.mark}`;
    case 'bubble':
      return `o|${item.x}|${item.y}`;
  }
}

/** Key without the position: an item that only moved because the layout around it changed. */
function looseKey(item: SceneItem): string {
  switch (item.t) {
    case 'line':
      return `l|${item.cls}|${relativePoints(item.pts)}`;
    case 'text':
      return `t|${item.cls}|${item.anchor}|${item.s}`;
    case 'box':
      return `b|${item.w}|${item.h}|${item.headH}`;
    case 'contact':
      return `c|${item.negated}|${item.edge}`;
    case 'coil':
      return `k|${item.mark}`;
    case 'bubble':
      return 'o';
  }
}

/** Pairs indices with equal keys and returns the indices left over on each side. */
function matchBy(
  oldIdx: number[],
  newIdx: number[],
  oldKey: (i: number) => string,
  newKey: (j: number) => string,
): { oldLeft: number[]; newLeft: number[] } {
  const pool = new Map<string, number[]>();
  for (const j of newIdx) {
    const key = newKey(j);
    pool.set(key, [...(pool.get(key) ?? []), j]);
  }
  const used = new Set<number>();
  const oldLeft: number[] = [];
  for (const i of oldIdx) {
    const j = pool.get(oldKey(i))?.shift();
    if (j === undefined) {
      oldLeft.push(i);
    } else {
      used.add(j);
    }
  }
  return { oldLeft, newLeft: newIdx.filter((j) => !used.has(j)) };
}

/** Marks the drawn elements that exist in only one version. Rails are layout, not content, and never marked. */
function diffScenes(o: LadScene, n: LadScene): Pair<LadScene> {
  const all = (items: SceneItem[]): number[] => items.flatMap((item, i) => (isRail(item) ? [] : [i]));
  const exact = matchBy(all(o.items), all(n.items), (i) => exactKey(o.items[i]!), (j) => exactKey(n.items[j]!));
  const loose = matchBy(exact.oldLeft, exact.newLeft, (i) => looseKey(o.items[i]!), (j) => looseKey(n.items[j]!));
  const oldMarked = new Set(loose.oldLeft);
  const newMarked = new Set(loose.newLeft);
  const mark = (items: SceneItem[], marked: Set<number>, diff: DiffMark): SceneItem[] =>
    items.map((item, i) => (marked.has(i) ? { ...item, diff } : item));
  return {
    old: { ...o, items: mark(o.items, oldMarked, OLD) },
    new: { ...n, items: mark(n.items, newMarked, NEW) },
    changed: oldMarked.size > 0 || newMarked.size > 0,
  };
}
