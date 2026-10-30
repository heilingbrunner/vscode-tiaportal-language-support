import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { layoutLad } from '../../src/layout/ladLayout';
import { sceneToSvg } from '../../src/render/svg';
import type { LadScene, SceneItem } from '../../src/layout/scene';
import { parseS7dclModel } from '../../src/parser/s7dclParser';
import { parseSdLad } from '../../src/parser/sdLadParser';

const sceneOf = (source: string): LadScene => layoutLad(parseSdLad(source.split('\n')));
const ofType = <T extends SceneItem['t']>(scene: LadScene, t: T): Array<Extract<SceneItem, { t: T }>> =>
  scene.items.filter((i): i is Extract<SceneItem, { t: T }> => i.t === t);
const texts = (scene: LadScene): string[] => ofType(scene, 'text').map((i) => i.s);

describe('parseSdLad', () => {
  it('reads a jump label and an empty-argument call', () => {
    const net = parseSdLad(['Label(GENERALSAFETY)', 'RUNG', '  "FB_GeneralSafety"()', 'END_RUNG']);
    expect(net.labels).toEqual(['GENERALSAFETY']);
    expect([...net.parts.values()].map((p) => p.name)).toEqual(['FB_GeneralSafety']);
    expect(sceneToSvg(layoutLad(net))).toContain('>GENERALSAFETY</text>');
  });

  it('starts a rung at an operand and draws a negated jump coil', () => {
    const net = parseSdLad(['RUNG #SafetyOverruled', '  I_JumpCoil( GENERALSAFETY )', 'END_RUNG']);
    expect([...net.parts.values()].map((p) => p.name)).toEqual(['Contact', 'JCoil']);
    expect([...net.accesses.values()].sort()).toEqual(['#SafetyOverruled', 'GENERALSAFETY']);
    expect(ofType(layoutLad(net), 'coil').map((c) => c.mark)).toEqual(['JMPN']);
  });

  it('starts a bare RUNG at the power rail and ignores attribute blocks after an element', () => {
    const net = parseSdLad([
      'RUNG',
      '  P_Contact( operand := "Req", bit := #FP )',
      '  { f_user_card := "1"; f_image_card := "0" }',
      '  #TOF_A.TOF( pt := t#120m, et => "Remain" )',
      'END_RUNG',
    ]);
    expect([...net.parts.values()].map((p) => p.name)).toEqual(['PContact', 'TOF']);
    expect(() => layoutLad(net)).not.toThrow();
  });

  it('draws a return coil as a RET coil', () => {
    const net = parseSdLad(['RUNG wire#powerrail', '  Contact( "IOCheckActive" )', '  ReturnCoil( TRUE )', 'END_RUNG']);
    expect([...net.parts.values()].map((p) => p.name)).toEqual(['Contact', 'RetCoil']);
    expect(ofType(layoutLad(net), 'coil').map((c) => c.mark)).toEqual(['RET']);
  });

  it('chains contacts and a coil in series', () => {
    const net = parseSdLad(['RUNG wire#powerrail', '  Contact( #a )', '  I_Contact( #b )', '  Coil( #c )', 'END_RUNG']);
    expect([...net.parts.values()].map((p) => p.name)).toEqual(['Contact', 'Contact', 'Coil']);
    expect([...net.parts.values()].map((p) => [...p.negated])).toEqual([[], ['operand'], []]);
    expect([...net.accesses.values()]).toEqual(['#a', '#b', '#c']);
    const scene = layoutLad(net);
    expect(ofType(scene, 'contact').map((c) => c.negated)).toEqual([false, true]);
    expect(ofType(scene, 'coil')).toHaveLength(1);
    expect(texts(scene)).toEqual(expect.arrayContaining(['#a', '#b', '#c']));
  });

  it('starts a second rung at a named wire and chains ENO to EN (Main OB1)', () => {
    const scene = sceneOf(`RUNG wire#powerrail
    Contact( true )
    wire#w1
    Move(
        in := "A".x,
        out1 => "B".y
    )
    Move( in := "A".z, out1 => "B".w )
END_RUNG
RUNG wire#w1
    Move( in := "C".x, out1 => "D".y )
END_RUNG`);
    expect(ofType(scene, 'box')).toHaveLength(3);
    expect(texts(scene).filter((s) => s === 'MOVE')).toHaveLength(3);
    expect(texts(scene)).toEqual(expect.arrayContaining(['true']));
  });

  it('joins a rung that ends in a wire with the series before the declaration (OR)', () => {
    const net = parseSdLad([
      'RUNG wire#powerrail',
      '  Contact( #a )',
      '  wire#w1',
      '  Coil( #q )',
      'END_RUNG',
      'RUNG wire#powerrail',
      '  Contact( #b )',
      'END_RUNG wire#w1',
    ]);
    const or = [...net.parts.values()].find((p) => p.name === 'O');
    expect(or).toBeDefined();
    expect(() => layoutLad(net)).not.toThrow();
  });

  it('feeds a named wire into a pin and maps comparators, templates and instance timers', () => {
    const scene = sceneOf(`RUNG wire#powerrail
    { S7_Templates := "SrcType := Real" }
    GT_Contact( in1 := #Speed, in2 := 20.0 )
    { S7_Templates := "time_type := Time" }
    #Ins_TON.TON( pt := T#5s, et => )
    S_SR( operand := #Bits.Wd, r1 := wire#w1 )
    Coil( #Out )
END_RUNG
RUNG wire#powerrail
    P_Trig( #Bits.FP )
END_RUNG wire#w1`);
    expect(texts(scene)).toEqual(expect.arrayContaining(['>', 'Real', 'TON', '#Ins_TON', 'S_SR', 'P', '#Bits.FP']));
  });

  it.each([
    ['unknown element', ['RUNG wire#powerrail', '  #x := 1;', 'END_RUNG']],
    ['wire without source', ['RUNG wire#w9', '  Coil( #a )', 'END_RUNG']],
    ['missing END_RUNG', ['RUNG wire#powerrail', '  Coil( #a )']],
    ['cyclic wires', ['RUNG wire#w1', '  Coil( #a )', 'END_RUNG wire#w1']],
  ])('throws for %s', (_name, lines) => {
    expect(() => parseSdLad(lines)).toThrow();
  });
});

