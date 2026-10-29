import { layoutLad } from '../layout/ladLayout';
import type { BlockKind, BlockModel, NetworkModel } from '../model/types';
import { Cursor } from './dbCursor';
import { parseAssignments } from './dbParser';
import { parseDeclaredType, parseMembers, type RawMember, type TypeNode } from './declParser';
import { buildMember, createContext, ROOT_FLAGS, type UdtResolver } from './memberBuilder';
import type { TextTable } from './s7res';
import { parseSdLad } from './sdLadParser';
import { BLOCK_KINDS, buildSections, readSection, type SectionGroup } from './sclParser';
import { analyzeStructure, scanLine } from './sclStructure';

export type S7Attributes = Record<string, string>;

/** A type declared in a `.s7dcl` file, comments already resolved from the `.s7res` texts. */
export interface S7dclUdt {
  name: string;
  version: string;
  title: string;
  comment: string;
  members: RawMember[];
}

const BLOCK_START = /^﻿?\s*(?:\{[^}]*\}\s*)*(TYPE|DATA_BLOCK|FUNCTION_BLOCK|FUNCTION|ORGANIZATION_BLOCK)(?![A-Za-z0-9_])/;

/** The declaration keyword that opens the file (after any attribute blocks), or undefined. */
export function s7dclBlockKeyword(source: string): string | undefined {
  return BLOCK_START.exec(source)?.[1];
}

/** Reads consecutive `{ S7_Key := "value"; ... }` blocks into one record with lower-cased keys. */
export function readAttributes(cur: Cursor): S7Attributes {
  const attributes: S7Attributes = Object.create(null) as S7Attributes;
  while (cur.peek() === '{') {
    Object.assign(attributes, cur.pragma());
  }
  return attributes;
}

/** Text for a multilingual text id; the id itself when the `.s7res` has no such entry. */
export function textOf(texts: TextTable | undefined, id: string | undefined): string {
  if (!id) {
    return '';
  }
  return texts?.get(id)?.trimEnd() ?? id;
}

function typeWithTexts(type: TypeNode, texts: TextTable | undefined): TypeNode {
  switch (type.kind) {
    case 'struct':
      return { ...type, members: membersWithTexts(type.members, texts) };
    case 'array':
      return { ...type, elem: typeWithTexts(type.elem, texts) };
    case 'simple':
      return type;
  }
}

/** Replaces the `S7_MLC` text id of every member (and nested member) by its text. */
export function membersWithTexts(members: RawMember[], texts: TextTable | undefined): RawMember[] {
  return members.map((m) => ({
    ...m,
    comment: m.pragmas.s7_mlc === undefined ? m.comment : textOf(texts, m.pragmas.s7_mlc),
    type: typeWithTexts(m.type, texts),
  }));
}

const isTrue = (value: string | undefined): boolean => value?.toLowerCase() === 'true';

/** Parses `TYPE Name : STRUCT ... END_STRUCT; END_TYPE`. */
export function parseS7dclUdt(source: string, texts?: TextTable): S7dclUdt {
  const cur = new Cursor(source);
  const attributes = readAttributes(cur);
  if (!cur.eatWord('TYPE')) {
    cur.fail('TYPE expected');
  }
  Object.assign(attributes, readAttributes(cur));
  const name = cur.name();
  cur.expect(':');
  if (!cur.eatWord('STRUCT')) {
    cur.fail('STRUCT expected');
  }
  cur.trailingComment();
  const members = membersWithTexts(parseMembers(cur, 'END_STRUCT'), texts);
  return {
    name,
    version: attributes.s7_version ?? '',
    title: textOf(texts, attributes.s7_blocktitle),
    comment: textOf(texts, attributes.s7_blockcomment),
    members,
  };
}

