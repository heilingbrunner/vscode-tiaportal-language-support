import type { BlockModel, InterfaceMember } from '../model/types';
import { Cursor } from './dbCursor';
import { parseMembers, parseStandaloneType, type RawMember, type TypeNode } from './declParser';
import { buildMember, createContext, ROOT_FLAGS, type BuildContext, type UdtResolver } from './memberBuilder';

export type { UdtResolver } from './memberBuilder';

interface Header {
  optimizedAccess: boolean;
  nonRetain: boolean;
  /** `RETAIN` in the header: every member is retained. */
  retainAll: boolean;
  version: string;
  family: string;
  author: string;
  title: string;
  instanceOf: string;
}

interface VarSection {
  members: RawMember[];
  retain: boolean;
  /** The members are one anonymous array that forms the whole block; show its elements as rows. */
  flatten?: boolean;
}

const anonymous = (type: TypeNode): RawMember => ({ name: '', pragmas: {}, type, init: '', comment: '' });

/** Builds the rows of a section; an anonymous array body is shown as its element rows. */
function buildSection(section: VarSection, ctx: BuildContext): InterfaceMember[] {
  ctx.retain = section.retain;
  const built = section.members.map((m) => buildMember(m, ctx, ROOT_FLAGS, ''));
  return section.flatten
    ? built.flatMap((b) => (b.children.length > 0 ? b.children : [{ ...b, name: b.datatype }]))
    : built;
}

/** Reads `Path.To[3].Member := value;` statements up to `END_DATA_BLOCK`. */
export function parseAssignments(cur: Cursor): Map<string, string> {
  const assignments = new Map<string, string>();
  while (cur.peek() !== '' && !cur.eatWord('END_DATA_BLOCK')) {
    if (cur.peek() === '{') {
      // `.s7dcl` attribute block (`{ S7_MLC := "..." }`) in front of an assignment
      cur.pragma();
      continue;
    }
    let path = '';
    for (;;) {
      path += cur.name();
      while (cur.eatInline('[')) {
        path += `[${cur.readBalanced('[', ']').replace(/\s+/g, '')}]`;
      }
      if (!cur.eatInline('.')) {
        break;
      }
      path += '.';
    }
    cur.expect(':=');
    assignments.set(path.toLowerCase(), cur.initText());
    cur.expect(';');
  }
  return assignments;
}

/** Handles one header line (`TITLE = ...`, `VERSION : 0.1`, `NON_RETAIN`, ...); unknown lines are skipped. */
function readHeaderLine(cur: Cursor, word: string, header: Header): void {
  if (!word) {
    cur.restOfLine();
    return;
  }
  cur.word();
  switch (word) {
    case 'TITLE':
      cur.eat('=');
      header.title = cur.restOfLine();
      break;
    case 'VERSION':
    case 'FAMILY':
    case 'AUTHOR': {
      cur.eat(':');
      header[word.toLowerCase() as 'version' | 'family' | 'author'] = cur.restOfLine();
      break;
    }
    case 'NON_RETAIN':
      header.nonRetain = true;
      break;
    case 'RETAIN':
      header.retainAll = true;
      break;
    default:
      cur.restOfLine();
  }
}

/** Parses a TIA data block source (`DATA_BLOCK "Name" ... END_DATA_BLOCK`) into a view model. */
export function parseDataBlock(source: string, resolve: UdtResolver = () => undefined): BlockModel {
  const cur = new Cursor(source);
  if (!cur.eatWord('DATA_BLOCK')) {
    cur.fail('DATA_BLOCK expected');
  }
  const name = cur.name();
  const header: Header = {
    optimizedAccess: false,
    nonRetain: false,
    retainAll: false,
    version: '',
    family: '',
    author: '',
    title: '',
    instanceOf: '',
  };
  const sections: VarSection[] = [];
  let assignments: ReadonlyMap<string, string> = new Map();

  for (let next = cur.peek(); next !== ''; next = cur.peek()) {
    if (next === '{') {
      const optimized = cur.pragma().s7_optimized_access;
      header.optimizedAccess = optimized !== undefined ? optimized.toLowerCase() === 'true' : header.optimizedAccess;
    } else if (next === '"') {
      header.instanceOf = cur.quoted();
    } else {
      const word = cur.peekWord().toUpperCase();
      if (word === 'BEGIN') {
        cur.word();
        assignments = parseAssignments(cur);
        break;
      }
      if (word === 'END_DATA_BLOCK') {
        break;
      }
      if (word === 'VAR') {
        cur.word();
        const retain = cur.eatWord('RETAIN') || header.retainAll;
        sections.push({ members: parseMembers(cur, 'END_VAR'), retain });
      } else if (word === 'ARRAY') {
        sections.push({ members: [anonymous(parseStandaloneType(cur))], retain: header.retainAll, flatten: true });
      } else if (word === 'STRUCT') {
        // non-optimized data blocks declare their members in a STRUCT body instead of VAR
        cur.word();
        cur.trailingComment();
        sections.push({ members: parseMembers(cur, 'END_STRUCT'), retain: header.retainAll });
      } else {
        readHeaderLine(cur, word, header);
      }
    }
  }

  // `DATA_BLOCK "X"` + `"Name"` is an instance DB, unless Name is a UDT: then the block is based on that type
  const udtMembers = header.instanceOf === '' ? undefined : resolve(header.instanceOf);
  if (udtMembers) {
    sections.push({ members: udtMembers, retain: header.retainAll });
    header.instanceOf = '';
  }
  const ctx = createContext(resolve, assignments);
  const members = sections.flatMap((section) => buildSection(section, ctx));
  return {
    kind: 'DB',
    name,
    number: '',
    language: 'DB',
    memoryLayout: header.optimizedAccess ? 'Optimized' : 'Standard',
    title: header.title,
    comment: '',
    sections: sections.length > 0 ? [{ name: 'Static', members }] : [],
    networks: [],
    dataBlock: {
      optimizedAccess: header.optimizedAccess,
      nonRetain: header.nonRetain,
      version: header.version,
      family: header.family,
      author: header.author,
      instanceOf: header.instanceOf,
    },
  };
}
