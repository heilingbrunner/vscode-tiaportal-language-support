import type { FlgPart } from '../parser/flgNetParser';
import type { PinState } from './pins';

export const ROW = 24;
export const TITLE_H = 24;
export const HEAD_LINE = 13;
export const CHAR_W = 7;
export const SYM_W = 44;
export const SYM_H = 46;
export const SYM_LINE = 32;
export const OR_W = 20;
export const ACCESS_GAP = 20;
const MIN_BOX_W = 100;
const HIDDEN_PARAMS_H = 10;
/** Upper bound for the `Card` template value, which comes from untrusted XML. */
const MAX_CARD = 64;

export type NodeKind = 'contact' | 'coil' | 'or' | 'box';

export interface PinDesc {
  name: string;
  label: string;
  row: number;
  negated: boolean;
  access: string;
}

export interface LNode {
  part: FlgPart;
  kind: NodeKind;
  /** Minimum content width. */
  w: number;
  /** Total height including labels above the symbol. */
  h: number;
  headLines: string[];
  /** Boxes: height of the label block above the box. Contacts/coils: extra label height above the symbol line. */
  headH: number;
  title: string;
  sub: string;
  mark: string;
  negated: boolean;
  edge: '' | 'P' | 'N';
  hasHiddenParams: boolean;
  left: PinDesc[];
  right: PinDesc[];
  leftPad: number;
  rightPad: number;
}

interface BoxDef {
  title: string;
  left: string[];
  right: string[];
}

const math = (title: string): BoxDef => ({ title, left: ['en', 'in1', 'in2'], right: ['eno', 'out'] });
const compare = (title: string): BoxDef => ({ title, left: ['pre', 'in1', 'in2'], right: ['out'] });
const timer = (title: string): BoxDef => ({ title, left: ['in', 'pt'], right: ['q', 'et'] });
const edge = (title: string): BoxDef => ({ title, left: ['in'], right: ['out'] });

const BOX_DEFS: Record<string, BoxDef> = {
  Move: { title: 'MOVE', left: ['en', 'in'], right: ['eno', 'out1'] },
  Add: math('ADD'),
  Sub: math('SUB'),
  Mul: math('MUL'),
  Div: math('DIV'),
  Abs: { title: 'ABS', left: ['en', 'in'], right: ['eno', 'out'] },
  Eq: compare('=='),
  Ne: compare('<>'),
  Gt: compare('>'),
  Lt: compare('<'),
  Ge: compare('>='),
  Le: compare('<='),
  TON: timer('TON'),
  TOF: timer('TOF'),
  TP: timer('TP'),
  Not: edge('NOT'),
  PBox: edge('P'),
  NBox: edge('N'),
};

const COIL_MARKS: Record<string, string> = { Coil: '', SCoil: 'S', RCoil: 'R' };
const CONTACT_EDGES: Record<string, '' | 'P' | 'N'> = { Contact: '', PContact: 'P', NContact: 'N' };
const OPERAND_PINS = new Set(['operand', 'bit']);
const HIDDEN_LABELS = new Set(['pre']);
const TYPE_TEMPLATES = ['SrcType', 'time_type', 'DestType'];

export const textWidth = (s: string): number => s.length * CHAR_W;

/** Contact/coil operands are wrapped to this many characters per line, like TIA Portal does. */
const WRAP_CHARS = 14;
const WRAP_BREAKS = '.[]",_';

/** Wraps an operand into lines of at most `maxChars`, preferring to break after a separator. */
export function wrapOperand(text: string, maxChars = WRAP_CHARS): string[] {
  const lines: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    const lastBreak = Math.max(...[...WRAP_BREAKS].map((c) => window.lastIndexOf(c)));
    const cut = lastBreak >= 0 ? lastBreak + 1 : maxChars;
    lines.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  return rest ? [...lines, rest] : lines;
}

type PinMap = Map<string, PinState>;

function pinLabel(name: string): string {
  if (HIDDEN_LABELS.has(name)) {
    return '';
  }
  return name === name.toLowerCase() ? name.toUpperCase() : name;
}

const plainPin = (name: string, row = 0): PinDesc => ({ name, label: '', row, negated: false, access: '' });

function symbolNode(part: FlgPart, kind: 'contact' | 'coil', pins: PinMap): LNode {
  const operand = pins.get('operand')?.accessIn ?? '';
  const negated = part.negated.has('operand');
  const lines = wrapOperand(operand);
  const extraH = Math.max(0, lines.length - 1) * HEAD_LINE;
  return {
    part,
    kind,
    w: Math.max(SYM_W, ...lines.map((l) => textWidth(l) + 10)),
    h: SYM_H + extraH,
    headLines: lines,
    headH: extraH,
    title: '',
    sub: '',
    mark: kind === 'coil' ? (negated ? '/' : (COIL_MARKS[part.name] ?? '')) : '',
    negated,
    edge: kind === 'contact' ? (CONTACT_EDGES[part.name] ?? '') : '',
    hasHiddenParams: false,
    left: [plainPin('in')],
    // a coil can still feed on (e.g. into a following contact), so it keeps an output pin
    right: [plainPin('out')],
    leftPad: 0,
    rightPad: 0,
  };
}

