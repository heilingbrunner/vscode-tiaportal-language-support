import type { Conn, FlgNet, FlgParam, FlgPart, FlgWire } from './flgNetParser';

/**
 * LAD in SIMATIC SD format (`RUNG wire#powerrail ... END_RUNG`) turned into the same `FlgNet` model that the
 * Openness XML parser produces, so the existing layout and SVG renderer draw it.
 *
 * - elements of a rung are in series; boxes chain ENO -> EN
 * - `RUNG wire#wN` starts at node `wN`; a bare `wire#wN` line names the current signal; `END_RUNG wire#wN`
 *   feeds the rung output into `wN`. Several drivers of one node are joined by an OR part.
 */

const POWER_RAIL = 'powerrail';
const MAX_RUNGS = 2000;
const WIRE_REF = /^wire#([A-Za-z0-9_]+)$/;

interface Arg {
  name: string;
  dir: ':=' | '=>' | '';
  value: string;
}

interface ElementItem {
  kind: 'element';
  callee: string;
  args: Arg[];
  templates: Record<string, string>;
}

type Item = ElementItem | { kind: 'wire'; name: string };

interface Rung {
  start: string;
  end: string | undefined;
  items: Item[];
}

interface ElementDef {
  name: string;
  flowIn: string;
  flowOut: string;
  operandPin?: string;
  negated?: string;
}

const symbol = (name: string, extra: Partial<ElementDef> = {}): ElementDef => ({
  name,
  flowIn: 'in',
  flowOut: 'out',
  operandPin: 'operand',
  ...extra,
});
const compare = (name: string): ElementDef => ({ name, flowIn: 'pre', flowOut: 'out' });
const edge = (name: string): ElementDef => ({ name, flowIn: 'in', flowOut: 'out', operandPin: 'bit' });
const eno = (name: string): ElementDef => ({ name, flowIn: 'en', flowOut: 'eno' });

const ELEMENTS: Record<string, ElementDef> = {
  CONTACT: symbol('Contact'),
  I_CONTACT: symbol('Contact', { negated: 'operand' }),
  P_CONTACT: symbol('PContact'),
  N_CONTACT: symbol('NContact'),
  COIL: symbol('Coil'),
  S_COIL: symbol('SCoil'),
  R_COIL: symbol('RCoil'),
  P_TRIG: edge('PBox'),
  N_TRIG: edge('NBox'),
  NOT: { name: 'Not', flowIn: 'in', flowOut: 'out' },
  EQ_CONTACT: compare('Eq'),
  NE_CONTACT: compare('Ne'),
  GT_CONTACT: compare('Gt'),
  LT_CONTACT: compare('Lt'),
  GE_CONTACT: compare('Ge'),
  LE_CONTACT: compare('Le'),
  MOVE: eno('Move'),
  ADD: eno('Add'),
  SUB: eno('Sub'),
  MUL: eno('Mul'),
  DIV: eno('Div'),
  ABS: eno('Abs'),
  S_SR: { name: 'S_SR', flowIn: 's1', flowOut: 'q', operandPin: 'operand' },
};

const TIMERS = new Set(['TON', 'TOF', 'TP']);
const BARE_NAME = /^[A-Za-z_]\w*$/;

class Scanner {
  private pos = 0;

  constructor(private readonly text: string) {}

  get done(): boolean {
    this.skipTrivia();
    return this.pos >= this.text.length;
  }

  private skipTrivia(): void {
    for (;;) {
      const two = this.text.slice(this.pos, this.pos + 2);
      if (/\s/.test(this.text[this.pos] ?? '')) {
        this.pos++;
      } else if (two === '//') {
        const eol = this.text.indexOf('\n', this.pos);
        this.pos = eol < 0 ? this.text.length : eol + 1;
      } else if (two === '(*') {
        const close = this.text.indexOf('*)', this.pos + 2);
        this.pos = close < 0 ? this.text.length : close + 2;
      } else {
        return;
      }
    }
  }

  private peekWord(): string {
    this.skipTrivia();
    return /^[A-Za-z_]\w*/.exec(this.text.slice(this.pos))?.[0] ?? '';
  }

  eatWord(word: string): boolean {
    if (this.peekWord().toUpperCase() !== word) {
      return false;
    }
    this.pos += word.length;
    return true;
  }

