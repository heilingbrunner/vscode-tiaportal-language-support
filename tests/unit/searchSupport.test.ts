import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BlockModel } from '../../src/model/types';
import { parseBlock } from '../../src/parser/blockParser';
import { parseDataBlock } from '../../src/parser/dbParser';
import { parseAwl, parseScl } from '../../src/parser/sclParser';
import { parseUdtModel } from '../../src/parser/udtParser';
import { compileMatcher } from '../../src/search/matcher';
import { searchModel } from '../../src/search/modelSearch';
import { longestWordRun, mayContain } from '../../src/search/prefilter';
import { displayPath } from '../../src/search/resultPath';

describe('longestWordRun', () => {
  it('takes the longest run of identifier characters of the term', () => {
    expect(longestWordRun('Ib_Start')).toBe('Ib_Start');
    expect(longestWordRun('"Motor".Run')).toBe('Motor');
    expect(longestWordRun('a.bcd[12]')).toBe('bcd');
  });

  it('is empty for a term without identifier characters', () => {
    expect(longestWordRun(':=')).toBe('');
    expect(longestWordRun('  ')).toBe('');
  });
});

describe('mayContain', () => {
  it('compares without regard to case', () => {
    expect(mayContain('VAR Ib_START : Bool;', 'ib_start')).toBe(true);
    expect(mayContain('VAR Other : Bool;', 'ib_start')).toBe(false);
  });

  it('cannot rule anything out for an empty run', () => {
    expect(mayContain('anything at all', '')).toBe(true);
  });

  it('finds an operand whose parts the source keeps apart', () => {
    // Openness XML stores "Tag"."Member" as two components, the longest run is still there
    expect(mayContain('<Component Name="Tag"/><Token Text="."/><Component Name="Member"/>', longestWordRun('Tag.Member'))).toBe(true);
  });
});

describe('mayContain against the real parsers', () => {
  // The scan skips a file when mayContain is false, so a file with a hit must never be skipped.
  const sources: Array<[string, (text: string) => BlockModel | undefined]> = [
    ['function-block.scl', (t) => parseScl(t)],
    ['function-block.awl', (t) => parseAwl(t)],
    ['data-block.db', (t) => parseDataBlock(t)],
    ['instance-db.db', (t) => parseDataBlock(t)],
    ['Valve.udt', (t) => parseUdtModel(t)],
    ['boxes.xml', (t) => parseBlock(t, '')],
  ];
  const terms = ['valve', 'Start', 'cycle', 'Demo', 'i', 'e', 'T#25s', '1.5', 'Int', ':=', '"DataTyp_Valve"', 'previous cycle'];
  const root = fileURLToPath(new URL('../..', import.meta.url));

  it.each(sources)('never rules out %s when it has a hit', (file, parse) => {
    const raw = readFileSync(join(root, 'fixtures', file), 'utf-8');
    const model = parse(raw);
    expect(model).toBeDefined();
    let withHits = 0;
    for (const term of terms) {
      const matcher = compileMatcher(term, false);
      if (model && matcher && searchModel(model, matcher)) {
        withHits++;
        expect(mayContain(raw, longestWordRun(term)), `${file}: ${term}`).toBe(true);
      }
    }
    expect(withHits).toBeGreaterThan(0);
  });
});

describe('displayPath', () => {
  it('starts at the searched folder and uses backslashes like TIA', () => {
    expect(displayPath('/work/Project', '/work/Project/Program blocks/0_OB/Main.xml')).toBe('Project\\Program blocks\\0_OB\\Main.xml');
  });

  it('copes with a trailing slash on the folder', () => {
    expect(displayPath('/work/Project/', '/work/Project/a/b.db')).toBe('Project\\a\\b.db');
  });

  it('names the file when it is directly in the folder', () => {
    expect(displayPath('/work/Project', '/work/Project/b.db')).toBe('Project\\b.db');
  });

  it('keeps the whole path for a file outside the folder', () => {
    expect(displayPath('/work/Project', '/elsewhere/b.db')).toBe('\\elsewhere\\b.db');
  });
});
