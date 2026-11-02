import { describe, expect, it } from 'vitest';
import { diffTagTables } from '../../src/diff/tagTableDiff';
import type { PlcTag, TagTable } from '../../src/parser/tagTableParser';
import { renderTagTableHtml } from '../../src/render/tagTableHtml';

const tag = (name: string, address: string): PlcTag => ({
  name,
  dataType: 'Bool',
  address,
  comment: '',
  retain: false,
  accessible: true,
  writable: true,
  visible: true,
});
const table = (...tags: PlcTag[]): TagTable => ({ name: 'T', tags, constants: [] });
const assets = { cspSource: 'x', nonce: 'n', styleUri: 's', scriptUri: 'j' };

describe('diffTagTables', () => {
  it('marks only the changed cell of a matched tag on both sides', () => {
    const { oldTable, newTable } = diffTagTables(table(tag('A', '%Q1.0'), tag('B', '%Q1.1')), table(tag('A', '%Q1.0'), tag('B', '%Q9.9')));
    expect(oldTable.tags[0]?.diff).toBeUndefined();
    expect(oldTable.tags[1]?.diff).toEqual({ mark: 'del', fields: ['address'] });
    expect(newTable.tags[1]?.diff).toEqual({ mark: 'add', fields: ['address'] });
  });

  it('marks removed and added tags as whole rows', () => {
    const { oldTable, newTable } = diffTagTables(table(tag('A', '')), table(tag('B', '')));
    expect(oldTable.tags[0]?.diff).toEqual({ mark: 'del' });
    expect(newTable.tags[0]?.diff).toEqual({ mark: 'add' });
  });

  it('renders the marks as diff classes', () => {
    const { oldTable } = diffTagTables(table(tag('A', '%Q1.0'), tag('B', '')), table(tag('A', '%Q2.0')));
    const html = renderTagTableHtml(oldTable, assets);
    expect(html).toContain('<td class="address diff-del">%Q1.0</td>');
    expect(html).toContain('<tr class="diff-del">');
  });
});
