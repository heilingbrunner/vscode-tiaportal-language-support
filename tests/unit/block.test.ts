import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { LadScene, SceneItem } from '../../src/layout/scene';
import type { NetworkModel } from '../../src/model/types';
import { CHAR_W } from '../../src/layout/nodes';
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
/** Contact/coil operands are wrapped over several text items; this joins them back in drawing order. */
const operandText = (scene: LadScene): string =>
  ofType(scene, 'text')
    .filter((i) => i.cls === 'operand')
    .map((i) => i.s)
    .join('');

/** Contact/coil labels that a wire segment runs through; a label must never be struck through by a line. */
const labelCollisions = (scene: LadScene): string[] => {
  const labels = ofType(scene, 'text').filter((i) => i.cls === 'operand' && i.anchor === 'middle');
  const wires = ofType(scene, 'line').filter((l) => l.cls === 'wire');
  const hits: string[] = [];
  for (const t of labels) {
    const half = (t.s.length * CHAR_W) / 2;
    const [x0, x1, y0, y1] = [t.x - half, t.x + half, t.y - 9, t.y + 2];
    for (const w of wires) {
      for (let i = 1; i < w.pts.length; i++) {
        const [ax, ay] = w.pts[i - 1]!;
        const [bx, by] = w.pts[i]!;
        const crossesX = Math.max(ax, bx) > x0 && Math.min(ax, bx) < x1;
        const crossesY = Math.max(ay, by) > y0 && Math.min(ay, by) < y1;
        if (crossesX && crossesY) {
          hits.push(t.s);
        }
      }
    }
  }
  return hits;
};

/**
 * Wire segments of different nets that cross, touch in a T or run on top of each other. Only segments
 * carrying a `net` id (the routed connections) are compared; segments of one net may share points.
 */
const netCrossings = (scene: LadScene): string[] => {
  const EPS = 0.5;
  const segs = ofType(scene, 'line').flatMap((l) =>
    l.net === undefined ? [] : l.pts.slice(1).map((b, i) => ({ net: l.net as number, a: l.pts[i]!, b })),
  );
  const isH = (s: (typeof segs)[number]): boolean => Math.abs(s.a[1] - s.b[1]) < EPS;
  const lo = (u: number, v: number): number => Math.min(u, v);
  const hi = (u: number, v: number): number => Math.max(u, v);
  const found: string[] = [];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const [s, t] = [segs[i]!, segs[j]!];
      if (s.net === t.net || s.a[0] === s.b[0] && s.a[1] === s.b[1] || t.a[0] === t.b[0] && t.a[1] === t.b[1]) {
        continue;
      }
      if (isH(s) === isH(t)) {
        const k = isH(s) ? 1 : 0; // shared axis
        const m = isH(s) ? 0 : 1; // running axis
        const overlap = Math.min(hi(s.a[m], s.b[m]), hi(t.a[m], t.b[m])) - Math.max(lo(s.a[m], s.b[m]), lo(t.a[m], t.b[m]));
        if (Math.abs(s.a[k] - t.a[k]) < EPS && overlap > EPS) {
          found.push(`nets ${s.net}/${t.net} overlap at ${isH(s) ? 'y' : 'x'}=${Math.round(s.a[k])}`);
        }
        continue;
      }
      const [h, v] = isH(s) ? [s, t] : [t, s];
      const [px, py] = [v.a[0], h.a[1]];
      const inH = px >= lo(h.a[0], h.b[0]) - EPS && px <= hi(h.a[0], h.b[0]) + EPS;
      const inV = py >= lo(v.a[1], v.b[1]) - EPS && py <= hi(v.a[1], v.b[1]) + EPS;
      const endH = Math.abs(px - h.a[0]) < EPS || Math.abs(px - h.b[0]) < EPS;
      const endV = Math.abs(py - v.a[1]) < EPS || Math.abs(py - v.b[1]) < EPS;
      if (inH && inV && !(endH && endV)) {
        found.push(`nets ${s.net}/${t.net} cross at ${Math.round(px)},${Math.round(py)}`);
      }
    }
  }
  return found;
};

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
    expect(operandText(scene)).toContain('#tb_CmnErrorEvaluation');
    expect(operandText(scene)).toContain('"GE1_PLC_Err".Gen.K1.ErrorEvaluation');
  });
});

const processFile = join(
  root, 'test', 'Project', '=CS+UC06-KF101', 'Programmbausteine', 'zLibrary', 'Bathtypes', 'ProcessBath', 'FB_ProcessBath_Process.xml',
);

