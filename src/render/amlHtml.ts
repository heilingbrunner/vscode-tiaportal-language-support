import type { AmlElement, AmlModel } from '../parser/amlParser';
import type { RowDiff } from '../parser/tagTableParser';
import { pageCsp, type HtmlAssets } from './html';
import { escapeHtml } from './svg';

/** A column; `field` names what a comparison reports for it (see `diffAml`), a column without one is never marked. */
interface Column {
  head: string;
  field?: string;
}

/** A row of plain-text cells (every cell is escaped on output, nothing arrives as markup) and its comparison mark. */
interface PanelRow {
  cells: string[];
  diff?: RowDiff;
}

/** One tab with its table. */
interface Panel {
  id: string;
  label: string;
  columns: Column[];
  rows: PanelRow[];
  emptyText: string;
}

/** An em space per level of depth: it survives HTML whitespace collapsing, unlike a regular space. */
const INDENT = ' ';
const DEVICE_ROLES: ReadonlySet<string> = new Set(['Device', 'DeviceItem']);
const NETWORK_ROLES: ReadonlySet<string> = new Set(['Subnet', 'Node', 'IoSystem']);

const hasRole = (element: AmlElement, roles: ReadonlySet<string>): boolean => element.roles.some((r) => roles.has(r));
const attr = (element: AmlElement, name: string): string => element.attributes[name] ?? '';
const col = (head: string, field?: string): Column => ({ head, field });
const row = (diff: RowDiff | undefined, ...cells: string[]): PanelRow => ({ cells, diff });

const devicePanel = (model: AmlModel): Panel => ({
  id: 'devices',
  label: 'Devices',
  columns: [col('Name', 'name'), col('Role', 'roles'), col('Type name', '@TypeName'), col('Order number', '@TypeIdentifier'), col('Position', '@PositionNumber'), col('Firmware', '@FirmwareVersion'), col('Comment', '@Comment'), col('Path', 'path')],
  rows: model.elements
    .filter((e) => hasRole(e, DEVICE_ROLES))
    .map((e) => row(e.diff, e.name, e.roles.join(', '), attr(e, 'TypeName'), attr(e, 'TypeIdentifier'), attr(e, 'PositionNumber'), attr(e, 'FirmwareVersion'), attr(e, 'Comment'), e.path)),
  emptyText: 'This file has no devices.',
});

const networkPanel = (model: AmlModel): Panel => ({
  id: 'network',
  label: 'Network',
  columns: [col('Name', 'name'), col('Role', 'roles'), col('Type', '@Type'), col('Address', '@NetworkAddress'), col('Subnet mask', '@SubnetMask'), col('PROFINET name', '@ProfinetDeviceName'), col('Path', 'path')],
  rows: model.elements
    .filter((e) => hasRole(e, NETWORK_ROLES))
    .map((e) => row(e.diff, e.name, e.roles.join(', '), attr(e, 'Type'), attr(e, 'NetworkAddress'), attr(e, 'SubnetMask'), attr(e, 'ProfinetDeviceName'), e.path)),
  emptyText: 'This file has no subnets or nodes.',
});

const linkPanel = (model: AmlModel): Panel => ({
  id: 'links',
  label: 'Links',
  columns: [col('Name', 'name'), col('From'), col('To')],
  rows: model.links.map((l) => row(l.diff, l.name, l.from, l.to)),
  emptyText: 'This file has no links.',
});

const tagPanel = (model: AmlModel): Panel => ({
  id: 'tags',
  label: 'I/O tags',
  columns: [col('Table'), col('Name'), col('Data type', 'dataType'), col('I/O type', 'ioType'), col('Address', 'address'), col('Length', 'length'), col('Comment', 'comment')],
  rows: model.tags.map((t) => row(t.diff, t.table, t.name, t.dataType, t.ioType, t.address, t.length, t.comment)),
  emptyText: 'This file has no I/O tags.',
});

const elementPanel = (model: AmlModel): Panel => ({
  id: 'elements',
  label: 'All elements',
  columns: [col('Name', 'name'), col('Role', 'roles'), col('Path', 'path')],
  rows: model.elements.map((e) => row(e.diff, `${INDENT.repeat(e.depth)}${e.name}`, e.roles.join(', '), e.path)),
  emptyText: 'This file has no elements.',
});

