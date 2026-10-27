import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { InterfaceMember } from '../../src/model/types';
import { DbParseError } from '../../src/parser/dbCursor';
import { parseDataBlock, type UdtResolver } from '../../src/parser/dbParser';
import { parseUdt } from '../../src/parser/udtParser';
import { renderBlockHtml } from '../../src/render/html';

const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = (name: string): string => readFileSync(join(root, 'fixtures', name), 'utf-8');
const assets = { cspSource: 'x', nonce: 'n', styleUri: 's.css', scriptUri: 's.js' };

const valve = parseUdt(fixture('Valve.udt'));
const resolver: UdtResolver = (name) => (name.toLowerCase() === valve.name.toLowerCase() ? valve.members : undefined);

const block = parseDataBlock(fixture('data-block.db'), resolver);
const top = block.sections[0]?.members ?? [];
const member = (list: InterfaceMember[], name: string): InterfaceMember => {
  const found = list.find((m) => m.name === name);
  if (!found) {
    throw new Error(`member ${name} not found`);
  }
  return found;
};
const info = member(top, 'Info');

describe('data block parser (synthetic)', () => {
  it('reads the header', () => {
    expect(block).toMatchObject({ kind: 'DB', name: 'Demo_DB', title: 'Demo data block', memoryLayout: 'Optimized' });
    expect(block.dataBlock).toMatchObject({ optimizedAccess: true, author: 'tester', family: 'demo', version: '0.1', instanceOf: '' });
  });

  it('reads top-level members of all VAR sections in order', () => {
    expect(top.map((m) => m.name)).toEqual(['Info', 'Valve1', 'Missing', 'Rows', 'Big', 'Count', 'Kept']);
  });

  it('reads nested structs with comments, pragmas and initial values', () => {
    expect(info.comment).toBe('Information block');
    expect(info.children.map((m) => m.name)).toEqual(['Cycle', 'Pos', 'Stamp', 'Flags', 'Name', 'Sub']);
    expect(member(info.children, 'Cycle').comment).toBe('Last cycle time');
    expect(member(info.children, 'Pos')).toMatchObject({ startValue: '1.5', startIsDefault: false });
    expect(member(info.children, 'Name').startValue).toBe("'valve'");
    expect(member(member(info.children, 'Sub').children, 'Level').startValue).toBe('7');
  });

  it('derives the access flags from pragmas', () => {
    expect(member(info.children, 'Pos')).toMatchObject({ accessible: false, writable: false, visible: false });
    expect(member(info.children, 'Cycle')).toMatchObject({ accessible: true, writable: true, visible: true, setpoint: false });
    expect(member(top, 'Count').setpoint).toBe(true);
  });

  it('greys type defaults and lets BEGIN assignments override them', () => {
    expect(member(info.children, 'Stamp')).toMatchObject({ startValue: 'DTL#1970-01-01-00:00:00', startIsDefault: true });
    expect(member(info.children, 'Cycle')).toMatchObject({ startValue: 'T#25s', startIsDefault: false });
  });

  it('expands arrays, applies indexed assignments and skips oversized arrays', () => {
    const flags = member(info.children, 'Flags');
    expect(flags.datatype).toBe('Array[0..3] of Bool');
    expect(flags.children.map((m) => m.name)).toEqual(['[0]', '[1]', '[2]', '[3]']);
    expect(flags.children[2]).toMatchObject({ startValue: 'TRUE', startIsDefault: false });
    expect(flags.children[0]).toMatchObject({ startValue: 'false', startIsDefault: true });
    const rows = member(top, 'Rows');
    expect(rows.children).toHaveLength(2);
    expect(member(rows.children[1]!.children, 'Id').startValue).toBe('9');
    expect(member(top, 'Big').children).toHaveLength(0);
  });

  it('expands UDT members from the resolver and keeps unknown types plain', () => {
    const valve1 = member(top, 'Valve1');
    expect(valve1.comment).toBe('first valve');
    expect(valve1.children.map((m) => m.name)).toEqual(['Open', 'Position', 'Retries', 'Name']);
    expect(member(valve1.children, 'Retries').startValue).toBe('5');
    expect(member(valve1.children, 'Open')).toMatchObject({ startValue: 'false' });
    expect(member(top, 'Missing')).toMatchObject({ datatype: '"Unknown_Type"', children: [] });
  });

  it('marks members of VAR RETAIN sections as retained', () => {
    expect(member(top, 'Kept').retainChecked).toBe(true);
    expect(member(top, 'Count').retainChecked).toBe(false);
  });

  it('recognises an instance data block', () => {
    const instance = parseDataBlock(fixture('instance-db.db'));
    expect(instance.sections).toEqual([]);
    expect(instance.dataBlock?.instanceOf).toBe('CMN_Demo');
  });
});

