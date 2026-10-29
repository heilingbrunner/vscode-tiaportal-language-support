import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseDataBlock } from '../../src/parser/dbParser';
import type { UdtResolver } from '../../src/parser/memberBuilder';
import { parseS7dclModel, parseS7dclUdt, s7dclBlockKeyword } from '../../src/parser/s7dclParser';
import { parseS7res } from '../../src/parser/s7res';
import { parseUdt, parseUdtModel } from '../../src/parser/udtParser';
import { renderBlockHtml } from '../../src/render/html';
import { createHighlighter, withHighlighting, type HighlightLanguage, type SclHighlighter } from '../../src/render/sclHighlighter';

const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = (name: string): string => readFileSync(join(root, 'fixtures', name), 'utf-8');
const assets = { cspSource: 'x', nonce: 'n', styleUri: 's.css', scriptUri: 's.js' };

const VALVE_S7DCL = `﻿TYPE
    { S7_Version := "0.1" }
    DataTyp_Valve : STRUCT
        {
            S7_MLC := "MLC_open";
            S7_Setpoint := "False"
        }
        Open : Bool := false;
        { S7_MLC := "MLC_pos"; S7_Setpoint := "False" }
        Position : Real := 0.0;
        { S7_Setpoint := "False" }
        Retries : USInt := 3;
        { S7_Setpoint := "False" }
        Name : String[16] := 'valve';
    END_STRUCT;
END_TYPE
`;

const DEMO_DB_S7DCL = `{
    S7_Author := "tester";
    S7_BlockTitle := "MLC_title";
    S7_Family := "demo";
    S7_Optimized := "TRUE";
    S7_StandardRetain := "FALSE";
    S7_Version := "0.1"
}
DATA_BLOCK Demo_DB
    VAR
        { S7_MLC := "MLC_info" }
        Info : STRUCT
            { S7_MLC := "MLC_cycle" }
            Cycle : Time;
            {
                S7_Access := "ReadOnly := External";
                S7_Visibility := "Hidden := External"
            }
            Pos : Real := 1.5;
            Stamp : DTL;
            Flags : Array[0..3] of Bool;
            Name : String[16] := 'valve';
            Sub : STRUCT
                Level : Int := 7;
            END_STRUCT;
        END_STRUCT;
        { S7_MLC := "MLC_valve"; S7_Setpoint := "False" }
        Valve1 : _.DataTyp_Valve;
        Missing : _.Unknown_Type;
        Rows : Array[1..2] of STRUCT
            Id : Int;
        END_STRUCT;
        Big : Array[0..1000] of Int;
        { S7_Setpoint := "True" }
        Count : DInt;
    END_VAR
    VAR RETAIN
        Kept : Bool;
    END_VAR

    Info.Cycle := T#25s;
    Info.Flags[2] := TRUE;
    Rows[2].Id := 9;
    Valve1.Retries := 5;
END_DATA_BLOCK
`;

const RES = (...pairs: Array<[string, string]>): string =>
  `MultiLingualTexts:\n${pairs.map(([id, text]) => `  - id: ${id}\n    de-DE: ${text}`).join('\n')}\n`;

const texts = parseS7res(
  RES(
    ['MLC_open', 'Command: open valve'],
    ['MLC_pos', 'Position [%]'],
    ['MLC_title', 'Demo data block'],
    ['MLC_info', 'Information block'],
    ['MLC_cycle', 'Last cycle time'],
    ['MLC_valve', 'first valve'],
  ),
);

const classicValve = parseUdt(fixture('Valve.udt'));
const s7dclValve = parseS7dclUdt(VALVE_S7DCL, texts);
const resolveClassic: UdtResolver = (name) => (name.toLowerCase() === classicValve.name.toLowerCase() ? classicValve.members : undefined);
const resolveS7dcl: UdtResolver = (name) => (name.toLowerCase() === s7dclValve.name.toLowerCase() ? s7dclValve.members : undefined);

