import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { layoutLad } from '../../src/layout/ladLayout';
import { CHAR_W } from '../../src/layout/nodes';
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
    expect(texts(scene)).toEqual(expect.arrayContaining(['>', 'Real', 'TON', '#Ins_TON', 'S_SR', 'P_TRIG', '#Bits.FP']));
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

/** Operand labels of contacts and coils that a wire runs through. */
const labelCollisions = (scene: LadScene): string[] => {
  const labels = ofType(scene, 'text').filter((i) => i.cls === 'operand' && i.anchor === 'middle');
  const wires = ofType(scene, 'line').filter((l) => l.cls === 'wire');
  return labels.flatMap((t) => {
    const half = (t.s.length * CHAR_W) / 2;
    const [x0, x1, y0, y1] = [t.x - half, t.x + half, t.y - 9, t.y + 2];
    const hit = wires.some((w) =>
      w.pts.slice(1).some(([bx, by], i) => {
        const [ax, ay] = w.pts[i] as [number, number];
        return Math.max(ax, bx) > x0 && Math.min(ax, bx) < x1 && Math.max(ay, by) > y0 && Math.min(ay, by) < y1;
      }),
    );
    return hit ? [t.s] : [];
  });
};

/** Stepped wires that are the only wire leaving their source point: nothing forces them to bend. */
const avoidableSteps = (scene: LadScene): string[] => {
  const routed = ofType(scene, 'line').filter((l) => l.net !== undefined && l.cls === 'wire');
  const alone = new Map<string, number>();
  for (const w of routed) {
    const key = `${w.net}@${w.pts[0]}`;
    alone.set(key, (alone.get(key) ?? 0) + 1);
  }
  return routed.filter((w) => w.pts.length > 2 && alone.get(`${w.net}@${w.pts[0]}`) === 1).map((w) => JSON.stringify(w.pts));
};

/** Fan-outs in which every branch steps: one of them could have kept the straight row. */
const fanOutsWithoutStraightBranch = (scene: LadScene): string[] => {
  const groups = new Map<string, Array<{ pts: number }>>();
  for (const w of ofType(scene, 'line').filter((l) => l.net !== undefined && l.cls === 'wire')) {
    const key = `${w.net}@${w.pts[0]}`;
    groups.set(key, [...(groups.get(key) ?? []), { pts: w.pts.length }]);
  }
  return [...groups].filter(([, g]) => g.length > 1 && g.every((w) => w.pts > 2)).map(([key]) => key);
};

/** Wires that bend although nothing forces them to: lone steps and fan-outs in which no branch is straight. */
const needlessBends = (scene: LadScene): string[] => [...avoidableSteps(scene), ...fanOutsWithoutStraightBranch(scene)];

describe('P_TRIG and N_TRIG boxes', () => {
  const trig = (name: string): LadScene =>
    sceneOf(`RUNG wire#powerrail
  Contact( #Start )
  ${name}( #FLM.Cathodes1On )
  Coil( #Out )
END_RUNG`);

  it.each([
    ['P_Trig', 'P_TRIG'],
    ['N_Trig', 'N_TRIG'],
  ])('draws %s like TIA Portal: title %s with CLK and Q pins', (source, title) => {
    const scene = trig(source);
    const pins = ofType(scene, 'text').filter((t) => t.cls === 'pin');
    expect(pins.map((p) => p.s)).toEqual(['CLK', 'Q']);
    expect(ofType(scene, 'text').some((t) => t.cls === 'title' && t.s === title)).toBe(true);
  });

  it('shows the memory bit below the box, not above it', () => {
    const scene = trig('P_Trig');
    const box = ofType(scene, 'box')[0]!;
    const bit = ofType(scene, 'text').find((t) => t.s === '#FLM.Cathodes1On')!;
    expect(bit.y).toBeGreaterThan(box.y + box.h);
  });

  it('keeps the memory bit clear of every wire', () => {
    const scene = trig('P_Trig');
    const bit = ofType(scene, 'text').find((t) => t.s === '#FLM.Cathodes1On')!;
    const half = (bit.s.length * CHAR_W) / 2;
    const struck = ofType(scene, 'line')
      .filter((l) => l.cls === 'wire')
      .some((l) =>
        l.pts.slice(1).some(([bx, by], i) => {
          const [ax, ay] = l.pts[i] as [number, number];
          return (
            Math.max(ax, bx) > bit.x - half &&
            Math.min(ax, bx) < bit.x + half &&
            Math.max(ay, by) > bit.y - 9 &&
            Math.min(ay, by) < bit.y + 2
          );
        }),
      );
    expect(struck).toBe(false);
  });
});

