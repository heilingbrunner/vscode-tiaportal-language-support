import type { FlgNet } from '../parser/flgNetParser';
import { describeNode, ROW, SYM_LINE, TITLE_H, HEAD_LINE, type LNode, type PinDesc } from './nodes';
import { buildPinTable, type PinTable } from './pins';
import type { LadScene, Pt, SceneItem } from './scene';

const RAIL_X = 12;
const GAP = 44;
const MARGIN_TOP = 10;
const MARGIN_BOTTOM = 16;
const GAP_Y = 8;
const END_PAD = 24;
const TICK = 6;
const OR_PAD = 4;
const STUB = 14;
const SYMBOL_HALF = 10;

interface Entry {
  uid: string;
  node: LNode;
  order: number;
  depth: number;
  top: number;
  /** OR nodes only: y of each input, taken from its source pin. */
  orYs: Map<string, number>;
}

interface Column {
  start: number;
  left: number;
  right: number;
}

/** Index of the first wire that mentions each part, for a stable top-to-bottom order. */
function firstWireIndex(net: FlgNet): Map<string, number> {
  const order = new Map<string, number>();
  net.wires.forEach((wire, i) => {
    for (const conn of [wire.src, ...wire.dsts]) {
      if (conn.kind === 'name' && !order.has(conn.uid)) {
        order.set(conn.uid, i);
      }
    }
  });
  return order;
}

class LadLayout {
  private readonly pins: PinTable;
  private readonly entries = new Map<string, Entry>();
  private readonly occupied = new Map<number, Array<[number, number]>>();
  private readonly out: SceneItem[] = [];
  private columns: Column[] = [];
  private endX = 0;

  constructor(private readonly net: FlgNet) {
    this.pins = buildPinTable(net);
    const order = firstWireIndex(net);
    let seq = net.wires.length;
    for (const [uid, part] of net.parts) {
      this.entries.set(uid, {
        uid,
        node: describeNode(part, this.pins.get(uid)),
        order: order.get(uid) ?? seq++,
        depth: 0,
        top: 0,
        orYs: new Map(),
      });
    }
  }

  run(): LadScene {
    this.assignDepths();
    this.placeAll();
    this.normalizeTop();
    this.computeColumns();
    for (const entry of this.entries.values()) {
      this.emitNode(entry);
    }
    this.emitWires();
    const height = this.bottom() + MARGIN_BOTTOM;
    this.out.unshift({ t: 'line', pts: [[RAIL_X, 0], [RAIL_X, height]], cls: 'rail' });
    return { width: this.endX + 20, height, items: this.out };
  }

  // ---- depth (column) assignment -------------------------------------------------------------

  private predecessors(uid: string): string[] {
    const found = new Set<string>();
    for (const state of this.pins.get(uid)?.values() ?? []) {
      const src = state.flowSrc;
      if (src && src !== 'rail' && src.uid !== uid && this.entries.has(src.uid)) {
        found.add(src.uid);
      }
    }
    return [...found];
  }

  private assignDepths(): void {
    const memo = new Map<string, number>();
    const visiting = new Set<string>();
    const depthOf = (uid: string): number => {
      const known = memo.get(uid);
      if (known !== undefined) {
        return known;
      }
      if (visiting.has(uid)) {
        return 0;
      }
      visiting.add(uid);
      let depth = 0;
      for (const pred of this.predecessors(uid)) {
        depth = Math.max(depth, depthOf(pred) + 1);
      }
      visiting.delete(uid);
      memo.set(uid, depth);
      return depth;
    };
    for (const entry of this.entries.values()) {
      entry.depth = depthOf(entry.uid);
    }
  }

  // ---- vertical placement --------------------------------------------------------------------

  private pinOffset(node: LNode, name: string): number {
    if (node.kind === 'or') {
      return 0;
    }
    if (node.kind !== 'box') {
      return SYM_LINE;
    }
    const pin = node.left.find((p) => p.name === name) ?? node.right.find((p) => p.name === name);
    return node.headH + TITLE_H + (pin?.row ?? 0) * ROW + ROW / 2;
  }

