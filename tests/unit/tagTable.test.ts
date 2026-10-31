import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseTagTable } from '../../src/parser/tagTableParser';
import { compileMatcher } from '../../src/search/matcher';
import type { SearchHit } from '../../src/search/hits';
import { searchTagTable } from '../../src/search/tagSearch';

const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = (name: string): string => readFileSync(join(root, 'fixtures', name), 'utf-8');

const source = fixture('tag-table.xml');
const table = parseTagTable(source, 'en-US');
if (!table) {
  throw new Error('tag-table.xml must parse');
}

const hitsFor = (term: string, exact = false): SearchHit[] => {
  const matcher = compileMatcher(term, exact);
  if (!matcher) {
    throw new Error('no matcher');
  }
  return searchTagTable(table, matcher)?.hits ?? [];
};
const hitAt = (hits: SearchHit[], path: string): SearchHit | undefined => hits.find((h) => h.path === path);

describe('parseTagTable', () => {
  it('reads the table name, its tags and its constants', () => {
    expect(table).toEqual({
      name: 'Conveyor I/O',
      tags: [
        { name: 'Ib_CarrierPresent', dataType: 'Bool', address: '%I1300.3', comment: 'Carrier present' },
        { name: 'Qr_Speed', dataType: 'Real', address: '%QD40', comment: '' },
      ],
      constants: [{ name: 'MaxCarriers', dataType: 'Int', value: '12', comment: 'Maximum carriers on the line' }],
    });
  });

  it('takes the comment of the asked culture, else the first text there is', () => {
    expect(parseTagTable(source, 'de-DE')?.tags[0].comment).toBe('Carrier vorhanden');
    expect(parseTagTable(source, '')?.tags[0].comment).toBe('Carrier vorhanden');
  });

  it('is undefined for an XML that is not a tag table', () => {
    expect(parseTagTable(fixture('boxes.xml'), '')).toBeUndefined();
  });
});

describe('searchTagTable', () => {
  it('finds nothing when nothing matches', () => {
    expect(hitsFor('zzzNothing')).toEqual([]);
  });

  it('describes the object it found hits in', () => {
    const matcher = compileMatcher('speed', false);
    expect(matcher && searchTagTable(table, matcher)).toMatchObject({ kind: 'TAGS', name: 'Conveyor I/O', total: 1 });
  });

  it('finds a table by its name', () => {
    const hit = hitAt(hitsFor('conveyor'), 'Name');
    expect(hit).toMatchObject({ field: 'name', text: 'Conveyor I/O' });
  });

  it('finds a tag by name, data type, address and comment', () => {
    expect(hitAt(hitsFor('carrierpresent'), 'Tags\\Ib_CarrierPresent\\Name')).toMatchObject({ field: 'tag', text: 'Ib_CarrierPresent' });
    expect(hitAt(hitsFor('real'), 'Tags\\Qr_Speed\\Data type')).toMatchObject({ field: 'tag', text: 'Real' });
    expect(hitAt(hitsFor('%QD40'), 'Tags\\Qr_Speed\\Address')).toMatchObject({ field: 'tag', text: '%QD40' });
    expect(hitAt(hitsFor('carrier present'), 'Tags\\Ib_CarrierPresent\\Comment')).toMatchObject({ field: 'tag', text: 'Carrier present' });
  });

  it('finds part of an address', () => {
    expect(hitAt(hitsFor('%I1300'), 'Tags\\Ib_CarrierPresent\\Address')).toBeDefined();
  });

  it('finds a constant by name, data type, value and comment', () => {
    expect(hitAt(hitsFor('maxcarriers'), 'Constants\\MaxCarriers\\Name')).toMatchObject({ field: 'constant', text: 'MaxCarriers' });
    expect(hitAt(hitsFor('int', true), 'Constants\\MaxCarriers\\Data type')).toMatchObject({ field: 'constant' });
    expect(hitAt(hitsFor('12', true), 'Constants\\MaxCarriers\\Value')).toMatchObject({ field: 'constant', text: '12' });
    expect(hitAt(hitsFor('on the line'), 'Constants\\MaxCarriers\\Comment')).toMatchObject({ field: 'constant' });
  });

  it('keeps tags and constants apart by field, so the view can limit the search to either', () => {
    const fields = new Set(hitsFor('carrier').map((h) => h.field));
    expect(fields).toEqual(new Set(['tag', 'constant']));
  });

  it('honours an exact match', () => {
    expect(hitsFor('Ib_Carrier', true)).toEqual([]);
    expect(hitsFor('Ib_Carrier', false).length).toBeGreaterThan(0);
  });

  it('keeps at most the asked number of hits but counts them all', () => {
    const matcher = compileMatcher('r', false);
    const all = matcher && searchTagTable(table, matcher);
    const capped = matcher && searchTagTable(table, matcher, 2);
    expect(capped?.hits).toHaveLength(2);
    expect(capped?.total).toBe(all?.total);
    expect(all?.total).toBeGreaterThan(2);
  });
});
