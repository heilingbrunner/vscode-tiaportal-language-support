import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { layoutLad } from '../../src/layout/ladLayout';
import type { LadScene, SceneItem } from '../../src/layout/scene';
import { parseBlock } from '../../src/parser/blockParser';
import { parseAwl } from '../../src/parser/sclParser';
import { parseSdLad } from '../../src/parser/sdLadParser';
import { stlAddress, stlAddresses, withAddresses } from '../../src/parser/stlAddresses';
import { buildAddressResolver, type AddressResolver } from '../../src/parser/tagAddresses';
import { parseTagTable, type PlcTag, type TagTable } from '../../src/parser/tagTableParser';
import { renderBlockHtml } from '../../src/render/html';

const root = fileURLToPath(new URL('../..', import.meta.url));
const assets = { cspSource: 'x', nonce: 'n', styleUri: 's.css', scriptUri: 's.js' };

const tag = (name: string, address: string): PlcTag => ({
  name,
  address,
  dataType: 'Bool',
  comment: '',
  retain: false,
  accessible: true,
  writable: true,
  visible: true,
});
const table = (...tags: PlcTag[]): TagTable => ({ name: 'T', tags, constants: [] });
const resolver: AddressResolver = buildAddressResolver([
  table(tag('AlwaysTRUE', '%M1.2'), tag('M_IBN_1', '%M4.1'), tag('NoAddress', ''), tag('Start', '%I0.0'), tag('Motor', '%Q4.0')),
]);

const ofType = <T extends SceneItem['t']>(scene: LadScene, t: T): Array<Extract<SceneItem, { t: T }>> =>
  scene.items.filter((i): i is Extract<SceneItem, { t: T }> => i.t === t);
const hints = (scene: LadScene): string[] => ofType(scene, 'text').filter((t) => t.cls === 'hint').map((t) => t.s);

describe('address resolver', () => {
  it('resolves a quoted global tag, ignoring case', () => {
    expect(resolver('"AlwaysTRUE"')).toBe('%M1.2');
    expect(resolver('"alwaystrue"')).toBe('%M1.2');
    expect(resolver('  "M_IBN_1" ')).toBe('%M4.1');
  });

  it('knows nothing about locals, data block members, constants or tags without an address', () => {
    expect(resolver('#Start')).toBeUndefined();
    expect(resolver('"DB_Data".Member')).toBeUndefined();
    expect(resolver('"NoAddress"')).toBeUndefined();
    expect(resolver('"Unknown"')).toBeUndefined();
    expect(resolver('5')).toBeUndefined();
    expect(resolver('')).toBeUndefined();
  });

  it('lets the first table win for a name that two tables define', () => {
    const both = buildAddressResolver([table(tag('X', '%I1.0')), table(tag('X', '%I2.0'))]);
    expect(both('"X"')).toBe('%I1.0');
  });

  it('reads the addresses of an Openness tag table export', () => {
    const xml = `<?xml version="1.0"?><Document><SW.Tags.PlcTagTable ID="0"><AttributeList><Name>T</Name></AttributeList><ObjectList>
      <SW.Tags.PlcTag ID="1" CompositionName="Tags"><AttributeList><DataTypeName>Bool</DataTypeName><LogicalAddress>%M1.2</LogicalAddress><Name>AlwaysTRUE</Name></AttributeList></SW.Tags.PlcTag>
    </ObjectList></SW.Tags.PlcTagTable></Document>`;
    const parsed = parseTagTable(xml, '');
    expect(buildAddressResolver(parsed ? [parsed] : [])('"AlwaysTRUE"')).toBe('%M1.2');
  });
});

