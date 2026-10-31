import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SceneItem, TextClass } from '../../src/layout/scene';
import type { BlockModel } from '../../src/model/types';
import { parseBlock } from '../../src/parser/blockParser';
import { parseDataBlock } from '../../src/parser/dbParser';
import { parseScl } from '../../src/parser/sclParser';
import { compileMatcher } from '../../src/search/matcher';
import { searchModel, type SearchHit } from '../../src/search/modelSearch';

const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = (name: string): string => readFileSync(join(root, 'fixtures', name), 'utf-8');

const find = (source: string, term: string, exact = false) => {
  const matcher = compileMatcher(term, exact);
  if (!matcher) {
    throw new Error('no matcher');
  }
  return matcher(source);
};

const fb = parseScl(fixture('function-block.scl'));
const db = parseDataBlock(fixture('data-block.db'));
const boxes = parseBlock(fixture('boxes.xml'), '');

const search = (model: Parameters<typeof searchModel>[0], term: string, exact = false): SearchHit[] => {
  const matcher = compileMatcher(term, exact);
  if (!matcher) {
    throw new Error('no matcher');
  }
  return searchModel(model, matcher)?.hits ?? [];
};

const hitAt = (hits: SearchHit[], field: SearchHit['field'], path: string): SearchHit | undefined =>
  hits.find((h) => h.field === field && h.path === path);

describe('compileMatcher', () => {
  it('finds text regardless of case and reports every occurrence', () => {
    expect(find('OB_ProgrammingError', 'err')).toEqual([[14, 17]]);
    expect(find('abXab', 'AB')).toEqual([
      [0, 2],
      [3, 5],
    ]);
  });

  it('treats the term literally, not as a pattern', () => {
    expect(find('a.b axb', 'a.b')).toEqual([[0, 3]]);
    expect(find('f(x) f(y)', '(x)')).toEqual([[1, 4]]);
  });

  it('finds whole words only when an exact match is asked for', () => {
    expect(find('Motor10 Motor1.Run', 'Motor1', true)).toEqual([[8, 14]]);
    expect(find('#x := 1', '#x', true)).toEqual([[0, 2]]);
    expect(find('xMotor1', 'Motor1', true)).toEqual([]);
  });

  it('has no matcher for an empty term', () => {
    expect(compileMatcher('', false)).toBeUndefined();
    expect(compileMatcher('   ', true)).toBeUndefined();
  });
});

describe('searchModel on an SCL function block', () => {
  it('finds nothing when nothing matches', () => {
    const matcher = compileMatcher('zzzNothing', false);
    expect(matcher && searchModel(fb, matcher)).toBeUndefined();
  });

  it('describes the object it found hits in', () => {
    const matcher = compileMatcher('Demo_FB', false);
    const result = matcher && searchModel(fb, matcher);
    expect(result).toMatchObject({ kind: 'FB', name: 'Demo_FB' });
  });

  it('finds the block name', () => {
    const hit = hitAt(search(fb, 'demo_fb'), 'name', 'Name');
    expect(hit?.text).toBe('Demo_FB');
    expect(hit?.marks).toEqual([[0, 7]]);
  });

  it('finds an interface member by name, with its path through the section', () => {
    const hit = hitAt(search(fb, 'Ib_Start'), 'interface', 'Interface\\Input\\Ib_Start\\Name');
    expect(hit?.text).toBe('Ib_Start');
  });

  it('finds the data type of an interface member', () => {
    const hit = hitAt(search(fb, 'DataTyp_Valve'), 'interface', 'Interface\\Input\\Ist_Valve\\Data type');
    // TIA writes the name of a user-defined type in quotes
    expect(hit?.text).toBe('"DataTyp_Valve"');
  });

  it('finds the comment of an interface member', () => {
    const hit = hitAt(search(fb, 'previous cycle'), 'comment', 'Interface\\Input\\It_Cycle\\Comment');
    expect(hit?.text).toBe('previous cycle');
  });

  it('finds the block title as a comment', () => {
    expect(hitAt(search(fb, 'Demo function block'), 'comment', 'Title')).toBeDefined();
  });

  it('finds program code line by line, numbered like the viewer', () => {
    const hits = search(fb, 'FOR #i').filter((h) => h.field === 'code');
    expect(hits).toHaveLength(1);
    expect(hits[0].text.trim()).toBe('FOR #i := 0 TO 3 DO');
    expect(hits[0].path).toMatch(/^Program code\\Line \d+$/);
  });

  it('honours an exact match on code', () => {
    expect(search(fb, 'Ib_Star', true)).toEqual([]);
    expect(search(fb, 'Ib_Star', false).length).toBeGreaterThan(0);
  });
});

describe('searchModel on a data block', () => {
  it('finds the author', () => {
    const hit = hitAt(search(db, 'tester'), 'author', 'Author');
    expect(hit?.text).toBe('tester');
  });

  it('names nested members by their dotted path', () => {
    const hit = search(db, 'Level').find((h) => h.field === 'interface');
    expect(hit?.path).toBe('Interface\\Static\\Info.Sub.Level\\Name');
  });

  it('finds start values that were written in the source', () => {
    expect(hitAt(search(db, '1.5'), 'interface', 'Interface\\Static\\Info.Pos\\Start value')).toBeDefined();
  });

  it('does not find start values that are only the greyed type default', () => {
    // `Cycle : Time` has no start value in the source, TIA shows T#0ms greyed
    expect(search(db, 'T#0ms').filter((h) => h.field === 'interface')).toEqual([]);
  });
});

