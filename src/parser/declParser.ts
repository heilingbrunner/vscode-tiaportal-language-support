import type { Cursor } from './dbCursor';

export type TypeNode =
  | { kind: 'simple'; text: string }
  | { kind: 'struct'; members: RawMember[] }
  | { kind: 'array'; dims: Array<[number, number]> | undefined; inner: string; elem: TypeNode };

/** One declared variable as written in a DB `VAR` section or a UDT `STRUCT`. */
export interface RawMember {
  name: string;
  /** Pragma values, keys lower-cased (`externalaccessible`, `s7_setpoint`, ...). */
  pragmas: Record<string, string>;
  type: TypeNode;
  /** Initial value as written (`:= ...`), empty when absent. */
  init: string;
  comment: string;
  /** Overlay target of an `AT` declaration (`Name AT Other : Type;`), empty when absent. */
  overlay?: string;
}

/** Guards against hostile nesting; real exports stay far below this. */
const MAX_NESTING = 32;
const DIM = /^\s*(-?\d+)\s*\.\.\s*(-?\d+)\s*$/;
/** `.s7dcl` global scope reference (`_.NoOfModul`), written `"NoOfModul"` in classic sources. */
const GLOBAL_NAME = /(?<![A-Za-z0-9_])_\.([A-Za-z_][A-Za-z0-9_]*)/g;
const S7_ELEMENT_ATTRIBUTES = /\{\s*S7_[^}]*\}/g;

/** Maps the `.s7dcl` access attributes onto the classic `External*` pragmas that `buildMember` reads. */
function withExternalFlags(attributes: Record<string, string>): Record<string, string> {
  const access = (attributes.s7_access ?? '').toLowerCase();
  const visibility = (attributes.s7_visibility ?? '').toLowerCase();
  const pragmas = { ...attributes };
  if (access.startsWith('readonly')) {
    pragmas.externalwritable = 'False';
  }
  if (visibility.startsWith('hidden')) {
    pragmas.externalaccessible = 'False';
  } else if (visibility.startsWith('unlisted')) {
    pragmas.externalvisible = 'False';
  }
  return pragmas;
}

/** Initial values may span lines and carry per-element `{ S7_MLC := ... }` attributes (`.s7dcl`). */
const tidyInit = (init: string): string => init.replace(S7_ELEMENT_ATTRIBUTES, '').replace(/\s*\n\s*/g, ' ').trim();

function parseDims(inner: string): Array<[number, number]> | undefined {
  const dims: Array<[number, number]> = [];
  for (const part of inner.split(',')) {
    const match = DIM.exec(part);
    if (!match) {
      return undefined;
    }
    dims.push([Number(match[1]), Number(match[2])]);
  }
  return dims;
}

interface ParsedType {
  type: TypeNode;
  /** Comment written on the line of a `Struct` keyword. */
  comment: string;
}

function parseType(cur: Cursor, depth: number): ParsedType {
  if (depth > MAX_NESTING) {
    cur.fail('type nested too deeply');
  }
  if (cur.peek() === '"') {
    return { type: { kind: 'simple', text: `"${cur.quoted()}"` }, comment: '' };
  }
  const word = cur.word();
  if (word === '_' && cur.eatInline('.')) {
    // `.s7dcl` global scope: `_.Name` is the classic `"Name"`
    return { type: { kind: 'simple', text: `"${cur.name()}"` }, comment: '' };
  }
  const upper = word.toUpperCase();
  if (upper === 'STRUCT') {
    const comment = cur.trailingComment();
    return { type: { kind: 'struct', members: parseMembers(cur, 'END_STRUCT', depth + 1) }, comment };
  }
  if (upper === 'ARRAY') {
    cur.expect('[');
    const inner = cur.readBalanced('[', ']').replace(GLOBAL_NAME, '"$1"');
    if (!cur.eatWord('OF')) {
      cur.fail("'of' expected");
    }
    const elem = parseType(cur, depth + 1);
    return { type: { kind: 'array', dims: parseDims(inner), inner, elem: elem.type }, comment: elem.comment };
  }
  let text = word;
  if (cur.eatInline('[')) {
    text += `[${cur.readBalanced('[', ']')}]`;
  } else if (cur.eatInline('(')) {
    text += `(${cur.readBalanced('(', ')')})`;
  }
  return { type: { kind: 'simple', text }, comment: '' };
}

/** True when the type ends with `END_STRUCT;`, which already consumed the member's `;`. */
function endsWithStruct(type: TypeNode): boolean {
  return type.kind === 'struct' || (type.kind === 'array' && endsWithStruct(type.elem));
}

function parseMember(cur: Cursor, depth: number): RawMember {
  // `.s7dcl` puts the attribute block before the name, classic sources after it
  const attributes = cur.pragma();
  const name = cur.name();
  let pragmas = Object.keys(attributes).length > 0 ? withExternalFlags(attributes) : cur.pragma();
  let overlay = '';
  if (cur.eatWord('AT')) {
    overlay = cur.name();
    while (cur.eatInline('.')) {
      overlay += `.${cur.name()}`;
    }
    if (Object.keys(pragmas).length === 0) {
      pragmas = cur.pragma();
    }
  }
  cur.expect(':');
  const parsed = parseType(cur, depth);
  let init = '';
  if (!endsWithStruct(parsed.type)) {
    if (cur.eat(':=')) {
      init = tidyInit(cur.initText());
    }
    cur.expect(';');
  }
  return { name, pragmas, type: parsed.type, init, comment: parsed.comment || cur.trailingComment(), overlay };
}

/** Parses a type without a trailing `;` (the body of an `.s7dcl` data block: `Array[0..19] of Real`). */
export function parseDeclaredType(cur: Cursor): TypeNode {
  return parseType(cur, 0).type;
}

/** Parses a type that forms the whole body of a data block (`Array[0..19] of Real;`). */
export function parseStandaloneType(cur: Cursor): TypeNode {
  const { type } = parseType(cur, 0);
  if (!endsWithStruct(type)) {
    cur.expect(';');
  }
  return type;
}

/** Parses declarations up to and including `endWord` (`END_VAR` or `END_STRUCT`). */
export function parseMembers(cur: Cursor, endWord: string, depth = 0): RawMember[] {
  if (depth > MAX_NESTING) {
    cur.fail('structure nested too deeply');
  }
  const members: RawMember[] = [];
  for (;;) {
    if (cur.peek() === '') {
      cur.fail(`${endWord} expected`);
    }
    if (cur.eatWord(endWord)) {
      cur.eatInline(';');
      return members;
    }
    members.push(parseMember(cur, depth));
  }
}
