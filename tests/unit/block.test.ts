import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { LadScene, SceneItem } from '../../src/layout/scene';
import type { NetworkModel } from '../../src/model/types';
import { parseBlock } from '../../src/parser/blockParser';
import { sceneToSvg } from '../../src/render/svg';

const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = (name: string): string => readFileSync(join(root, 'fixtures', name), 'utf-8');

const sceneOf = (network: NetworkModel): LadScene => {
  if (network.body.kind !== 'lad') {
    throw new Error(`network ${network.index} is not LAD`);
  }
  return network.body.scene;
};
const texts = (scene: LadScene): string[] =>
  scene.items.filter((i): i is Extract<SceneItem, { t: 'text' }> => i.t === 'text').map((i) => i.s);
const ofType = <T extends SceneItem['t']>(scene: LadScene, t: T): Array<Extract<SceneItem, { t: T }>> =>
  scene.items.filter((i): i is Extract<SceneItem, { t: T }> => i.t === t);

/** A real export from the local, git-ignored project; these tests are skipped when it is absent. */
const cmnMainFile = join(root, 'test', 'Project', 'PC-System_1', 'Software PLC_1', 'Program blocks', '4_Modules', '00_CMN', 'CMN_Main.xml');

describe.skipIf(!existsSync(cmnMainFile))('CMN_Main.xml (local real export)', () => {
  const block = existsSync(cmnMainFile) ? parseBlock(readFileSync(cmnMainFile, 'utf-8'), 'de-DE') : undefined;

  it('reads block metadata and title', () => {
    expect(block).toMatchObject({ kind: 'FB', name: 'CMN_Main', number: '6', language: 'LAD', title: 'Modul Common Main' });
  });

  it('reads the interface sections in TIA order', () => {
    const names = block?.sections.map((s) => s.name);
    expect(names).toEqual(['Input', 'Output', 'InOut', 'Static', 'Temp', 'Constant']);
    const statics = block?.sections.find((s) => s.name === 'Static')?.members ?? [];
    expect(statics).toHaveLength(6);
    expect(statics[0]).toMatchObject({ name: 'Ins_Buttonhandling', datatype: '"PFB_Typ_HMI_Button"', accessible: false });
    const temp = block?.sections.find((s) => s.name === 'Temp')?.members ?? [];
    expect(temp[0]).toMatchObject({ name: 'tb_CmnErrorEvaluation', datatype: 'Bool' });
  });

  it('reads all networks with titles; the last one is empty', () => {
    expect(block?.networks).toHaveLength(7);
    expect(block?.networks[0]?.title).toBe('Button Handling');
    expect(block?.networks[6]?.body.kind).toBe('empty');
  });

  it('draws the button handling call with instance, name and operand', () => {
    const scene = sceneOf(block!.networks[0]!);
    expect(texts(scene)).toEqual(
      expect.arrayContaining(['#Ins_Buttonhandling', '"PFB_Typ_HMI_Button"', '"CMN_HMI_Btn"', 'Ip_BtnDB', 'EN', 'ENO']),
    );
    expect(ofType(scene, 'box')).toHaveLength(1);
  });

  it('chains the three calls of network 2 left to right on one row', () => {
    const boxes = ofType(sceneOf(block!.networks[1]!), 'box');
    expect(boxes).toHaveLength(3);
    expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
    expect(boxes[1]!.x).toBeLessThan(boxes[2]!.x);
    expect(new Set(boxes.map((b) => b.y)).size).toBe(1);
  });

  it('lays out 9 parallel contacts, an OR join and one coil on the first contact row', () => {
    const scene = sceneOf(block!.networks[5]!);
    const contacts = ofType(scene, 'contact');
    expect(contacts).toHaveLength(9);
    expect(new Set(contacts.map((c) => c.y)).size).toBe(9);
    const coil = ofType(scene, 'coil')[0]!;
    expect(coil.y).toBe(Math.min(...contacts.map((c) => c.y)));
    expect(texts(scene)).toContain('#tb_CmnErrorEvaluation');
    expect(texts(scene)).toContain('"GE1_PLC_Err".Gen.K1.ErrorEvaluation');
  });
});

