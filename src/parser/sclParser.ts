import type { BlockKind, BlockModel, InterfaceMember, InterfaceSection } from '../model/types';
import { splitNetworks } from './awlNetworks';
import { Cursor } from './dbCursor';
import { parseMembers, type RawMember } from './declParser';
import { buildMember, createContext, ROOT_FLAGS, type UdtResolver } from './memberBuilder';
import { analyzeStructure, scanLine } from './sclStructure';

const BLOCK_KINDS: Record<string, BlockKind> = {
  FUNCTION_BLOCK: 'FB',
  FUNCTION: 'FC',
  ORGANIZATION_BLOCK: 'OB',
};
const SECTION_NAMES: Record<string, string> = {
  VAR_INPUT: 'Input',
  VAR_OUTPUT: 'Output',
  VAR_IN_OUT: 'InOut',
  VAR: 'Static',
  VAR_TEMP: 'Temp',
};
/** Sections TIA always shows for a block kind, in TIA order (empty ones included). */
const STANDARD_SECTIONS: Record<BlockKind, string[]> = {
  FB: ['Input', 'Output', 'InOut', 'Static', 'Temp', 'Constant'],
  FC: ['Input', 'Output', 'InOut', 'Temp', 'Constant', 'Return'],
  OB: ['Input', 'Temp', 'Constant'],
  DB: [],
  UDT: [],
};
const RETAIN_SECTIONS = new Set(['Input', 'Output', 'InOut', 'Static']);
const END_KEYWORD = /^\s*END_(?:FUNCTION_BLOCK|FUNCTION|ORGANIZATION_BLOCK)\b/;
const MAX_CODE_LINES = 100_000;

interface SectionGroup {
  name: string;
  members: RawMember[];
  retain: boolean;
}

interface Header {
  optimizedAccess: boolean;
  title: string;
}

const stripComment = (text: string): string => text.replace(/\/\/.*$/, '').trim();

function readSection(cur: Cursor, word: string): SectionGroup {
  cur.word();
  let name = SECTION_NAMES[word] as string;
  let retain = false;
  // modifiers share the line of the section keyword (`VAR RETAIN`, `VAR CONSTANT`, `VAR_INPUT DB_SPECIFIC`)
  for (;;) {
    if (cur.eatInlineWord('RETAIN')) {
      retain = true;
    } else if (cur.eatInlineWord('CONSTANT')) {
      name = 'Constant';
    } else if (!cur.eatInlineWord('NON_RETAIN') && !cur.eatInlineWord('DB_SPECIFIC')) {
      break;
    }
  }
  return { name, members: parseMembers(cur, 'END_VAR'), retain };
}

/** Handles one header line (`TITLE = ...`, `VERSION : 0.1`, ...); unknown lines are skipped. */
function readHeaderLine(cur: Cursor, word: string, header: Header): void {
  if (word) {
    cur.word();
  }
  if (word === 'TITLE') {
    cur.eat('=');
    header.title = cur.restOfLine();
  } else {
    cur.restOfLine();
  }
}

/** The code between `BEGIN` and the closing `END_*` keyword, one entry per line, without the BEGIN line. */
function extractCode(remainder: string): string[] {
  const [, ...rest] = remainder.split(/\r?\n/);
  const lines: string[] = [];
  let inComment = false;
  for (const line of rest) {
    const scanned = scanLine(line, inComment);
    // the closing END_* keyword only counts outside comments and strings
    if (!inComment && END_KEYWORD.test(scanned.clean)) {
      break;
    }
    inComment = scanned.inBlockComment;
    lines.push(line);
    if (lines.length >= MAX_CODE_LINES) {
      break;
    }
  }
  while (lines.length > 0 && (lines[lines.length - 1] as string).trim() === '') {
    lines.pop();
  }
  return lines;
}

function buildSections(kind: BlockKind, groups: SectionGroup[], returnType: string, resolve: UdtResolver): InterfaceSection[] {
  const returns: RawMember[] =
    returnType !== '' && returnType.toLowerCase() !== 'void'
      ? [{ name: 'Ret_Val', pragmas: {}, type: { kind: 'simple', text: returnType }, init: '', comment: '' }]
      : [];
  const all = [...groups, { name: 'Return', members: returns, retain: false }];
  const names = [...STANDARD_SECTIONS[kind], ...all.map((g) => g.name)].filter((n, i, list) => list.indexOf(n) === i);
  const ctx = createContext(resolve);
  return names
    .map((name) => {
      const members: InterfaceMember[] = all
        .filter((g) => g.name === name)
        .flatMap((group) => {
          ctx.retain = false;
          ctx.showDefaults = RETAIN_SECTIONS.has(name);
          ctx.retainText = RETAIN_SECTIONS.has(name) ? (group.retain ? 'Retain' : 'Non-retain') : '';
          ctx.retainSimpleOnly = name === 'InOut';
          return group.members.map((m) => buildMember(m, ctx, ROOT_FLAGS, ''));
        });
      return { name, members };
    })
    .filter((s) => STANDARD_SECTIONS[kind].includes(s.name) || s.members.length > 0);
}

/** SCL and STL sources share the block header and the variable sections; only the code part differs. */
function parseSource(source: string, resolve: UdtResolver, language: 'SCL' | 'STL'): BlockModel {
  const cur = new Cursor(source);
  const keyword = cur.peekWord().toUpperCase();
  if (!Object.hasOwn(BLOCK_KINDS, keyword)) {
    cur.fail('FUNCTION_BLOCK, FUNCTION or ORGANIZATION_BLOCK expected');
  }
  cur.word();
  const kind = BLOCK_KINDS[keyword] as BlockKind;
  const name = cur.name();
  const returnType = kind === 'FC' && cur.eatInline(':') ? stripComment(cur.restOfLine()) : '';

  const header: Header = { optimizedAccess: false, title: '' };
  const groups: SectionGroup[] = [];
  let code: string[] = [];
  for (let next = cur.peek(); next !== ''; next = cur.peek()) {
    if (next === '{') {
      const optimized = cur.pragma().s7_optimized_access;
      header.optimizedAccess = optimized !== undefined ? optimized.toLowerCase() === 'true' : header.optimizedAccess;
      continue;
    }
    const word = cur.peekWord().toUpperCase();
    if (word === 'BEGIN') {
      cur.word();
      code = extractCode(cur.remainder());
      break;
    }
    if (Object.hasOwn(SECTION_NAMES, word)) {
      groups.push(readSection(cur, word));
    } else {
      readHeaderLine(cur, word, header);
    }
  }

  return {
    kind,
    name,
    number: '',
    language,
    memoryLayout: header.optimizedAccess ? 'Optimized' : 'Standard',
    title: header.title,
    comment: '',
    sections: buildSections(kind, groups, returnType, resolve),
    networks: language === 'STL' ? splitNetworks(code) : [],
    code: language === 'SCL' ? { lines: code, ...analyzeStructure(code) } : undefined,
  };
}

/** Parses a TIA SCL source (`FUNCTION_BLOCK`, `FUNCTION` or `ORGANIZATION_BLOCK`) into a view model. */
export function parseScl(source: string, resolve: UdtResolver = () => undefined): BlockModel {
  return parseSource(source, resolve, 'SCL');
}

/** Parses a TIA STL source (`.awl` / `.stl`): the same block header, followed by `NETWORK` sections. */
export function parseAwl(source: string, resolve: UdtResolver = () => undefined): BlockModel {
  return parseSource(source, resolve, 'STL');
}