describe.skipIf(!existsSync(processFile))('FB_ProcessBath_Process.xml (local real export)', () => {
  const block = existsSync(processFile) ? parseBlock(readFileSync(processFile, 'utf-8'), 'en-US') : undefined;
  const network68 = block?.networks.find((n) => n.title.startsWith('Lid Station right - Open'));

  it('draws both coils of network 68 within a normal width', () => {
    const scene = sceneOf(network68!);
    expect(ofType(scene, 'coil')).toHaveLength(2);
    expect(scene.width).toBeLessThan(1100);
  });

  it('does not run any wire through a contact or coil label in network 68', () => {
    expect(labelCollisions(sceneOf(network68!))).toEqual([]);
  });

  it('does not run an OR bar through the STAT.MON coil of network 63', () => {
    const network63 = block?.networks.find((n) => n.index === 63);
    expect(labelCollisions(sceneOf(network63!))).toEqual([]);
  });

  it('draws no crossing between unconnected wires in networks 63 and 68', () => {
    for (const index of [63, 68]) {
      const network = block?.networks.find((n) => n.index === index);
      expect(netCrossings(sceneOf(network!)), `network ${index}`).toEqual([]);
    }
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

  it('wraps long contact and coil operands so both coils stay close to their contacts', () => {
    const scene = sceneOf(block!.networks[6]!);
    const coils = ofType(scene, 'coil');
    expect(coils).toHaveLength(2);
    expect(ofType(scene, 'contact').filter((c) => c.negated)).toHaveLength(1);
    expect(scene.width).toBeLessThan(700);
    expect(coils.every((c) => c.cx < scene.width)).toBe(true);
    expect(operandText(scene)).toContain('#Station_Handling.Request_Open_Cover');
    expect(operandText(scene)).toContain('#Command_Output.Close_Lid_Station_Right');
    const wrapped = ofType(scene, 'text').filter((i) => i.cls === 'operand');
    expect(wrapped.every((i) => i.s.length <= 14)).toBe(true);
  });

  it('keeps wires of other rows from running through a wrapped contact label', () => {
    const scene = sceneOf(block!.networks[7]!);
    expect(ofType(scene, 'contact')).toHaveLength(4);
    expect(labelCollisions(scene)).toEqual([]);
  });

  it('draws no crossing between unconnected wires in any LAD network of the fixture', () => {
    const lad = (block?.networks ?? []).filter((n) => n.body.kind === 'lad');
    expect(lad.length).toBeGreaterThan(4);
    for (const network of lad) {
      expect(netCrossings(sceneOf(network)), `network ${network.index}`).toEqual([]);
    }
  });

  it('keeps the first branch of a fan-out on a straight line, whatever the label heights are', () => {
    const scene = sceneOf(block!.networks[9]!);
    const [a, b] = ofType(scene, 'contact');
    const [firstCoil] = ofType(scene, 'coil');
    expect(b!.y).toBe(a!.y);
    expect(firstCoil!.y).toBe(a!.y);
    // only the second branch of the fan-out needs a step
    expect(ofType(scene, 'line').filter((l) => l.net !== undefined && l.pts.length > 2)).toHaveLength(1);
  });

  it('moves a whole series chain down together instead of bending it when one link is displaced', () => {
    const scene = sceneOf(block!.networks[10]!);
    const [, q, r] = ofType(scene, 'contact');
    expect(r!.y).toBe(q!.y);
    const bent = ofType(scene, 'line').filter((l) => l.net !== undefined && l.pts.length > 2);
    expect(bent).toHaveLength(0);
  });

  it('is not pushed around by wires of parts that are not placed yet', () => {
    const scene = sceneOf(block!.networks[11]!);
    // contacts in part order: A, B, K, C, D, E, F
    const [a, b, k, c] = ofType(scene, 'contact');
    expect(b!.y).toBe(a!.y);
    expect(a!.y).toBeLessThan(k!.y); // A keeps its place above its sibling K ...
    expect(k!.y).toBeLessThan(c!.y); // ... and the first rung stays above the second one
  });

  it('keeps the first branch of a fan-out straight even when a neighbouring chain is in its way', () => {
    const scene = sceneOf(block!.networks[12]!);
    // contacts in part order: Q, R, P, B, C
    const [, , p, b] = ofType(scene, 'contact');
    expect(b!.y).toBe(p!.y);
  });

  it('shows named constants wired to the pins of a call', () => {
    const scene = sceneOf(block!.networks[13]!);
    expect(texts(scene)).toEqual(expect.arrayContaining(['"EnumMES_Spare"', '#LOCAL_LIMIT', '5', '"STATION_LEFT"']));
  });

  it('shows named constants in SCL code', () => {
    expect(block?.networks[14]?.body).toEqual({ kind: 'code', language: 'SCL', lines: ['#Ver := "GLOBAL_MAJOR";'] });
  });

  it('keeps a coil off the OR bar that shares its column', () => {
    const scene = sceneOf(block!.networks[8]!);
    expect(ofType(scene, 'coil')).toHaveLength(3);
    expect(labelCollisions(scene)).toEqual([]);
  });

  it('renders an SCL block call with its instance, parameters, comments and blank lines', () => {
    expect(block?.networks[5]?.body).toEqual({
      kind: 'code',
      language: 'SCL',
      lines: [
        '#Ins_Cfg(i_A  := "M_IBN_0", // TODO a',
        '    io_DB  := "DB_Work".Bath[#tBathIndex]);',
        '',
        '',
      ],
    });
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