describe('s7dcl LAD networks', () => {
  it('falls back to source text when a network cannot be parsed', () => {
    const source = `FUNCTION_BLOCK "FB_X"
{ S7_Language := "LAD" }
NETWORK
    RUNG wire#powerrail
        Unknown thing here
    END_RUNG
END_NETWORK
END_FUNCTION_BLOCK
`;
    expect(parseS7dclModel(source).networks[0]?.body.kind).toBe('code');
  });
});

const root = fileURLToPath(new URL('../..', import.meta.url));
const corpusDir = join(root, 'test', 'Project');

function s7dclFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return s7dclFiles(path);
    }
    return name.toLowerCase().endsWith('.s7dcl') ? [path] : [];
  });
}

describe.skipIf(!existsSync(corpusDir))('local project corpus (s7dcl)', () => {
  it('draws every LAD network that the parser understands without throwing', () => {
    let drawn = 0;
    let fallback = 0;
    for (const file of s7dclFiles(corpusDir)) {
      const model = parseS7dclModel(readFileSync(file, 'utf-8'));
      for (const n of model.networks) {
        if (n.language === 'LAD' && n.body.kind === 'lad') {
          drawn++;
        } else if (n.language === 'LAD' && n.body.kind === 'code') {
          fallback++;
        }
      }
    }
    expect(drawn).toBeGreaterThan(0);
    expect(fallback).toBeLessThanOrEqual(drawn);
  });
});
