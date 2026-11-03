import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { layoutLad } from '../../src/layout/ladLayout';
import { createHighlighter, withHighlighting, type HighlightLanguage, type SclHighlighter } from '../../src/render/sclHighlighter';
import type { LadScene, SceneItem } from '../../src/layout/scene';
import { parseBlock } from '../../src/parser/blockParser';
import { parseS7dclModel } from '../../src/parser/s7dclParser';
import { parseSdLad } from '../../src/parser/sdLadParser';
import { sceneToSvg } from '../../src/render/svg';

const ofType = <T extends SceneItem['t']>(scene: LadScene, t: T): Array<Extract<SceneItem, { t: T }>> =>
  scene.items.filter((i): i is Extract<SceneItem, { t: T }> => i.t === t);
const texts = (scene: LadScene): string[] => ofType(scene, 'text').map((i) => i.s);
const titles = (scene: LadScene): string[] =>
  ofType(scene, 'text')
    .filter((t) => t.cls === 'title')
    .map((t) => t.s);
const fbd = (source: string): LadScene => layoutLad(parseSdLad(source.split('\n'), true));
const hasRail = (scene: LadScene): boolean => ofType(scene, 'line').some((l) => l.cls === 'rail');

describe('FBD networks in SD format', () => {
  const AND_COILS = `RUNG "IOCheckRequest"
    A( in2 := #TOF_IOCheckActive.Q )
    Coil( "IOCheckActive" )
    Coil( #SafetyOverruled )
END_RUNG`;

  it('maps A / O / X to And / Or / Xor boxes', () => {
    const names = (source: string[]): string[] => [...parseSdLad(source, true).parts.values()].map((p) => p.name);
    expect(names(['RUNG #a', '  A( in2 := #b )', 'END_RUNG'])).toEqual(['And']);
    expect(names(['RUNG #a', '  O( in2 := #b )', '  Coil( #c )', 'END_RUNG'])).toEqual(['Or', 'Coil']);
    expect(names(['RUNG #a', '  X( in2 := #b )', 'END_RUNG'])).toEqual(['Xor']);
    expect(parseSdLad(['RUNG #a', '  A( in2 := #b )', 'END_RUNG'], true).fbd).toBe(true);
  });

  it('wires the rung start operand to the box pin instead of drawing a contact', () => {
    const scene = fbd(AND_COILS);
    expect(ofType(scene, 'contact')).toHaveLength(0);
    expect(texts(scene)).toEqual(expect.arrayContaining(['"IOCheckRequest"', '#TOF_IOCheckActive.Q']));
  });

  it('draws logic boxes with their IEC symbol and coils as assignment boxes, without a power rail', () => {
    const scene = fbd(AND_COILS);
    expect(hasRail(scene)).toBe(false);
    expect(ofType(scene, 'coil')).toHaveLength(0);
    expect(titles(scene)).toEqual(['&', '=', '=']);
    expect(texts(scene)).toEqual(expect.arrayContaining(['"IOCheckActive"', '#SafetyOverruled']));
    expect(ofType(scene, 'box')).toHaveLength(3);
  });

  it('feeds consecutive coils from the same signal because assignments have no output pin', () => {
    const net = parseSdLad(AND_COILS.split('\n'), true);
    const [and, coil1, coil2] = [...net.parts.values()];
    const feeds = net.wires.flatMap((w) => w.dsts.map((d) => [w.src, d] as const));
    const fedByAnd = feeds.filter(([src]) => src.kind === 'name' && src.uid === and?.uid);
    expect(fedByAnd.map(([, dst]) => (dst.kind === 'name' ? dst.uid : ''))).toEqual([coil1?.uid, coil2?.uid]);
    expect(feeds.some(([src]) => src.kind === 'name' && src.uid === coil1?.uid)).toBe(false);
    // the drawing routes one wire from the And box to each assignment box
    const routed = ofType(layoutLad(net), 'line').filter((l) => l.cls === 'wire' && l.net !== undefined);
    expect(routed).toHaveLength(2);
    expect(new Set(routed.map((l) => l.pts.at(-1)?.join(','))).size).toBe(2);
  });

  it('shows no pin labels on logic boxes and assignments', () => {
    const pins = ofType(fbd(AND_COILS), 'text').filter((t) => t.cls === 'pin');
    expect(pins).toEqual([]);
  });

  it('titles set, reset, return and jump coils and marks negated ones', () => {
    expect(titles(fbd('RUNG #a\n S_Coil( #q )\nEND_RUNG'))).toEqual(['S']);
    expect(titles(fbd('RUNG #a\n R_Coil( #q )\nEND_RUNG'))).toEqual(['R']);
    expect(titles(fbd('RUNG #a\n JumpCoil( L1 )\nEND_RUNG'))).toEqual(['JMP']);
    expect(titles(fbd('RUNG #a\n I_JumpCoil( L1 )\nEND_RUNG'))).toEqual(['JMPN']);
  });

  it('joins several drivers of a wire with an Or box', () => {
    const net = parseSdLad(['RUNG #a', '  wire#w1', '  Coil( #q )', 'END_RUNG', 'RUNG #b', 'END_RUNG wire#w1'], true);
    expect([...net.parts.values()].map((p) => p.name)).toContain('Or');
    expect(titles(layoutLad(net))).toContain('>=1');
  });

  it('keeps a lone operand rung as a contact', () => {
    const net = parseSdLad(['RUNG #a', 'END_RUNG'], true);
    expect([...net.parts.values()].map((p) => p.name)).toEqual(['Contact']);
  });

  it('keeps moves as boxes and leaves LAD untouched', () => {
    const move = fbd('RUNG\n  Move( in := #a, out1 => #b )\nEND_RUNG');
    expect(texts(move)).toEqual(expect.arrayContaining(['MOVE', '#a', '#b']));
    const lad = layoutLad(parseSdLad(['RUNG wire#powerrail', '  Coil( #q )', 'END_RUNG']));
    expect(hasRail(lad)).toBe(true);
    expect(ofType(lad, 'coil')).toHaveLength(1);
  });

  it('renders as svg without a power rail', () => {
    const svg = sceneToSvg(fbd(AND_COILS));
    expect(svg).toContain('<svg class="lad"');
    expect(svg).not.toContain('class="rail"');
  });
});

