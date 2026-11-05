import type { AmlElement, AmlModel } from '../parser/amlParser';
import { pageCsp, type HtmlAssets } from './html';
import { escapeHtml } from './svg';

/** One tab: its table rendered from plain-text rows (every cell is escaped here, nothing arrives as markup). */
interface Panel {
  id: string;
  label: string;
  columns: string[];
  rows: string[][];
  emptyText: string;
}

/** An em space per level of depth: it survives HTML whitespace collapsing, unlike a regular space. */
const INDENT = ' ';
const DEVICE_ROLES: ReadonlySet<string> = new Set(['Device', 'DeviceItem']);
const NETWORK_ROLES: ReadonlySet<string> = new Set(['Subnet', 'Node', 'IoSystem']);

const hasRole = (element: AmlElement, roles: ReadonlySet<string>): boolean => element.roles.some((r) => roles.has(r));
const attr = (element: AmlElement, name: string): string => element.attributes[name] ?? '';

const devicePanel = (model: AmlModel): Panel => ({
  id: 'devices',
  label: 'Devices',
  columns: ['Name', 'Role', 'Type name', 'Order number', 'Position', 'Firmware', 'Comment', 'Path'],
  rows: model.elements
    .filter((e) => hasRole(e, DEVICE_ROLES))
    .map((e) => [e.name, e.roles.join(', '), attr(e, 'TypeName'), attr(e, 'TypeIdentifier'), attr(e, 'PositionNumber'), attr(e, 'FirmwareVersion'), attr(e, 'Comment'), e.path]),
  emptyText: 'This file has no devices.',
});

const networkPanel = (model: AmlModel): Panel => ({
  id: 'network',
  label: 'Network',
  columns: ['Name', 'Role', 'Type', 'Address', 'Subnet mask', 'PROFINET name', 'Path'],
  rows: model.elements
    .filter((e) => hasRole(e, NETWORK_ROLES))
    .map((e) => [e.name, e.roles.join(', '), attr(e, 'Type'), attr(e, 'NetworkAddress'), attr(e, 'SubnetMask'), attr(e, 'ProfinetDeviceName'), e.path]),
  emptyText: 'This file has no subnets or nodes.',
});

const linkPanel = (model: AmlModel): Panel => ({
  id: 'links',
  label: 'Links',
  columns: ['Name', 'From', 'To'],
  rows: model.links.map((l) => [l.name, l.from, l.to]),
  emptyText: 'This file has no links.',
});

const tagPanel = (model: AmlModel): Panel => ({
  id: 'tags',
  label: 'I/O tags',
  columns: ['Table', 'Name', 'Data type', 'I/O type', 'Address', 'Length', 'Comment'],
  rows: model.tags.map((t) => [t.table, t.name, t.dataType, t.ioType, t.address, t.length, t.comment]),
  emptyText: 'This file has no I/O tags.',
});

const elementPanel = (model: AmlModel): Panel => ({
  id: 'elements',
  label: 'All elements',
  columns: ['Name', 'Role', 'Path'],
  rows: model.elements.map((e) => [`${INDENT.repeat(e.depth)}${e.name}`, e.roles.join(', '), e.path]),
  emptyText: 'This file has no elements.',
});

const headRow = (columns: string[]): string => `<thead><tr>${['#', ...columns].map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>`;

const bodyRow = (row: string[], index: number): string =>
  `<tr><td class="rownum">${index + 1}</td>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`;

const listing = (panel: Panel): string =>
  panel.rows.length === 0
    ? `<p class="notice">${escapeHtml(panel.emptyText)}</p>`
    : `<table class="interface tagtable" data-static>${headRow(panel.columns)}<tbody>${panel.rows.map(bodyRow).join('')}</tbody></table>`;

const tab = (panel: Panel, selected: boolean): string =>
  `<button type="button" role="tab" class="tab" data-tab="${panel.id}" aria-selected="${selected}">${escapeHtml(`${panel.label} (${panel.rows.length})`)}</button>`;

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
