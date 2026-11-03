import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { LadScene, SceneItem } from '../../src/layout/scene';
import type { NetworkModel } from '../../src/model/types';
import { parseBlock } from '../../src/parser/blockParser';
import { displayLanguage, parseLanguage } from '../../src/parser/languages';
import { parseS7dclModel } from '../../src/parser/s7dclParser';
import { renderBlockHtml } from '../../src/render/html';
import { createHighlighter, withHighlighting, type HighlightLanguage, type SclHighlighter } from '../../src/render/sclHighlighter';

const root = fileURLToPath(new URL('../..', import.meta.url));
const assets = { cspSource: 'x', nonce: 'n', styleUri: 's.css', scriptUri: 's.js' };
const hasRail = (network: NetworkModel | undefined): boolean =>
  network?.body.kind === 'lad' && network.body.scene.items.some((i: SceneItem) => i.t === 'line' && i.cls === 'rail');
const titles = (scene: LadScene): string[] =>
  scene.items.flatMap((i) => (i.t === 'text' && i.cls === 'title' ? [i.s] : []));

describe('language names', () => {
  it.each([
    ['LAD', false, 'LAD'],
    ['FBD', false, 'FBD'],
    ['F_LAD', false, 'F-LAD'],
    ['F_FBD', false, 'F-FBD'],
    ['f-lad', false, 'F-LAD'],
    ['LAD', true, 'F-LAD'],
    ['FBD', true, 'F-FBD'],
    ['fbd', true, 'F-FBD'],
    ['SCL', true, 'SCL'],
    ['STL', true, 'STL'],
    ['SCL', false, 'SCL'],
  ])('reads %s (block safety %s) as %s', (raw, safe, shown) => {
    expect(displayLanguage(parseLanguage(raw, safe))).toBe(shown);
  });

  it('keeps the drawing language of a fail-safe variant', () => {
    expect(parseLanguage('F_FBD')).toEqual({ base: 'FBD', safety: true });
    expect(parseLanguage('F_LAD')).toEqual({ base: 'LAD', safety: true });
    expect(parseLanguage('LAD', true)).toEqual({ base: 'LAD', safety: true });
    expect(parseLanguage('')).toEqual({ base: '', safety: false });
  });
});

describe('F-LAD / F-FBD in Openness XML', () => {
  const xml = (language: string): string => `<?xml version="1.0" encoding="utf-8"?>
<Document><SW.Blocks.FC ID="0"><AttributeList>
<Interface><Sections xmlns="http://www.siemens.com/automation/Openness/SW/Interface/v5"><Section Name="Input" /></Sections></Interface>
<Name>F_Demo</Name><ProgrammingLanguage>${language}</ProgrammingLanguage></AttributeList>
<ObjectList><SW.Blocks.CompileUnit ID="3" CompositionName="CompileUnits"><AttributeList><NetworkSource>
<FlgNet xmlns="http://www.siemens.com/automation/Openness/SW/NetworkSource/FlgNet/v5"><Parts>
<Access Scope="LocalVariable" UId="21"><Symbol><Component Name="Start" /></Symbol></Access>
<Access Scope="LocalVariable" UId="23"><Symbol><Component Name="Motor" /></Symbol></Access>
<Part Name="Coil" UId="25" />
</Parts><Wires>
<Wire UId="30"><IdentCon UId="21" /><NameCon UId="25" Name="in" /></Wire>
<Wire UId="33"><IdentCon UId="23" /><NameCon UId="25" Name="operand" /></Wire>
</Wires></FlgNet></NetworkSource><ProgrammingLanguage>${language}</ProgrammingLanguage></AttributeList>
<ObjectList /></SW.Blocks.CompileUnit></ObjectList></SW.Blocks.FC></Document>`;

  it('shows F_FBD as F-FBD and draws it as FBD', () => {
    const model = parseBlock(xml('F_FBD'), '');
    expect(model?.language).toBe('F-FBD');
    expect(model?.networks[0]?.language).toBe('F-FBD');
    expect(hasRail(model?.networks[0])).toBe(false);
    const body = model?.networks[0]?.body;
    expect(body?.kind === 'lad' && titles(body.scene)).toEqual(['=']);
  });

  it('shows F_LAD as F-LAD and draws it as LAD', () => {
    const model = parseBlock(xml('F_LAD'), '');
    expect(model?.language).toBe('F-LAD');
    expect(model?.networks[0]?.language).toBe('F-LAD');
    expect(hasRail(model?.networks[0])).toBe(true);
  });

  it('leaves the standard languages as they are', () => {
    expect(parseBlock(xml('LAD'), '')?.networks[0]?.language).toBe('LAD');
    expect(parseBlock(xml('FBD'), '')?.networks[0]?.language).toBe('FBD');
  });

  it('prints the fail-safe name in the header and on the network', () => {
    const model = parseBlock(xml('F_FBD'), '');
    const html = model ? renderBlockHtml(model, assets) : '';
    expect(html).toContain('Language: F-FBD');
    expect(html).toContain('<span class="lang">F-FBD</span>');
  });
});