describe('LAD needless bends', () => {
  it('does not push a contact down for the bar of an OR in its column when only a few pixels are missing', () => {
    const scene = sceneOf(`RUNG wire#powerrail
  Contact( #i_LocalCondition.AutoMode )
  I_Contact( #tBathReady )
  wire#w1
  Contact( "DB_IF_Station".Station[#tStationLeft].MCG.ToStation.InSequence )
  wire#w2
  I_Contact( "DB_Work_Dryer".Bath[#i_No].Process.IF_Handling["STATION_LEFT"].STAT.CarrierPresent )
  wire#w3
  I_Contact( "DB_Work_Dryer".Bath[#i_No].StationCondition.Status.Deactivated )
  wire#w5
  Coil( "DB_Work_Dryer".Bath[#i_No].Alarm.Process.Errors.BathNotReadyForLoading )
END_RUNG
RUNG wire#w2
  Contact( "DB_Work_Dryer".Bath[#i_No].Process.IF_Handling["STATION_LEFT"].STAT.CarrierPresent )
  I_Contact( "DB_Work_Dryer".Bath[#i_No]."IF".IN.ReleaseMachine )
END_RUNG wire#w3
RUNG wire#w1
  Contact( "DB_IF_Station".Station[#tStationRight].MCG.ToStation.InSequence )
  wire#w4
  I_Contact( "DB_Work_Dryer".Bath[#i_No].Process.IF_Handling["STATION_RIGHT"].STAT.CarrierPresent )
END_RUNG wire#w3
RUNG wire#w4
  Contact( "DB_Work_Dryer".Bath[#i_No].Process.IF_Handling["STATION_RIGHT"].STAT.CarrierPresent )
  I_Contact( "DB_Work_Dryer".Bath[#i_No]."IF".IN.ReleaseMachine )
END_RUNG wire#w3
RUNG wire#w3
  Contact( "DB_IF_Station".Station[#tStationLeft].MCG.ToStation.NotRedundant )
END_RUNG wire#w5
RUNG wire#w3
  Contact( "DB_IF_Station".Station[#tStationRight].MCG.ToStation.NotRedundant )
END_RUNG wire#w5
RUNG wire#w3
  Contact( "DB_Work_Dryer".Bath[#i_No].StationCondition.Status.Deactivated )
  I_Contact( "DB_IF_Station".Station[#tStationLeft].MCG.ToStation.NotRedundant )
  I_Contact( "DB_IF_Station".Station[#tStationRight].MCG.ToStation.NotRedundant )
  Coil( "DB_Work_Dryer".Bath[#i_No].Alarm.Process.Messages.BathNotReadyForLoading )
END_RUNG`);
    expect(needlessBends(scene)).toEqual([]);
  });

  it('moves the chain that feeds a lower box input down to it (a timer feeding R1)', () => {
    const scene = sceneOf(`RUNG wire#powerrail
  Contact( "CMN_HMI_Btn".Mode.TestLightTower.STATE."ON" )
  S_SR( operand := #mb_TestLightTowerOn, r1 := wire#w1 )
  Coil( #mb_cmd_TestLightOn )
END_RUNG
RUNG wire#powerrail
  Contact( #mb_cmd_TestLightOn )
  { S7_Templates := "time_type := Time" }
  #Ins_TON_TestLightTower.TON( pt := t#5s, et => )
END_RUNG wire#w1
RUNG wire#powerrail
  I_Contact( "CMN_HMI_Btn".Mode.TestLightTower.STATE."ON" )
END_RUNG wire#w1`);
    expect(needlessBends(scene)).toEqual([]);
  });

  it('widens the gap above a box input that is fed from below by a comparator', () => {
    const scene = sceneOf(`RUNG wire#powerrail
  #Ins_BP1_1(
    Ib_GaugeOff := wire#w1,
    Ib_GaugeWithDiffChannel := true,
    Ib_Manual := "EC2_HMI_Act".Mode.Manual,
    Ib_AnalogValueState_1 := wire#w3,
    Ib_AnalogValueState_2 := wire#w5,
    Ii_AnalogInput_Absolut := "EC2-BP1_1_Abs",
    Ii_AnalogInput_Diff := "EC2-BP1_1_Diff",
    Ii_FullScaleDigits := 27648,
    Qst_Data => "EC2_HMI_Act".Vacuum.BP1_1
  )
END_RUNG
RUNG wire#powerrail
  Contact( "EC1_HMI_Act".Vacuum.Gen.VentActive )
END_RUNG wire#w1
RUNG wire#powerrail
  Contact( "EC1_HMI_Act".Vacuum.Gen.Vented )
END_RUNG wire#w1
RUNG wire#powerrail
  Contact( "EC2-BP1_1_Abs_Vs" )
  wire#w2
  { S7_Templates := "SrcType := Int" }
  LT_Contact( in1 := "EC2-BP1_1_Abs", in2 := 32767 )
  { S7_Templates := "SrcType := Int" }
  GT_Contact( in1 := "EC2-BP1_1_Abs", in2 := -32768 )
END_RUNG wire#w3
RUNG wire#powerrail
  Contact( true )
END_RUNG wire#w2
RUNG wire#powerrail
  Contact( "EC2-BP1_1_Diff_Vs" )
  wire#w4
  { S7_Templates := "SrcType := Int" }
  LT_Contact( in1 := "EC2-BP1_1_Diff", in2 := 32767 )
  { S7_Templates := "SrcType := Int" }
  GT_Contact( in1 := "EC2-BP1_1_Diff", in2 := -32768 )
END_RUNG wire#w5
RUNG wire#powerrail
  Contact( true )
END_RUNG wire#w4`);
    expect(needlessBends(scene)).toEqual([]);
  });

  it('lets the topmost of two boxes fed by one OR bar pull the chain behind the bar down to it', () => {
    const pump = (name: string): string => `RUNG wire#powerrail
  Contact( #i_LocalCondition.AutoORManualMode )
  Contact( "DB_Work_ProcessBath".Bath[#i_No].Process.${name}.OUT.CMD_Pump )
  Move(
    in := "DB_Work_ProcessBath".Bath[#i_No].Process.${name}.OUT.SetPumpPower,
    out1 => "DB_Work_ProcessBath".Bath[#i_No].Output.GP301."PARA".SetSpeedAuto
  )
END_RUNG`;
    const scene = sceneOf(`RUNG wire#powerrail
  Contact( #i_LocalCondition.AutoORManualMode )
  wire#w1
  Contact( "DB_Work_ProcessBath".Bath[#i_No].Process.Fill.OUT.CMD_Mixing )
  wire#w2
  Contact( #HelpFlags.RelCirculationWhileFill )
  wire#w3
  Coil( "DB_Work_ProcessBath".Bath[#i_No].Output.GP301.IN.PumpON )
END_RUNG
RUNG wire#w1
  Contact( "DB_Work_ProcessBath".Bath[#i_No].Process.Dosing.OUT.Mixing )
END_RUNG wire#w2
RUNG wire#w1
  Contact( "DB_Work_ProcessBath".Bath[#i_No].Process.Clean.OUT.CMD_Mixing )
END_RUNG wire#w3
RUNG wire#w1
  Contact( "DB_Work_ProcessBath".Bath[#i_No].Process.Bleed.OUT.CMD_Pump )
END_RUNG wire#w3
RUNG wire#w1
  Contact( "DB_Work_ProcessBath".Bath[#i_No].Process.Drain.OUT.CMD_Pump )
  Contact( #HelpFlags.RelCirculationWhileFill )
END_RUNG wire#w3
RUNG wire#w1
  Contact( "DB_Work_ProcessBath".Bath[#i_No].Process."Sequence".OUT.CMD_Circulation )
END_RUNG wire#w3
RUNG wire#powerrail
  Contact( "DB_Work_ProcessBath".Bath[#i_No].Output.GP301.IN.PumpON )
  wire#w4
  Contact( "DB_Work_ProcessBath".Bath[#i_No].Process.Drain.OUT.CMD_PumpPulse )
  wire#w5
  Coil( "DB_Work_ProcessBath".Bath[#i_No].Output.GP301.IN.IntervalON )
END_RUNG
RUNG wire#w4
  Contact( "DB_Work_ProcessBath".Bath[#i_No].Process.Bleed.OUT.CMD_PumpPulse )
END_RUNG wire#w5
RUNG wire#powerrail
  I_Contact( "DB_Work_ProcessBath".Bath[#i_No].Output.GP301.IN.PumpON )
  Contact( #tForcePump )
  Coil( "DB_Work_ProcessBath".Bath[#i_No].Output.GP301.IN.ForceEnable )
  Coil( "DB_Work_ProcessBath".Bath[#i_No].Output.GP301.IN.ForceStart )
END_RUNG
RUNG wire#powerrail
  Contact( #i_LocalCondition.AutoORManualMode )
  wire#w6
  Contact( "DB_Work_ProcessBath".Bath[#i_No].Process.Fill.OUT.CMD_Mixing )
  wire#w7
  Move(
    in := "DB_Work_ProcessBath".Bath[#i_No].Process.Fill.OUT.SetPumpPower,
    out1 => "DB_Work_ProcessBath".Bath[#i_No].Output.GP301."PARA".SetSpeedAuto
  )
END_RUNG
RUNG wire#w6
  Contact( "DB_Work_ProcessBath".Bath[#i_No].Process.Dosing.OUT.Mixing )
END_RUNG wire#w7
${pump('Drain')}
${pump('Bleed')}
RUNG wire#powerrail
  Contact( "DB_RECIPE_ProcessBath".Current.Bath[#i_No].Common.ActivateFlowControl )
  R_Coil( "DB_RECIPE_ProcessBath".Current.Bath[#i_No].Common.ActivatePressureControl )
END_RUNG
RUNG wire#powerrail
  Contact( "DB_RECIPE_ProcessBath".Current.Bath[#i_No].Common.ActivatePressureControl )
  R_Coil( "DB_RECIPE_ProcessBath".Current.Bath[#i_No].Common.ActivateFlowControl )
END_RUNG
RUNG wire#powerrail
  Contact( #i_LocalCondition.AutoORManualMode )
  Contact( "DB_Work_ProcessBath".Bath[#i_No].Process."Sequence".OUT.CMD_Circulation )
  wire#w8
  Contact( "DB_CFG_ProcessBath".Bath[#i_No].Options.CirculationFlowControl )
  Contact( "DB_RECIPE_ProcessBath".Current.Bath[#i_No].Common.ActivateFlowControl )
  wire#w9
  Coil( "DB_Work_ProcessBath".Bath[#i_No].Output.GP301Ctrl."PARA".ActivateFlow )
END_RUNG
RUNG wire#w9
  Move(
    in := "DB_Work_ProcessBath".Bath[#i_No].Output.GP301."PARA".SetSpeedAuto,
    out1 => "DB_Work_ProcessBath".Bath[#i_No].Output.GP301Ctrl."PARA".SetInternFlow
  )
END_RUNG
RUNG wire#w9
  Move(
    in := "DB_Work_ProcessBath".Bath[#i_No].Output.GP301Ctrl.OUT.SetPumpCtrl,
    out1 => "DB_Work_ProcessBath".Bath[#i_No].Output.GP301."PARA".SetSpeedCtrl
  )
END_RUNG
RUNG wire#w8
  Contact( "DB_CFG_ProcessBath".Bath[#i_No].Options.CirculationPressureControl )
  Contact( "DB_RECIPE_ProcessBath".Current.Bath[#i_No].Common.ActivatePressureControl )
  wire#w10
  Coil( "DB_Work_ProcessBath".Bath[#i_No].Output.GP301Ctrl."PARA".ActivatePressure )
END_RUNG
RUNG wire#w10
  Move(
    in := "DB_Work_ProcessBath".Bath[#i_No].Output.GP301."PARA".SetSpeedAuto,
    out1 => "DB_Work_ProcessBath".Bath[#i_No].Output.GP301Ctrl."PARA".SetInternPressure
  )
END_RUNG
RUNG wire#w10
  Move(
    in := "DB_Work_ProcessBath".Bath[#i_No].Output.GP301Ctrl.OUT.SetPumpCtrl,
    out1 => "DB_Work_ProcessBath".Bath[#i_No].Output.GP301."PARA".SetSpeedCtrl
  )
END_RUNG
RUNG wire#powerrail
  Contact( #i_LocalCondition.AutoORManualMode )
  wire#w11
  Contact( "DB_Work_ProcessBath".Bath[#i_No].Output.GP301Ctrl."PARA".ActivateFlow )
  wire#w12
  Coil( "DB_Work_ProcessBath".Bath[#i_No].Output.GP301.IN.ActiveCtrl )
END_RUNG
RUNG wire#w11
  Contact( "DB_Work_ProcessBath".Bath[#i_No].Output.GP301Ctrl."PARA".ActivatePressure )
END_RUNG wire#w12
RUNG wire#w12
  Coil( "DB_Work_ProcessBath".Bath[#i_No].Output.GP301Ctrl.IN.CtrlIntern )
END_RUNG`);
    expect(needlessBends(scene)).toEqual([]);
  });
});