const headRow = (columns: Column[]): string =>
  `<thead><tr><th>#</th>${columns.map((c) => `<th>${escapeHtml(c.head)}</th>`).join('')}</tr></thead>`;

/** A row that exists in one version only is coloured as a whole; a row of both only in the cells that differ. */
const rowAttr = (diff: RowDiff | undefined): string => (diff && !diff.fields ? ` class="diff-${diff.mark}"` : '');

/** The cells of a row. A change in a value that no column shows marks the first cell and names the change in its tooltip. */
function bodyCells(columns: Column[], { cells, diff }: PanelRow): string {
  const shown = new Set(columns.map((c) => c.field));
  const hidden = diff?.fields?.filter((f) => !shown.has(f)) ?? [];
  return cells
    .map((text, i) => {
      const own = columns[i].field;
      const marked = diff?.fields && ((own !== undefined && diff.fields.includes(own)) || (i === 0 && hidden.length > 0));
      const attrs =
        (marked && diff ? ` class="diff-${diff.mark}"` : '') +
        (i === 0 && hidden.length > 0 ? ` title="${escapeHtml(`Changed: ${hidden.map((f) => f.replace(/^@/, '')).join(', ')}`)}"` : '');
      return `<td${attrs}>${escapeHtml(text)}</td>`;
    })
    .join('');
}

const bodyRow = (columns: Column[], row: PanelRow, index: number): string =>
  `<tr${rowAttr(row.diff)}><td class="rownum">${index + 1}</td>${bodyCells(columns, row)}</tr>`;

const listing = (panel: Panel): string =>
  panel.rows.length === 0
    ? `<p class="notice">${escapeHtml(panel.emptyText)}</p>`
    : `<table class="interface tagtable" data-static>${headRow(panel.columns)}<tbody>${panel.rows.map((r, i) => bodyRow(panel.columns, r, i)).join('')}</tbody></table>`;

/** A tab whose table holds a difference carries the colour of its marks, so the difference is found on another tab. */
function tabClass(panel: Panel): string {
  const mark = panel.rows.find((r) => r.diff)?.diff?.mark;
  return mark ? `tab tab-diff-${mark}` : 'tab';
}

const tab = (panel: Panel, selected: boolean): string =>
  `<button type="button" role="tab" class="${tabClass(panel)}" data-tab="${panel.id}" aria-selected="${selected}">${escapeHtml(`${panel.label} (${panel.rows.length})`)}</button>`;

const tabPanel = (panel: Panel, selected: boolean): string =>
  `<div class="tab-panel" role="tabpanel" data-panel="${panel.id}"${selected ? '' : ' hidden'}>${listing(panel)}</div>`;

/** "Totally Integrated Automation Portal (Siemens) · 2100.0.121.1 · <written> · CAEX 2.15", leaving out what is missing. */
function metaLine(model: AmlModel): string {
  const { writerName, writerVendor, writerRelease, writerVersion, lastWritten, schemaVersion } = model.header;
  const writer = writerVendor ? `${writerName} (${writerVendor})` : writerName;
  return [writer, writerRelease || writerVersion, lastWritten, schemaVersion ? `CAEX ${schemaVersion}` : '']
    .filter(Boolean)
    .join(' · ');
}

/**
 * Renders an AutomationML (CAEX) export as tables: devices, network nodes, links, I/O tags and a list of all elements.
 * The page opens on the first tab that has rows.
 */
export function renderAmlHtml(model: AmlModel, assets: HtmlAssets): string {
  const panels = [devicePanel(model), networkPanel(model), linkPanel(model), tagPanel(model), elementPanel(model)];
  const selected = (panels.find((p) => p.rows.length > 0) ?? panels[0]).id;
  const title = model.fileName || 'AutomationML';
  const meta = metaLine(model);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${pageCsp(assets)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${assets.styleUri}">
<title>${escapeHtml(title)}</title></head>
<body>
<header class="block-head"><h1>${escapeHtml(title)} <span class="kind">[AutomationML]</span></h1>
${meta ? `<p class="aml-meta">${escapeHtml(meta)}</p>\n` : ''}<div class="tabs" role="tablist">${panels.map((p) => tab(p, p.id === selected)).join('')}</div></header>
${panels.map((p) => tabPanel(p, p.id === selected)).join('\n')}
<script nonce="${assets.nonce}" src="${assets.scriptUri}"></script>
</body></html>`;
}
