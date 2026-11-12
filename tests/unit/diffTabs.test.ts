import { describe, expect, it } from 'vitest';
import { pairByLabel, parseDiffLabel } from '../../src/provider/diffTabs';

const name = (file: string): string => file.slice(file.lastIndexOf('/') + 1);

describe('parseDiffLabel', () => {
  it('splits a diff tab label into the left and right file name', () => {
    expect(parseDiffLabel('A.s7dcl ↔ B.s7dcl')).toEqual({ left: 'A.s7dcl', right: 'B.s7dcl' });
  });

  it('ignores labels that are not a comparison', () => {
    expect(parseDiffLabel('DataTyp_SEL1400.s7dcl')).toBeUndefined();
  });
});

describe('pairByLabel', () => {
  it('assigns the sides by file name when the names differ', () => {
    const files = ['x/B.xml', 'x/A.xml'];
    expect(pairByLabel('A.xml ↔ B.xml', files, name)).toEqual({ original: 'x/A.xml', modified: 'x/B.xml' });
  });

  it('uses the opening order when both sides have the same name', () => {
    const files = ['old/T.s7dcl', 'new/T.s7dcl'];
    expect(pairByLabel('T.s7dcl ↔ T.s7dcl', files, name)).toEqual({ original: 'old/T.s7dcl', modified: 'new/T.s7dcl' });
  });

  it('takes the two most recently opened files of that name', () => {
    const files = ['a/T.s7dcl', 'b/T.s7dcl', 'c/T.s7dcl'];
    expect(pairByLabel('T.s7dcl ↔ T.s7dcl', files, name)).toEqual({ original: 'b/T.s7dcl', modified: 'c/T.s7dcl' });
  });

  it('matches file names case-insensitively', () => {
    expect(pairByLabel('a.xml ↔ b.xml', ['x/A.XML', 'x/B.XML'], name)).toEqual({ original: 'x/A.XML', modified: 'x/B.XML' });
  });

  it('finds no pair while only one side is open', () => {
    expect(pairByLabel('T.s7dcl ↔ T.s7dcl', ['old/T.s7dcl'], name)).toBeUndefined();
    expect(pairByLabel('A.xml ↔ B.xml', ['x/A.xml'], name)).toBeUndefined();
  });

  it('finds no pair for a label that is not a comparison', () => {
    expect(pairByLabel('T.s7dcl', ['a/T.s7dcl', 'b/T.s7dcl'], name)).toBeUndefined();
  });
});