describe('searchModel on an Openness LAD block', () => {
  const model = boxes;
  if (!model) {
    throw new Error('boxes.xml must parse');
  }

  it('finds an operand of a LAD network', () => {
    const lad = model.networks.find((n) => n.body.kind === 'lad');
    const scene = lad?.body.kind === 'lad' ? lad.body.scene : undefined;
    const operand = scene?.items.find((i) => i.t === 'text' && i.cls === 'operand');
    if (!lad || operand?.t !== 'text') {
      throw new Error('boxes.xml must have a LAD network with an operand');
    }
    const hits = search(model, operand.s, true).filter((h) => h.field === 'code');
    expect(hits.some((h) => h.path === `Network ${lad.index}\\Program code` && h.text === operand.s)).toBe(true);
  });

  it('finds network titles and comments', () => {
    const titled = { ...model, networks: model.networks.map((n, i) => ({ ...n, title: i === 0 ? 'Pump start sequence' : n.title, comment: i === 0 ? 'Needs the pump ready' : n.comment })) };
    const index = titled.networks[0].index;
    expect(hitAt(search(titled, 'start sequence'), 'comment', `Network ${index}\\Title`)?.text).toBe('Pump start sequence');
    expect(hitAt(search(titled, 'pump ready'), 'comment', `Network ${index}\\Comment`)?.text).toBe('Needs the pump ready');
  });
});

describe('searchModel on a LAD scene', () => {
  const text = (s: string, x: number, y: number, cls: TextClass = 'operand', anchor: 'start' | 'middle' | 'end' = 'middle'): SceneItem => ({
    t: 'text',
    x,
    y,
    s,
    cls,
    anchor,
  });
  const ladBlock = (items: SceneItem[]): BlockModel => ({
    ...parseScl('FUNCTION "F"\nBEGIN\nEND_FUNCTION'),
    networks: [{ index: 3, title: '', comment: '', language: 'LAD', body: { kind: 'lad', scene: { width: 400, height: 100, items } } }],
  });
  const codeHits = (items: SceneItem[], term: string): SearchHit[] =>
    search(ladBlock(items), term).filter((h) => h.field === 'code');

  it('lists an operand once per network however often it is used', () => {
    const hits = codeHits([text('Ib_Start', 50, 10), text('Ib_Start', 250, 10), text('Ib_Start', 50, 80)], 'Ib_Start');
    expect(hits.map((h) => [h.path, h.text])).toEqual([['Network 3\\Program code', 'Ib_Start']]);
  });

  it('joins an operand that is wrapped over several lines', () => {
    const wrapped = [text('"Motor".Long.', 100, 10), text('Name', 100, 23)];
    expect(codeHits(wrapped, 'Long.Name').map((h) => h.text)).toEqual(['"Motor".Long.Name']);
  });

  it('keeps operands that merely stand next to each other apart', () => {
    const neighbours = [text('Alpha', 100, 10), text('Beta', 160, 23), text('Gamma', 100, 80)];
    expect(codeHits(neighbours, 'AlphaBeta')).toEqual([]);
    expect(codeHits(neighbours, 'Beta').map((h) => h.text)).toEqual(['Beta']);
  });

  it('finds called blocks and the instance above a box, but not pin labels or instruction titles', () => {
    const items = [
      text('"FB_Pump"', 10, 16, 'title', 'start'),
      text('"DB_Pump"', 10, 5, 'head', 'start'),
      text('MOVE', 10, 16, 'title', 'start'),
      text('ENO', 10, 40, 'pin', 'start'),
    ];
    expect(codeHits(items, 'Pump').map((h) => h.text)).toEqual(['"FB_Pump"', '"DB_Pump"']);
    expect(codeHits(items, 'MOVE')).toEqual([]);
    expect(codeHits(items, 'ENO')).toEqual([]);
  });
});

describe('hit limit per object', () => {
  it('keeps at most the asked number of hits but still counts all of them', () => {
    const matcher = compileMatcher('e', false);
    const all = matcher && searchModel(fb, matcher);
    const capped = matcher && searchModel(fb, matcher, 3);
    expect(all?.total).toBe(all?.hits.length);
    expect(all?.total).toBeGreaterThan(3);
    expect(capped?.hits).toEqual(all?.hits.slice(0, 3));
    expect(capped?.total).toBe(all?.total);
  });
});

describe('result snippets', () => {
  it('shows line breaks and tabs as spaces, keeping the marks in place', () => {
    const hit = search({ ...fb, comment: 'first line\nsecond\tline' }, 'second').find((h) => h.path === 'Comment');
    expect(hit?.text).toBe('first line second line');
    expect(hit?.text.slice(hit.marks[0][0], hit.marks[0][1])).toBe('second');
  });

  it('keeps long lines short and the marks on the match', () => {
    const long = `${'x'.repeat(400)} NeedleHere ${'y'.repeat(400)}`;
    const model = parseScl(`FUNCTION "F"\nBEGIN\n${long}\nEND_FUNCTION`);
    const hit = search(model, 'needlehere').find((h) => h.field === 'code');
    expect(hit).toBeDefined();
    if (!hit) {
      return;
    }
    expect(hit.text.length).toBeLessThan(260);
    const [from, to] = hit.marks[0];
    expect(hit.text.slice(from, to)).toBe('NeedleHere');
  });
});
