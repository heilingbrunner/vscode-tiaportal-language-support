import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { splitNetworks } from '../../src/parser/awlNetworks';
import { DbParseError } from '../../src/parser/dbCursor';
import type { UdtResolver } from '../../src/parser/memberBuilder';
import { parseAwl } from '../../src/parser/sclParser';
import { parseUdt } from '../../src/parser/udtParser';
import { renderBlockHtml } from '../../src/render/html';
import { createAwlHighlighter, withHighlighting, type SclHighlighter } from '../../src/render/sclHighlighter';

const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = (name: string): string => readFileSync(join(root, 'fixtures', name), 'utf-8');
const assets = { cspSource: 'x', nonce: 'n', styleUri: 's.css', scriptUri: 's.js' };

const valve = parseUdt(fixture('Valve.udt'));
const resolver: UdtResolver = (name) => (name.toLowerCase() === valve.name.toLowerCase() ? valve.members : undefined);

const readGrammar = async (language: 'scl' | 'awl'): Promise<string> =>
  readFileSync(join(root, 'syntaxes', `${language}.tmLanguage.json`), 'utf-8');
const readWasm = async (): Promise<ArrayBuffer> => {
  const bytes = readFileSync(createRequire(import.meta.url).resolve('vscode-oniguruma/release/onig.wasm'));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

const model = parseAwl(fixture('function-block.awl'), resolver);
const codeLines = (index: number): string[] => {
  const body = model.networks[index]?.body;
  return body?.kind === 'code' ? body.lines : [];
};

describe('STL parser (synthetic function block)', () => {
  it('reads the block header and the interface like an SCL block', () => {
    expect(model).toMatchObject({ kind: 'FB', name: 'Demo_AWL', language: 'STL', title: 'Demo statement list', memoryLayout: 'Standard' });
    expect(model.code).toBeUndefined();
    expect(model.sections.map((s) => s.name)).toEqual(['Input', 'Output', 'InOut', 'Static', 'Temp', 'Constant']);
    const input = model.sections[0]?.members ?? [];
    expect(input.map((m) => m.name)).toEqual(['Start', 'Ist_Valve']);
    expect(input[1]?.children).toHaveLength(4);
  });

  it('splits the code at NETWORK lines with title and comment', () => {
    expect(model.networks).toHaveLength(4);
    expect(model.networks[0]).toMatchObject({
      index: 1,
      title: 'Motor control',
      comment: 'first comment line\nsecond comment line',
      language: 'STL',
    });
    expect(codeLines(0)).toHaveLength(8);
    expect(codeLines(0)[0]).toBe('      A     "Tag_Input_1";    // check input');
    expect(codeLines(1)).toHaveLength(9);
    expect(codeLines(1)).toContain('next: NOP   0;');
  });

  it('keeps empty networks and later networks in order', () => {
    expect(model.networks[2]).toMatchObject({ index: 3, title: '', body: { kind: 'empty' } });
    expect(model.networks[3]).toMatchObject({ index: 4, title: 'Last' });
  });

  it('reads a function with German mnemonics', () => {
    const fc = parseAwl(fixture('function.stl'));
    expect(fc.kind).toBe('FC');
    expect(fc.networks).toHaveLength(1);
    expect(fc.networks[0]?.title).toBe('Verknuepfung');
    expect(fc.networks[0]?.body).toMatchObject({ kind: 'code', lines: ['      U     #Freigabe;', '      UN    E      0.1;', '      =     A      4.0;'] });
  });
});

describe('STL network splitting (edge cases)', () => {
  it('treats code before the first NETWORK as a network, but ignores leading blank lines', () => {
    expect(splitNetworks(['', '  A #x;', 'NETWORK', 'TITLE = B', '  = #y;'])).toHaveLength(2);
    expect(splitNetworks(['', '', 'NETWORK', '  A #x;'])).toHaveLength(1);
  });

  it('reads block comments as the network comment', () => {
    const [network] = splitNetworks(['NETWORK', 'TITLE = T', '(* about this *)', '  A #x;']);
    expect(network?.comment).toBe('about this');
  });

  it('caps the number of networks', () => {
    const lines = Array.from({ length: 6_000 }, () => 'NETWORK');
    expect(splitNetworks(lines)).toHaveLength(5_000);
  });

  it('rejects text that is not a block', () => {
    expect(() => parseAwl('hello')).toThrow(DbParseError);
  });
});

describe('STL highlighting and rendering', () => {
  let highlighter: SclHighlighter;
  beforeAll(async () => {
    highlighter = await createAwlHighlighter({ readGrammar, readWasm });
  });

  const tokensOf = (line: string): Array<{ text: string; cls: string }> => highlighter.tokenize([line])[0] ?? [];

  it('classifies instructions, jumps, labels and absolute addresses with the repo grammar', () => {
    expect(tokensOf('      L     MW10;').find((t) => t.text === 'L')?.cls).toBe('c-instruction');
    expect(tokensOf('      A     "Tag";').find((t) => t.text === 'A')?.cls).toBe('c-instruction');
    expect(tokensOf('      JC    next;').find((t) => t.text === 'JC')?.cls).toBe('c-keyword');
    expect(tokensOf('next: NOP   0;').some((t) => t.cls === 'c-label')).toBe(true);
    expect(tokensOf('      O     I      0.1;').some((t) => t.cls === 'c-absolute')).toBe(true);
    expect(tokensOf('      A     "Tag_Input_1";    // check input').some((t) => t.cls === 'c-comment')).toBe(true);
  });

  it('never loses or invents text', () => {
    for (const network of model.networks) {
      if (network.body.kind !== 'code') {
        continue;
      }
      const { lines } = network.body;
      highlighter.tokenize(lines).forEach((tokens, i) => {
        expect(tokens.map((t) => t.text).join('')).toBe(lines[i]);
      });
    }
  });

  it('renders networks with comments and numbered, highlighted code panes with unique ids', () => {
    const html = renderBlockHtml(withHighlighting(model, { awl: highlighter }), assets);
    expect(html).toContain('Network 1: Motor control');
    expect(html).toContain('first comment line');
    expect(html).toContain('class="code-view no-outline"');
    expect(html).toContain('<div class="cl" id="n1-L1">');
    expect(html).toContain('<div class="cl" id="n2-L1">');
    expect(html).toContain('<span class="c-instruction">');
    expect(html).toContain('(empty network)');
  });

  it('escapes instruction text', () => {
    const evil = parseAwl('FUNCTION_BLOCK "X"\nBEGIN\nNETWORK\nTITLE = <b>t</b>\n  A <script>x</script>;\nEND_FUNCTION_BLOCK');
    const html = renderBlockHtml(withHighlighting(evil, { awl: highlighter }), assets);
    expect(html).not.toContain('<script>x');
    expect(html).not.toContain('<b>t</b>');
  });
});

function filesWithExtensions(dir: string, extensions: string[]): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return filesWithExtensions(path, extensions);
    }
    return extensions.some((e) => path.toLowerCase().endsWith(e)) ? [path] : [];
  });
}

/** Local, git-ignored samples; skipped when the folder is absent. */
const testRoot = join(root, 'test');

describe.skipIf(!existsSync(testRoot))('local corpus (all .awl and .stl files under test/)', () => {
  it('parses and tokenizes every file', async () => {
    const corpusHighlighter = await createAwlHighlighter({ readGrammar, readWasm });
    const failures: string[] = [];
    const files = filesWithExtensions(testRoot, ['.awl', '.stl']);
    for (const file of files) {
      try {
        const parsed = parseAwl(readFileSync(file, 'utf-8'));
        expect(parsed.networks.length, file).toBeGreaterThan(0);
        for (const network of parsed.networks) {
          if (network.body.kind !== 'code') {
            continue;
          }
          const { lines } = network.body;
          corpusHighlighter.tokenize(lines).forEach((tokens, i) => {
            if (tokens.map((t) => t.text).join('') !== lines[i]) {
              failures.push(`${file}: token text differs in network ${network.index}, line ${i + 1}`);
            }
          });
        }
      } catch (error: unknown) {
        failures.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    expect(failures).toEqual([]);
    expect(files.length).toBeGreaterThan(0);
  }, 60_000);
});