describe('s7dclBlockKeyword', () => {
  it('finds the declaration keyword behind attribute blocks and a BOM', () => {
    expect(s7dclBlockKeyword(DEMO_DB_S7DCL)).toBe('DATA_BLOCK');
    expect(s7dclBlockKeyword(VALVE_S7DCL)).toBe('TYPE');
    expect(s7dclBlockKeyword('{ S7_Optimized := "TRUE" }\nFUNCTION "F" : Void')).toBe('FUNCTION');
    expect(s7dclBlockKeyword('FUNCTION_BLOCK "FB"')).toBe('FUNCTION_BLOCK');
    expect(s7dclBlockKeyword('nothing here')).toBeUndefined();
  });
});

describe('s7dcl TYPE', () => {
  it('renders like the classic .udt of the same type', () => {
    const model = parseS7dclModel(VALVE_S7DCL, texts, resolveS7dcl);
    expect({ ...model, texts: undefined }).toEqual(parseUdtModel(fixture('Valve.udt'), resolveClassic));
  });

  it('reads title and comment of the type from the resource texts', () => {
    const source = 'TYPE\n { S7_BlockTitle := "T1"; S7_BlockComment := "C1" }\n X : STRUCT\n a : Bool;\n END_STRUCT;\nEND_TYPE';
    const model = parseS7dclModel(source, parseS7res(RES(['T1', 'The title'], ['C1', 'The comment'])));
    expect(model).toMatchObject({ kind: 'UDT', name: 'X', title: 'The title', comment: 'The comment' });
  });

  it('keeps the text id as comment when the resource has no such entry or no resource exists', () => {
    const source = 'TYPE\n X : STRUCT\n { S7_MLC := "MLC_zz" }\n a : Bool;\n END_STRUCT;\nEND_TYPE';
    expect(parseS7dclModel(source, parseS7res(RES(['other', 'x']))).sections[0]?.members[0]?.comment).toBe('MLC_zz');
    expect(parseS7dclModel(source).sections[0]?.members[0]?.comment).toBe('MLC_zz');
  });

  it('maps the access attributes onto the flags of the row', () => {
    const source = `TYPE
      X : STRUCT
        { S7_Access := "ReadOnly := External"; S7_Visibility := "Unlisted := External" }
        a : Bool;
        { S7_Access := "ReadOnly := External"; S7_Visibility := "Hidden := External" }
        b : Bool;
        c : Bool;
      END_STRUCT;
    END_TYPE`;
    const [a, b, c] = parseS7dclModel(source).sections[0]?.members ?? [];
    expect(a).toMatchObject({ accessible: true, writable: false, visible: false });
    expect(b).toMatchObject({ accessible: false, writable: false, visible: false });
    expect(c).toMatchObject({ accessible: true, writable: true, visible: true });
  });

  it('resolves global scope names and array bounds like the classic quoted names', () => {
    const source = 'TYPE\n X : STRUCT\n a : Array[0.._.NoOfModul] of _.Module;\n END_STRUCT;\nEND_TYPE';
    expect(parseS7dclModel(source).sections[0]?.members[0]?.datatype).toBe('Array[0.."NoOfModul"] of "Module"');
  });

  it('keeps array initial values on one line, without element attributes', () => {
    const source = `TYPE
      X : STRUCT
        t : Array[0..2] of DInt := [
            (),
            { S7_MLC := "MLC_e" }
            DINT#7,
            8(1.0)
        ];
      END_STRUCT;
    END_TYPE`;
    expect(parseS7dclModel(source).sections[0]?.members[0]?.startValue).toBe('[ (), DINT#7, 8(1.0) ]');
  });

  it('fails with a line number on malformed input', () => {
    expect(() => parseS7dclModel('TYPE\n X : STRUCT\n a : Bool;\n')).toThrow(/END_STRUCT expected \(line \d+\)/);
    expect(() => parseS7dclModel('TYPE\n X : Bool;')).toThrow(/STRUCT expected/);
  });
});

