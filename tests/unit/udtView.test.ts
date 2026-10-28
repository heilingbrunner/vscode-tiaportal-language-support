import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { UdtResolver } from '../../src/parser/memberBuilder';
import { parseUdt, parseUdtModel } from '../../src/parser/udtParser';
import { renderBlockHtml } from '../../src/render/html';

const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = (name: string): string => readFileSync(join(root, 'fixtures', name), 'utf-8');
const assets = { cspSource: 'x', nonce: 'n', styleUri: 's.css', scriptUri: 's.js' };

const valve = parseUdt(fixture('Valve.udt'));
const resolver: UdtResolver = (name) => (name.toLowerCase() === valve.name.toLowerCase() ? valve.members : undefined);
const udtSource = (members: string): string => `TYPE "T"\nVERSION : 0.1\n   STRUCT\n${members}\n   END_STRUCT;\n\nEND_TYPE\n`;

describe('UDT view model', () => {
  const model = parseUdtModel(fixture('Valve.udt'), resolver);
  const members = model.sections[0]?.members ?? [];

  it('describes the type as one unnamed section of members', () => {
    expect(model).toMatchObject({ kind: 'UDT', name: 'DataTyp_Valve', networks: [], typeInfo: { version: '0.1' } });
    expect(model.sections).toHaveLength(1);
    expect(model.sections[0]?.name).toBe('');
    expect(members.map((m) => m.name)).toEqual(['Open', 'Position', 'Retries', 'Name']);
  });

  it('keeps data type, default value, comment and flags of a member', () => {
    expect(members[0]).toMatchObject({ datatype: 'Bool', startValue: 'false', comment: 'Command: open valve' });
    expect(members[3]).toMatchObject({ datatype: 'String[16]', startValue: "'valve'" });
    expect(members[0]).toMatchObject({ accessible: true, writable: true, visible: true, setpoint: false });
  });

  it('reads the setpoint and external access pragmas', () => {
    const source = udtSource("      A { S7_SetPoint := 'True'} : Int;\n      B { ExternalAccessible := 'False'} : Int;");
    const [a, b] = parseUdtModel(source).sections[0]?.members ?? [];
    expect(a).toMatchObject({ setpoint: true, accessible: true });
    expect(b).toMatchObject({ accessible: false, writable: false, visible: false });
  });

  it('expands a referenced UDT through the resolver', () => {
    const nested = parseUdtModel(udtSource('      Pump : "DataTyp_Valve";'), resolver);
    expect(nested.sections[0]?.members[0]?.children.map((c) => c.name)).toEqual(['Open', 'Position', 'Retries', 'Name']);
  });

  it('shows a UDT that is not known as a plain row', () => {
    const unknown = parseUdtModel(udtSource('      Q : "Missing";'), resolver);
    expect(unknown.sections[0]?.members[0]).toMatchObject({ datatype: '"Missing"', children: [] });
  });

  it('does not expand a type into itself forever', () => {
    const source = 'TYPE "Loop"\nSTRUCT\n Next : "Loop";\n V : Int;\nEND_STRUCT;\nEND_TYPE';
    const loop = parseUdt(source);
    const self: UdtResolver = (name) => (name === 'Loop' ? loop.members : undefined);
    const result = parseUdtModel(source, self);
    expect(result.sections[0]?.members.map((m) => m.name)).toEqual(['Next', 'V']);
    expect(result.sections[0]?.members[0]?.children).toEqual([]);
  });
});

describe('UDT view html', () => {
  const html = renderBlockHtml(parseUdtModel(fixture('Valve.udt'), resolver), assets);

  it('shows the columns of the TIA Portal UDT editor, without Retain', () => {
    const headers = [...html.matchAll(/<th>(.*?)<\/th>/g)].map((m) => m[1]);
    expect(headers).toEqual([
      '#',
      'Name',
      'Data type',
      'Default value',
      'Accessible from HMI/OPC UA',
      'Writable from HMI/OPC UA',
      'Visible in HMI engineering',
      'Setpoint',
      'Supervision',
      'Comment',
    ]);
  });

  it('lists the members directly, numbered from 1, without a section row', () => {
    expect(html).not.toContain('class="section');
    expect(html).toContain('class="rownum">1<');
    expect(html).toContain('class="rownum">4<');
    expect(html).toContain('Command: open valve');
  });

  it('greys the default value of a member without a start value', () => {
    const plain = renderBlockHtml(parseUdtModel(udtSource('      A : Int;')), assets);
    expect(plain).toContain('class="start default"');
    expect(html).not.toContain('class="start default"'); // every member of Valve.udt has an explicit value
  });

  it('names the type and its version in the header', () => {
    expect(html).toContain('DataTyp_Valve');
    expect(html).toContain('[UDT]');
    expect(html).toContain('Version: 0.1');
    expect(html).not.toContain('id="zoom"');
  });

  it('starts nested members collapsed, like the data block view', () => {
    const nested = renderBlockHtml(parseUdtModel(udtSource('      Pump : "DataTyp_Valve";'), resolver), assets);
    expect(nested).toContain('class="caret collapsed"');
    expect(nested).toContain('<tr class="hidden"');
  });

  it('shows a notice for a type without members', () => {
    const empty = renderBlockHtml(parseUdtModel(udtSource('')), assets);
    expect(empty).toContain('This data type declares no members.');
    expect(empty).not.toContain('<table');
  });

  it('escapes names and comments from the source', () => {
    const evil = renderBlockHtml(parseUdtModel(udtSource('      A : Int;   // <script>alert(1)</script>')), assets);
    expect(evil).not.toContain('<script>alert');
    expect(evil).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
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
const projectDir = join(root, 'test', 'Project');

describe.skipIf(!existsSync(projectDir))('local project corpus (udt view)', () => {
  it('renders every .udt file', () => {
    const files = filesWithExtension(projectDir, '.udt').sort();
    const known = new Map<string, ReturnType<typeof parseUdt>['members']>();
    for (const file of files) {
      const definition = parseUdt(readFileSync(file, 'utf-8'));
      known.set(definition.name.toLowerCase(), definition.members);
    }
    const resolve: UdtResolver = (name) => known.get(name.toLowerCase());
    const failures: string[] = [];
    for (const file of files) {
      try {
        const html = renderBlockHtml(parseUdtModel(readFileSync(file, 'utf-8'), resolve), assets);
        if (!html.includes('[UDT]')) {
          failures.push(`${file}: no UDT header`);
        }
      } catch (error: unknown) {
        failures.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    expect(failures).toEqual([]);
  }, 120_000);
});