  private pinY(entry: Entry, name: string): number {
    if (entry.node.kind === 'or') {
      const ys = [...entry.orYs.values()];
      if (ys.length === 0) {
        return entry.top;
      }
      return name === 'out' ? Math.min(...ys) : (entry.orYs.get(name) ?? entry.top);
    }
    return entry.top + this.pinOffset(entry.node, name);
  }

  private fillOrYs(entry: Entry): void {
    const known: number[] = [];
    const pending: string[] = [];
    for (const pin of entry.node.left) {
      const src = this.pins.get(entry.uid)?.get(pin.name)?.flowSrc;
      const srcEntry = src && src !== 'rail' ? this.entries.get(src.uid) : undefined;
      const srcReady = srcEntry !== undefined && !(srcEntry.node.kind === 'or' && srcEntry.orYs.size === 0);
      if (src && src !== 'rail' && srcEntry && srcReady) {
        const y = this.pinY(srcEntry, src.pin);
        entry.orYs.set(pin.name, y);
        known.push(y);
      } else {
        pending.push(pin.name);
      }
    }
    const fallback = known.length > 0 ? Math.min(...known) : MARGIN_TOP + SYM_LINE;
    for (const name of pending) {
      entry.orYs.set(name, fallback);
    }
    if (entry.orYs.size === 0) {
      entry.orYs.set('', fallback);
    }
  }

  private preferredTop(entry: Entry): number {
    if (entry.node.kind === 'or') {
      this.fillOrYs(entry);
      return Math.min(...entry.orYs.values(), Number.MAX_SAFE_INTEGER);
    }
    for (const pin of entry.node.left) {
      const src = this.pins.get(entry.uid)?.get(pin.name)?.flowSrc;
      if (!src) {
        continue;
      }
      if (src === 'rail') {
        return MARGIN_TOP;
      }
      const srcEntry = this.entries.get(src.uid);
      if (srcEntry) {
        return this.pinY(srcEntry, src.pin) - this.pinOffset(entry.node, pin.name);
      }
    }
    return MARGIN_TOP;
  }

  private reserve(col: number, from: number, to: number): void {
    const slots = this.occupied.get(col) ?? [];
    slots.push([from, to]);
    this.occupied.set(col, slots);
  }

  private place(entry: Entry, preferred: number): void {
    if (entry.node.kind === 'or') {
      entry.top = preferred;
      this.reserve(entry.depth, preferred - OR_PAD, Math.max(...entry.orYs.values()) + OR_PAD);
      return;
    }
    const height = entry.node.h;
    const slots = this.occupied.get(entry.depth) ?? [];
    let top = preferred;
    for (let moved = true; moved; ) {
      moved = false;
      for (const [from, to] of slots) {
        if (top < to + GAP_Y && top + height > from - GAP_Y) {
          top = to + GAP_Y;
          moved = true;
        }
      }
    }
    entry.top = top;
    this.reserve(entry.depth, top, top + height);
  }