describe('s7dcl DATA_BLOCK', () => {
  it('renders like the classic .db of the same block', () => {
    const model = parseS7dclModel(DEMO_DB_S7DCL, texts, resolveS7dcl);
    expect({ ...model, texts: undefined }).toEqual(parseDataBlock(fixture('data-block.db'), resolveClassic));
  });

  it('describes an instance data block like the classic one', () => {
    const model = parseS7dclModel('{ S7_Optimized := "TRUE"; S7_StandardRetain := "FALSE"; S7_Version := "0.1" }\nDATA_BLOCK CMN_Demo_DB : CMN_Demo\nEND_DATA_BLOCK\n');
    expect(model).toEqual(parseDataBlock(fixture('instance-db.db')));
    expect(model.dataBlock?.instanceOf).toBe('CMN_Demo');
  });

  it('builds a data block on a UDT from its members', () => {
    const model = parseS7dclModel('DATA_BLOCK Valves : _.DataTyp_Valve\nEND_DATA_BLOCK', undefined, resolveS7dcl);
    expect(model.dataBlock?.instanceOf).toBe('');
    expect(model.sections[0]?.members.map((m) => m.name)).toEqual(['Open', 'Position', 'Retries', 'Name']);
  });

  it('retains members of VAR RETAIN sections and of blocks with standard retain', () => {
    const rows = parseS7dclModel(DEMO_DB_S7DCL, texts).sections[0]?.members ?? [];
    expect(rows.find((m) => m.name === 'Kept')?.retainChecked).toBe(true);
    expect(rows.find((m) => m.name === 'Count')?.retainChecked).toBe(false);
    const retained = parseS7dclModel('{ S7_StandardRetain := "TRUE" }\nDATA_BLOCK D\nVAR\n a : Int;\nEND_VAR\nEND_DATA_BLOCK');
    expect(retained.sections[0]?.members[0]?.retainChecked).toBe(true);
    expect(retained.dataBlock?.nonRetain).toBe(false);
  });

  it('shows the elements of an array that forms the whole block', () => {
    const model = parseS7dclModel('DATA_BLOCK Gaps : Array[0..2] of Real\n\nEND_DATA_BLOCK');
    expect(model.dataBlock?.instanceOf).toBe('');
    expect(model.sections[0]?.members.map((m) => [m.name, m.datatype])).toEqual([
      ['[0]', 'Real'],
      ['[1]', 'Real'],
      ['[2]', 'Real'],
    ]);
  });

  it('applies start values behind attribute blocks and skips default assignments', () => {
    const source = `DATA_BLOCK D : T
        { S7_MLC := "MLC_a" }
        A.B := ();
        { S7_MLC := "MLC_b" }
        A.C := 5;
      END_DATA_BLOCK`;
    const udt: UdtResolver = () => [
      {
        name: 'A',
        pragmas: {},
        init: '',
        comment: '',
        type: {
          kind: 'struct',
          members: [
            { name: 'B', pragmas: {}, init: '', comment: '', type: { kind: 'simple', text: 'Int' } },
            { name: 'C', pragmas: {}, init: '', comment: '', type: { kind: 'simple', text: 'Int' } },
          ],
        },
      },
    ];
    const [a] = parseS7dclModel(source, undefined, udt).sections[0]?.members ?? [];
    expect(a?.children.map((c) => [c.name, c.startValue, c.startIsDefault])).toEqual([
      ['B', '0', true],
      ['C', '5', false],
    ]);
  });

  it('ignores constant sections', () => {
    const model = parseS7dclModel('DATA_BLOCK D\nVAR CONSTANT\n MAX : Int := 12;\nEND_VAR\nVAR\n a : Int;\nEND_VAR\nEND_DATA_BLOCK');
    expect(model.sections[0]?.members.map((m) => m.name)).toEqual(['a']);
  });

  it('shows the resolved comments in the rendered page', () => {
    const html = renderBlockHtml(parseS7dclModel(DEMO_DB_S7DCL, texts, resolveS7dcl), assets);
    expect(html).toContain('Last cycle time');
    expect(html).toContain('Demo data block');
  });

  it('fails on a block that is not terminated', () => {
    expect(() => parseS7dclModel('DATA_BLOCK D\nVAR\n a : Int;\n')).toThrow(/END_VAR expected/);
  });
});