describe('FBD blocks in the viewer model', () => {
  const SOURCE = `{ S7_PreferredLanguage := "FBD" }
FUNCTION_BLOCK "FB_Fbd"
VAR_INPUT
    a : Bool;
END_VAR
{ S7_Language := "FBD" }
NETWORK
    RUNG #a
        A( in2 := #b )
        Coil( #c )
    END_RUNG
END_NETWORK
{ S7_Language := "LAD" }
NETWORK
    RUNG wire#powerrail
        Contact( #a )
        Coil( #c )
    END_RUNG
END_NETWORK
{ S7_Language := "FBD" }
NETWORK
    RUNG
    END_RUNG
END_NETWORK
END_FUNCTION_BLOCK`;

  it('draws FBD networks as FBD and LAD networks as ladder', () => {
    const model = parseS7dclModel(SOURCE);
    const [fbdNet, ladNet, emptyNet] = model.networks;
    expect(model.language).toBe('FBD');
    expect(fbdNet?.language).toBe('FBD');
    expect(fbdNet?.body.kind === 'lad' && hasRail(fbdNet.body.scene)).toBe(false);
    expect(fbdNet?.body.kind === 'lad' && texts(fbdNet.body.scene)).toEqual(expect.arrayContaining(['&', '=']));
    expect(ladNet?.body.kind === 'lad' && hasRail(ladNet.body.scene)).toBe(true);
    expect(emptyNet?.body.kind).toBe('empty');
  });
});

