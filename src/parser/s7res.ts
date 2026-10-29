/** Multilingual texts of a `.s7res` file, by text id (`MLC_44C`). */
export type TextTable = ReadonlyMap<string, string>;

const ENTRY = /^\s*-\s+id:\s*(.*)$/;
const FIELD = /^(\s+)([A-Za-z][A-Za-z0-9-]*):(?:\s+(.*))?$/;
const BLOCK_HEADER = /^\|([+-]?)(\d?)([+-]?)\s*$/;
const FALLBACK_CULTURE = 'de-DE';

const indentOf = (line: string): number => line.length - line.trimStart().length;

/** Reads a `'...'` scalar body (after the opening quote); `''` is an escaped quote. */
function scanSingleQuoted(text: string): { value: string; closed: boolean } {
  let value = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "'") {
      if (text[i + 1] === "'") {
        value += "'";
        i++;
        continue;
      }
      return { value, closed: true };
    }
    value += text[i];
  }
  return { value, closed: false };
}

interface ReadValue {
  text: string;
  next: number;
}

/** `|`, `|-`, `|+` and `|N` block scalars: the lines more indented than the key, up to the next entry. */
function readBlockScalar(lines: string[], start: number, keyIndent: number, header: RegExpExecArray): ReadValue {
  const chomp = header[1] || header[3] || '';
  const explicit = header[2] ? Number(header[2]) : 0;
  const body: string[] = [];
  let contentIndent = explicit > 0 ? keyIndent + explicit : -1;
  let next = start;
  for (; next < lines.length; next++) {
    const line = lines[next] as string;
    if (line.trim() === '') {
      body.push('');
      continue;
    }
    const indent = indentOf(line);
    if (indent <= keyIndent) {
      break;
    }
    if (contentIndent < 0) {
      contentIndent = indent;
    }
    body.push(line.slice(Math.min(contentIndent, indent)));
  }
  let trailing = 0;
  while (body.length > 0 && body[body.length - 1] === '') {
    body.pop();
    trailing++;
  }
  if (body.length === 0) {
    return { text: '', next };
  }
  const text = body.join('\n');
  switch (chomp) {
    case '-':
      return { text, next };
    case '+':
      return { text: `${text}\n${'\n'.repeat(trailing)}`, next };
    default:
      return { text: `${text}\n`, next };
  }
}

function readSingleQuoted(lines: string[], start: number, raw: string): ReadValue {
  let scan = scanSingleQuoted(raw.slice(1));
  let text = scan.value;
  let next = start;
  while (!scan.closed && next < lines.length) {
    const part = (lines[next++] as string).trim();
    scan = scanSingleQuoted(part);
    text += part === '' ? '\n' : `${text.endsWith('\n') ? '' : ' '}${scan.value}`;
  }
  return { text, next };
}

function readDoubleQuoted(raw: string, start: number): ReadValue {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'string') {
      return { text: parsed, next: start };
    }
  } catch {
    // not a JSON-compatible escape sequence: keep the text between the quotes as written
  }
  return { text: raw.replace(/^"|"$/g, ''), next: start };
}

function readValue(lines: string[], start: number, keyIndent: number, raw: string): ReadValue {
  const block = BLOCK_HEADER.exec(raw);
  if (block) {
    return readBlockScalar(lines, start, keyIndent, block);
  }
  if (raw.startsWith("'")) {
    return readSingleQuoted(lines, start, raw);
  }
  if (raw.startsWith('"')) {
    return readDoubleQuoted(raw, start);
  }
  return { text: raw.trim(), next: start };
}

function unquoteId(raw: string): string {
  const id = raw.trim();
  return id.length >= 2 && /^(['"]).*\1$/.test(id) ? id.slice(1, -1) : id;
}

function pickText(values: ReadonlyMap<string, string>, culture: string): string | undefined {
  return values.get(culture) ?? values.get(FALLBACK_CULTURE) ?? values.values().next().value;
}

/**
 * Parses the `MultiLingualTexts` list of a `.s7res` file. Each entry holds one text per culture; the text
 * of `culture` is used, then `de-DE` (the editing language of the exports), then the first one present.
 */
export function parseS7res(source: string, culture = ''): TextTable {
  const lines = source.replace(/^﻿/, '').split(/\r?\n/);
  const texts = new Map<string, string>();
  let id = '';
  let values = new Map<string, string>();
  const flush = (): void => {
    const text = id === '' ? undefined : pickText(values, culture);
    if (text !== undefined) {
      texts.set(id, text);
    }
    id = '';
    values = new Map();
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    const entry = ENTRY.exec(line);
    if (entry) {
      flush();
      id = unquoteId(entry[1] ?? '');
      i++;
      continue;
    }
    const field = id === '' ? null : FIELD.exec(line);
    if (field) {
      const { text, next } = readValue(lines, i + 1, (field[1] as string).length, field[3] ?? '');
      values.set(field[2] as string, text);
      i = next;
      continue;
    }
    i++;
  }
  flush();
  return texts;
}