const SCL_FUNCTION = `{
    S7_EditorMode := "SCL";
    S7_Optimized := "TRUE";
    S7_Version := "0.1"
}
FUNCTION "ML_Check" : Int
    VAR_INPUT
        { S7_MLC := "MLC_begin" }
        Id_Begin : DInt;
    END_VAR
    VAR_TEMP
        ti_INDEX : Int;
    END_VAR

    { S7_Language := "SCL" }
    NETWORK
        (* END_NETWORK inside a comment *)
        REGION Loop
            FOR #ti_INDEX := 1 TO 3 DO
                #Id_Begin := #ti_INDEX;
            END_FOR;
        END_REGION
    END_NETWORK
END_FUNCTION
`;

const LAD_BLOCK = `{
    S7_BlockTitle := "MLC_blk";
    S7_Optimized := "TRUE";
    S7_PreferredLanguage := "LAD";
    S7_Version := "0.1"
}
FUNCTION_BLOCK "FB_Mixed"
    VAR_INPUT
        Ib_Enable : Bool;
    END_VAR
    VAR RETAIN
        mi_Count : Int;
    END_VAR

    {
        S7_Language := "LAD";
        S7_NetworkComment := "MLC_c1";
        S7_NetworkTitle := "MLC_t1"
    }
    NETWORK
        RUNG wire#powerrail
            Contact( #Ib_Enable )
            Coil( #mb_Out )
        END_RUNG
    END_NETWORK
    { S7_Language := "LAD" }
    NETWORK
        RUNG wire#powerrail
        END_RUNG
    END_NETWORK
    { S7_Language := "SCL" }
    NETWORK
        #mi_Count := #mi_Count + 1;
    END_NETWORK
END_FUNCTION_BLOCK
`;

describe('s7dcl FUNCTION / FUNCTION_BLOCK / ORGANIZATION_BLOCK', () => {
  it('shows a pure SCL block like an .scl source: interface table and code with outline', () => {
    const model = parseS7dclModel(SCL_FUNCTION, parseS7res(RES(['MLC_begin', 'Begin area'])));
    expect(model).toMatchObject({ kind: 'FC', name: 'ML_Check', language: 'SCL', memoryLayout: 'Optimized', networks: [] });
    expect(model.sections.find((s) => s.name === 'Input')?.members[0]).toMatchObject({ name: 'Id_Begin', comment: 'Begin area' });
    expect(model.sections.find((s) => s.name === 'Temp')?.members.map((m) => m.name)).toEqual(['ti_INDEX']);
    expect(model.sections.find((s) => s.name === 'Return')?.members[0]).toMatchObject({ name: 'Ret_Val', datatype: 'Int' });
    expect(model.code?.lines[0]).toBe('(* END_NETWORK inside a comment *)');
    expect(model.code?.lines).toHaveLength(6);
    expect(model.code?.regions).toEqual([{ name: 'Loop', line: 2, depth: 0 }]);
  });

  it('keeps one network per NETWORK in a LAD block and decides the language per network', () => {
    const model = parseS7dclModel(LAD_BLOCK, parseS7res(RES(['MLC_blk', 'Block title'], ['MLC_t1', 'Enable'], ['MLC_c1', 'Comment 1'])));
    expect(model).toMatchObject({ kind: 'FB', name: 'FB_Mixed', language: 'LAD', title: 'Block title', code: undefined });
    expect(model.networks.map((n) => [n.index, n.language, n.body.kind])).toEqual([
      [1, 'LAD', 'code'],
      [2, 'LAD', 'empty'],
      [3, 'SCL', 'code'],
    ]);
    expect(model.networks[0]).toMatchObject({ title: 'Enable', comment: 'Comment 1' });
    expect(model.networks[0]?.body).toMatchObject({ lines: ['RUNG wire#powerrail', '    Contact( #Ib_Enable )', '    Coil( #mb_Out )', 'END_RUNG'] });
    expect(model.networks[2]?.body).toMatchObject({ lines: ['#mi_Count := #mi_Count + 1;'] });
  });

  it('marks the members of a VAR RETAIN section as retained', () => {
    const statics = parseS7dclModel(LAD_BLOCK).sections.find((s) => s.name === 'Static');
    expect(statics?.members[0]).toMatchObject({ name: 'mi_Count', retain: 'Retain' });
  });

  it('reads an organization block without sections', () => {
    const model = parseS7dclModel('{ S7_PreferredLanguage := "LAD" }\nORGANIZATION_BLOCK "Startup"\n{ S7_Language := "LAD" }\nNETWORK\nEND_NETWORK\nEND_ORGANIZATION_BLOCK');
    expect(model).toMatchObject({ kind: 'OB', name: 'Startup' });
    expect(model.networks.map((n) => n.body.kind)).toEqual(['empty']);
  });

  it('renders the page of a block', () => {
    const html = renderBlockHtml(parseS7dclModel(LAD_BLOCK), assets);
    expect(html).toContain('FB_Mixed');
    expect(html).toContain('Contact(');
    expect(html).toContain('(empty network)');
  });

  it('offers one collapse/expand toggle with both icons when there is something to fold', () => {
    const html = renderBlockHtml(parseS7dclModel(LAD_BLOCK), assets);
    expect(html.match(/data-toggle-all/g)).toHaveLength(1);
    expect(html).toContain('data-action="collapse"');
    expect(html).toContain('aria-label="Collapse all"');
    expect(html).toContain('class="icon-collapse"');
    expect(html).toContain('class="icon-expand"');
    // interface sections with members fold too, so a single SCL block has the toggle as well
    expect(renderBlockHtml(parseS7dclModel(SCL_FUNCTION), assets)).toContain('data-toggle-all');
  });

  it('has no toggle without foldable sections and with at most one network, or in a UDT view', () => {
    const empty = '{ S7_PreferredLanguage := "LAD" }\nFUNCTION_BLOCK "F"\n{ S7_Language := "SCL" }\nNETWORK\nEND_NETWORK\nEND_FUNCTION_BLOCK';
    expect(renderBlockHtml(parseS7dclModel(empty), assets)).not.toContain('data-toggle-all');
    expect(renderBlockHtml(parseS7dclModel(VALVE_S7DCL, texts, resolveS7dcl), assets)).not.toContain('data-toggle-all');
  });
});