describe('F-LAD / F-FBD in SD format', () => {
  const block = (language: string, safety: string): string => `{
    S7_PreferredLanguage := "${language}";
    ${safety}
    S7_Version := "0.1"
}
FUNCTION_BLOCK "FB_F"
VAR_INPUT
    a : Bool;
END_VAR
{ S7_Language := "${language}" }
NETWORK
    RUNG #a
        Coil( #b )
    END_RUNG
END_NETWORK
{ S7_Language := "SCL" }
NETWORK
    #b := #a;
END_NETWORK
END_FUNCTION_BLOCK`;

  it.each([
    ['LAD', 'F-LAD'],
    ['FBD', 'F-FBD'],
  ])('marks a safety block with %s networks as %s', (language, shown) => {
    const model = parseS7dclModel(block(language, 'S7_Safety := "TRUE";'));
    expect(model.language).toBe(shown);
    expect(model.networks[0]?.language).toBe(shown);
    // the drawing follows the base language
    expect(hasRail(model.networks[0])).toBe(language === 'LAD');
  });

  it('accepts the other spellings of the flag', () => {
    expect(parseS7dclModel(block('FBD', 'S7_Safety := "True";')).language).toBe('F-FBD');
    expect(parseS7dclModel(block('LAD', 'S7_Safety := "true";')).language).toBe('F-LAD');
  });

  it('keeps SCL networks of a safety block as SCL', () => {
    const model = parseS7dclModel(block('LAD', 'S7_Safety := "TRUE";'));
    expect(model.networks[1]?.language).toBe('SCL');
  });

  it('does not mark a standard block', () => {
    expect(parseS7dclModel(block('LAD', '')).language).toBe('LAD');
    expect(parseS7dclModel(block('FBD', 'S7_Safety := "FALSE";')).language).toBe('FBD');
    expect(parseS7dclModel(block('FBD', '')).networks[0]?.language).toBe('FBD');
  });

  it('shows the real safety export as F-FBD', () => {
    const source = readFileSync(join(root, 'fixtures', 'function-block-fbd.s7dcl'), 'utf-8');
    const model = parseS7dclModel(source);
    expect(model.language).toBe('F-FBD');
    expect(model.networks.map((n) => n.language)).toEqual(Array(8).fill('F-FBD'));
    expect(model.networks.slice(0, 7).every((n) => !hasRail(n) && n.body.kind === 'lad')).toBe(true);
  });
});

const readGrammar = async (language: HighlightLanguage): Promise<string> =>
  readFileSync(join(root, 'syntaxes', `${language}.tmLanguage.json`), 'utf-8');
const readWasm = async (): Promise<ArrayBuffer> => {
  const bytes = readFileSync(createRequire(import.meta.url).resolve('vscode-oniguruma/release/onig.wasm'));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

describe('fail-safe instructions in the grammars', () => {
  const RUNG = ['RUNG', '    ESTOP1( E1 := #a, ACK_NEC := #b )', '    F_TON( in := #c, pt := t#5s )', '    Coil( #d )', 'END_RUNG'];
  let s7dcl: SclHighlighter;
  let fbd: SclHighlighter;
  beforeAll(async () => {
    s7dcl = await createHighlighter('s7dcl', { readGrammar, readWasm });
    fbd = await createHighlighter('fbd', { readGrammar, readWasm });
  });
  const classOf = (highlighter: SclHighlighter, lineIndex: number, text: string): string | undefined =>
    highlighter.tokenize(RUNG)[lineIndex]?.find((t) => t.text === text)?.cls;

  it.each([['F-LAD (s7dcl)'], ['F-FBD (fbd)']])('highlights safety functions and F timers in %s', (name) => {
    const highlighter = name.includes('fbd') ? fbd : s7dcl;
    expect(classOf(highlighter, 1, 'ESTOP1')).toBe('c-instruction');
    expect(classOf(highlighter, 2, 'F_TON')).toBe('c-instruction');
  });

  it('keeps highlighting the undrawable networks of a safety block with the grammar of the base language', () => {
    const source = `{ S7_PreferredLanguage := "FBD"; S7_Safety := "TRUE" }
FUNCTION_BLOCK "F"
{ S7_Language := "FBD" }
NETWORK
    RUNG
        Unknown thing here
        ESTOP1( E1 := #a )
    END_RUNG
END_NETWORK
END_FUNCTION_BLOCK`;
    const network = withHighlighting(parseS7dclModel(source), { s7dcl, fbd }).networks[0];
    expect(network?.language).toBe('F-FBD');
    const body = network?.body;
    expect(body?.kind).toBe('code');
    const tokens = body?.kind === 'code' ? body.tokens?.flat() : undefined;
    expect(tokens?.find((t) => t.text === 'ESTOP1')?.cls).toBe('c-instruction');
  });
});