describe('FBD networks in Openness XML', () => {
  const xml = (language: string): string => `<?xml version="1.0" encoding="utf-8"?>
<Document>
  <SW.Blocks.FC ID="0">
    <AttributeList>
      <Interface><Sections xmlns="http://www.siemens.com/automation/Openness/SW/Interface/v5"><Section Name="Input" /></Sections></Interface>
      <Name>Demo</Name>
      <ProgrammingLanguage>${language}</ProgrammingLanguage>
    </AttributeList>
    <ObjectList>
      <SW.Blocks.CompileUnit ID="3" CompositionName="CompileUnits">
        <AttributeList>
          <NetworkSource>
            <FlgNet xmlns="http://www.siemens.com/automation/Openness/SW/NetworkSource/FlgNet/v5">
              <Parts>
                <Access Scope="LocalVariable" UId="21"><Symbol><Component Name="Start" /></Symbol></Access>
                <Access Scope="LocalVariable" UId="22"><Symbol><Component Name="Stop" /></Symbol></Access>
                <Access Scope="LocalVariable" UId="23"><Symbol><Component Name="Motor" /></Symbol></Access>
                <Part Name="And" UId="24" />
                <Part Name="Coil" UId="25" />
              </Parts>
              <Wires>
                <Wire UId="30"><IdentCon UId="21" /><NameCon UId="24" Name="in1" /></Wire>
                <Wire UId="31"><IdentCon UId="22" /><NameCon UId="24" Name="in2" /></Wire>
                <Wire UId="32"><NameCon UId="24" Name="out" /><NameCon UId="25" Name="in" /></Wire>
                <Wire UId="33"><IdentCon UId="23" /><NameCon UId="25" Name="operand" /></Wire>
              </Wires>
            </FlgNet>
          </NetworkSource>
          <ProgrammingLanguage>${language}</ProgrammingLanguage>
        </AttributeList>
        <ObjectList />
      </SW.Blocks.CompileUnit>
    </ObjectList>
  </SW.Blocks.FC>
</Document>`;

  const sceneOfFirst = (language: string): LadScene => {
    const body = parseBlock(xml(language), '')?.networks[0]?.body;
    if (body?.kind !== 'lad') {
      throw new Error('network is not a diagram');
    }
    return body.scene;
  };

  it('draws And boxes with operands at the pins and the coil as an assignment box', () => {
    const scene = sceneOfFirst('FBD');
    expect(hasRail(scene)).toBe(false);
    expect(ofType(scene, 'coil')).toHaveLength(0);
    expect(titles(scene)).toEqual(['&', '=']);
    expect(texts(scene)).toEqual(expect.arrayContaining(['#Start', '#Stop', '#Motor']));
  });

  it('draws the same parts as a ladder diagram when the network is LAD', () => {
    const scene = sceneOfFirst('LAD');
    expect(hasRail(scene)).toBe(true);
    expect(ofType(scene, 'coil')).toHaveLength(1);
  });
});

const root = fileURLToPath(new URL('../..', import.meta.url));
const readGrammar = async (language: HighlightLanguage): Promise<string> =>
  readFileSync(join(root, 'syntaxes', `${language}.tmLanguage.json`), 'utf-8');