describe('LAD label clearance', () => {
  it('keeps one branch of a fan-out between two OR bars on the row of the first bar', () => {
    const scene = sceneOf(`RUNG wire#powerrail
  Contact( true )
  wire#w1
  Contact( "STD_To_Safety".Cmd."PM1_1-1Q15_2x_PwrOn" )
  wire#w2
  Coil( #tb_G15_12conditionPSstateEnabled )
END_RUNG
RUNG wire#w1
  Contact( "PM1_HMI_Cfg".Comp_1.Gen.ProcessActiv )
  Contact( "PM1_HMI_Cfg".Comp_1.Cathode.TB15_12.Select.Installed )
  wire#w3
  Contact( "PM1_HMI_Act".Mode.Manual )
  wire#w4
  Contact( "PM1_Workdata".Comp_1.Water.Common.State.AllWaterValvesEnabled )
  Contact( "PM1_HMI_Act".Comp_1.Cathode.MA11_12.AxisReleased )
  I_Contact( "PM1_Workdata".Comp_1.Water.BlowOutFct.State.Active )
  Contact( "F_OutputData".Rel."PM1_1-1Q15_2x_PwrOn" )
END_RUNG wire#w2
RUNG wire#w3
  Contact( "PM1_HMI_Act".Mode.Transport )
END_RUNG wire#w4
RUNG wire#w1
  Contact( "STD_To_Safety".Cmd."PM1_1-1Q15_2x_PwrOn" )
  Contact( "FQ_PM1_1-1QA15_2x_PwrOn" )
  I_Contact( "PM1_1-1QA15_21_FB_OK" )
  I_Contact( "PM1_1-1QA15_22_FB_OK" )
  Contact( "PM1_Workdata".Comp_1.Sputtern.State."PowerSupply IsOn_TB15_12" )
  Coil( "PM1_HMI_Btn".Comp_1.Cathode.TB15_12.PowerSupplyOn.STATE.MONITOR )
END_RUNG
RUNG wire#w1
  Contact( "STD_To_Safety".Cmd."PM1_1-1Q15_2x_PwrOn" )
  wire#w5
  I_Contact( "PM1_Workdata".Comp_1.Sputtern.State."PowerSupply IsOn_TB15_12" )
  wire#w6
  Coil( "PM1_HMI_Btn".Comp_1.Cathode.TB15_12.PowerSupplyOn.STATE.EXECUTING )
END_RUNG
RUNG wire#w1
  Contact( #mb_PSoff_G15_12intern )
END_RUNG wire#w5
RUNG wire#w5
  I_Contact( "CMN_PB_Devicestate".SlavePresent[47] )
END_RUNG wire#w6
RUNG wire#w1
  Contact( "PM1_PLC_Err".Comp_1.Cathode.TB15_12.K2.WatchdogFail )
  wire#w7
  Coil( "PM1_HMI_Btn".Comp_1.Cathode.TB15_12.PowerSupplyOn.STATE.ERROR )
END_RUNG
RUNG wire#w1
  Contact( "PM1_PLC_Err".Comp_1.Cathode.TB15_12.K2.ProfibusNoFeedback )
END_RUNG wire#w7
RUNG wire#w1
  I_Contact( "STD_To_Safety".Cmd."PM1_1-1Q15_2x_PwrOn" )
  R_Coil( "PM1_HMI_Btn".Comp_1.Cathode.TB15_12.PowerSupplyOn.STATE."ON" )
END_RUNG`);
    expect(fanOutsWithoutStraightBranch(scene)).toEqual([]);
  });

  it('lines a box up with the contact feeding it when a neighbouring box in its column pushes it down', () => {
    const scene = sceneOf(`RUNG wire#powerrail
  #Ins_Valve( Ib_Manual := "A".Mode.Manual, Qb_CoilOn => "A".Out.CoilOn )
  wire#w4
  Contact( "A".Out.CoilOn )
  P_Trig( #mst_FLM.Q2_1_StateOn )
  Coil( #mst_Imp.Q2_1_StateOn )
END_RUNG
RUNG wire#w4
  Contact( "A".Out.CoilOn )
  N_Trig( #mst_FLM.Q2_1_StateOff )
  Coil( #mst_Imp.Q2_1_StateOff )
END_RUNG
RUNG wire#w4
  I_Contact( "A".Out.CoilOn )
  Coil( "A".Out.CoilOff )
END_RUNG`);
    expect(avoidableSteps(scene)).toEqual([]);
  });

  it('does not send a chain below all its siblings when a crossing wire makes it step down', () => {
    const scene = sceneOf(`RUNG wire#powerrail
  Contact( true )
  wire#w1
  Contact( "CMN_Workdata".VacuumGraph.Output.LL1.InEvacedState )
  wire#w2
  Coil( "LL1_HMI_Act".Vacuum.Gen.Evaced )
END_RUNG
RUNG wire#w1
  { S7_Templates := "SrcType := Real" }
  LE_Contact(
    in1 := "LL1_HMI_Act".Vacuum.BP01_100.PressureValue,
    in2 := "LL1_HMI_Cfg".Vacuum.VentEvac.Evaced
  )
  I_Contact( "CMN_Workdata".VacuumGraph.Output.LL1.EvacActive )
  I_Contact( "CMN_Workdata".VacuumGraph.Output.LL1.VentActive )
END_RUNG wire#w2
RUNG wire#w1
  Contact( "CMN_Workdata".VacuumGraph.Output.LL1.InVentedState )
  wire#w3
  Coil( "LL1_HMI_Act".Vacuum.Gen.Vented )
END_RUNG
RUNG wire#w1
  Contact( "F_StateData".SafetyFunctions.SF04a_LL1_PressureLowerThanAtmosphere )
  I_Contact( "CMN_Workdata".VacuumGraph.Output.LL1.EvacActive )
  I_Contact( "CMN_Workdata".VacuumGraph.Output.LL1.VentActive )
END_RUNG wire#w3
RUNG wire#w1
  Contact( "CMN_Workdata".VacuumGraph.Output.LL1.EvacActive )
  Coil( "LL1_HMI_Act".Vacuum.Gen.EvacActive )
END_RUNG
RUNG wire#w1
  Contact( "CMN_Workdata".VacuumGraph.Output.LL1.VentActive )
  Coil( "LL1_HMI_Act".Vacuum.Gen.VentActive )
END_RUNG
RUNG wire#w1
  Contact( "LL1_HMI_Act".Gates.QM06_500.ValveClosed )
  Contact( "LL1_HMI_Act".Gates.QM06_200.ValveClosed )
  Contact( "CMN_Workdata".VacuumGraph.Output.Gen.InIsolateState )
  Coil( "LL1_HMI_Act".Vacuum.Gen.Isolated )
END_RUNG`);
    expect(avoidableSteps(scene)).toEqual([]);
    // seven short rows, not a diagram stretched over several times its height
    expect(scene.height).toBeLessThan(1000);
  });

  const edgeBoxFeedsCall = `RUNG wire#powerrail
  Contact( "DB_WORK_General".STAT.MachineEmpty )
  Contact( "DB_WORK_Load".Station."IF".Out.StationEmpty )
  wire#w0
  P_Trig( "FP_MCG_Init" )
END_RUNG wire#w1
RUNG wire#powerrail
  Contact( "M_Rui_00" )
END_RUNG wire#w0
RUNG wire#powerrail
  "FC_MCG_Initialisation"( i_Start := wire#w1 )
END_RUNG`;

  it('keeps the rail wire into EN clear of the labels of a chain that feeds a lower pin through an edge box', () => {
    expect(labelCollisions(sceneOf(edgeBoxFeedsCall))).toEqual([]);
  });

  it('draws the chain, the edge box and the call pin on one row, without a step in the wire', () => {
    const scene = sceneOf(edgeBoxFeedsCall);
    const pinText = (label: string): number => ofType(scene, 'text').find((t) => t.cls === 'pin' && t.s === label)?.y ?? NaN;
    expect(pinText('Q')).toBe(pinText('i_Start'));
  });

  it('moves a box input down far enough that the OR group feeding it reaches it with a straight wire', () => {
    const scene = sceneOf(`RUNG wire#powerrail
  Contact( "CMN_Workdata".Process.PowerSupply.Cmd.On_PS2 )
  Contact( "F_OutputData".Rel."PM1_1-1Q15_2x_PwrOn" )
  wire#w1
  S_SR( operand := "STD_To_Safety".Cmd."PM1_1-1Q15_2x_PwrOn", r1 := wire#w3 )
END_RUNG
RUNG wire#powerrail
  Contact( "PM1_HMI_Act".Mode.Manual )
  wire#w2
  Contact( "PM1_Workdata".Comp_1.Water.Common.State.AllWaterValvesEnabled )
  Contact( "PM1_HMI_Act".Comp_1.Cathode.MA11_12.AxisReleased )
END_RUNG wire#w1
RUNG wire#powerrail
  Contact( "PM1_HMI_Act".Mode.Transport )
END_RUNG wire#w2
RUNG wire#powerrail
  Contact( "CMN_Workdata".Process.PowerSupply.Cmd.Off )
END_RUNG wire#w3
RUNG wire#powerrail
  Contact( "CMN_HMI_Btn".Sputtering.AllPowerSuppliesOff.STATE.PLC_PULS )
END_RUNG wire#w3`);
    const box = ofType(scene, 'box')[0]!;
    const r1Y = (ofType(scene, 'text').find((t) => t.cls === 'pin' && t.s === 'R1')?.y ?? NaN) - 4;
    const intoR1 = ofType(scene, 'line').filter((l) => l.net !== undefined && l.pts.at(-1)?.[0] === box.x && l.pts.at(-1)?.[1] === r1Y);
    expect(intoR1).toHaveLength(1);
    expect(intoR1[0]?.pts).toHaveLength(2);
  });

  it('leaves room above a row for the tallest label further along it, so the row stays straight', () => {
    const scene = sceneOf(`RUNG wire#powerrail
  Contact( true )
  wire#w1
  Contact( "STD".Cmd.PwrOn.Alpha.Beta )
  Contact( #a )
  Contact( #b )
  Contact( #c )
  Contact( #d )
  Coil( #top )
END_RUNG
RUNG wire#w1
  Contact( "STD".Cmd."PM1_1-1Q15_2x_PwrOn" )
  wire#w5
  I_Contact( "PM1_Workdata".Comp_1.Sputtern.State."PowerSupply IsOn_TB15_12" )
  wire#w6
  Coil( "PM1_HMI_Btn".Comp_1.Cathode.TB15_12.PowerSupplyOn.STATE.EXECUTING )
END_RUNG
RUNG wire#w1
  Contact( #mb_PSoff_G15_12intern )
END_RUNG wire#w5
RUNG wire#w5
  I_Contact( "CMN_PB_Devicestate".SlavePresent[47] )
END_RUNG wire#w6`);
    // the first contact of the second row and its coil (behind two OR bars) lie on one level
    const rowStart = ofType(scene, 'contact')[6];
    const rowEnd = ofType(scene, 'coil')[1];
    expect(rowEnd?.y).toBe(rowStart?.y);
    expect(labelCollisions(scene)).toEqual([]);
  });

  it('keeps a chain behind an OR bar on the row of the bar, even when a wire above crosses its label', () => {
    const scene = sceneOf(`RUNG wire#powerrail
  Contact( "Top".Long.Operand.Name.Alpha )
  Contact( "Top".Long.Operand.Name.Beta )
  wire#w3
  Coil( "Out".Q )
END_RUNG
RUNG wire#powerrail
  Contact( "Manual".Mode.Manual )
  wire#w2
  Contact( "Workdata".Comp.Water.Common.State.AllWaterValvesEnabled )
  Contact( "HMI".Comp.Cathode.Axis.Released.Long.Name )
END_RUNG wire#w3
RUNG wire#powerrail
  Contact( "Transport".Mode.Transport )
END_RUNG wire#w2`);
    expect(ofType(scene, 'line').filter((l) => l.net !== undefined && l.pts.length > 2)).toEqual([]);
    expect(labelCollisions(scene)).toEqual([]);
  });

  it('stacks the parallel branches of a series of OR groups on shared rows instead of stepping them down', () => {
    const group = (n: number, from: number): string => `RUNG wire#w${from}
  I_Contact( "Cfg".Pump${n}.Installed )
END_RUNG wire#w${from + 1}
RUNG wire#w${from}
  Contact( "Cfg".Pump${n}.Deactivated )
END_RUNG wire#w${from + 1}`;
    const scene = sceneOf(`RUNG wire#powerrail
  Contact( "A".Start )
  Contact( "A".Valve )
  wire#w2
  I_Contact( "Act".Pump1.IsTurning )
  wire#w3
  I_Contact( "Act".Pump2.IsTurning )
  wire#w4
  I_Contact( "Act".Pump3.IsTurning )
  wire#w5
  Coil( "A".Out )
END_RUNG
${group(1, 2)}
${group(2, 3)}
${group(3, 4)}`);
    expect(ofType(scene, 'contact')).toHaveLength(11);
    // the chain row plus one shared row per extra branch
    expect(new Set(ofType(scene, 'contact').map((c) => c.y)).size).toBe(3);
    expect(labelCollisions(scene)).toEqual([]);
  });

  it('lines up each chain with its own call pin instead of stacking them below a box fed from EN', () => {
    const scene = sceneOf(`RUNG wire#powerrail
  Contact( "GLOBAL_POS_Dimensions".Transport.EC1.EnablePresentTrigger )
  #Ins_CarrierTrigger( Ib_LS_Previous := wire#w1, Ib_LS := wire#w2, Ib_LS_Next := wire#w3 )
END_RUNG
RUNG wire#powerrail
  Contact( "EC1_HMI_Act".Servo.BG11_111.State )
  Contact( "EC1_HMI_Act".Servo.BG11_211.State )
END_RUNG wire#w1
RUNG wire#powerrail
  Contact( "EC1_HMI_Act".Servo.BG11_121.State )
  Contact( "EC1_HMI_Act".Servo.BG11_221.State )
END_RUNG wire#w2
RUNG wire#powerrail
  Contact( "EC1_HMI_Act".Servo.BG11_131.State )
  Contact( "EC1_HMI_Act".Servo.BG11_231.State )
END_RUNG wire#w3`);
    const pinY = (label: string): number => (ofType(scene, 'text').find((t) => t.cls === 'pin' && t.s === label)?.y ?? NaN) - 4;
    const chainYs = ofType(scene, 'contact')
      .map((c) => c.y)
      .slice(1);
    expect(ofType(scene, 'line').filter((l) => l.net !== undefined && l.pts.length > 2)).toEqual([]);
    expect([chainYs[0], chainYs[2], chainYs[4]]).toEqual([pinY('Ib_LS_Previous'), pinY('Ib_LS'), pinY('Ib_LS_Next')]);
    expect(labelCollisions(scene)).toEqual([]);
  });

  it('puts the first branch of each OR group on its call pin and stacks the other branches below it', () => {
    const scene = sceneOf(`RUNG wire#powerrail
  "FB_Call"( Ib_A := wire#w1, Ib_B := wire#w2 )
END_RUNG
RUNG wire#powerrail
  Contact( "DB_One".Station.Interface.Out.FirstBranchOfTheFirstGroup )
END_RUNG wire#w1
RUNG wire#powerrail
  Contact( "DB_One".Station.Interface.Out.SecondBranchOfTheFirstGroup )
END_RUNG wire#w1
RUNG wire#powerrail
  Contact( "DB_One".Station.Interface.Out.ThirdBranchOfTheFirstGroup )
END_RUNG wire#w1
RUNG wire#powerrail
  Contact( "DB_Two".Station.Interface.Out.FirstBranchOfTheSecondGroup )
END_RUNG wire#w2
RUNG wire#powerrail
  Contact( "DB_Two".Station.Interface.Out.SecondBranchOfTheSecondGroup )
END_RUNG wire#w2`);
    expect(labelCollisions(scene)).toEqual([]);
    expect(ofType(scene, 'line').filter((l) => l.net !== undefined && l.pts.length > 2)).toEqual([]);
    const firstBranch = ofType(scene, 'contact').map((c) => c.y);
    expect(firstBranch[0]).toBeLessThan(Math.min(...firstBranch.slice(1, 3)));
  });

  it('keeps the labels of a series chain clear of the wire into a comparator that feeds a call', () => {
    const scene = sceneOf(`RUNG wire#powerrail
  "FB_Call"( Ib_A := wire#w1 )
END_RUNG
RUNG wire#powerrail
  I_Contact( "DB_Safety".SafetyFunctions.SF04a_PressureLowerThanAtmosphere )
  { S7_Templates := "SrcType := Real" }
  LE_Contact( in1 := "DB_Act".Vacuum.BP01_100.PressureValue, in2 := 1000.0 )
END_RUNG wire#w1`);
    expect(labelCollisions(scene)).toEqual([]);
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