describe('STL address column', () => {
  it.each([
    ['      A "AlwaysTRUE";', '%M1.2'],
    ['      = "M_IBN_1";', '%M4.1'],
    ['      FP "M_IBN_1"; // edge', '%M4.1'],
    ['      L 0;', '0'],
    ['      L 60;', '60'],
    ['      L T#5s;', 'T#5s'],
    ['      L -1.5;', '-1.5'],
    ['      L "Unknown";', ''],
    ['      A "DB".Member;', ''],
    ['      CLR;', ''],
    ['      A(;', ''],
    ['      );', ''],
    ['', ''],
    ['// A "AlwaysTRUE";', ''],
  ])('shows %j as %j', (line, address) => {
    expect(stlAddress(line, resolver)).toBe(address);
  });

  it('gives one entry per line, or none when no line has an address', () => {
    expect(stlAddresses(['A "AlwaysTRUE";', 'CLR;', ''], resolver)).toEqual(['%M1.2', '', '']);
    expect(stlAddresses(['CLR;', 'SET;'], resolver)).toBeUndefined();
  });

  const SOURCE = `FUNCTION "FC_X" : Void
BEGIN
NETWORK
TITLE = N1
      A "AlwaysTRUE";
      = "M_IBN_1";
END_FUNCTION`;

  it('adds the column to the STL networks of a model and renders it', () => {
    const model = withAddresses(parseAwl(SOURCE), resolver);
    const body = model.networks[0]?.body;
    expect(body?.kind === 'code' && body.addresses).toEqual(['%M1.2', '%M4.1']);
    const html = renderBlockHtml(model, assets);
    expect(html).toContain('class="code-pane has-addr"');
    expect(html).toContain('<span class="addr">%M1.2</span>');
    expect(html).toContain('<span class="addr">%M4.1</span>');
  });

  it('adds nothing without a known address, and renders no column', () => {
    const model = withAddresses(parseAwl(SOURCE), () => undefined);
    const body = model.networks[0]?.body;
    expect(body?.kind === 'code' && body.addresses).toBeUndefined();
    expect(renderBlockHtml(model, assets)).not.toContain('has-addr');
  });

  it('escapes the text of the column', () => {
    const html = renderBlockHtml(withAddresses(parseAwl(SOURCE), () => '<%M1.2>'), assets);
    expect(html).toContain('<span class="addr">&lt;%M1.2&gt;</span>');
  });
});

describe('block comment', () => {
  const withComment = `FUNCTION "FC_X" : Void
TITLE = Demo
////========================================
////SINGULUS TECHNOLOGIES AG
////(c)Copyright 2020
////========================================

BEGIN
NETWORK
      CLR;
END_FUNCTION`;

  it('reads the //// lines in front of BEGIN, without the exported // prefix', () => {
    expect(parseAwl(withComment).comment).toBe(
      ['//========================================', '//SINGULUS TECHNOLOGIES AG', '//(c)Copyright 2020', '//========================================'].join('\n'),
    );
  });

  it('has no comment without such lines, and ignores ordinary comments and the code', () => {
    expect(parseAwl('FUNCTION "F" : Void\n// plain comment\nBEGIN\nNETWORK\n////not a header comment\nEND_FUNCTION').comment).toBe('');
  });

  it('collapses a multi-line comment to its first line, like TIA Portal', () => {
    const html = renderBlockHtml(parseAwl(withComment), assets);
    expect(html).toContain('<details class="comment"><summary>//========================================...</summary>');
    expect(html).toContain('//SINGULUS TECHNOLOGIES AG');
  });

  it('shows a one-line comment as it is', () => {
    const html = renderBlockHtml(parseAwl('FUNCTION "F" : Void\n////only one line\nBEGIN\nNETWORK\n      CLR;\nEND_FUNCTION'), assets);
    expect(html).toContain('<div class="comment">//only one line</div>');
    expect(html).not.toContain('<details');
  });
});

