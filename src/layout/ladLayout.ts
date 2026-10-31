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
/** Clearance kept between a wire that skips over a column and the nodes (and labels) placed in it. */
const CROSS_MARGIN = 4;
/** A chain start is moved at most this often, and at most this far in total, to straighten its chain. */
const MAX_AIMS = 4;
const MAX_AIM_SHIFT = 250;
/** Upper bound for the placement passes that grow the fan-out spans (they settle after one or two). */
const MAX_PASSES = 8;
/** Upper bound for the extra gap a single box input may need on top of the estimated spacing. */
const MAX_PIN_GROW = 400;

/** How far above its symbol line a one-line operand label reaches (text top, plus air for a wire above). */
const LABEL_REACH = 38;

/** Air between the top of a label and the wire above it. */
const AIR = LABEL_REACH - SYM_LINE;

type PinRefLike = { uid: string; pin: string } | 'rail' | undefined;

/** Vertical room around a wire: how far its feeding elements reach up and down from it. */
interface Extent {
  above: number;
  below: number;
}

const NO_EXTENT: Extent = { above: 0, below: 0 };

/** A wire that runs straight through the columns between its source and its farthest destination. */
interface PassThrough {
  src: Entry;
  pin: string;
  firstCol: number;
  lastCol: number;
}

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
  /** Per column: reserved vertical ranges with the clearance to keep from each (an OR bar needs little). */
  private readonly occupied = new Map<number, Array<[number, number, number]>>();
  private readonly out: SceneItem[] = [];
  private columns: Column[] = [];
  private passThroughs: PassThrough[] = [];
  /** Nodes already positioned in the current pass; the others still have a meaningless top. */
  private placed = new Set<string>();
  /** Top of the vertical band of the rung being placed. */
  private base = MARGIN_TOP;
  /** Per node: vertical span (from its top) that its fan-out needs; grown between placement passes. */
  private spans = new Map<string, number>();
  /** Per rail-fed node: how far below its rung's top it wants to sit (to line up with the pin it drives). */
  private aims = new Map<string, number>();
  /** How often a chain start was moved to straighten its chain; bounded so a conflict cannot snowball. */
  private aimCount = new Map<string, number>();
  /** Per node: the preferred top of the current pass without its aim. */
  private rawPrefs = new Map<string, number>();
  /** Per node: how far its rung was moved down after placement; aims are measured before that move. */
  private shifts = new Map<string, number>();
  /** Per node: its description before the input pins were spaced out. */
  private rawNodes = new Map<string, LNode>();
  /** Per box input pin (`uid:pin`): extra gap above it that the placement showed to be needed. */
  private pinGrow = new Map<string, number>();
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
    for (const entry of this.entries.values()) {
      this.rawNodes.set(entry.uid, entry.node);
    }
    this.spaceAllBoxes();
  }

  private spaceAllBoxes(): void {
    for (const entry of this.entries.values()) {
      this.spaceBoxInputs(entry);
    }
  }

  private flowSrc(uid: string, pin: string): PinRefLike {
    return this.pins.get(uid)?.get(pin)?.flowSrc;
  }

  /**
   * Vertical room the elements feeding a pin take around the wire that reaches it: `above` up to the top of
   * their labels, `below` down to the bottom of the branches an OR bar stacks under its first input.
   */
  private feedExtent(src: PinRefLike, path = new Set<string>()): Extent {
    const entry = src === 'rail' || !src ? undefined : this.entries.get(src.uid);
    if (!entry || path.has(entry.uid) || src === 'rail' || !src) {
      return NO_EXTENT;
    }
    path.add(entry.uid);
    const { node } = entry;
    const extent =
      node.kind === 'or'
        ? this.orExtent(entry, path)
        : node.kind === 'box'
          ? this.boxExtent(entry, src.pin, path)
          : this.symbolExtent(entry, path);
    path.delete(entry.uid);
    return extent;
  }

  /** A contact or coil shares its wire with the rest of its series chain, whose labels count as well. */
  private symbolExtent(entry: Entry, path: Set<string>): Extent {
    const up = this.feedExtent(this.flowSrc(entry.uid, 'in'), path);
    const above = entry.node.headH + SYM_LINE;
    return { above: Math.max(above, up.above), below: Math.max(entry.node.h - above, up.below) };
  }

  /** The output of an OR bar follows its first input; the other inputs stack below it. */
  private orExtent(entry: Entry, path: Set<string>): Extent {
    const [first, ...rest] = entry.node.left.map((p) => this.feedExtent(this.flowSrc(entry.uid, p.name), path));
    if (!first) {
      return NO_EXTENT;
    }
    const below = rest.reduce((sum, part) => sum + GAP_Y + part.above + part.below, first.below);
    return { above: first.above, below };
  }

  /** A box takes its own height around the output pin, plus the chain on its (first wired) input pin. */
  private boxExtent(entry: Entry, pin: string, path: Set<string>): Extent {
    const { node } = entry;
    const output = node.right.find((p) => p.name === pin);
    if (!output) {
      return NO_EXTENT;
    }
    const offset = node.headH + TITLE_H + output.row * ROW + ROW / 2;
    const own = { above: offset, below: node.h - offset };
    const input = node.left.find((p) => this.flowSrc(entry.uid, p.name));
    if (!input) {
      return own;
    }
    const up = this.feedExtent(this.flowSrc(entry.uid, input.name), path);
    const shift = (output.row - input.row) * ROW;
    return { above: Math.max(own.above, up.above + shift), below: Math.max(own.below, up.below - shift) };
  }

  /**
   * Spreads the input pins of a box as far apart as the elements feeding them need: the label of a chain
   * must clear the wires above it, and a pin must start below the branches stacked under the pin before.
   */
  private spaceBoxInputs(entry: Entry): void {
    const node = this.rawNodes.get(entry.uid) ?? entry.node;
    if (node.kind !== 'box') {
      return;
    }
    let y = 0;
    let lastWired = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    const left = node.left.map((pin, i) => {
      const extent = this.feedExtent(this.flowSrc(entry.uid, pin.name));
      const wired = extent.above > 0;
      if (i > 0) {
        const clear = wired
          ? Math.max(lastWired + extent.above + AIR, bottom + GAP_Y + extent.above)
          : Number.NEGATIVE_INFINITY;
        y = Math.max(y + ROW, clear) + (this.pinGrow.get(`${entry.uid}:${pin.name}`) ?? 0);
      }
      lastWired = wired ? y : lastWired;
      bottom = Math.max(bottom, y + extent.below);
      return { ...pin, row: y / ROW };
    });
    const oldRows = Math.max(node.left.length, node.right.length, 1);
    const newRows = Math.max(left.length > 0 ? (y + ROW) / ROW : 0, node.right.length, 1);
    entry.node = { ...node, left, h: node.h + (newRows - oldRows) * ROW };
  }

  run(): LadScene {
    this.assignDepths();
    this.collectPassThroughs();
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      this.resetPlacement();
      this.placeAll();
      if (!this.growSpans()) {
        break;
      }
    }
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

  private collectPassThroughs(): void {
    this.passThroughs = [];
    for (const { src, dsts } of this.net.wires) {
      const srcEntry = src.kind === 'name' ? this.entries.get(src.uid) : undefined;
      if (!srcEntry || src.kind !== 'name') {
        continue;
      }
      const farthest = Math.max(-1, ...dsts.map((d) => (d.kind === 'name' ? (this.entries.get(d.uid)?.depth ?? -1) : -1)));
      if (farthest - srcEntry.depth >= 2) {
        this.passThroughs.push({ src: srcEntry, pin: src.pin, firstCol: srcEntry.depth + 1, lastCol: farthest - 1 });
      }
    }
  }

  /** y of every wire that runs through the column of `entry` without ending there. */
  private crossingYs(entry: Entry): number[] {
    return this.passThroughs
      .filter((p) => p.firstCol <= entry.depth && entry.depth <= p.lastCol && this.placed.has(p.src.uid))
      .map((p) => this.pinY(p.src, p.pin));
  }

  // ---- vertical placement --------------------------------------------------------------------

  private pinOffset(node: LNode, name: string): number {
    if (node.kind === 'or') {
      return 0;
    }
    if (node.kind !== 'box') {
      return SYM_LINE + node.headH;
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
    const fallback = known.length > 0 ? Math.min(...known) : this.base + SYM_LINE;
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
        return this.base + (this.aims.get(entry.uid) ?? 0);
      }
      const srcEntry = this.entries.get(src.uid);
      if (srcEntry) {
        return this.pinY(srcEntry, src.pin) - this.pinOffset(entry.node, pin.name) + (this.aims.get(entry.uid) ?? 0);
      }
    }
    return this.base;
  }

  /** True for a node whose first wired input comes straight from the power rail. */
  private isRailFed(entry: Entry): boolean {
    const pin = entry.node.left.find((p) => this.pins.get(entry.uid)?.get(p.name)?.flowSrc);
    return pin !== undefined && this.pins.get(entry.uid)?.get(pin.name)?.flowSrc === 'rail';
  }

  /** Offset from the node's top to the input pin its preferred position is aligned with. */
  private alignedOffset(entry: Entry): number {
    if (entry.node.kind === 'or') {
      return 0;
    }
    const pin = entry.node.left.find((p) => this.pins.get(entry.uid)?.get(p.name)?.flowSrc);
    return pin ? this.pinOffset(entry.node, pin.name) : 0;
  }

  private reserve(col: number, from: number, to: number, clearance = GAP_Y): void {
    const slots = this.occupied.get(col) ?? [];
    slots.push([from, to, clearance]);
    this.occupied.set(col, slots);
  }

  private place(entry: Entry, preferred: number): void {
    this.placed.add(entry.uid);
    if (entry.node.kind === 'or') {
      entry.top = preferred;
      // a bar is a thin line, and its range already carries OR_PAD, so nothing is added around it
      this.reserve(entry.depth, preferred - OR_PAD, Math.max(...entry.orYs.values()) + OR_PAD, 0);
      return;
    }
    const height = Math.max(entry.node.h, this.spans.get(entry.uid) ?? 0);
    const slots = this.occupied.get(entry.depth) ?? [];
    const crossings = this.crossingYs(entry);
    const pinNames = [...entry.node.left, ...entry.node.right].map((p) => p.name);
    const onOwnPin = (top: number, y: number): boolean =>
      pinNames.some((name) => Math.abs(top + this.pinOffset(entry.node, name) - y) < 0.5);
    // A row keeps clear of what lies above it by the tallest label further along the row, not only its own.
    const isSymbol = entry.node.kind === 'contact' || entry.node.kind === 'coil';
    const lift = isSymbol && this.startsRow(entry) ? Math.max(0, this.rowLabelHeight(entry.uid) - entry.node.headH) : 0;
    let top = preferred;
    for (let moved = true; moved; ) {
      moved = false;
      for (const [from, to, gap] of slots) {
        if (top - lift < to + gap && top + height > from - gap) {
          top = to + gap + lift;
          moved = true;
        }
      }
      for (const y of crossings) {
        if (y > top - lift - CROSS_MARGIN && y < top + height + CROSS_MARGIN && !onOwnPin(top, y)) {
          top = y + GAP_Y + lift;
          moved = true;
        }
      }
    }
    entry.top = top;
    this.reserve(entry.depth, top, top + height);
  }

  private resetPlacement(): void {
    this.occupied.clear();
    this.placed.clear();
    this.shifts.clear();
    for (const entry of this.entries.values()) {
      entry.top = 0;
      entry.orYs.clear();
    }
  }

  /** The node whose row `entry` is aligned with, i.e. the source of its first (topmost for ORs) input. */
  private treeParent(entry: Entry): Entry | undefined {
    let best: { y: number; parent: Entry } | undefined;
    for (const pin of entry.node.left) {
      const src = this.pins.get(entry.uid)?.get(pin.name)?.flowSrc;
      const parent = src && src !== 'rail' ? this.entries.get(src.uid) : undefined;
      if (!parent) {
        if (src === 'rail' && entry.node.kind !== 'or') {
          return undefined;
        }
        continue;
      }
      if (entry.node.kind !== 'or') {
        return parent;
      }
      const y = entry.orYs.get(pin.name) ?? Number.MAX_SAFE_INTEGER;
      if (!best || y < best.y) {
        best = { y, parent };
      }
    }
    return best?.parent;
  }

  /**
   * True when `entry` is one of several parallel branches that all merge again at the OR bar `join` (and
   * nothing else hangs off the wire that feeds them). The wires of those branches end at the bar, so what
   * follows the join lies to its right and does not hang below `entry`.
   */
  private endsAtJoin(entry: Entry, join: Entry): boolean {
    if (join.node.kind !== 'or' || join.node.left.length < 2 || entry.node.kind === 'or') {
      return false;
    }
    const input = entry.node.left.find((p) => this.flowSrc(entry.uid, p.name));
    const src = input ? this.flowSrc(entry.uid, input.name) : undefined;
    if (!src || src === 'rail') {
      return false;
    }
    const siblings = this.pins.get(src.uid)?.get(src.pin)?.flowDsts ?? [];
    return siblings.every(
      (s) =>
        s.uid === entry.uid || (this.pins.get(s.uid)?.get('out')?.flowDsts ?? []).some((d) => d.uid === join.uid),
    );
  }

  /**
   * How much of a node counts towards the span of the node feeding it. A box fed by several different
   * sources only counts down to the row of that wire: the other sources line up with their own pins, so
   * they must not be pushed below the whole box.
   */
  private reservedHeight(entry: Entry): number {
    const feeders = new Set(
      entry.node.left.map((p) => {
        const src = this.flowSrc(entry.uid, p.name);
        return src === 'rail' ? 'rail' : src?.uid;
      }),
    );
    feeders.delete(undefined);
    return entry.node.kind === 'box' && feeders.size > 1 ? this.alignedOffset(entry) + ROW / 2 : entry.node.h;
  }

  /**
   * Makes every node reserve the vertical span of everything that hangs off it (its fan-out), so the
   * next node in its column lands below that subtree and no wire has to cross it. OR bars add no span
   * of their own. Returns true when a span grew and the placement has to be redone.
   */
  private growSpans(): boolean {
    const children = new Map<string, Entry[]>();
    for (const entry of this.entries.values()) {
      const parent = this.treeParent(entry);
      if (parent) {
        children.set(parent.uid, [...(children.get(parent.uid) ?? []), entry]);
      }
    }
    const memo = new Map<string, number>();
    const bottom = (entry: Entry): number => {
      const known = memo.get(entry.uid);
      if (known !== undefined) {
        return known;
      }
      memo.set(entry.uid, Number.NEGATIVE_INFINITY);
      let result = entry.node.kind === 'or' ? Number.NEGATIVE_INFINITY : entry.top + this.reservedHeight(entry);
      for (const child of children.get(entry.uid) ?? []) {
        if (!this.endsAtJoin(entry, child)) {
          result = Math.max(result, bottom(child));
        }
      }
      memo.set(entry.uid, result);
      return result;
    };
    let grew = false;
    const movedChains = new Set<string>();
    for (const entry of this.entries.values()) {
      if (entry.node.kind === 'or') {
        continue;
      }
      const span = bottom(entry) - entry.top;
      if (span > Math.max(entry.node.h, this.spans.get(entry.uid) ?? 0) + 0.5) {
        this.spans.set(entry.uid, span);
        grew = true;
      }
      grew = this.aimRailRoot(entry) || grew;
      grew = this.alignChain(entry, movedChains) || grew;
    }
    return this.alignBoxInputs(movedChains) || grew;
  }

  /**
   * The pin spacing of a box is estimated before anything is placed, so a chain, an OR group or a coil
   * can end up on another row than the pin it feeds. When it is lower (it could not reach up that far),
   * the gap above the pin is widened by the difference; when it is higher, the feeding chain is moved
   * down to the pin. Either way the placement is redone. Returns true when something moved.
   */
  private alignBoxInputs(movedChains: Set<string>): boolean {
    let grew = false;
    for (const entry of this.entries.values()) {
      for (const [i, pin] of entry.node.left.entries()) {
        const src = entry.node.kind === 'box' && i > 0 ? this.flowSrc(entry.uid, pin.name) : undefined;
        const feeder = src && src !== 'rail' ? this.entries.get(src.uid) : undefined;
        if (!src || src === 'rail' || !feeder) {
          continue;
        }
        const lag = this.pinY(feeder, src.pin) - this.pinY(entry, pin.name);
        const key = `${entry.uid}:${pin.name}`;
        const grown = this.pinGrow.get(key) ?? 0;
        const alone = (this.pins.get(feeder.uid)?.get(src.pin)?.flowDsts ?? []).length === 1;
        const root = lag < -0.5 && alone ? this.feederRoot(feeder) : undefined;
        if (lag > 0.5 && grown + lag <= MAX_PIN_GROW) {
          this.pinGrow.set(key, grown + lag);
          grew = true;
        } else if (root) {
          grew = this.moveChainDown(root, -lag, movedChains) || grew;
        }
      }
    }
    if (grew) {
      this.spaceAllBoxes();
    }
    return grew;
  }

  /** The chain start that decides the row of `feeder`: for an OR bar, the chain of its topmost input. */
  private feederRoot(feeder: Entry): Entry | undefined {
    if (feeder.node.kind !== 'or') {
      return this.beforeJoins(this.chainRoot(feeder));
    }
    const [topmost] = [...feeder.orYs].sort((a, b) => a[1] - b[1]);
    const src = topmost ? this.flowSrc(feeder.uid, topmost[0]) : undefined;
    const input = src && src !== 'rail' ? this.entries.get(src.uid) : undefined;
    return input ? this.beforeJoins(this.chainRoot(input), new Set(), feeder) : undefined;
  }

  /**
   * The node `entry` is aligned with, when its wire can stay straight: the parent feeds nothing else, or
   * `entry` is the first (primary) branch of a fan-out. The other branches of a fan-out have to step.
   */
  private straightParent(entry: Entry): { parent: Entry; ownPin: string; parentPin: string } | undefined {
    const pin = entry.node.left.find((p) => this.pins.get(entry.uid)?.get(p.name)?.flowSrc);
    const src = pin ? this.pins.get(entry.uid)?.get(pin.name)?.flowSrc : undefined;
    const parent = src && src !== 'rail' ? this.entries.get(src.uid) : undefined;
    if (!pin || !src || src === 'rail' || !parent || parent.node.kind === 'or') {
      return undefined;
    }
    const dsts = this.pins.get(parent.uid)?.get(src.pin)?.flowDsts ?? [];
    const primary = dsts[0]?.uid === entry.uid && dsts[0]?.pin === pin.name;
    return dsts.length === 1 || primary ? { parent, ownPin: pin.name, parentPin: src.pin } : undefined;
  }

  /** Start of the straight chain that `entry` belongs to, following wires that can stay straight. */
  private chainRoot(entry: Entry): Entry {
    let root = entry;
    for (let up = this.straightParent(root); up; up = this.straightParent(root)) {
      root = up.parent;
    }
    return root;
  }

  /**
   * The chain start to move down, and by how much, so that `entry` lines up with what feeds it: the
   * single-output node before it, or the OR bar before it. An OR bar outputs at the row of its topmost
   * input, so it is that input's chain that has to move.
   */
  private dragTarget(entry: Entry): { root: Entry; dy: number } | undefined {
    const link = this.straightParent(entry);
    if (link) {
      return {
        root: this.beforeJoins(this.chainRoot(link.parent)),
        dy: this.pinY(entry, link.ownPin) - this.pinY(link.parent, link.parentPin),
      };
    }
    const bar = this.joinBefore(entry);
    const pin = entry.node.left.find((p) => this.flowSrc(entry.uid, p.name));
    if (bar && pin) {
      return { root: this.beforeJoins(entry), dy: this.pinY(entry, pin.name) - this.pinY(bar, 'out') };
    }
    // The topmost of several consumers of a bar holds the bar's row. Moving the chain behind the bar is only
    // safe when it starts at the power rail; a start on a fan-out would push its neighbours around.
    const holder = pin ? this.holderJoin(entry, pin.name) : undefined;
    const root = holder ? this.feederRoot(holder) : undefined;
    return holder && pin && root && this.isRailFed(root)
      ? { root, dy: this.pinY(entry, pin.name) - this.pinY(holder, 'out') }
      : undefined;
  }

  /** The OR bar feeding `pinName` of `entry`, if `entry` is the highest of the consumers wired to its output. */
  private holderJoin(entry: Entry, pinName: string): Entry | undefined {
    const src = this.flowSrc(entry.uid, pinName);
    const bar = src && src !== 'rail' ? this.entries.get(src.uid) : undefined;
    if (bar?.node.kind !== 'or') {
      return undefined;
    }
    const own = this.pinY(entry, pinName);
    const others = (this.pins.get(bar.uid)?.get('out')?.flowDsts ?? []).filter(
      (c) => !(c.uid === entry.uid && c.pin === pinName),
    );
    const isHigher = (c: { uid: string; pin: string }): boolean => {
      const consumer = this.entries.get(c.uid);
      return consumer ? this.pinY(consumer, c.pin) > own : true;
    };
    return others.every(isHigher) ? bar : undefined;
  }

  /**
   * The OR bar that feeds `entry`, if moving `entry` moves the bar's row: it has no other consumer, or all
   * its other consumers are parallel branches that meet again at `via`, the bar being climbed through.
   */
  private joinBefore(entry: Entry, via?: Entry): Entry | undefined {
    const pin = entry.node.left.find((p) => this.flowSrc(entry.uid, p.name));
    const src = pin ? this.flowSrc(entry.uid, pin.name) : undefined;
    const bar = src && src !== 'rail' ? this.entries.get(src.uid) : undefined;
    if (bar?.node.kind !== 'or') {
      return undefined;
    }
    const consumers = this.pins.get(bar.uid)?.get('out')?.flowDsts ?? [];
    const meetAgain = (c: { uid: string }): boolean =>
      c.uid === entry.uid ||
      (via !== undefined && (this.pins.get(c.uid)?.get('out')?.flowDsts ?? []).some((d) => d.uid === via.uid));
    return consumers.length === 1 || consumers.every(meetAgain) ? bar : undefined;
  }

  /** True for a node that starts its own row: fed from the rail, or a side branch of a fan-out. */
  private startsRow(entry: Entry): boolean {
    const pin = entry.node.left.find((p) => this.flowSrc(entry.uid, p.name));
    const src = pin ? this.flowSrc(entry.uid, pin.name) : undefined;
    if (!pin || !src) {
      return false;
    }
    if (src === 'rail') {
      return true;
    }
    const parent = this.entries.get(src.uid);
    const consumers = this.pins.get(src.uid)?.get(src.pin)?.flowDsts ?? [];
    const isPrimary = consumers[0]?.uid === entry.uid && consumers[0]?.pin === pin.name;
    return parent?.node.kind !== 'or' && consumers.length > 1 && !isPrimary;
  }

  /**
   * Tallest operand label further along the row of `uid`'s output: contacts and coils in series (also
   * through OR bars) share one wire, so the row has to leave room for the tallest of their labels.
   */
  private rowLabelHeight(uid: string, pin = 'out', seen = new Set<string>()): number {
    const consumers = this.pins.get(uid)?.get(pin)?.flowDsts ?? [];
    const isOr = this.entries.get(uid)?.node.kind === 'or';
    // a fan-out only keeps its primary branch on this row; the others start rows of their own
    return (isOr ? consumers : consumers.slice(0, 1)).reduce((tallest, dst) => {
      const next = this.entries.get(dst.uid);
      if (!next || seen.has(next.uid) || next.node.kind === 'box') {
        return tallest;
      }
      seen.add(next.uid);
      const own = next.node.kind === 'or' ? 0 : next.node.headH;
      return Math.max(tallest, own, this.rowLabelHeight(next.uid, 'out', seen));
    }, 0);
  }

  /**
   * A chain that starts right behind an OR bar cannot move relative to the bar: the bar outputs at the
   * row of its topmost input, so it is the chain of that input that has to move.
   */
  private beforeJoins(root: Entry, seen = new Set<string>(), via?: Entry): Entry {
    const bar = this.joinBefore(root, via);
    if (!bar || seen.has(root.uid)) {
      return root;
    }
    seen.add(root.uid);
    const [topmost] = [...bar.orYs].sort((a, b) => a[1] - b[1]);
    const feeder = topmost ? this.flowSrc(bar.uid, topmost[0]) : undefined;
    const feederEntry = feeder && feeder !== 'rail' ? this.entries.get(feeder.uid) : undefined;
    return feederEntry ? this.beforeJoins(this.chainRoot(feederEntry), seen, bar) : root;
  }

  /**
   * A contact or coil that ended up lower than the single-output node feeding it (pushed down by a wire
   * or a neighbour) drags the start of that straight chain down by the same amount, so the wire does not
   * get a crease.
   */
  private alignChain(entry: Entry, movedChains: Set<string>): boolean {
    if (entry.node.kind === 'or') {
      return false;
    }
    const target = this.dragTarget(entry);
    if (!target || target.dy <= 0.5) {
      return false;
    }
    return this.moveChainDown(target.root, target.dy, movedChains);
  }

  /** Moves the chain starting at `top` down by `dy` in the next pass; bounded so a conflict cannot snowball. */
  private moveChainDown(top: Entry, dy: number, movedChains: Set<string>): boolean {
    const times = this.aimCount.get(top.uid) ?? 0;
    // relative to the raw preference, from where the node really sits (a neighbour may hold it lower)
    const placedTop = top.top - (this.shifts.get(top.uid) ?? 0);
    const wanted = placedTop + dy - (this.rawPrefs.get(top.uid) ?? placedTop);
    if (movedChains.has(top.uid) || times >= MAX_AIMS || wanted > MAX_AIM_SHIFT) {
      return false;
    }
    movedChains.add(top.uid);
    this.aimCount.set(top.uid, times + 1);
    this.aims.set(top.uid, wanted);
    return true;
  }

  /**
   * The box pins that the wire leaving `pin` of a node ends at. OR bars, contacts, coils and single-row
   * edge boxes (P/N/NOT) pass the row on, so the search continues through them.
   */
  private drivenPins(uid: string, pin: string, seen = new Set<string>()): Array<{ uid: string; pin: string }> {
    if (seen.has(uid)) {
      return [];
    }
    seen.add(uid);
    return (this.pins.get(uid)?.get(pin)?.flowDsts ?? []).flatMap((dst) => {
      const out = this.rowPreservingOutput(dst);
      const onward = out ? this.drivenPins(dst.uid, out, seen) : [];
      return onward.length > 0 ? onward : [dst];
    });
  }

  /**
   * The output pin through which the row of the wire arriving at `dst` continues: OR bars, contacts and
   * coils pass it on, and so does a box with a single output on the same row as that (first wired) input.
   */
  private rowPreservingOutput(dst: { uid: string; pin: string }): string | undefined {
    const node = this.entries.get(dst.uid)?.node;
    if (node?.kind === 'or' || node?.kind === 'contact' || node?.kind === 'coil') {
      return 'out';
    }
    const [output] = node?.kind === 'box' && node.right.length === 1 ? node.right : [];
    const firstWired = node?.left.find((p) => this.pins.get(dst.uid)?.get(p.name)?.flowSrc);
    const arrivesOnFirst = firstWired?.name === dst.pin;
    return output && arrivesOnFirst && firstWired.row === output.row ? output.name : undefined;
  }

  /**
   * A node fed straight from the power rail that drives a lower pin of a box is moved down to that pin's
   * row, so its wire runs straight instead of cutting across the box's other input wires.
   */
  private aimRailRoot(entry: Entry): boolean {
    const firstIn = entry.node.left[0];
    if (!firstIn || this.pins.get(entry.uid)?.get(firstIn.name)?.flowSrc !== 'rail') {
      return false;
    }
    let delta = 0;
    for (const dst of this.drivenPins(entry.uid, 'out')) {
      const dstEntry = this.entries.get(dst.uid);
      if (dstEntry?.node.kind !== 'box') {
        continue;
      }
      // the box spaces its pins so that the labels of what feeds them clear the wires above
      const row = this.pinY(dstEntry, dst.pin);
      delta = Math.max(delta, row - this.pinOffset(entry.node, 'out') - entry.top);
    }
    if (delta <= 0.5) {
      return false;
    }
    const placedTop = entry.top - (this.shifts.get(entry.uid) ?? 0);
    this.aims.set(entry.uid, placedTop + delta - (this.rawPrefs.get(entry.uid) ?? placedTop));
    return true;
  }

  /** Connected groups of parts, ignoring the power rail: one per rung, in drawing order. */
  private rungs(): Entry[][] {
    const parent = new Map<string, string>([...this.entries.keys()].map((uid) => [uid, uid]));
    const root = (uid: string): string => {
      let r = uid;
      while (parent.get(r) !== r) {
        r = parent.get(r) as string;
      }
      return r;
    };
    for (const { src, dsts } of this.net.wires) {
      if (src.kind !== 'name') {
        continue;
      }
      const uids = [src, ...dsts].flatMap((c) => (c.kind === 'name' && this.entries.has(c.uid) ? [c.uid] : []));
      for (const uid of uids.slice(1)) {
        parent.set(root(uid), root(uids[0] as string));
      }
    }
    const groups = new Map<string, Entry[]>();
    for (const entry of this.entries.values()) {
      const key = root(entry.uid);
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
    const first = (g: Entry[]): number => Math.min(...g.map((e) => e.order));
    return [...groups.values()].sort((a, b) => first(a) - first(b));
  }

  private extent(entry: Entry): [number, number] {
    return entry.node.kind === 'or'
      ? [Math.min(...entry.orYs.values()) - OR_PAD, Math.max(...entry.orYs.values()) + OR_PAD]
      : [entry.top, entry.top + entry.node.h];
  }

  private placeRung(rung: Entry[]): void {
    const byDepth = new Map<number, Entry[]>();
    for (const entry of rung) {
      byDepth.set(entry.depth, [...(byDepth.get(entry.depth) ?? []), entry]);
    }
    for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
      const group = byDepth.get(depth) ?? [];
      const preferred = new Map(group.map((e) => [e, this.preferredTop(e)] as const));
      for (const e of group) {
        this.rawPrefs.set(e.uid, (preferred.get(e) ?? 0) - (this.aims.get(e.uid) ?? 0));
      }
      // An OR bar cannot move (its inputs fix its span), so it goes first and the other nodes avoid it.
      const isOr = (e: Entry): number => (e.node.kind === 'or' ? 0 : 1);
      // Order by the row a node lines up with (not by its label top), so a tall label cannot take the
      // straight row away from the node the wire actually continues through. The aims are left out: a
      // node that was moved down keeps its place in the order, and the nodes behind it stack beneath it
      // instead of it being sent below all of them.
      const row = (e: Entry): number =>
        this.isRailFed(e) ? this.base : (this.rawPrefs.get(e.uid) ?? 0) + this.alignedOffset(e);
      group.sort((a, b) => isOr(a) - isOr(b) || row(a) - row(b) || a.order - b.order);
      for (const entry of group) {
        this.place(entry, preferred.get(entry) ?? this.base);
      }
    }
  }

  /** Places rung after rung, each in its own vertical band, so wires of different rungs never meet. */
  private placeAll(): void {
    let band = MARGIN_TOP;
    for (const rung of this.rungs()) {
      this.base = band;
      this.placeRung(rung);
      const top = Math.min(...rung.map((e) => this.extent(e)[0]));
      if (top < band) {
        this.shiftRung(rung, band - top);
      }
      band = Math.max(...rung.map((e) => this.extent(e)[1])) + GAP_Y;
    }
  }

  private shiftRung(rung: Entry[], dy: number): void {
    for (const entry of rung) {
      entry.top += dy;
      this.shifts.set(entry.uid, dy);
      for (const [name, y] of entry.orYs) {
        entry.orYs.set(name, y + dy);
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
    const y = entry.top + node.headH + SYM_LINE;
    // a coil with a long mark (RET, JMPN) is drawn wider so the text sits between its parentheses
    const half = node.kind === 'coil' ? Math.max(SYMBOL_HALF, node.mark.length * 3.5 + 5) : SYMBOL_HALF;
    this.wire([col.left, y], [cx - half, y]);
    this.wire([cx + half, y], [col.right, y]);
    if (node.kind === 'contact') {
      this.out.push({ t: 'contact', cx, y, negated: node.negated, edge: node.edge });
    } else {
      this.out.push({ t: 'coil', cx, y, mark: node.mark, half });
      if (this.hasNoFlowDst(entry.uid, 'out')) {
        this.out.push({ t: 'line', pts: [[col.right, y - TICK], [col.right, y + TICK]], cls: 'tick' });
      }
    }
    node.headLines.forEach((line, i) => {
      this.out.push({ t: 'text', x: cx, y: entry.top + 11 + i * HEAD_LINE, s: line, cls: 'operand', anchor: 'middle' });
    });
  }

  private emitBox(entry: Entry, col: Column): void {
    const { node } = entry;
    const boxTop = entry.top + node.headH;
    const boxH = node.h - node.headH - node.footH;
    const width = col.right - col.left;
    this.out.push({ t: 'box', x: col.left, y: boxTop, w: width, h: boxH, headH: TITLE_H });
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
    node.footLines.forEach((line, i) => {
      this.out.push({
        t: 'text',
        x: col.left + width / 2,
        y: boxTop + boxH + (i + 1) * HEAD_LINE,
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
        y: boxTop + boxH - 2,
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
    this.net.wires.forEach(({ src, dsts }, netIndex) => {
      const srcEntry = src.kind === 'name' ? this.entries.get(src.uid) : undefined;
      const from = srcEntry && src.kind === 'name' ? this.pinPoint(srcEntry, src.pin, 'R') : undefined;
      for (const dst of dsts) {
        const dstEntry = dst.kind === 'name' ? this.entries.get(dst.uid) : undefined;
        const to = dstEntry && dst.kind === 'name' ? this.pinPoint(dstEntry, dst.pin, 'L') : undefined;
        if (!dstEntry || !to) {
          continue;
        }
        if (src.kind === 'rail') {
          this.out.push({ t: 'line', pts: [[RAIL_X, to[1]], to], cls: 'wire', net: netIndex });
        } else if (from) {
          this.out.push({ t: 'line', pts: this.route(from, to, this.column(dstEntry).start), cls: 'wire', net: netIndex });
        }
      }
    });
  }
}

/** Lays out the FlgNet of one LAD network as drawing instructions. */
export function layoutLad(net: FlgNet): LadScene {
  if (net.parts.size === 0) {
    return {
      width: 48,
      height: 30,
      items: [{ t: 'line', pts: [[RAIL_X, 0], [RAIL_X, 30]], cls: 'rail' }],
      ...(net.labels?.length ? { labels: net.labels } : {}),
    };
  }
  const scene = new LadLayout(net).run();
  if (net.labels?.length) {
    scene.labels = net.labels;
  }
  if (!Number.isFinite(scene.width) || !Number.isFinite(scene.height)) {
    throw new Error('LAD layout produced invalid geometry');
  }
  return scene;
}