  /** `wire#name` at the current position. */
  eatWire(): string | undefined {
    this.skipTrivia();
    const m = /^wire#([A-Za-z0-9_]+)/.exec(this.text.slice(this.pos));
    if (!m) {
      return undefined;
    }
    this.pos += m[0].length;
    return m[1];
  }

  /** `{ ... }` attribute block; returns its inner text. */
  eatBraces(): string | undefined {
    this.skipTrivia();
    if (this.text[this.pos] !== '{') {
      return undefined;
    }
    const close = this.skipBalanced(this.pos, '{', '}');
    const inner = this.text.slice(this.pos + 1, close);
    this.pos = close + 1;
    return inner;
  }

  /** The callee text up to the `(` of a call; the position moves behind the `(`. */
  callee(): string {
    this.skipTrivia();
    const start = this.pos;
    let depth = 0;
    while (this.pos < this.text.length) {
      const c = this.text[this.pos];
      if (c === '"') {
        this.pos = this.endOfQuote(this.pos);
      } else if (c === '[') {
        depth++;
      } else if (c === ']') {
        depth--;
      } else if (c === '(' && depth === 0) {
        const callee = this.text.slice(start, this.pos).trim();
        this.pos++;
        return callee;
      }
      this.pos++;
    }
    throw new Error(`call without '(' near "${this.text.slice(start, start + 20)}"`);
  }

  /** The arguments of a call whose `(` was just read; the position moves behind the matching `)`. */
  args(): Arg[] {
    const open = this.pos - 1;
    const close = this.skipBalanced(open, '(', ')');
    const inner = this.text.slice(open + 1, close);
    this.pos = close + 1;
    return splitTop(inner)
      .filter((a) => a.trim() !== '')
      .map(parseArg);
  }

  private endOfQuote(from: number): number {
    const close = this.text.indexOf('"', from + 1);
    if (close < 0) {
      throw new Error('unterminated quote');
    }
    return close;
  }

  /** Index of the bracket that closes the one at `from`, skipping strings. */
  private skipBalanced(from: number, open: string, close: string): number {
    let depth = 0;
    for (let i = from; i < this.text.length; i++) {
      const c = this.text[i];
      if (c === '"') {
        i = this.endOfQuote(i);
      } else if (c === "'") {
        i = endOfSingleQuote(this.text, i);
      } else if (c === open) {
        depth++;
      } else if (c === close && --depth === 0) {
        return i;
      }
    }
    throw new Error(`missing '${close}'`);
  }
}

function endOfSingleQuote(text: string, from: number): number {
  for (let i = from + 1; i < text.length; i++) {
    if (text[i] === '$') {
      i++;
    } else if (text[i] === "'") {
      return i;
    }
  }
  throw new Error('unterminated string');
}

/** Splits at top-level commas, outside strings and brackets. */
function splitTop(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const close = text.indexOf('"', i + 1);
      if (close < 0) {
        throw new Error('unterminated quote');
      }
      i = close;
    } else if (c === "'") {
      i = endOfSingleQuote(text, i);
    } else if (c === '(' || c === '[') {
      depth++;
    } else if (c === ')' || c === ']') {
      depth--;
    } else if (c === ',' && depth === 0) {
      parts.push(text.slice(last, i));
      last = i + 1;
    }
  }
  parts.push(text.slice(last));
  return parts;
}

const tidy = (text: string): string => text.replace(/\s*\n\s*/g, ' ').trim();

function parseArg(arg: string): Arg {
  const m = /^\s*([A-Za-z_]\w*)\s*(:=|=>)([\s\S]*)$/.exec(arg);
  if (!m) {
    return { name: '', dir: '', value: tidy(arg) };
  }
  return { name: m[1] as string, dir: m[2] as ':=' | '=>', value: tidy(m[3] as string) };
}

function parseTemplates(attributes: string): Record<string, string> {
  const templates: Record<string, string> = {};
  const raw = /S7_Templates\s*:=\s*"([^"]*)"/i.exec(attributes)?.[1] ?? '';
  for (const pair of raw.split(/[;,]/)) {
    const m = /^\s*(\w+)\s*:=\s*(\S+)\s*$/.exec(pair);
    if (m) {
      templates[m[1] as string] = m[2] as string;
    }
  }
  return templates;
}

