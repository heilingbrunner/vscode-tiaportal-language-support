import { Cursor } from './dbCursor';
import { parseMembers, type RawMember } from './declParser';

export interface UdtDefinition {
  name: string;
  members: RawMember[];
}

/** Parses a `TYPE "Name" ... STRUCT ... END_STRUCT; END_TYPE` source file. */
export function parseUdt(source: string): UdtDefinition {
  const cur = new Cursor(source);
  if (!cur.eatWord('TYPE')) {
    cur.fail('TYPE expected');
  }
  const name = cur.name();
  for (;;) {
    const next = cur.peek();
    if (next === '') {
      cur.fail('STRUCT expected');
    }
    if (next === '{') {
      cur.pragma();
    } else if (cur.eatWord('STRUCT')) {
      cur.trailingComment();
      return { name, members: parseMembers(cur, 'END_STRUCT') };
    } else {
      cur.restOfLine();
    }
  }
}
