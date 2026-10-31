import { describe, expect, it } from 'vitest';
import type { TagTable } from '../../src/parser/tagTableParser';
import { renderTagTableHtml } from '../../src/render/tagTableHtml';

const assets = { cspSource: 'vscode-resource:', nonce: 'abc123', styleUri: 'media/viewer.css', scriptUri: 'media/viewer.js' };

const table: TagTable = {
  name: 'Conveyor I/O',
  tags: [
    { name: '=004+011-XS13/2:X2', dataType: 'Bool', address: '%I1300.3', comment: 'carrier Buffer present infeed', retain: false, accessible: false, writable: true, visible: true },
    { name: 'Qr_Speed', dataType: 'Real', address: '%QD40', comment: '', retain: true, accessible: true, writable: true, visible: true },
  ],
  constants: [{ name: 'MaxCarriers', dataType: 'Int', value: '12', comment: 'Maximum carriers' }],
};

const html = renderTagTableHtml(table, assets);

/** The cells of the table inside the panel with this name, row by row, as plain text. */
function cells(panel: string): string[][] {
  const section = html.slice(html.indexOf(`data-panel="${panel}"`));
  const body = section.slice(0, section.indexOf('</table>'));
  return [...body.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)].map((row) => [...row[1].matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/g)].map((c) => c[1].replace(/<[^>]*>/g, '')));
}

describe('renderTagTableHtml', () => {
  it('names the page after the table and says what it is', () => {
    expect(html).toContain('<title>Conveyor I/O</title>');
    expect(html).toMatch(/<h1>Conveyor I\/O <span class="kind">\[Tag table\]<\/span><\/h1>/);
  });

  it('offers the Tags and User constants tabs, Tags first and shown', () => {
    expect(html).toMatch(/<button[^>]*data-tab="tags"[^>]*aria-selected="true"[^>]*>Tags<\/button>/);
    expect(html).toMatch(/<button[^>]*data-tab="constants"[^>]*aria-selected="false"[^>]*>User constants<\/button>/);
    expect(html).toMatch(/<div[^>]*data-panel="tags"(?![^>]*hidden)[^>]*>/);
    expect(html).toMatch(/<div[^>]*data-panel="constants"[^>]*hidden[^>]*>/);
  });

  it('opens on User constants when the table has constants but no tags', () => {
    const enums = renderTagTableHtml({ ...table, tags: [] }, assets);
    expect(enums).toMatch(/<button[^>]*data-tab="constants"[^>]*aria-selected="true"/);
    expect(enums).toMatch(/<button[^>]*data-tab="tags"[^>]*aria-selected="false"/);
    expect(enums).toMatch(/<div[^>]*data-panel="tags"[^>]*hidden/);
    expect(enums).toMatch(/<div[^>]*data-panel="constants"(?![^>]*hidden)[^>]*>/);
  });

  it('lists the tags like the tag table editor of TIA Portal', () => {
    const rows = cells('tags');
    expect(rows[0]).toEqual(['#', 'Name', 'Data type', 'Address', 'Retain', 'Accessible from HMI/OPC UA', 'Writable from HMI/OPC UA', 'Visible in HMI engineering', 'Supervision', 'Comment']);
    expect(rows[1].filter((c) => c !== '')).toEqual(['1', '=004+011-XS13/2:X2', 'Bool', '%I1300.3', 'carrier Buffer present infeed']);
    expect(rows[2].filter((c) => c !== '')).toEqual(['2', 'Qr_Speed', 'Real', '%QD40']);
  });

  it('shows a flag unchecked and disabled when the tag is not accessible, as TIA does', () => {
    const [first, second] = html.slice(html.indexOf('data-panel="tags"'), html.indexOf('data-panel="constants"')).split('<tr').slice(2);
    expect(first.match(/type="checkbox"/g)).toHaveLength(4);
    expect(first).not.toContain(' checked');
    // Writable and Visible are dimmed (not hidden); Accessible itself stays editable, so it can be switched on
    expect(first.match(/class="dim"/g)).toHaveLength(2);
    expect(first).not.toContain('class="off"');
    // an accessible tag has the three flags on, and a set Retain on top
    expect(second.match(/ checked/g)).toHaveLength(4);
    expect(second).not.toContain('class="dim"');
  });

  it('lists the user constants', () => {
    const rows = cells('constants');
    expect(rows[0]).toEqual(['#', 'Name', 'Data type', 'Value', 'Comment']);
    expect(rows[1]).toEqual(['1', 'MaxCarriers', 'Int', '12', 'Maximum carriers']);
  });

  it('says so when a table has no tags or no constants', () => {
    const empty = renderTagTableHtml({ name: 'Empty', tags: [], constants: [] }, assets);
    expect(empty).toContain('This tag table has no tags.');
    expect(empty).toContain('This tag table has no user constants.');
  });

  it('escapes everything that comes from the export', () => {
    const hostile = renderTagTableHtml(
      { name: '<img src=x onerror=alert(1)>', tags: [{ ...table.tags[0], name: '<script>alert(1)</script>', comment: '"><b>' }], constants: [] },
      assets,
    );
    expect(hostile).not.toContain('<img src=x');
    expect(hostile).not.toContain('<script>alert');
    expect(hostile).not.toContain('"><b>');
    expect(hostile).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('only allows the script that carries its nonce', () => {
    expect(html).toContain("script-src 'nonce-abc123'");
    expect(html).toContain('<script nonce="abc123" src="media/viewer.js"></script>');
  });
});
