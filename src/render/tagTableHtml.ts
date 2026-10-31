import type { PlcConstant, PlcTag, TagTable } from '../parser/tagTableParser';
import { pageCsp, type HtmlAssets } from './html';
import { escapeHtml } from './svg';

const TAG_COLUMNS = [
  '#',
  'Name',
  'Data type',
  'Address',
  'Retain',
  'Accessible from HMI/OPC UA',
  'Writable from HMI/OPC UA',
  'Visible in HMI engineering',
  'Supervision',
  'Comment',
];
const CONSTANT_COLUMNS = ['#', 'Name', 'Data type', 'Value', 'Comment'];

const headRow = (columns: string[]): string => `<thead><tr>${columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>`;

/** A read-only flag cell; a dimmed box is one that cannot be changed at the moment (it is still shown, as in TIA). */
const flag = (value: boolean, dimmed = false): string =>
  `<td class="chk"><input type="checkbox" disabled${value ? ' checked' : ''}${dimmed ? ' class="dim"' : ''}></td>`;

/**
 * One tag as a row. Like TIA, the writable and visible flags only mean something for a tag that is accessible from
 * HMI / OPC UA: otherwise they are shown unchecked and dimmed.
 */
function tagRow(tag: PlcTag, index: number): string {
  const open = tag.accessible;
  return (
    `<tr><td class="rownum">${index + 1}</td><td class="name">${escapeHtml(tag.name)}</td>` +
    `<td>${escapeHtml(tag.dataType)}</td><td class="address">${escapeHtml(tag.address)}</td>` +
    `${flag(tag.retain)}${flag(open)}${flag(open && tag.writable, !open)}${flag(open && tag.visible, !open)}` +
    `<td></td><td>${escapeHtml(tag.comment)}</td></tr>`
  );
}

const constantRow = (constant: PlcConstant, index: number): string =>
  `<tr><td class="rownum">${index + 1}</td><td class="name">${escapeHtml(constant.name)}</td>` +
  `<td>${escapeHtml(constant.dataType)}</td><td class="value">${escapeHtml(constant.value)}</td>` +
  `<td>${escapeHtml(constant.comment)}</td></tr>`;

function listing<T>(items: T[], columns: string[], row: (item: T, index: number) => string, emptyText: string): string {
  if (items.length === 0) {
    return `<p class="notice">${escapeHtml(emptyText)}</p>`;
  }
  return `<table class="interface tagtable" data-static>${headRow(columns)}<tbody>${items.map(row).join('')}</tbody></table>`;
}

const tab = (id: string, label: string, selected: boolean): string =>
  `<button type="button" role="tab" class="tab" data-tab="${id}" aria-selected="${selected}">${escapeHtml(label)}</button>`;

/**
 * Renders a PLC tag table like TIA Portal's tag table editor: a Tags tab and a User constants tab. The page opens on
 * Tags, except for a table that only has constants (an enumeration), which would otherwise open on an empty tab.
 */
export function renderTagTableHtml(table: TagTable, assets: HtmlAssets): string {
  const constantsFirst = table.tags.length === 0 && table.constants.length > 0;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${pageCsp(assets)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${assets.styleUri}">
<title>${escapeHtml(table.name)}</title></head>
<body>
<header class="block-head"><h1>${escapeHtml(table.name)} <span class="kind">[Tag table]</span></h1>
<div class="tabs" role="tablist">${tab('tags', 'Tags', !constantsFirst)}${tab('constants', 'User constants', constantsFirst)}</div></header>
<div class="tab-panel" role="tabpanel" data-panel="tags"${constantsFirst ? ' hidden' : ''}>${listing(table.tags, TAG_COLUMNS, tagRow, 'This tag table has no tags.')}</div>
<div class="tab-panel" role="tabpanel" data-panel="constants"${constantsFirst ? '' : ' hidden'}>${listing(table.constants, CONSTANT_COLUMNS, constantRow, 'This tag table has no user constants.')}</div>
<script nonce="${assets.nonce}" src="${assets.scriptUri}"></script>
</body></html>`;
}
