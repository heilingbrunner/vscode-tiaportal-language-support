import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { diffAml } from '../../src/diff/amlDiff';
import { parseAml, type AmlModel } from '../../src/parser/amlParser';
import { renderAmlHtml } from '../../src/render/amlHtml';

const root = fileURLToPath(new URL('../..', import.meta.url));
const assets = { cspSource: 'vscode-resource:', nonce: 'abc123', styleUri: 'media/viewer.css', scriptUri: 'media/viewer.js' };
const model = parseAml(readFileSync(join(root, 'fixtures', 'sample.aml'), 'utf-8'), 'en-US')!;
const html = renderAmlHtml(model, assets);

/** The cells of the table inside the panel with this name, row by row, as plain text. */
function cells(page: string, panel: string): string[][] {
  const section = page.slice(page.indexOf(`data-panel="${panel}"`));
  const body = section.slice(0, section.indexOf('</table>'));
  return [...body.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)].map((row) => [...row[1].matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/g)].map((c) => c[1].replace(/<[^>]*>/g, '')));
}

describe('renderAmlHtml', () => {
  it('names the page after the file and says what it is', () => {
    expect(html).toContain('<title>Sample.aml</title>');
    expect(html).toMatch(/<h1>Sample\.aml <span class="kind">\[AutomationML\]<\/span><\/h1>/);
  });

  it('shows who wrote the file and when', () => {
    expect(html).toContain('Totally Integrated Automation Portal');
    expect(html).toContain('2100.0.121.1');
    expect(html).toContain('2026-11-05T15:30:50Z');
  });

  it('offers one tab per table with its row count, the first one shown', () => {
    expect(html).toMatch(/<button[^>]*data-tab="devices"[^>]*aria-selected="true"[^>]*>Devices \(2\)<\/button>/);
    expect(html).toMatch(/<button[^>]*data-tab="network"[^>]*aria-selected="false"[^>]*>Network \(2\)<\/button>/);
    expect(html).toMatch(/<button[^>]*data-tab="links"[^>]*>Links \(3\)<\/button>/);
    expect(html).toMatch(/<button[^>]*data-tab="tags"[^>]*>I\/O tags \(1\)<\/button>/);
    expect(html).toMatch(/<button[^>]*data-tab="elements"[^>]*>All elements \(\d+\)<\/button>/);
    expect(html).toMatch(/<div[^>]*data-panel="devices"(?![^>]*hidden)[^>]*>/);
    expect(html).toMatch(/<div[^>]*data-panel="network"[^>]*hidden[^>]*>/);
  });

  it('lists devices and device items with their type data', () => {
    const rows = cells(html, 'devices');
    expect(rows[0]).toEqual(['#', 'Name', 'Role', 'Type name', 'Order number', 'Position', 'Firmware', 'Comment', 'Path']);
    expect(rows[1]).toEqual(['1', 'PLC_1', 'DeviceItem', '', 'OrderNumber:6ES7 511-1AK02-0AB0', '0', '', 'Main controller', 'Project / Hardware']);
    expect(rows[2].slice(0, 3)).toEqual(['2', 'Drive_1', 'Device']);
  });

  it('lists subnets and nodes with their addresses', () => {
    const rows = cells(html, 'network');
    expect(rows[0]).toEqual(['#', 'Name', 'Role', 'Type', 'Address', 'Subnet mask', 'PROFINET name', 'Path']);
    expect(rows[1].slice(0, 4)).toEqual(['1', 'PN', 'Subnet', 'Ethernet']);
    expect(rows[2]).toEqual(['2', 'IE1', 'Node', '', '192.168.0.1', '255.255.255.0', '', 'Project / Hardware / PLC_1 / PROFINET interface']);
  });

  it('lists the links between ports', () => {
    const rows = cells(html, 'links');
    expect(rows[0]).toEqual(['#', 'Name', 'From', 'To']);
    expect(rows[1]).toEqual(['1', 'Link To Port_1', 'Project / Hardware / PLC_1 / PROFINET interface / Port_1', 'Project / Hardware / Drive_1 / Port_1']);
  });

  it('lists the I/O tags', () => {
    const rows = cells(html, 'tags');
    expect(rows[0]).toEqual(['#', 'Table', 'Name', 'Data type', 'I/O type', 'Address', 'Length', 'Comment']);
    expect(rows[1]).toEqual(['1', 'Default tag table', 'A2548.0', 'Bool', 'Output', '2848.0', '', '']);
  });

  it('lists every element, indented by depth, so unknown roles stay visible', () => {
    const rows = cells(html, 'elements');
    expect(rows[0]).toEqual(['#', 'Name', 'Role', 'Path']);
    expect(rows).toHaveLength(model.elements.length + 1);
    // PLC_1 sits two levels below the project: two em spaces
    expect(rows[4][1]).toBe('  PLC_1');
  });

  it('opens on the first tab that has rows and says so for an empty one', () => {
    const onlyTags: AmlModel = { ...model, elements: [], links: [] };
    const page = renderAmlHtml(onlyTags, assets);
    expect(page).toMatch(/<button[^>]*data-tab="tags"[^>]*aria-selected="true"/);
    expect(page).toMatch(/<button[^>]*data-tab="devices"[^>]*aria-selected="false"/);
    expect(page).toContain('This file has no devices.');
  });

  it('escapes everything that comes from the export', () => {
    const hostile = renderAmlHtml(
      { ...model, fileName: '<img src=x onerror=alert(1)>', links: [{ name: '<script>alert(1)</script>', from: '"><b>', to: '', fromId: 'a', toId: 'b' }] },
      assets,
    );
    expect(hostile).not.toContain('<img src=x');
    expect(hostile).not.toContain('<script>alert');
    expect(hostile).not.toContain('"><b>');
    expect(hostile).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  describe('in a comparison', () => {
    const parse = (text: string): AmlModel => parseAml(text, 'en-US')!;
    const sourceText = readFileSync(join(root, 'fixtures', 'sample.aml'), 'utf-8');
    const base = parse(sourceText);
    const render = (changed: string, side: 'old' | 'new'): string => {
      const diffed = diffAml(base, parse(changed));
      return renderAmlHtml(side === 'old' ? diffed.oldModel : diffed.newModel, assets);
    };
    /** The opening tag and cells of the first table row of any panel that mentions `text`. */
    const rowWith = (page: string, text: string): string => page.split('<tr').find((r) => r.includes(`>${text}<`)) ?? '';

    it('shows no mark when nothing differs', () => {
      const page = render(sourceText, 'new');
      expect(page).not.toMatch(/diff-(add|del)/);
      expect(page).not.toContain('tab-diff');
      expect(page).not.toContain('title="Changed');
    });

    it('colours only the cell that changed, green in the new version and red in the old one', () => {
      const changed = sourceText.replace('192.168.0.1', '192.168.0.9');
      const row = rowWith(render(changed, 'new'), 'IE1');
      expect(row).not.toMatch(/^[^>]*class="diff/);
      expect(row).toContain('<td class="diff-add">192.168.0.9</td>');
      expect(rowWith(render(changed, 'old'), 'IE1')).toContain('<td class="diff-del">192.168.0.1</td>');
    });

    it('colours the whole row of an element only one version has', () => {
      const added = sourceText.replace('<InternalElement ID="t-1"', '<InternalElement ID="d-3" Name="Drive_2"><SupportedRoleClass RefRoleClassPath="L/Device" /></InternalElement>\n<InternalElement ID="t-1"');
      expect(rowWith(render(added, 'new'), 'Drive_2')).toMatch(/^ class="diff-add"/);
      expect(render(added, 'old')).not.toContain('Drive_2');
    });

    it('marks the tabs that hold a difference, so a change on another tab is found', () => {
      const changed = sourceText.replace('192.168.0.1', '192.168.0.9');
      const page = render(changed, 'new');
      expect(page).toMatch(/<button[^>]*class="tab tab-diff-add"[^>]*data-tab="network"/);
      expect(page).not.toMatch(/<button[^>]*tab-diff[^>]*data-tab="tags"/);
      // the old version's marks are red
      expect(render(changed, 'old')).toMatch(/<button[^>]*class="tab tab-diff-del"[^>]*data-tab="network"/);
    });

    it('marks the name cell and says what changed when the changed value has no column', () => {
      // BuiltIn is not a column of any table
      const changed = sourceText.replace('<Attribute Name="BuiltIn" AttributeDataType="xs:boolean"><Value>false</Value></Attribute>', '<Attribute Name="BuiltIn" AttributeDataType="xs:boolean"><Value>true</Value></Attribute>');
      const row = rowWith(render(changed, 'new'), 'PLC_1');
      expect(row).toContain('<td class="diff-add" title="Changed: BuiltIn">PLC_1</td>');
    });
  });

  it('only allows the script that carries its nonce', () => {
    expect(html).toContain("script-src 'nonce-abc123'");
    expect(html).toContain('<script nonce="abc123" src="media/viewer.js"></script>');
  });
});
