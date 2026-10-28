import { describe, expect, it } from 'vitest';
import { formatAccess } from '../../src/parser/access';
import { parseXml } from '../../src/parser/xml';

const access = (xml: string): string => formatAccess(parseXml(xml));

describe('formatAccess: named constants', () => {
  it('shows a global constant in quotes, as TIA Portal does', () => {
    expect(access('<Access Scope="GlobalConstant" UId="25"><Constant Name="EnumMES_PumpSpeed_anal" /></Access>')).toBe(
      '"EnumMES_PumpSpeed_anal"',
    );
  });

  it('shows a local constant with a leading #', () => {
    expect(access('<Access Scope="LocalConstant" UId="26"><Constant Name="LIMIT" UId="27" /></Access>')).toBe('#LIMIT');
  });

  it('reads the name of a constant that is exported as a value text', () => {
    const global = '<Access Scope="GlobalConstant" UId="38"><Constant UId="39"><ConstantValue UId="40">STATION_LEFT</ConstantValue></Constant></Access>';
    const local = '<Access Scope="LocalConstant"><Constant><ConstantValue>LIMIT</ConstantValue></Constant></Access>';
    expect(access(global)).toBe('"STATION_LEFT"');
    expect(access(local)).toBe('#LIMIT');
  });

  it('yields no text for a constant without a name', () => {
    expect(access('<Access Scope="GlobalConstant"><Constant /></Access>')).toBe('');
    expect(access('<Access Scope="GlobalConstant" />')).toBe('');
  });

  it('keeps a named constant used as an array index', () => {
    const xml =
      '<Access Scope="GlobalVariable"><Symbol>' +
      '<Component Name="DB_Work" /><Component Name="IF_Handling" AccessModifier="Array">' +
      '<Access Scope="GlobalConstant"><Constant Name="STATION_RIGHT" /></Access>' +
      '</Component></Symbol></Access>';
    expect(access(xml)).toBe('"DB_Work".IF_Handling["STATION_RIGHT"]');
  });
});

describe('formatAccess: other constants are unchanged', () => {
  it('reads literal and typed constants from their value', () => {
    expect(access('<Access Scope="LiteralConstant"><Constant><ConstantValue>10</ConstantValue></Constant></Access>')).toBe('10');
    expect(
      access('<Access Scope="TypedConstant"><Constant><ConstantType>Time</ConstantType><ConstantValue>T#5s</ConstantValue></Constant></Access>'),
    ).toBe('T#5s');
  });

  it('still formats variables', () => {
    expect(access('<Access Scope="LocalVariable"><Symbol><Component Name="Run" /></Symbol></Access>')).toBe('#Run');
  });
});
