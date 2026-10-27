import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { InterfaceMember } from '../../src/model/types';
import { DbParseError } from '../../src/parser/dbCursor';
import type { UdtResolver } from '../../src/parser/memberBuilder';
import { parseScl } from '../../src/parser/sclParser';
import { analyzeStructure } from '../../src/parser/sclStructure';
import { parseUdt } from '../../src/parser/udtParser';
import { renderBlockHtml } from '../../src/render/html';
import { createSclHighlighter, withHighlighting, type SclHighlighter } from '../../src/render/sclHighlighter';

const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = (name: string): string => readFileSync(join(root, 'fixtures', name), 'utf-8');
const assets = { cspSource: 'x', nonce: 'n', styleUri: 's.css', scriptUri: 's.js' };

const valve = parseUdt(fixture('Valve.udt'));
const resolver: UdtResolver = (name) => (name.toLowerCase() === valve.name.toLowerCase() ? valve.members : undefined);

const readGrammar = async (): Promise<string> => readFileSync(join(root, 'syntaxes', 'scl.tmLanguage.json'), 'utf-8');
const readWasm = async (): Promise<ArrayBuffer> => {
  const bytes = readFileSync(createRequire(import.meta.url).resolve('vscode-oniguruma/release/onig.wasm'));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

const section = (model: ReturnType<typeof parseScl>, name: string): InterfaceMember[] =>
  model.sections.find((s) => s.name === name)?.members ?? [];
const member = (list: InterfaceMember[], name: string): InterfaceMember => {
  const found = list.find((m) => m.name === name);
  if (!found) {
    throw new Error(`member ${name} not found`);
  }
  return found;
};

const fb = parseScl(fixture('function-block.scl'), resolver);

describe('SCL parser (synthetic function block)', () => {
  it('reads the header', () => {
    expect(fb).toMatchObject({ kind: 'FB', name: 'Demo_FB', language: 'SCL', title: 'Demo function block', memoryLayout: 'Optimized' });
  });

  it('lists the standard FB sections in TIA order, empty ones included', () => {
    expect(fb.sections.map((s) => s.name)).toEqual(['Input', 'Output', 'InOut', 'Static', 'Temp', 'Constant']);
    expect(section(fb, 'Output')).toEqual([]);
  });

  it('merges section variants (DB_SPECIFIC) and greys type defaults of inputs', () => {
    const input = section(fb, 'Input');
    expect(input.map((m) => m.name)).toEqual(['It_Cycle', 'Ist_Valve', 'Ib_Start', 'Ip_Db']);
    expect(member(input, 'It_Cycle')).toMatchObject({
      startValue: 'T#0ms',
      startIsDefault: true,
      retain: 'Non-retain',
      comment: 'previous cycle',
      accessible: false,
    });
  });

  it('expands UDT members from the resolver', () => {
    expect(member(section(fb, 'Input'), 'Ist_Valve').children.map((m) => m.name)).toEqual(['Open', 'Position', 'Retries', 'Name']);
  });

  it('shows no retain text for structured in/out members', () => {
    const inOut = section(fb, 'InOut');
    expect(member(inOut, 'IQr_Cache')).toMatchObject({ retain: 'Non-retain', startValue: '0.0', startIsDefault: true });
    expect(member(inOut, 'IQst_Valve').retain).toBe('');
  });

  it('handles static, retained, temp and constant variables', () => {
    expect(member(section(fb, 'Static'), 'Ins_Delay').retain).toBe('Non-retain');
    expect(member(section(fb, 'Static'), 'Counter')).toMatchObject({ retain: 'Retain', startValue: '5', startIsDefault: false });
    expect(member(section(fb, 'Temp'), 'tr_energy')).toMatchObject({ startValue: '', retain: '' });
    expect(member(section(fb, 'Constant'), 'cr_Limit')).toMatchObject({ startValue: '100.0', startIsDefault: false, retain: '' });
  });

  it('extracts the code after BEGIN with tabs preserved and 1-based lines', () => {
    const lines = fb.code?.lines ?? [];
    expect(lines[0]).toBe('\tREGION Calc');
    expect(lines).not.toContain('BEGIN');
    expect(lines[lines.length - 1]).toBe("\t#text := 'IF not a keyword';");
    expect(lines).toHaveLength(20);
  });

  it('builds the region outline with nesting and ignores keywords in comments and strings', () => {
    expect(fb.code?.regions).toEqual([
      { name: 'Calc', line: 1, depth: 0 },
      { name: 'Outer', line: 11, depth: 0 },
      { name: 'Inner', line: 12, depth: 1 },
    ]);
  });

  it('finds fold ranges for regions, control blocks and multi-line comments', () => {
    expect(fb.code?.folds).toEqual([
      { from: 1, to: 9 },
      { from: 3, to: 8 },
      { from: 5, to: 7 },
      { from: 11, to: 17 },
      { from: 12, to: 16 },
      { from: 13, to: 15 },
      { from: 18, to: 19 },
    ]);
  });
});

describe('SCL parser (function and organization block)', () => {
  it('reads a function with a return type', () => {
    const fc = parseScl(fixture('function.scl'));
    expect(fc.kind).toBe('FC');
    expect(fc.sections.map((s) => s.name)).toEqual(['Input', 'Output', 'InOut', 'Temp', 'Constant', 'Return']);
    expect(section(fc, 'Return')[0]).toMatchObject({ name: 'Ret_Val', datatype: 'Int' });
    expect(fc.code?.lines).toEqual(['\t#ti_tmp := #Ii_Raw * 2;', '\t#Demo_FC := #ti_tmp;']);
  });

  it('reads AT overlay declarations', () => {
    const model = parseScl('FUNCTION_BLOCK "X"\nVAR_TEMP\n  w : DWord;\n  b AT w : "DataTyp_Valve";\nEND_VAR\nBEGIN\nEND_FUNCTION_BLOCK', resolver);
    const overlay = member(section(model, 'Temp'), 'b');
    expect(overlay.datatype).toBe('"DataTyp_Valve" AT w');
    expect(overlay.children).toHaveLength(4);
  });

  it('reads an organization block', () => {
    const ob = parseScl('ORGANIZATION_BLOCK "Main"\nVAR_TEMP\n x : Bool;\nEND_VAR\nBEGIN\n  #x := TRUE;\nEND_ORGANIZATION_BLOCK');
    expect(ob.kind).toBe('OB');
    expect(ob.sections.map((s) => s.name)).toEqual(['Input', 'Temp', 'Constant']);
    expect(ob.code?.lines).toEqual(['  #x := TRUE;']);
  });
});

describe('SCL parser (hostile input)', () => {
  it('rejects text that is not a block', () => {
    expect(() => parseScl('hello world')).toThrow(DbParseError);
  });

  it('rejects an unterminated VAR section', () => {
    expect(() => parseScl('FUNCTION_BLOCK "X"\nVAR_INPUT\n a : Int;\nBEGIN\nEND_FUNCTION_BLOCK')).toThrow(DbParseError);
  });

  it('tolerates a missing BEGIN and a missing end keyword', () => {
    expect(parseScl('FUNCTION_BLOCK "X"\nVAR_INPUT\n a : Int;\nEND_VAR\n').code?.lines).toEqual([]);
    expect(parseScl('FUNCTION_BLOCK "X"\nBEGIN\n a := 1;\n').code?.lines).toEqual([' a := 1;']);
  });

  it('caps the number of code lines', () => {
    const big = `FUNCTION_BLOCK "X"\nBEGIN\n${'a := 1;\n'.repeat(150_000)}END_FUNCTION_BLOCK`;
    expect(parseScl(big).code?.lines).toHaveLength(100_000);
  });

  it('keeps the code when an END_* keyword appears inside a block comment', () => {
    const model = parseScl('FUNCTION_BLOCK "X"\nBEGIN\n(*\nEND_FUNCTION_BLOCK\n*)\n a := 1;\nEND_FUNCTION_BLOCK');
    expect(model.code?.lines).toEqual(['(*', 'END_FUNCTION_BLOCK', '*)', ' a := 1;']);
  });

  it('understands the $\' escape inside SCL strings', () => {
    expect(analyzeStructure(["x := 'it$' IF'; IF a THEN", 'END_IF;']).folds).toEqual([{ from: 1, to: 2 }]);
    const model = parseScl("FUNCTION_BLOCK \"X\"\nVAR\n s : String := 'Don$'t';\n n : Int;\nEND_VAR\nBEGIN\nEND_FUNCTION_BLOCK");
    expect(section(model, 'Static').map((m) => m.name)).toEqual(['s', 'n']);
  });

  it('reports absurdly nested array types as a parse error', () => {
    const source = `FUNCTION_BLOCK "X"\nVAR\n a : ${'Array[0..1] of '.repeat(100)}Int;\nEND_VAR\nBEGIN\nEND_FUNCTION_BLOCK`;
    expect(() => parseScl(source)).toThrow(DbParseError);
  });

  it('keeps fold analysis fast and bounded for deeply nested or unbalanced input', () => {
    const started = Date.now();
    const result = analyzeStructure(Array.from({ length: 60_000 }, () => 'REGION r'));
    expect(result.regions.length).toBeLessThanOrEqual(5_000);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('ignores unbalanced blocks when folding', () => {
    expect(analyzeStructure(['END_IF;', 'IF a THEN', 'REGION x', '(* open'])).toMatchObject({ folds: [] });
  });
});

describe('SCL highlighting and rendering', () => {
  let highlighter: SclHighlighter;
  beforeAll(async () => {
    highlighter = await createSclHighlighter({ readGrammar, readWasm });
  });

  const tokensOf = (line: string): Array<{ text: string; cls: string }> => highlighter.tokenize([line])[0] ?? [];

  it('classifies keywords, local variables and comments with the repo grammar', () => {
    const tokens = tokensOf('IF #x THEN // note');
    expect(tokens.find((t) => t.text === 'IF')?.cls).toBe('c-keyword');
    expect(tokens.find((t) => t.text.includes('#x'))?.cls).toBe('c-local');
    expect(tokens.find((t) => t.text.includes('note'))?.cls).toBe('c-comment');
    expect(tokensOf('REGION Calc').some((t) => t.cls === 'c-region')).toBe(true);
  });

  it('carries multi-line comment state across lines', () => {
    const [, second] = highlighter.tokenize(['(* start', 'still comment IF *)']);
    expect(second?.every((t) => t.cls === 'c-comment')).toBe(true);
  });

  it('never loses or invents text', () => {
    const lines = fb.code?.lines ?? [];
    highlighter.tokenize(lines).forEach((tokens, i) => {
      expect(tokens.map((t) => t.text).join('')).toBe(lines[i]);
    });
  });

  it('renders outline, fold toggles, highlighted code and no empty title band', () => {
    const html = renderBlockHtml(withHighlighting(fb, { scl: highlighter }), assets);
    expect(html).toContain('class="code-view"');
    expect(html).toContain('data-line="12" data-depth="1"');
    expect(html).toContain('data-from="1" data-to="9"');
    expect(html).toContain('<span class="c-keyword">IF</span>');
    expect(html).toContain('Block title:');
    const untitled = renderBlockHtml(parseScl(fixture('function.scl')), assets);
    expect(untitled).not.toContain('Block title:');
    expect(untitled).toContain('class="code-view no-outline"');
  });

  it('escapes code text', () => {
    const evil = parseScl('FUNCTION_BLOCK "X"\nBEGIN\n// <script>alert(1)</script>\nEND_FUNCTION_BLOCK');
    const html = renderBlockHtml(withHighlighting(evil, { scl: highlighter }), assets);
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

/** Local, git-ignored project exports and samples; skipped when the folder is absent. */
const testRoot = join(root, 'test');

describe.skipIf(!existsSync(testRoot))('local corpus (all .scl files under test/)', () => {
  it('parses and tokenizes every .scl file', async () => {
    const udts = new Map<string, ReturnType<typeof parseUdt>['members']>();
    for (const file of filesWithExtension(testRoot, '.udt').sort()) {
      const definition = parseUdt(readFileSync(file, 'utf-8'));
      if (!udts.has(definition.name.toLowerCase())) {
        udts.set(definition.name.toLowerCase(), definition.members);
      }
    }
    const corpusHighlighter = await createSclHighlighter({ readGrammar, readWasm });
    const failures: string[] = [];
    let withRegions = 0;
    const files = filesWithExtension(testRoot, '.scl');
    for (const file of files) {
      try {
        const model = parseScl(readFileSync(file, 'utf-8'), (name) => udts.get(name.toLowerCase()));
        const lines = model.code?.lines ?? [];
        expect(lines.length, file).toBeGreaterThan(0);
        withRegions += (model.code?.regions.length ?? 0) > 0 ? 1 : 0;
        corpusHighlighter.tokenize(lines).forEach((tokens, i) => {
          if (tokens.map((t) => t.text).join('') !== lines[i]) {
            failures.push(`${file}: token text differs on line ${i + 1}`);
          }
        });
      } catch (error: unknown) {
        failures.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    expect(failures).toEqual([]);
    expect(files.length).toBeGreaterThan(0);
    expect(withRegions).toBeGreaterThan(0);
  }, 120_000);
});