describe('boxes.xml (synthetic)', () => {
  const block = parseBlock(fixture('boxes.xml'), 'de-DE');

  it('reads comments, nested members, start values and retain mode', () => {
    expect(block?.sections[0]?.members[0]?.comment).toBe('Start button');
    const statics = block?.sections.find((s) => s.name === 'Static')?.members ?? [];
    expect(statics[0]?.retain).toBe('Set in IDB');
    expect(statics[1]?.children[0]).toMatchObject({ name: 'X', startValue: '5' });
  });

  it('draws a negated contact, a timer with instance and a coil', () => {
    const scene = sceneOf(block!.networks[0]!);
    expect(ofType(scene, 'contact')[0]?.negated).toBe(true);
    expect(texts(scene)).toEqual(expect.arrayContaining(['#Ins_Delay', 'TON', 'Time', 'T#5s', 'Q', 'ET', '#Start', '#Run']));
    expect(ofType(scene, 'coil')).toHaveLength(1);
  });

  it('keeps the series chain of network 1 on a single row (no vertical wire steps)', () => {
    const wires = ofType(sceneOf(block!.networks[0]!), 'line').filter((l) => l.cls === 'wire');
    expect(wires.every((w) => new Set(w.pts.map(([, y]) => y)).size === 1)).toBe(true);
  });

  it('draws a comparator and a Move without ENO, writing to an operand', () => {
    const scene = sceneOf(block!.networks[1]!);
    expect(texts(scene)).toEqual(expect.arrayContaining(['>', 'Int', '#Pos.X', '10', 'MOVE', '#Result']));
    expect(texts(scene)).not.toContain('ENO');
  });

  it('renders STL and SCL networks as source text', () => {
    expect(block?.networks[2]?.body).toEqual({ kind: 'code', language: 'STL', lines: ['A #Start', '= #Run'] });
    expect(block?.networks[3]?.body).toEqual({ kind: 'code', language: 'SCL', lines: ['#Run := #Start;', '// done'] });
    expect(block?.networks[4]?.body.kind).toBe('empty');
  });
});

describe('robustness', () => {
  it('returns undefined for XML that is not a block', () => {
    expect(parseBlock('<Document><Other/></Document>', '')).toBeUndefined();
  });

  const netXml = (parts: string, wires: string): string =>
    '<Document><SW.Blocks.FB><AttributeList><Name>X</Name></AttributeList><ObjectList>' +
    '<SW.Blocks.CompileUnit><AttributeList><NetworkSource><FlgNet>' +
    `<Parts>${parts}</Parts><Wires>${wires}</Wires></FlgNet></NetworkSource></AttributeList>` +
    '</SW.Blocks.CompileUnit></ObjectList></SW.Blocks.FB></Document>';
  const railTo = (uid: string, pin: string): string =>
    `<Wire UId="9"><Powerrail/><NameCon UId="${uid}" Name="${pin}"/></Wire>`;

  it('bounds the Card template value instead of looping forever', () => {
    const xml = netXml(
      '<Part Name="Move" UId="1"><TemplateValue Name="Card" Type="Cardinality">Infinity</TemplateValue></Part>',
      railTo('1', 'en'),
    );
    const scene = sceneOf(parseBlock(xml, '')!.networks[0]!);
    expect(Number.isFinite(scene.width) && Number.isFinite(scene.height)).toBe(true);
  });

  it('treats prototype-like part names as unknown parts', () => {
    for (const name of ['constructor', 'toString', '__proto__']) {
      const xml = netXml(`<Part Name="${name}" UId="1"/>`, railTo('1', 'in'));
      const svg = sceneToSvg(sceneOf(parseBlock(xml, '')!.networks[0]!));
      expect(svg).not.toContain('function');
    }
  });

  it('keeps geometry finite for an OR part without wired inputs', () => {
    const scene = sceneOf(parseBlock(netXml('<Part Name="O" UId="1"/>', ''), '')!.networks[0]!);
    expect(JSON.stringify(scene)).not.toMatch(/null|Infinity|NaN/);
  });

  it('does not expand entity bombs', () => {
    const bomb =
      '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">' +
      '<!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;"><!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;">]>' +
      '<Document><SW.Blocks.FB><AttributeList><Name>&d;&d;&d;&d;&d;&d;&d;&d;&d;&d;</Name></AttributeList></SW.Blocks.FB></Document>';
    const started = Date.now();
    try {
      const name = parseBlock(bomb, '')?.name ?? '';
      expect(name.length).toBeLessThan(2_000_000);
    } catch {
      // rejecting the file is an acceptable outcome
    }
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('escapes operand text in SVG output', () => {
    const svg = sceneToSvg({
      width: 100,
      height: 50,
      items: [{ t: 'text', x: 1, y: 1, s: '<script>alert("x")</script>', cls: 'operand', anchor: 'start' }],
    });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });
});

/** Parses every exported block of a local TIA project (git-ignored, skipped when absent). */
const corpusDir = join(root, 'test', 'Project');

function xmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return xmlFiles(path);
    }
    return path.endsWith('.xml') ? [path] : [];
  });
}

describe.skipIf(!existsSync(corpusDir))('local project corpus', () => {
  it('parses and lays out every block without errors; boxes never overlap', () => {
    for (const file of xmlFiles(corpusDir)) {
      const block = parseBlock(readFileSync(file, 'utf-8'), 'de-DE');
      for (const network of block?.networks ?? []) {
        expect(network.body, file).not.toMatchObject({ language: 'error' });
        if (network.body.kind !== 'lad') {
          continue;
        }
        const { scene } = network.body;
        const finite = scene.items.every((i) => JSON.stringify(i).indexOf('null') < 0);
        expect(finite, `${file} network ${network.index}`).toBe(true);
        const boxes = ofType(scene, 'box');
        for (const [i, a] of boxes.entries()) {
          for (const b of boxes.slice(i + 1)) {
            const overlaps = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
            expect(overlaps, `${file} network ${network.index}`).toBe(false);
          }
        }
      }
    }
  }, 120_000);
});