function readRungs(text: string): Rung[] {
  const scan = new Scanner(text);
  const rungs: Rung[] = [];
  while (!scan.done) {
    if (rungs.length >= MAX_RUNGS || !scan.eatWord('RUNG')) {
      throw new Error('expected RUNG');
    }
    const start = scan.eatWire();
    if (!start) {
      throw new Error('RUNG without wire#');
    }
    const items: Item[] = [];
    let templates: Record<string, string> = {};
    while (!scan.eatWord('END_RUNG')) {
      if (scan.done) {
        throw new Error('missing END_RUNG');
      }
      const braces = scan.eatBraces();
      const wire = braces === undefined ? scan.eatWire() : undefined;
      if (braces !== undefined) {
        templates = { ...templates, ...parseTemplates(braces) };
      } else if (wire) {
        items.push({ kind: 'wire', name: wire });
      } else {
        const callee = scan.callee();
        items.push({ kind: 'element', callee, args: scan.args(), templates });
        templates = {};
      }
    }
    rungs.push({ start, end: scan.eatWire(), items });
  }
  return rungs;
}

function connKey(c: Conn): string {
  switch (c.kind) {
    case 'rail':
      return 'rail';
    case 'name':
      return `name:${c.uid}:${c.pin}`;
    default:
      return `${c.kind}:${c.uid}`;
  }
}

function newPart(uid: string, name: string): FlgPart {
  return {
    uid,
    name,
    isCall: false,
    blockType: '',
    instance: '',
    negated: new Set(),
    templates: {},
    disabledEno: false,
    params: [],
  };
}

class Builder {
  private readonly accesses = new Map<string, string>();
  private readonly parts = new Map<string, FlgPart>();
  private readonly wires = new Map<string, FlgWire>();
  private readonly nodes = new Map<string, Conn>();
  private readonly outputs: (Conn | undefined)[];
  private readonly emitting = new Set<number>();
  private readonly declaredIn = new Map<string, number>();
  private readonly endersOf = new Map<string, number[]>();
  private uid = 0;

  constructor(private readonly rungs: Rung[]) {
    this.outputs = rungs.map(() => undefined);
    rungs.forEach((rung, i) => {
      for (const item of rung.items) {
        if (item.kind === 'wire') {
          if (this.declaredIn.has(item.name)) {
            throw new Error(`wire#${item.name} declared twice`);
          }
          this.declaredIn.set(item.name, i);
        }
      }
      if (rung.end) {
        this.endersOf.set(rung.end, [...(this.endersOf.get(rung.end) ?? []), i]);
      }
    });
  }

  build(): FlgNet {
    this.rungs.forEach((_, i) => this.emitRung(i));
    return { accesses: this.accesses, parts: this.parts, wires: [...this.wires.values()] };
  }

  private newUid(): string {
    return String(++this.uid);
  }

  private flow(src: Conn, dst: Conn): void {
    const key = connKey(src);
    const wire = this.wires.get(key);
    if (wire) {
      wire.dsts.push(dst);
    } else {
      this.wires.set(key, { src, dsts: [dst] });
    }
  }

  private access(text: string): Conn {
    const uid = this.newUid();
    this.accesses.set(uid, text);
    return { kind: 'ident', uid };
  }

  /** Joins several drivers of one node with an OR part. */
  private join(signals: Conn[]): Conn {
    const [only] = signals;
    if (signals.length === 1 && only) {
      return only;
    }
    const uid = this.newUid();
    this.parts.set(uid, newPart(uid, 'O'));
    signals.forEach((s, i) => this.flow(s, { kind: 'name', uid, pin: `in${i + 1}` }));
    return { kind: 'name', uid, pin: 'out' };
  }

  private nodeSignal(name: string): Conn {
    if (name === POWER_RAIL) {
      return { kind: 'rail' };
    }
    const known = this.nodes.get(name);
    if (known) {
      return known;
    }
    const declaring = this.declaredIn.get(name);
    if (declaring !== undefined) {
      this.emitRung(declaring);
      const declared = this.nodes.get(name);
      if (declared) {
        return declared;
      }
    }
    const enders = this.endersOf.get(name) ?? [];
    if (enders.length === 0) {
      throw new Error(`wire#${name} has no source`);
    }
    const signal = this.join(enders.map((e) => this.rungOutput(e)));
    this.nodes.set(name, signal);
    return signal;
  }

