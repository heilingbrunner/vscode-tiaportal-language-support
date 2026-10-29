import { describe, expect, it } from 'vitest';
import { parseS7res } from '../../src/parser/s7res';

const res = (...entries: string[]): string => `﻿MultiLingualTexts:\n${entries.join('\n')}\n`;

describe('parseS7res', () => {
  it('reads plain texts by id', () => {
    const texts = parseS7res(res('  - id: MLC_44C', '    de-DE: Roots pump is not installed', '  - id: MLC_4c5', '    de-DE: Soft Vent'));
    expect(texts.get('MLC_44C')).toBe('Roots pump is not installed');
    expect(texts.get('MLC_4c5')).toBe('Soft Vent');
    expect(texts.size).toBe(2);
  });

  it('keeps ids case-sensitive', () => {
    const texts = parseS7res(res('  - id: MLC_4c5', '    de-DE: lower', '  - id: MLC_4C5', '    de-DE: upper'));
    expect(texts.get('MLC_4c5')).toBe('lower');
    expect(texts.get('MLC_4C5')).toBe('upper');
  });

  it('unescapes single-quoted scalars', () => {
    const texts = parseS7res(res('  - id: A', "    de-DE: 'Substrate in area '", '  - id: B', "    de-DE: '''Error Type'''", '  - id: C', "    de-DE: '-'"));
    expect(texts.get('A')).toBe('Substrate in area ');
    expect(texts.get('B')).toBe("'Error Type'");
    expect(texts.get('C')).toBe('-');
  });

  it('reads block scalars with their chomping and indentation indicators', () => {
    const texts = parseS7res(
      res(
        '  - id: STRIP',
        '    de-DE: |-',
        '      first',
        '',
        '      second',
        '  - id: KEEP',
        '    de-DE: |+',
        '      line',
        '',
        '  - id: INDENT',
        '    de-DE: |2+',
        '        0    Start',
        '        1    End',
        '  - id: CLIP',
        '    de-DE: |',
        '      only',
      ),
    );
    expect(texts.get('STRIP')).toBe('first\n\nsecond');
    expect(texts.get('KEEP')).toBe('line\n\n');
    expect(texts.get('INDENT')).toBe('  0    Start\n  1    End\n');
    expect(texts.get('CLIP')).toBe('only\n');
  });

  it('treats an empty value as an empty text', () => {
    const texts = parseS7res(res('  - id: MLC_3Dp', '    de-DE:', '  - id: NEXT', '    de-DE: x'));
    expect(texts.get('MLC_3Dp')).toBe('');
    expect(texts.get('NEXT')).toBe('x');
  });

  it('prefers the requested culture, then de-DE, then the first one', () => {
    const source = res('  - id: BOTH', '    de-DE: Hallo', '    en-US: Hello', '  - id: ONLY_EN', '    en-US: Only english');
    expect(parseS7res(source, 'en-US').get('BOTH')).toBe('Hello');
    expect(parseS7res(source, 'fr-FR').get('BOTH')).toBe('Hallo');
    expect(parseS7res(source).get('ONLY_EN')).toBe('Only english');
  });

  it('accepts CRLF line breaks and ignores unrelated text', () => {
    const texts = parseS7res('MultiLingualTexts:\r\n  - id: X\r\n    de-DE: ok\r\n');
    expect(texts.get('X')).toBe('ok');
    expect(parseS7res('').size).toBe(0);
    expect(parseS7res('garbage\nmore: garbage').size).toBe(0);
  });
});
