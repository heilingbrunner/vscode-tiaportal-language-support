import type { BlockModel } from '../model/types';
import { Cursor } from './dbCursor';
import { parseMembers, type RawMember } from './declParser';
import { buildMember, createContext, ROOT_FLAGS, type UdtResolver } from './memberBuilder';

export interface UdtDefinition {
  name: string;
  /** Text of the `VERSION : x` header line, empty when the file has none. */
  version: string;
  members: RawMember[];
}

/** Parses a `TYPE "Name" ... STRUCT ... END_STRUCT; END_TYPE` source file. */
export function parseUdt(source: string): UdtDefinition {
  const cur = new Cursor(source);
  if (!cur.eatWord('TYPE')) {
    cur.fail('TYPE expected');
  }
  const name = cur.name();
  let version = '';
  for (;;) {
    const next = cur.peek();
    if (next === '') {
      cur.fail('STRUCT expected');
    }
    if (next === '{') {
      cur.pragma();
    } else if (cur.peekWord().toUpperCase() === 'VERSION') {
      cur.word();
      cur.eat(':');
      version = cur.restOfLine();
    } else if (cur.eatWord('STRUCT')) {
      cur.trailingComment();
      return { name, version, members: parseMembers(cur, 'END_STRUCT') };
    } else {
      cur.restOfLine();
    }
  }
}

/**
 * Parses a UDT source into a view model: one unnamed section with the members of the type, referenced
 * UDTs, structs and arrays expanded through `resolve`.
 */
export function parseUdtModel(source: string, resolve: UdtResolver = () => undefined): BlockModel {
  const { name, version, members } = parseUdt(source);
  const ctx = createContext(resolve);
  // a type that contains itself must not expand into itself
  ctx.udtStack.push(name.toLowerCase());
  const rows = members.map((m) => buildMember(m, ctx, ROOT_FLAGS, ''));
  return {
    kind: 'UDT',
    name,
    number: '',
    language: 'UDT',
    memoryLayout: '',
    title: '',
    comment: '',
    sections: [{ name: '', members: rows }],
    networks: [],
    typeInfo: { version },
  };
}