  private placeAll(): void {
    const byDepth = new Map<number, Entry[]>();
    for (const entry of this.entries.values()) {
      byDepth.set(entry.depth, [...(byDepth.get(entry.depth) ?? []), entry]);
    }
    for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
      const group = byDepth.get(depth) ?? [];
      const preferred = new Map(group.map((e) => [e, this.preferredTop(e)] as const));
      group.sort((a, b) => (preferred.get(a) ?? 0) - (preferred.get(b) ?? 0) || a.order - b.order);
      for (const entry of group) {
        this.place(entry, preferred.get(entry) ?? MARGIN_TOP);
      }
    }
  }

  /** Shifts everything down so the topmost element (e.g. an instance label) sits at the top margin. */
  private normalizeTop(): void {
    const tops = [...this.entries.values()].map((e) =>
      e.node.kind === 'or' ? Math.min(...e.orYs.values()) - OR_PAD : e.top,
    );
    const shift = MARGIN_TOP - Math.min(...tops);
    if (shift === 0) {
      return;
    }
    for (const entry of this.entries.values()) {
      entry.top += shift;
      for (const [name, y] of entry.orYs) {
        entry.orYs.set(name, y + shift);
      }
    }
  }

  // ---- horizontal geometry -------------------------------------------------------------------

  private computeColumns(): void {
    const maxDepth = Math.max(0, ...[...this.entries.values()].map((e) => e.depth));
    let cursor = RAIL_X + GAP;
    this.columns = [];
    for (let depth = 0; depth <= maxDepth; depth++) {
      const nodes = [...this.entries.values()].filter((e) => e.depth === depth).map((e) => e.node);
      const leftPad = Math.max(0, ...nodes.map((n) => n.leftPad));
      const rightPad = Math.max(0, ...nodes.map((n) => n.rightPad));
      const width = Math.max(0, ...nodes.map((n) => n.w));
      const left = cursor + leftPad;
      this.columns.push({ start: cursor, left, right: left + width });
      cursor = left + width + rightPad + GAP;
    }
    this.endX = cursor - GAP + END_PAD;
  }

  private column(entry: Entry): Column {
    return this.columns[entry.depth] as Column;
  }

  private pinPoint(entry: Entry, name: string, side: 'L' | 'R'): Pt | undefined {
    const list = side === 'L' ? entry.node.left : entry.node.right;
    if (!list.some((p) => p.name === name)) {
      return undefined;
    }
    const col = this.column(entry);
    const isOrInput = entry.node.kind === 'or' && side === 'L';
    const x = isOrInput ? (col.left + col.right) / 2 : side === 'L' ? col.left : col.right;
    return [x, this.pinY(entry, name)];
  }

  // ---- emitting ------------------------------------------------------------------------------

  private wire(...pts: Pt[]): void {
    this.out.push({ t: 'line', pts, cls: 'wire' });
  }

  private bottom(): number {
    let bottom = MARGIN_TOP + SYM_LINE;
    for (const entry of this.entries.values()) {
      const extent =
        entry.node.kind === 'or' ? Math.max(...entry.orYs.values()) + OR_PAD : entry.top + entry.node.h;
      bottom = Math.max(bottom, extent);
    }
    return bottom;
  }

  private emitNode(entry: Entry): void {
    const col = this.column(entry);
    if (entry.node.kind === 'or') {
      const ys = [...entry.orYs.values()];
      const barX = (col.left + col.right) / 2;
      this.wire([barX, Math.min(...ys)], [barX, Math.max(...ys)]);
      this.wire([barX, Math.min(...ys)], [col.right, Math.min(...ys)]);
    } else if (entry.node.kind === 'box') {
      this.emitBox(entry, col);
    } else {
      this.emitSymbol(entry, col);
    }
  }

  private emitSymbol(entry: Entry, col: Column): void {
    const { node } = entry;
    const cx = (col.left + col.right) / 2;
    const y = entry.top + SYM_LINE;
    this.wire([col.left, y], [cx - SYMBOL_HALF, y]);
    if (node.kind === 'contact') {
      this.wire([cx + SYMBOL_HALF, y], [col.right, y]);
      this.out.push({ t: 'contact', cx, y, negated: node.negated, edge: node.edge });
    } else {
      this.out.push({ t: 'coil', cx, y, mark: node.mark });
    }
    if (node.headLines[0]) {
      this.out.push({ t: 'text', x: cx, y: entry.top + 11, s: node.headLines[0], cls: 'operand', anchor: 'middle' });
    }
  }

  private emitBox(entry: Entry, col: Column): void {
    const { node } = entry;
    const boxTop = entry.top + node.headH;
    const width = col.right - col.left;
    this.out.push({ t: 'box', x: col.left, y: boxTop, w: width, h: node.h - node.headH, headH: TITLE_H });
    node.headLines.forEach((line, i) => {
      this.out.push({
        t: 'text',
        x: col.left + width / 2,
        y: entry.top + (i + 1) * HEAD_LINE,
        s: line,
        cls: 'head',
        anchor: 'middle',
      });
    });
    this.out.push({ t: 'text', x: col.left + 8, y: boxTop + 16, s: node.title, cls: 'title', anchor: 'start' });
    if (node.sub) {
      this.out.push({ t: 'text', x: col.right - 8, y: boxTop + 16, s: node.sub, cls: 'type', anchor: 'end' });
    }
    for (const pin of node.left) {
      this.emitPin(entry, pin, 'L', col);
    }
    for (const pin of node.right) {
      this.emitPin(entry, pin, 'R', col);
    }
    if (node.hasHiddenParams) {
      this.out.push({
        t: 'text',
        x: col.left + width / 2,
        y: entry.top + node.h - 2,
        s: '▾',
        cls: 'hint',
        anchor: 'middle',
      });
    }
  }

  private emitPin(entry: Entry, pin: PinDesc, side: 'L' | 'R', col: Column): void {
    const point = this.pinPoint(entry, pin.name, side);
    if (!point) {
      return;
    }
    const [x, y] = point;
    const isLeft = side === 'L';
    if (pin.label) {
      this.out.push({
        t: 'text',
        x: isLeft ? x + 5 : x - 5,
        y: y + 4,
        s: pin.label,
        cls: 'pin',
        anchor: isLeft ? 'start' : 'end',
      });
    }
    if (pin.negated) {
      this.out.push({ t: 'bubble', x, y });
    }
    if (pin.access) {
      const dir = isLeft ? -1 : 1;
      this.wire([x, y], [x + dir * STUB, y]);
      this.out.push({
        t: 'text',
        x: x + dir * (STUB + 4),
        y: y + 4,
        s: pin.access,
        cls: 'operand',
        anchor: isLeft ? 'end' : 'start',
      });
    } else if (!isLeft && pin.name === 'eno' && this.hasNoFlowDst(entry.uid, pin.name)) {
      this.wire([col.right, y], [this.endX, y]);
      this.out.push({ t: 'line', pts: [[this.endX, y - TICK], [this.endX, y + TICK]], cls: 'tick' });
    }
  }

  private hasNoFlowDst(uid: string, pin: string): boolean {
    const state = this.pins.get(uid)?.get(pin);
    return !state || state.flowDsts.length === 0;
  }

  private route(from: Pt, to: Pt, dstColStart: number): Pt[] {
    if (Math.abs(from[1] - to[1]) < 0.5) {
      return [from, [to[0], from[1]]];
    }
    const trunk = dstColStart - GAP / 2;
    const x = trunk > from[0] ? trunk : from[0] + STUB;
    return [from, [x, from[1]], [x, to[1]], to];
  }

  private emitWires(): void {
    for (const { src, dsts } of this.net.wires) {
      const srcEntry = src.kind === 'name' ? this.entries.get(src.uid) : undefined;
      const from = srcEntry && src.kind === 'name' ? this.pinPoint(srcEntry, src.pin, 'R') : undefined;
      for (const dst of dsts) {
        const dstEntry = dst.kind === 'name' ? this.entries.get(dst.uid) : undefined;
        const to = dstEntry && dst.kind === 'name' ? this.pinPoint(dstEntry, dst.pin, 'L') : undefined;
        if (!dstEntry || !to) {
          continue;
        }
        if (src.kind === 'rail') {
          this.wire([RAIL_X, to[1]], to);
        } else if (from) {
          this.wire(...this.route(from, to, this.column(dstEntry).start));
        }
      }
    }
  }
}

/** Lays out the FlgNet of one LAD network as drawing instructions. */
export function layoutLad(net: FlgNet): LadScene {
  if (net.parts.size === 0) {
    return {
      width: 48,
      height: 30,
      items: [{ t: 'line', pts: [[RAIL_X, 0], [RAIL_X, 30]], cls: 'rail' }],
    };
  }
  const scene = new LadLayout(net).run();
  if (!Number.isFinite(scene.width) || !Number.isFinite(scene.height)) {
    throw new Error('LAD layout produced invalid geometry');
  }
  return scene;
}