function udtModel(source: string, texts: TextTable | undefined, resolve: UdtResolver): BlockModel {
  const { name, version, title, comment, members } = parseS7dclUdt(source, texts);
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
    title,
    comment,
    sections: [{ name: '', members: rows }],
    networks: [],
    typeInfo: { version },
  };
}

interface VarSection {
  members: RawMember[];
  retain: boolean;
  /** The members are one anonymous array that forms the whole block; show its elements as rows. */
  flatten?: boolean;
}

const isDefaultValue = (value: string): boolean => /^\(\s*\)$/.test(value);

/** `Path := ();` assigns the default value, which is what a member without assignment shows anyway. */
function withoutDefaults(assignments: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
  return new Map([...assignments].filter(([, value]) => !isDefaultValue(value)));
}

/** `DATA_BLOCK Name [: Instance]`, `VAR [RETAIN] ... END_VAR` sections, then the start value assignments. */
function dataBlockModel(source: string, texts: TextTable | undefined, resolve: UdtResolver): BlockModel {
  const cur = new Cursor(source);
  const attributes = readAttributes(cur);
  if (!cur.eatWord('DATA_BLOCK')) {
    cur.fail('DATA_BLOCK expected');
  }
  const name = cur.name();
  let instanceOf = '';
  const sections: VarSection[] = [];
  if (cur.eat(':')) {
    if (cur.peekWord().toUpperCase() === 'ARRAY') {
      const body: RawMember = { name: '', pragmas: {}, type: parseDeclaredType(cur), init: '', comment: '' };
      sections.push({ members: [body], retain: isTrue(attributes.s7_standardretain), flatten: true });
    } else {
      if (cur.peekWord() === '_') {
        cur.word();
        cur.expect('.');
      }
      instanceOf = cur.name();
    }
  }

  let assignments: ReadonlyMap<string, string> = new Map();
  for (let next = cur.peek(); next !== ''; next = cur.peek()) {
    if (next === '{') {
      Object.assign(attributes, readAttributes(cur));
    } else if (cur.peekWord().toUpperCase() === 'END_DATA_BLOCK') {
      break;
    } else if (cur.eatWord('VAR')) {
      const retain = cur.eatInlineWord('RETAIN') || isTrue(attributes.s7_standardretain);
      const isConstant = cur.eatInlineWord('CONSTANT');
      const members = membersWithTexts(parseMembers(cur, 'END_VAR'), texts);
      if (!isConstant) {
        sections.push({ members, retain });
      }
    } else {
      assignments = withoutDefaults(parseAssignments(cur));
      break;
    }
  }

  // `DATA_BLOCK X : Name` is an instance DB, unless Name is a UDT: then the block is based on that type
  const udtMembers = instanceOf === '' ? undefined : resolve(instanceOf);
  if (udtMembers) {
    sections.push({ members: udtMembers, retain: isTrue(attributes.s7_standardretain) });
    instanceOf = '';
  }
  const ctx = createContext(resolve, assignments);
  const rows = sections.flatMap((section) => {
    ctx.retain = section.retain;
    const built = section.members.map((m) => buildMember(m, ctx, ROOT_FLAGS, ''));
    return section.flatten
      ? built.flatMap((b) => (b.children.length > 0 ? b.children : [{ ...b, name: b.datatype }]))
      : built;
  });
  const optimizedAccess = isTrue(attributes.s7_optimized);
  return {
    kind: 'DB',
    name,
    number: attributes.s7_blocknumber ?? '',
    language: 'DB',
    memoryLayout: optimizedAccess ? 'Optimized' : 'Standard',
    title: textOf(texts, attributes.s7_blocktitle),
    comment: textOf(texts, attributes.s7_blockcomment),
    sections: sections.length > 0 ? [{ name: 'Static', members: rows }] : [],
    networks: [],
    dataBlock: {
      optimizedAccess,
      nonRetain: attributes.s7_standardretain?.toLowerCase() === 'false',
      version: attributes.s7_version ?? '',
      family: attributes.s7_family ?? '',
      author: attributes.s7_author ?? '',
      instanceOf,
    },
  };
}