describe('data block parser (hostile input)', () => {
  it('rejects text that is not a data block', () => {
    expect(() => parseDataBlock('hello world')).toThrow(DbParseError);
  });

  it('rejects an unterminated struct', () => {
    expect(() => parseDataBlock('DATA_BLOCK "X"\nVAR\n A : Struct\n B : Int;\nEND_VAR\nBEGIN\nEND_DATA_BLOCK')).toThrow(DbParseError);
  });

  it('does not expand huge array ranges', () => {
    const model = parseDataBlock('DATA_BLOCK "X"\nVAR\n A : Array[0..2147483647] of Bool;\nEND_VAR\nBEGIN\nEND_DATA_BLOCK');
    expect(model.sections[0]?.members[0]?.children).toEqual([]);
  });

  it('stops expanding self-referencing UDTs', () => {
    const selfRef = parseUdt('TYPE "Loop"\nSTRUCT\n Next : "Loop";\n V : Int;\nEND_STRUCT;\nEND_TYPE');
    const loop: UdtResolver = (name) => (name.toLowerCase() === 'loop' ? selfRef.members : undefined);
    const model = parseDataBlock('DATA_BLOCK "X"\nVAR\n L : "Loop";\nEND_VAR\nBEGIN\nEND_DATA_BLOCK', loop);
    const depthOf = (m: InterfaceMember): number => 1 + Math.max(0, ...m.children.map(depthOf));
    expect(depthOf(model.sections[0]!.members[0]!)).toBeLessThan(20);
  });

  it('parses a huge pragma in linear time', () => {
    const started = Date.now();
    const source = `DATA_BLOCK "X"\nVAR\n A { ${'a'.repeat(200_000)} } : Int;\nEND_VAR\nBEGIN\nEND_DATA_BLOCK`;
    expect(parseDataBlock(source).sections[0]?.members).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('caps the rows of an array of inline structs', () => {
    const members = Array.from({ length: 300 }, (_, i) => ` M${i} : Int;`).join('\n');
    const source = `DATA_BLOCK "X"\nVAR\n A : Array[0..511] of Struct\n${members}\n END_STRUCT;\nEND_VAR\nBEGIN\nEND_DATA_BLOCK`;
    const count = (list: InterfaceMember[]): number => list.reduce((sum, m) => sum + 1 + count(m.children), 0);
    expect(count(parseDataBlock(source).sections[0]?.members ?? [])).toBeLessThan(25_000);
  });

  it('understands the $\' escape in initial values', () => {
    const model = parseDataBlock("DATA_BLOCK \"X\"\nVAR\n s : String := 'Don$'t';\n n : Int;\nEND_VAR\nBEGIN\nEND_DATA_BLOCK");
    expect(model.sections[0]?.members.map((m) => m.name)).toEqual(['s', 'n']);
    expect(model.sections[0]?.members[0]?.startValue).toBe("'Don$'t'");
  });

  it('rejects absurd struct nesting', () => {
    const open = 'A : Struct\n'.repeat(40);
    expect(() => parseDataBlock(`DATA_BLOCK "X"\nVAR\n${open}END_VAR`)).toThrow(DbParseError);
  });
});

describe('UDT parser and rendering', () => {
  it('parses a UDT source', () => {
    expect(valve.name).toBe('DataTyp_Valve');
    expect(valve.members.map((m) => m.name)).toEqual(['Open', 'Position', 'Retries', 'Name']);
    expect(() => parseUdt('TYPE "X"\nEND_TYPE')).toThrow(DbParseError);
  });

  it('renders start values, greyed defaults, row numbers and a collapsed nested level', () => {
    const html = renderBlockHtml(block, assets);
    expect(html).toContain('Start value');
    expect(html).toContain('class="start default"');
    expect(html).toContain('class="rownum">1<');
    expect(html).toContain('[DB]');
    expect(html).not.toContain('id="zoom"');
  });

  it('shows a notice for instance data blocks', () => {
    const html = renderBlockHtml(parseDataBlock(fixture('instance-db.db')), assets);
    expect(html).toContain('Instance data block of');
    expect(html).toContain('"CMN_Demo"');
  });

  it('shows the elements of a data block that consists of a single array', () => {
    const model = parseDataBlock('DATA_BLOCK "Gaps"\nNON_RETAIN\nArray[0..2] of Real;\nBEGIN\nEND_DATA_BLOCK');
    expect(model.sections[0]?.members.map((m) => m.name)).toEqual(['[0]', '[1]', '[2]']);
    expect(model.sections[0]?.members[0]).toMatchObject({ datatype: 'Real', startValue: '0.0', startIsDefault: true });
  });

  it('expands a data block that is based on a UDT instead of calling it an instance DB', () => {
    const source = 'DATA_BLOCK "V1"\nNON_RETAIN\n"DataTyp_Valve"\nBEGIN\n   Retries := 9;\nEND_DATA_BLOCK';
    const model = parseDataBlock(source, resolver);
    expect(model.dataBlock?.instanceOf).toBe('');
    expect(model.sections[0]?.members.map((m) => m.name)).toEqual(['Open', 'Position', 'Retries', 'Name']);
    expect(model.sections[0]?.members[2]?.startValue).toBe('9');
  });

  it('reads a non-optimized data block whose members sit in a STRUCT body', () => {
    const source = 'DATA_BLOCK "Std"\n{ S7_Optimized_Access := \'FALSE\' }\nNON_RETAIN\n   STRUCT \n      A : Int;\n      B : Struct\n         C : Bool;\n      END_STRUCT;\n   END_STRUCT;\n\nBEGIN\nEND_DATA_BLOCK';
    const model = parseDataBlock(source);
    expect(model.memoryLayout).toBe('Standard');
    expect(model.sections[0]?.members.map((m) => m.name)).toEqual(['A', 'B']);
    expect(model.sections[0]?.members[1]?.children[0]?.name).toBe('C');
  });

  it('escapes comments and names from the source', () => {
    const evil = 'DATA_BLOCK "X"\nVAR\n A : Int;   // <script>alert(1)</script>\nEND_VAR\nBEGIN\nEND_DATA_BLOCK';
    const html = renderBlockHtml(parseDataBlock(evil), assets);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

function filesWithExtension(dir: string, extension: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return filesWithExtension(path, extension);
    }
    return path.toLowerCase().endsWith(extension) ? [path] : [];
  });
}

/** Local, git-ignored project exports; skipped when the folder is absent. */
const testRoot = join(root, 'test');
const projectDir = join(testRoot, 'Project');

describe.skipIf(!existsSync(projectDir))('local project corpus (db + udt)', () => {
  const udtFiles = filesWithExtension(testRoot, '.udt').sort();
  const udts = new Map<string, ReturnType<typeof parseUdt>['members']>();

  it('parses every .udt file', () => {
    const failures: string[] = [];
    for (const file of udtFiles) {
      try {
        const definition = parseUdt(readFileSync(file, 'utf-8'));
        if (!udts.has(definition.name.toLowerCase())) {
          udts.set(definition.name.toLowerCase(), definition.members);
        }
      } catch (error: unknown) {
        failures.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('parses every .db file and resolves every referenced UDT', () => {
    const lookup: UdtResolver = (name) => udts.get(name.toLowerCase());
    const failures: string[] = [];
    const unresolved = new Set<string>();
    let globalDbs = 0;
    const visit = (members: InterfaceMember[]): void => {
      for (const m of members) {
        if (m.datatype.startsWith('"') && !lookup(m.datatype.slice(1, -1))) {
          unresolved.add(m.datatype);
        }
        visit(m.children);
      }
    };
    for (const file of filesWithExtension(projectDir, '.db')) {
      try {
        const model = parseDataBlock(readFileSync(file, 'utf-8'), lookup);
        if (model.sections.length > 0) {
          globalDbs++;
          expect(model.sections[0]?.members.length, file).toBeGreaterThan(0);
          visit(model.sections[0]?.members ?? []);
        } else {
          expect(model.dataBlock?.instanceOf, file).not.toBe('');
        }
      } catch (error: unknown) {
        failures.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    expect(failures).toEqual([]);
    expect([...unresolved]).toEqual([]);
    expect(globalDbs).toBeGreaterThan(0);
  }, 120_000);
});