function orNode(part: FlgPart, pins: PinMap): LNode {
  const inputs = [...pins.keys()]
    .filter((n) => /^in\d+$/.test(n))
    .sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
  return {
    part,
    kind: 'or',
    w: OR_W,
    h: 0,
    headLines: [],
    headH: 0,
    title: '',
    sub: '',
    mark: '',
    negated: false,
    edge: '',
    hasHiddenParams: false,
    left: inputs.map((n, i) => plainPin(n, i)),
    right: [plainPin('out')],
    leftPad: 0,
    rightPad: 0,
  };
}

/** Orders pin names: the `leading` ones first (when present), then the rest. */
function orderPins(names: string[], leading: string[]): string[] {
  return [...leading.filter((n) => names.includes(n)), ...names.filter((n) => !leading.includes(n))];
}

interface PinNames {
  left: string[];
  right: string[];
  hidden: boolean;
}

function callPins(part: FlgPart, pins: PinMap): PinNames {
  const declared = part.params.filter((p) => {
    const state = pins.get(p.name);
    return state !== undefined && !state.openOnly;
  });
  const inSection = (p: { section: string }): boolean => p.section === 'Input' || p.section === 'InOut';
  return {
    left: ['en', ...declared.filter(inSection).map((p) => p.name)],
    right: [
      ...(part.disabledEno ? [] : ['eno']),
      ...declared.filter((p) => !inSection(p)).map((p) => p.name),
    ],
    hidden: declared.length < part.params.length,
  };
}

function partPins(part: FlgPart, def: BoxDef | undefined, pins: PinMap): PinNames {
  const known = new Set([...(def?.left ?? []), ...(def?.right ?? [])]);
  const left = [...(def?.left ?? [])];
  const right = [...(def?.right ?? [])];
  if (part.name === 'Move') {
    const card = Math.min(Number.parseInt(part.templates.Card ?? '1', 10) || 1, MAX_CARD);
    for (let i = 2; i <= card; i++) {
      right.push(`out${i}`);
    }
  }
  for (const p of pins.values()) {
    const isExtra =
      !known.has(p.name) && !OPERAND_PINS.has(p.name) && !p.openOnly && !right.includes(p.name) && !left.includes(p.name);
    if (isExtra) {
      (p.dir === 'in' ? left : right).push(p.name);
    }
  }
  const orderedRight = orderPins(right, ['eno']);
  if (!def && left.includes('en') && !part.disabledEno && !orderedRight.includes('eno')) {
    orderedRight.unshift('eno');
  }
  return {
    left: orderPins(left, ['en', 'pre']),
    right: orderedRight.filter((n) => !(n === 'eno' && part.disabledEno)),
    hidden: false,
  };
}

function boxNode(part: FlgPart, pins: PinMap): LNode {
  const def = part.isCall || !Object.hasOwn(BOX_DEFS, part.name) ? undefined : BOX_DEFS[part.name];
  const names = part.isCall ? callPins(part, pins) : partPins(part, def, pins);
  const operandTexts = [...pins.values()]
    .filter((p) => OPERAND_PINS.has(p.name) && p.accessIn)
    .map((p) => p.accessIn as string);
  const headLines = [part.instance, ...operandTexts].filter(Boolean);
  const title = part.isCall ? `"${part.name}"` : (def?.title ?? part.name);
  const sub = part.isCall ? '' : (TYPE_TEMPLATES.map((k) => part.templates[k]).find(Boolean) ?? '');
  const describe = (list: string[], isLeft: boolean): PinDesc[] =>
    list.map((name, row) => {
      const state = pins.get(name);
      return {
        name,
        label: pinLabel(name),
        row,
        negated: part.negated.has(name),
        access: isLeft ? (state?.accessIn ?? '') : (state?.accessOut.join(', ') ?? ''),
      };
    });
  const left = describe(names.left, true);
  const right = describe(names.right, false);
  const rows = Math.max(left.length, right.length, 1);
  const headH = headLines.length > 0 ? headLines.length * HEAD_LINE + 4 : 0;
  const labelW = (ps: PinDesc[]): number => Math.max(0, ...ps.map((p) => textWidth(p.label)));
  const padOf = (ps: PinDesc[]): number =>
    Math.max(0, ...ps.filter((p) => p.access).map((p) => textWidth(p.access) + ACCESS_GAP));
  return {
    part,
    kind: 'box',
    w: Math.max(
      MIN_BOX_W,
      labelW(left) + labelW(right) + 28,
      textWidth(title) + (sub ? textWidth(sub) + 10 : 0) + 20,
      ...headLines.map((l) => textWidth(l) + 10),
    ),
    h: headH + TITLE_H + rows * ROW + 4 + (names.hidden ? HIDDEN_PARAMS_H : 0),
    headLines,
    headH,
    title,
    sub,
    mark: '',
    negated: false,
    edge: '',
    hasHiddenParams: names.hidden,
    left,
    right,
    leftPad: padOf(left),
    rightPad: padOf(right),
  };
}

export function describeNode(part: FlgPart, pins: PinMap | undefined): LNode {
  const pinMap: PinMap = pins ?? new Map();
  if (!part.isCall) {
    if (Object.hasOwn(CONTACT_EDGES, part.name)) {
      return symbolNode(part, 'contact', pinMap);
    }
    if (Object.hasOwn(COIL_MARKS, part.name)) {
      return symbolNode(part, 'coil', pinMap);
    }
    if (part.name === 'O') {
      return orNode(part, pinMap);
    }
  }
  return boxNode(part, pinMap);
}