const SECTION_WORDS = new Set(['VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'VAR_TEMP']);
const END_NETWORK = /^\s*END_NETWORK\b/;
const END_BLOCK = /^\s*END_(?:FUNCTION_BLOCK|FUNCTION|ORGANIZATION_BLOCK)\b/;
const EMPTY_LAD_NETWORK = 'RUNG wire#powerrail END_RUNG';
const MAX_NETWORKS = 5000;

interface RawNetwork {
  attributes: S7Attributes;
  lines: string[];
}

/** Removes the common indentation and the blank lines around a network body. */
function dedent(lines: string[]): string[] {
  const indents = lines.filter((l) => l.trim() !== '').map((l) => l.length - l.trimStart().length);
  const cut = indents.reduce((least, indent) => Math.min(least, indent), Number.POSITIVE_INFINITY);
  const body = lines.map((l) => (l.trim() === '' ? '' : l.slice(Number.isFinite(cut) ? cut : 0)));
  const first = body.findIndex((l) => l !== '');
  if (first < 0) {
    return [];
  }
  let last = body.length - 1;
  while (body[last] === '') {
    last--;
  }
  return body.slice(first, last + 1);
}

/**
 * Splits the part after the interface sections into `{ S7_Language := ... } NETWORK ... END_NETWORK` groups.
 * Network bodies are SCL or LAD text and are kept as written; `END_NETWORK` only counts outside comments.
 */
function readNetworks(text: string): RawNetwork[] {
  const networks: RawNetwork[] = [];
  let attributes: S7Attributes = Object.create(null) as S7Attributes;
  let attributeText: string | undefined;
  let body: string[] | undefined;
  let inComment = false;
  for (const line of text.split(/\r?\n/)) {
    if (networks.length >= MAX_NETWORKS) {
      break;
    }
    if (body) {
      const scanned = scanLine(line, inComment);
      if (!inComment && END_NETWORK.test(scanned.clean)) {
        networks.push({ attributes, lines: dedent(body) });
        attributes = Object.create(null) as S7Attributes;
        body = undefined;
        continue;
      }
      inComment = scanned.inBlockComment;
      body.push(line);
      continue;
    }
    if (attributeText !== undefined || line.trimStart().startsWith('{')) {
      attributeText = `${attributeText ?? ''}${line}\n`;
      if (line.includes('}')) {
        Object.assign(attributes, new Cursor(attributeText).pragma());
        attributeText = undefined;
      }
    } else if (/^\s*NETWORK\b/.test(line)) {
      body = [];
      inComment = false;
    } else if (END_BLOCK.test(line)) {
      break;
    }
  }
  return networks;
}

function networkModel(raw: RawNetwork, index: number, headerLanguage: string, texts: TextTable | undefined): NetworkModel {
  const language = (raw.attributes.s7_language ?? headerLanguage).toUpperCase();
  const isEmpty = raw.lines.length === 0 || (language === 'LAD' && raw.lines.join(' ').replace(/\s+/g, ' ').trim() === EMPTY_LAD_NETWORK);
  let body: NetworkModel['body'] = { kind: 'code', language, lines: raw.lines };
  if (isEmpty) {
    body = { kind: 'empty' };
  } else if (language === 'LAD') {
    // drawn as a ladder diagram; what the parser does not understand stays source text (highlighted by the grammar)
    try {
      body = { kind: 'lad', scene: layoutLad(parseSdLad(raw.lines)) };
    } catch {
      body = { kind: 'code', language, lines: raw.lines };
    }
  }
  return {
    index,
    title: textOf(texts, raw.attributes.s7_networktitle),
    comment: textOf(texts, raw.attributes.s7_networkcomment),
    language,
    body,
  };
}

/**
 * `FUNCTION_BLOCK`, `FUNCTION` and `ORGANIZATION_BLOCK`: the interface sections like an SCL source, then the networks.
 * `S7_EditorMode := "SCL"` marks a pure SCL block, shown like an `.scl` file (code pane with outline); in a block
 * with `S7_PreferredLanguage` each network follows its own `S7_Language`.
 */
function codeBlockModel(source: string, texts: TextTable | undefined, resolve: UdtResolver, keyword: string): BlockModel {
  const cur = new Cursor(source);
  const attributes = readAttributes(cur);
  cur.word();
  const kind = BLOCK_KINDS[keyword] as BlockKind;
  const name = cur.name();
  const returnType = kind === 'FC' && cur.eatInline(':') ? cur.restOfLine().replace(/\/\/.*$/, '').trim() : '';
  const groups: SectionGroup[] = [];
  while (SECTION_WORDS.has(cur.peekWord().toUpperCase())) {
    const group = readSection(cur, cur.peekWord().toUpperCase());
    groups.push({ ...group, members: membersWithTexts(group.members, texts) });
  }

  const networks = readNetworks(cur.remainder());
  const isPureScl = (attributes.s7_editormode ?? '').toUpperCase() === 'SCL';
  const headerLanguage = isPureScl ? 'SCL' : (attributes.s7_preferredlanguage ?? 'LAD');
  const codeLines = isPureScl ? networks.flatMap((n, i) => (i === 0 ? n.lines : ['', ...n.lines])) : [];
  return {
    kind,
    name,
    number: attributes.s7_blocknumber ?? '',
    language: headerLanguage.toUpperCase(),
    memoryLayout: isTrue(attributes.s7_optimized) ? 'Optimized' : 'Standard',
    title: textOf(texts, attributes.s7_blocktitle),
    comment: textOf(texts, attributes.s7_blockcomment),
    sections: buildSections(kind, groups, returnType, resolve),
    networks: isPureScl ? [] : networks.map((n, i) => networkModel(n, i + 1, headerLanguage, texts)),
    code: isPureScl ? { lines: codeLines, ...analyzeStructure(codeLines) } : undefined,
  };
}

/**
 * Parses a `.s7dcl` source into the same view model as the classic `.udt` / `.db` / `.scl` sources. `texts` holds
 * the multilingual texts of the sibling `.s7res`, when there is one.
 */
export function parseS7dclModel(source: string, texts?: TextTable, resolve: UdtResolver = () => undefined): BlockModel {
  const model = buildModel(source, texts, resolve);
  return texts ? { ...model, texts: textsInfo(source, texts) } : model;
}

const TEXT_REFERENCE = /S7_(?:MLC|BlockTitle|BlockComment|NetworkTitle|NetworkComment)\s*:=\s*"([^"]*)"/gi;

/** All texts of the `.s7res`, each marked as used or not, and the referenced ids it does not contain. */
function textsInfo(source: string, texts: TextTable): NonNullable<BlockModel['texts']> {
  const referenced = new Set([...source.matchAll(TEXT_REFERENCE)].map((match) => match[1] as string));
  return {
    entries: [...texts].map(([id, text]) => ({ id, text, used: referenced.has(id) })),
    missing: [...referenced].filter((id) => !texts.has(id)),
  };
}

function buildModel(source: string, texts: TextTable | undefined, resolve: UdtResolver): BlockModel {
  const keyword = s7dclBlockKeyword(source);
  switch (keyword) {
    case 'TYPE':
      return udtModel(source, texts, resolve);
    case 'DATA_BLOCK':
      return dataBlockModel(source, texts, resolve);
    case 'FUNCTION_BLOCK':
    case 'FUNCTION':
    case 'ORGANIZATION_BLOCK':
      return codeBlockModel(source, texts, resolve, keyword);
    default:
      return new Cursor(source).fail('TYPE, DATA_BLOCK, FUNCTION_BLOCK, FUNCTION or ORGANIZATION_BLOCK expected');
  }
}