const readGrammar = async (language: HighlightLanguage): Promise<string> =>
  readFileSync(join(root, 'syntaxes', `${language}.tmLanguage.json`), 'utf-8');
const readWasm = async (): Promise<ArrayBuffer> => {
  const bytes = readFileSync(createRequire(import.meta.url).resolve('vscode-oniguruma/release/onig.wasm'));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

describe('s7dcl syntax highlighting in the viewer', () => {
  let highlighter: SclHighlighter;
  beforeAll(async () => {
    highlighter = await createHighlighter('s7dcl', { readGrammar, readWasm });
  });
  // neighbouring tokens of one class are merged (`{ S7_MLC` is one token), so look for the token containing the text
  const classOf = (line: string, text: string): string | undefined =>
    highlighter.tokenize([line])[0]?.find((t) => t.text.includes(text))?.cls;

  it('highlights rungs: keywords, wires, instructions and operands', () => {
    const lines = ['RUNG wire#powerrail', '    Contact( "CMN_Workdata".Basic.Info.SimulationActivated )', '    Coil( #Bits.bEnable )', 'END_RUNG'];
    const [rung, contact, coil, end] = highlighter.tokenize(lines);
    expect(rung?.find((t) => t.text === 'RUNG')?.cls).toBe('c-keyword');
    expect(rung?.find((t) => t.text === 'wire#powerrail')?.cls).toBe('c-label');
    expect(contact?.find((t) => t.text === 'Contact')?.cls).toBe('c-function');
    expect(contact?.find((t) => t.text === '"CMN_Workdata"')?.cls).toBe('c-global');
    expect(coil?.find((t) => t.text === 'Coil')?.cls).toBe('c-function');
    expect(coil?.find((t) => t.text === '#Bits')?.cls).toBe('c-local');
    expect(end?.[0]).toEqual({ text: 'END_RUNG', cls: 'c-keyword' });
  });

  it('highlights attribute blocks, structure keywords and global scope names', () => {
    expect(classOf('        { S7_MLC := "MLC_1" }', 'S7_MLC')).toBe('c-pragma');
    expect(classOf('        { S7_MLC := "MLC_1" }', '"MLC_1"')).toBe('c-string');
    expect(classOf('    NETWORK', 'NETWORK')).toBe('c-keyword');
    expect(classOf('        a : Array[0.._.NoOfX] of _.Module;', '_.')).toBe('c-keyword');
  });

  it('highlights the LAD networks of a model and leaves other networks to their own grammar', () => {
    const model = withHighlighting(parseS7dclModel(LAD_BLOCK), { s7dcl: highlighter });
    const [lad, , scl] = model.networks.map((n) => n.body);
    expect(lad?.kind === 'code' && lad.tokens?.[0]).toEqual([
      { text: 'RUNG', cls: 'c-keyword' },
      { text: ' ', cls: '' },
      { text: 'wire#powerrail', cls: 'c-label' },
    ]);
    expect(scl?.kind === 'code' && scl.tokens).toBeUndefined();
  });

  it('keeps the text of every line intact for the whole local corpus sample', () => {
    const lines = LAD_BLOCK.split('\n');
    const tokens = highlighter.tokenize(lines);
    expect(tokens.map((line) => line.map((t) => t.text).join(''))).toEqual(lines);
  });
});

describe('texts of the .s7res', () => {
  const source = 'TYPE\n X : STRUCT\n { S7_MLC := "MLC_used" }\n a : Bool;\n { S7_MLC := "MLC_gone" }\n b : Bool;\n END_STRUCT;\nEND_TYPE';
  const res = parseS7res(RES(['MLC_used', 'Used <text>'], ['MLC_unused', 'Never referenced']));

  it('lists every text with its use and the referenced ids the file lacks', () => {
    expect(parseS7dclModel(source, res).texts).toEqual({
      entries: [
        { id: 'MLC_used', text: 'Used <text>', used: true },
        { id: 'MLC_unused', text: 'Never referenced', used: false },
      ],
      missing: ['MLC_gone'],
    });
  });

  it('has no texts without an .s7res', () => {
    expect(parseS7dclModel(source).texts).toBeUndefined();
    expect(renderBlockHtml(parseS7dclModel(source), assets)).not.toContain('Texts (.s7res)');
  });

  it('renders a collapsed, escaped table with a summary of unused and missing ids', () => {
    const html = renderBlockHtml(parseS7dclModel(source, res), assets);
    expect(html).toContain('<summary>Texts (.s7res): 2, 1 unused, 1 missing</summary>');
    expect(html).toContain('Used &lt;text&gt;');
    expect(html).toContain('<tr class="missing"><td class="id">MLC_gone</td>');
    expect(html).toContain('<tr class="unused"><td class="id">MLC_unused</td>');
  });

  it('counts texts referenced by block, network and member attributes as used', () => {
    const block = '{ S7_BlockTitle := "T" }\nFUNCTION_BLOCK "F"\n{ S7_Language := "SCL"; S7_NetworkTitle := "N"; S7_NetworkComment := "C" }\nNETWORK\nEND_NETWORK\nEND_FUNCTION_BLOCK';
    const model = parseS7dclModel(block, parseS7res(RES(['T', 't'], ['N', 'n'], ['C', 'c'])));
    expect(model.texts?.entries.every((e) => e.used)).toBe(true);
    expect(model.texts?.missing).toEqual([]);
  });
});

describe('parseS7dclModel', () => {
  it('rejects sources it has no view for', () => {
    expect(() => parseS7dclModel('nothing here')).toThrow(/TYPE, DATA_BLOCK, FUNCTION_BLOCK, FUNCTION or ORGANIZATION_BLOCK expected/);
  });
});

const testRoot = join(root, 'test');

function collect(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return collect(path);
    }
    return path.endsWith('.s7dcl') ? [path] : [];
  });
}

describe.skipIf(!existsSync(testRoot))('local corpus (all .s7dcl files under test/)', () => {
  const files = existsSync(testRoot) ? collect(testRoot) : [];

  it('parses every type, data block and code block', () => {
    const failures: string[] = [];
    let parsed = 0;
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      const resFile = file.replace(/\.s7dcl$/, '.s7res');
      const resTexts = existsSync(resFile) ? parseS7res(readFileSync(resFile, 'utf-8')) : undefined;
      try {
        parseS7dclModel(source, resTexts);
        parsed++;
      } catch (error) {
        failures.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
    expect(parsed).toBeGreaterThan(0);
  });
});
