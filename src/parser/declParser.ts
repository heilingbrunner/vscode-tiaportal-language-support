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
  const upper = word.toUpperCase();
  if (upper === 'STRUCT') {
    const comment = cur.trailingComment();
    return { type: { kind: 'struct', members: parseMembers(cur, 'END_STRUCT', depth + 1) }, comment };
  }
  if (upper === 'ARRAY') {
    cur.expect('[');
    const inner = cur.readBalanced('[', ']');
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
  const name = cur.name();
  let pragmas = cur.pragma();
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
      init = cur.initText();
    }
    cur.expect(';');
  }
  return { name, pragmas, type: parsed.type, init, comment: parsed.comment || cur.trailingComment(), overlay };
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
