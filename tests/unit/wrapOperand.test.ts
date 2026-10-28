import { describe, expect, it } from 'vitest';
import { wrapOperand } from '../../src/layout/nodes';

describe('wrapOperand', () => {
  it('keeps a short operand on one line', () => {
    expect(wrapOperand('#Start')).toEqual(['#Start']);
  });

  it('returns no lines for empty text', () => {
    expect(wrapOperand('')).toEqual([]);
  });

  it('wraps a long operand into lines of at most 14 characters without losing text', () => {
    const text = '"DB_Work_ProcessBath".Bath[#i_No].Process.IF_Handling["STATION_RIGHT"].OUT.CMD_LidOpen';
    const lines = wrapOperand(text);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => line.length > 0 && line.length <= 14)).toBe(true);
    expect(lines.join('')).toBe(text);
  });

  it('prefers to break after a separator', () => {
    expect(wrapOperand('Buttons.Station.LidOpen')).toEqual(['Buttons.', 'Station.', 'LidOpen']);
  });

  it('hard-cuts text that has no separator', () => {
    expect(wrapOperand('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 10)).toEqual(['ABCDEFGHIJ', 'KLMNOPQRST', 'UVWXYZ']);
  });
});