const readWasm = async (): Promise<ArrayBuffer> => {
  const bytes = readFileSync(createRequire(import.meta.url).resolve('vscode-oniguruma/release/onig.wasm'));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

describe('FBD syntax highlighting', () => {
  let highlighter: SclHighlighter;
  beforeAll(async () => {
    highlighter = await createHighlighter('fbd', { readGrammar, readWasm });
  });

  const RUNG = [
    'RUNG "IOCheckRequest"',
    '    A( in2 := #TOF_IOCheckActive.Q )',
    '    Coil( "IOCheckActive" )',
    '    Move( in := #a, out1 => #b )',
    '    "FC_SafetyIOCheck"()',
    'END_RUNG',
  ];
  const tokens = (lines: readonly string[]): ReturnType<SclHighlighter['tokenize']> => highlighter.tokenize(lines);
  const classOf = (line: string, text: string, lines: readonly string[] = RUNG): string | undefined =>
    tokens(lines)[lines.indexOf(line)]?.find((t) => t.text === text)?.cls;

  it('highlights the rung keywords and the start operand', () => {
    expect(classOf(RUNG[0] as string, 'RUNG')).toBe('c-keyword');
    expect(classOf(RUNG[0] as string, '"IOCheckRequest"')).toBe('c-global');
    expect(tokens(RUNG).at(-1)?.[0]).toEqual({ text: 'END_RUNG', cls: 'c-keyword' });
  });

  it('highlights logic boxes, assignments and instruction boxes as instructions', () => {
    expect(classOf(RUNG[1] as string, 'A')).toBe('c-instruction');
    expect(classOf(RUNG[2] as string, 'Coil')).toBe('c-instruction');
    expect(classOf(RUNG[3] as string, 'Move')).toBe('c-instruction');
  });

  it('highlights box pins as parameters and operands by their kind', () => {
    expect(classOf(RUNG[1] as string, 'in2')).toBe('c-param');
    expect(classOf(RUNG[3] as string, 'out1')).toBe('c-param');
    expect(classOf(RUNG[1] as string, '#TOF_IOCheckActive')).toBe('c-local');
  });

  it('highlights a call of a block like a function', () => {
    expect(classOf(RUNG[4] as string, '"FC_SafetyIOCheck"')).toBeDefined();
  });

  it('highlights jump labels, attributes and the network structure', () => {
    const lines = ['{ S7_Language := "FBD" }', 'NETWORK', '    Label(GENERALSAFETY)', '    RUNG', '    END_RUNG', 'END_NETWORK'];
    const out = tokens(lines);
    expect(out[0]?.some((t) => t.cls === 'c-pragma')).toBe(true);
    expect(out[1]?.find((t) => t.text === 'NETWORK')?.cls).toBe('c-keyword');
    expect(out[2]?.find((t) => t.text === 'Label')?.cls).toBe('c-keyword');
    expect(out[2]?.find((t) => t.text === 'GENERALSAFETY')?.cls).toBe('c-label');
  });

  it('keeps the text of every line intact', () => {
    const lines = ['{', '  S7_Language := "FBD";', '  S7_NetworkTitle := "MLC_3xD"', '}', 'NETWORK', ...RUNG, 'END_NETWORK'];
    expect(tokens(lines).map((line) => line.map((t) => t.text).join(''))).toEqual(lines);
  });

  it('is used for FBD source text of a block, the LAD grammar for LAD text', async () => {
    const s7dcl = await createHighlighter('s7dcl', { readGrammar, readWasm });
    const source = (language: string): string =>
      `FUNCTION_BLOCK "F"\n{ S7_Language := "${language}" }\nNETWORK\n    RUNG\n        A( in2 := #b )\n        Unknown thing here\n    END_RUNG\nEND_NETWORK\nEND_FUNCTION_BLOCK`;
    const tokenOf = (language: string, set: { s7dcl?: SclHighlighter; fbd?: SclHighlighter }): string | undefined => {
      const body = withHighlighting(parseS7dclModel(source(language)), set).networks[0]?.body;
      return body?.kind === 'code' ? body.tokens?.[1]?.find((t) => t.text === 'A')?.cls : undefined;
    };
    expect(tokenOf('FBD', { s7dcl, fbd: highlighter })).toBe('c-instruction');
    expect(tokenOf('LAD', { s7dcl, fbd: highlighter })).toBe('c-function');
    // no FBD grammar available: the LAD grammar still colours the rung
    expect(tokenOf('FBD', { s7dcl })).toBe('c-function');
  });
});

describe('real FBD export (fixtures/function-block-fbd.s7dcl)', () => {
  const source = readFileSync(join(root, 'fixtures', 'function-block-fbd.s7dcl'), 'utf-8');

  it('draws every network of the block as FBD without a power rail', () => {
    const model = parseS7dclModel(source);
    expect(model.language).toBe('FBD');
    const kinds = model.networks.map((n) => n.body.kind);
    expect(kinds).toEqual(['lad', 'lad', 'lad', 'lad', 'lad', 'lad', 'lad', 'empty']);
    for (const network of model.networks) {
      expect(network.body.kind === 'lad' && hasRail(network.body.scene)).toBe(false);
    }
    const all = model.networks.flatMap((n) => (n.body.kind === 'lad' ? titles(n.body.scene) : []));
    expect(all).toEqual(expect.arrayContaining(['&', '=', 'JMPN', 'RET', 'TOF']));
  });

  it('tokenizes the whole file with the FBD grammar without losing text', async () => {
    const highlighter = await createHighlighter('fbd', { readGrammar, readWasm });
    const lines = source.replace(/^﻿/, '').split(/\r?\n/);
    const tokens = highlighter.tokenize(lines);
    expect(tokens.map((line) => line.map((t) => t.text).join(''))).toEqual(lines);
    const find = (text: string): string | undefined =>
      tokens.flat().find((t) => t.text === text)?.cls;
    expect(find('NETWORK')).toBe('c-keyword');
    expect(find('RUNG')).toBe('c-keyword');
    expect(find('A')).toBe('c-instruction');
    expect(find('Coil')).toBe('c-instruction');
    expect(find('I_JumpCoil')).toBe('c-instruction');
    expect(find('in2')).toBe('c-param');
    expect(find('GENERALSAFETY')).toBe('c-label');
  });
});

describe('edge contacts in FBD', () => {
  const edge = (callee: string): LadScene =>
    fbd(`RUNG\n  ${callee}( operand := "IOCheckRequest", bit := #FP_IOCheckActive )\nEND_RUNG`);

  it('draws P_Contact and N_Contact as P / N boxes with the operand above and the bit below', () => {
    for (const [callee, title] of [['P_Contact', 'P'], ['N_Contact', 'N']] as const) {
      const scene = edge(callee);
      expect(titles(scene)).toEqual([title]);
      expect(ofType(scene, 'contact')).toHaveLength(0);
      const box = ofType(scene, 'box')[0];
      const operand = ofType(scene, 'text').find((t) => t.s === '"IOCheckRequest"');
      const bit = ofType(scene, 'text').find((t) => t.s === '#FP_IOCheckActive');
      expect(operand?.y).toBeLessThan(box?.y ?? 0);
      expect(bit?.y).toBeGreaterThan((box?.y ?? 0) + (box?.h ?? 0));
    }
  });

  it('keeps them as contacts in a LAD network', () => {
    const lad = layoutLad(parseSdLad(['RUNG', '  P_Contact( operand := #a, bit := #b )', 'END_RUNG']));
    expect(ofType(lad, 'contact').map((c) => c.edge)).toEqual(['P']);
  });

  it('shows the P box of the real export', () => {
    const source = readFileSync(join(root, 'fixtures', 'function-block-fbd.s7dcl'), 'utf-8');
    const first = parseS7dclModel(source).networks[0]?.body;
    expect(first?.kind === 'lad' && titles(first.scene)).toEqual(['P', 'TOF']);
  });
});

describe('logic box inputs in FBD XML', () => {
  const block = (name: string, card: string): string => `<?xml version="1.0" encoding="utf-8"?>
<Document><SW.Blocks.FC ID="0"><AttributeList>
<Interface><Sections xmlns="http://www.siemens.com/automation/Openness/SW/Interface/v5"><Section Name="Input" /></Sections></Interface>
<Name>Demo</Name><ProgrammingLanguage>FBD</ProgrammingLanguage></AttributeList>
<ObjectList><SW.Blocks.CompileUnit ID="3" CompositionName="CompileUnits"><AttributeList><NetworkSource>
<FlgNet xmlns="http://www.siemens.com/automation/Openness/SW/NetworkSource/FlgNet/v5"><Parts>
<Access Scope="LocalVariable" UId="21"><Symbol><Component Name="Start" /></Symbol></Access>
<Part Name="${name}" UId="24"><TemplateValue Name="Card" Type="Cardinality">${card}</TemplateValue></Part>
</Parts><Wires><Wire UId="30"><IdentCon UId="21" /><NameCon UId="24" Name="in1" /></Wire></Wires></FlgNet>
</NetworkSource><ProgrammingLanguage>FBD</ProgrammingLanguage></AttributeList><ObjectList /></SW.Blocks.CompileUnit></ObjectList></SW.Blocks.FC></Document>`;
  const pinCount = (name: string, card: string): number => {
    const body = parseBlock(block(name, card), '')?.networks[0]?.body;
    if (body?.kind !== 'lad') {
      throw new Error('network is not a diagram');
    }
    // one operand stub on in1; the unwired inputs are drawn as box rows, so measure the box height
    return Math.round(ofType(body.scene, 'box')[0]?.h ?? 0);
  };

  it.each([['And', '&'], ['A', '&'], ['Or', '>=1'], ['O', '>=1'], ['Xor', '=1'], ['X', '=1']])(
    'draws a %s part as a %s box',
    (name, title) => {
      const body = parseBlock(block(name, '2'), '')?.networks[0]?.body;
      expect(body?.kind === 'lad' && titles(body.scene)).toEqual([title]);
    },
  );

  it('makes the box as tall as its Card template says', () => {
    expect(pinCount('And', '4')).toBeGreaterThan(pinCount('And', '2'));
    // every further input adds one pin row (ROW = 24)
    expect(pinCount('O', '5') - pinCount('O', '2')).toBe(3 * 24);
  });
});