  private rungOutput(index: number): Conn {
    const out = this.emitRung(index);
    if (!out) {
      throw new Error('rung without output');
    }
    return out;
  }

  private emitRung(index: number): Conn | undefined {
    const done = this.outputs[index];
    if (done) {
      return done;
    }
    if (this.emitting.has(index)) {
      throw new Error('cyclic wire#');
    }
    this.emitting.add(index);
    const rung = this.rungs[index] as Rung;
    let cur = this.nodeSignal(rung.start);
    for (const item of rung.items) {
      if (item.kind === 'wire') {
        const others = (this.endersOf.get(item.name) ?? []).filter((e) => e !== index).map((e) => this.rungOutput(e));
        cur = this.join([cur, ...others]);
        this.nodes.set(item.name, cur);
      } else {
        cur = this.element(cur, item);
      }
    }
    this.emitting.delete(index);
    this.outputs[index] = cur;
    return cur;
  }

  private element(cur: Conn, item: ElementItem): Conn {
    const { part, def } = this.describe(item);
    this.parts.set(part.uid, part);
    this.flow(cur, { kind: 'name', uid: part.uid, pin: def.flowIn });
    const positional = item.args.filter((a) => a.name === '' && a.value !== '');
    if (positional.length > 1 || (positional.length === 1 && !def.operandPin)) {
      throw new Error(`unexpected arguments of ${item.callee}`);
    }
    for (const arg of item.args) {
      const pin = arg.name === '' ? (def.operandPin as string) : part.isCall ? arg.name : arg.name.toLowerCase();
      if (arg.name !== '') {
        const param: FlgParam = { name: pin, section: arg.dir === '=>' ? 'Output' : 'Input', type: '' };
        part.params.push(param);
      }
      this.connectArg(part.uid, pin, arg);
    }
    return { kind: 'name', uid: part.uid, pin: def.flowOut };
  }

  private connectArg(uid: string, pin: string, arg: Arg): void {
    if (arg.value === '') {
      return;
    }
    const dst: Conn = { kind: 'name', uid, pin };
    const ref = WIRE_REF.exec(arg.value);
    if (ref) {
      this.flow(this.nodeSignal(ref[1] as string), dst);
    } else if (arg.dir === '=>') {
      this.flow(dst, this.access(arg.value));
    } else {
      this.flow(this.access(arg.value), dst);
    }
  }

  private describe(item: ElementItem): { part: FlgPart; def: ElementDef } {
    const uid = this.newUid();
    const key = item.callee.toUpperCase();
    const known = Object.hasOwn(ELEMENTS, key) ? ELEMENTS[key] : undefined;
    if (known) {
      const part = newPart(uid, known.name);
      part.templates = item.templates;
      if (known.negated) {
        part.negated = new Set([known.negated]);
      }
      return { part, def: known };
    }
    const timer = /^(.+)\.(TON|TOF|TP)$/i.exec(item.callee);
    if (timer && TIMERS.has((timer[2] as string).toUpperCase())) {
      const part = newPart(uid, (timer[2] as string).toUpperCase());
      part.instance = timer[1] as string;
      part.templates = item.templates;
      return { part, def: { name: part.name, flowIn: 'in', flowOut: 'q' } };
    }
    const isInstance = item.callee.startsWith('#');
    if (isInstance || item.callee.startsWith('"')) {
      // the called block's name is not part of an instance call, so the instance stands in for it
      const part = newPart(uid, item.callee.replace(/^[#"]|"$/g, ''));
      part.isCall = true;
      part.blockType = isInstance ? 'FB' : 'FC';
      part.templates = item.templates;
      return { part, def: eno(part.name) };
    }
    if (BARE_NAME.test(item.callee)) {
      const part = newPart(uid, item.callee);
      part.templates = item.templates;
      return { part, def: eno(item.callee) };
    }
    throw new Error(`unknown LAD element ${item.callee}`);
  }
}

/** Parses the rungs of one SD-format LAD network. Throws when the text is not understood. */
export function parseSdLad(lines: string[]): FlgNet {
  return new Builder(readRungs(lines.join('\n'))).build();
}