describe('addresses in LAD and FBD', () => {
  const lad = (source: string, fbd = false, addresses?: AddressResolver): LadScene =>
    layoutLad(parseSdLad(source.split('\n'), fbd), addresses);

  it('draws the address below the operand of a contact and a coil', () => {
    const scene = lad('RUNG wire#powerrail\n  Contact( "Start" )\n  Coil( "Motor" )\nEND_RUNG', false, resolver);
    expect(hints(scene)).toEqual(['%I0.0', '%Q4.0']);
    const text = (s: string): { y: number } => ofType(scene, 'text').find((t) => t.s === s) as { y: number };
    expect(text('%I0.0').y).toBeGreaterThan(text('"Start"').y);
  });

  it('leaves the diagram as it is for operands without address, and without a resolver', () => {
    const source = 'RUNG wire#powerrail\n  Contact( "Start" )\n  Coil( #local )\nEND_RUNG';
    expect(hints(lad(source, false, resolver))).toEqual(['%I0.0']);
    const plain = lad(source);
    expect(hints(plain)).toEqual([]);
    expect(lad(source, false, () => undefined).items).toEqual(plain.items);
  });

  it('makes room for the address line above the symbol', () => {
    const source = 'RUNG wire#powerrail\n  Contact( "Start" )\n  Coil( "Motor" )\nEND_RUNG';
    expect(lad(source, false, resolver).height).toBeGreaterThan(lad(source).height);
  });

  it('draws the address below the operand at an FBD input pin', () => {
    const scene = lad('RUNG "Start"\n  A( in2 := "Motor" )\nEND_RUNG', true, resolver);
    expect(hints(scene).sort()).toEqual(['%I0.0', '%Q4.0']);
    for (const operand of ['"Start"', '"Motor"']) {
      const name = ofType(scene, 'text').find((t) => t.s === operand);
      const address = ofType(scene, 'text').find((t) => t.cls === 'hint' && t.x === name?.x && t.y > (name?.y ?? Infinity));
      expect(address).toBeDefined();
    }
  });

  it('reaches the diagrams of Openness XML', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<Document><SW.Blocks.FC ID="0"><AttributeList>
<Interface><Sections xmlns="http://www.siemens.com/automation/Openness/SW/Interface/v5"><Section Name="Input" /></Sections></Interface>
<Name>Demo</Name><ProgrammingLanguage>LAD</ProgrammingLanguage></AttributeList>
<ObjectList><SW.Blocks.CompileUnit ID="3" CompositionName="CompileUnits"><AttributeList><NetworkSource>
<FlgNet xmlns="http://www.siemens.com/automation/Openness/SW/NetworkSource/FlgNet/v5"><Parts>
<Access Scope="GlobalVariable" UId="21"><Symbol><Component Name="Start" /></Symbol></Access>
<Part Name="Contact" UId="22" />
</Parts><Wires>
<Wire UId="30"><Powerrail /><NameCon UId="22" Name="in" /></Wire>
<Wire UId="31"><IdentCon UId="21" /><NameCon UId="22" Name="operand" /></Wire>
</Wires></FlgNet></NetworkSource><ProgrammingLanguage>LAD</ProgrammingLanguage></AttributeList>
<ObjectList /></SW.Blocks.CompileUnit></ObjectList></SW.Blocks.FC></Document>`;
    const body = parseBlock(xml, '', resolver)?.networks[0]?.body;
    expect(body?.kind === 'lad' && hints(body.scene)).toEqual(['%I0.0']);
    const without = parseBlock(xml, '')?.networks[0]?.body;
    expect(without?.kind === 'lad' && hints(without.scene)).toEqual([]);
  });
});

describe.skipIf(
  !existsSync(join(root, 'test', 'awl', 'FC_Signalgenerator.awl')) ||
    !existsSync(join(root, 'test', 'Project', '=CS+UC06-KF101', 'PLC tags', 'SignalGenerator.xml')),
)('local sample FC_Signalgenerator (the TIA Portal view)', () => {
  it('shows the addresses TIA Portal shows', () => {
    const tags = parseTagTable(readFileSync(join(root, 'test', 'Project', '=CS+UC06-KF101', 'PLC tags', 'SignalGenerator.xml'), 'utf-8'), '');
    const resolve = buildAddressResolver(tags ? [tags] : []);
    const model = withAddresses(parseAwl(readFileSync(join(root, 'test', 'awl', 'FC_Signalgenerator.awl'), 'utf-8')), resolve);
    const column = (n: number): string[] => {
      const body = model.networks[n]?.body;
      return body?.kind === 'code' ? (body.addresses ?? []) : [];
    };
    expect(column(0).slice(0, 3)).toEqual(['%M1.2', '%M1.3', '']);
    expect(column(2).slice(0, 2)).toEqual(['0', '%MW10']);
    expect(column(4).slice(0, 3)).toEqual(['%M3.5', '%M3.6', '%M3.7']);
    expect(model.comment.split('\n')[0]).toBe('//========================================');
  });
});
