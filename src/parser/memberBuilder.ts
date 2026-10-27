import type { InterfaceMember } from '../model/types';
import type { RawMember, TypeNode } from './declParser';
import { defaultStart } from './typeDefaults';

/** Looks up the members of a UDT by name (case-insensitive); undefined when unknown. */
export type UdtResolver = (name: string) => RawMember[] | undefined;

const MAX_ARRAY_ELEMENTS = 512;
const MAX_ROWS = 20_000;
const MAX_UDT_DEPTH = 8;

export interface Flags {
  accessible: boolean;
  writable: boolean;
  visible: boolean;
}

export interface BuildContext {
  /** `BEGIN` assignments by lower-cased path (`info.lastcycletime`, `arr[3].x`). */
  assignments: ReadonlyMap<string, string>;
  resolve: UdtResolver;
  /** Data blocks: members are retained (shown as a checkbox). */
  retain: boolean;
  /** Block interfaces: text of the Retain column, empty for none. */
  retainText: string;
  /** Block interfaces: leave structured members (struct, array, UDT) without a retain text. */
  retainSimpleOnly: boolean;
  /** Show the greyed type default when a member has no start value. */
  showDefaults: boolean;
  rows: number;
  udtStack: string[];
}

export const ROOT_FLAGS: Flags = { accessible: true, writable: true, visible: true };

export function createContext(resolve: UdtResolver, assignments: ReadonlyMap<string, string> = new Map()): BuildContext {
  return { assignments, resolve, retain: false, retainText: '', retainSimpleOnly: false, showDefaults: true, rows: 0, udtStack: [] };
}

function typeText(type: TypeNode): string {
  switch (type.kind) {
    case 'simple':
      return type.text;
    case 'struct':
      return 'Struct';
    case 'array':
      return `Array[${type.inner}] of ${typeText(type.elem)}`;
  }
}

const childPath = (parent: string, name: string): string =>
  parent === '' ? name : name.startsWith('[') ? `${parent}${name}` : `${parent}.${name}`;

function expandArray(
  type: Extract<TypeNode, { kind: 'array' }>,
  ctx: BuildContext,
  flags: Flags,
  path: string,
): InterfaceMember[] {
  const { dims } = type;
  if (!dims) {
    return [];
  }
  const total = dims.reduce((product, [lo, hi]) => product * Math.max(0, hi - lo + 1), 1);
  if (total === 0 || total > MAX_ARRAY_ELEMENTS || ctx.rows + total > MAX_ROWS) {
    return [];
  }
  const index = dims.map(([lo]) => lo);
  const elements: InterfaceMember[] = [];
  for (let n = 0; n < total && ctx.rows < MAX_ROWS; n++) {
    const element: RawMember = { name: `[${index.join(',')}]`, pragmas: {}, type: type.elem, init: '', comment: '' };
    elements.push(buildMember(element, ctx, flags, path));
    for (let d = index.length - 1; d >= 0; d--) {
      const [lo, hi] = dims[d] as [number, number];
      index[d] = (index[d] as number) + 1;
      if ((index[d] as number) <= hi) {
        break;
      }
      index[d] = lo;
    }
  }
  return elements;
}

function expandUdt(text: string, ctx: BuildContext, flags: Flags, path: string): InterfaceMember[] {
  if (!text.startsWith('"')) {
    return [];
  }
  const name = text.slice(1, -1);
  const key = name.toLowerCase();
  const members = ctx.resolve(name);
  if (!members || ctx.udtStack.length >= MAX_UDT_DEPTH || ctx.udtStack.includes(key) || ctx.rows >= MAX_ROWS) {
    return [];
  }
  ctx.udtStack.push(key);
  try {
    return members.map((m) => buildMember(m, ctx, flags, path));
  } finally {
    ctx.udtStack.pop();
  }
}

function buildChildren(type: TypeNode, ctx: BuildContext, flags: Flags, path: string): InterfaceMember[] {
  switch (type.kind) {
    case 'struct':
      // an array of inline structs would otherwise multiply its members past any row limit
      return ctx.rows >= MAX_ROWS ? [] : type.members.map((m) => buildMember(m, ctx, flags, path));
    case 'array':
      return expandArray(type, ctx, flags, path);
    case 'simple':
      return expandUdt(type.text, ctx, flags, path);
  }
}

/** Turns a declared member into a table row, expanding structs, arrays and resolvable UDTs. */
export function buildMember(raw: RawMember, ctx: BuildContext, parent: Flags, parentPath: string): InterfaceMember {
  ctx.rows++;
  const path = childPath(parentPath, raw.name);
  const pragma = (key: string): boolean | undefined => {
    const value = raw.pragmas[key];
    return value === undefined ? undefined : value.toLowerCase() === 'true';
  };
  const accessible = (pragma('externalaccessible') ?? true) && parent.accessible;
  const flags: Flags = {
    accessible,
    writable: (pragma('externalwritable') ?? true) && accessible && parent.writable,
    visible: (pragma('externalvisible') ?? true) && accessible && parent.visible,
  };
  const children = buildChildren(raw.type, ctx, flags, path);
  const datatype = typeText(raw.type);
  const explicit = ctx.assignments.get(path.toLowerCase()) ?? (raw.init || undefined);
  const fallback = ctx.showDefaults ? defaultStart(datatype) : undefined;
  const structured = raw.type.kind !== 'simple' || raw.type.text.startsWith('"');
  return {
    name: raw.name,
    datatype: raw.overlay ? `${datatype} AT ${raw.overlay}` : datatype,
    startValue: explicit ?? fallback ?? '',
    startIsDefault: explicit === undefined && fallback !== undefined,
    retain: ctx.retainSimpleOnly && structured ? '' : ctx.retainText,
    retainChecked: ctx.retain,
    ...flags,
    setpoint: pragma('s7_setpoint') ?? false,
    comment: raw.comment,
    children,
  };
}
