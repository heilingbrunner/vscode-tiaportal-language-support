import type { PlcConstant, PlcTag, RowDiff, TagTable } from '../parser/tagTableParser';
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

/** Row class of a row that exists in one version only (a comparison marks such a row as a whole). */
const rowAttr = (diff: RowDiff | undefined): string => (diff && !diff.fields ? ` class="diff-${diff.mark}"` : '');

/** Cell class for a row whose own cells (not the whole row) differ between the two versions. */
const cellDiff = (diff: RowDiff | undefined, ...fields: string[]): string =>
  diff?.fields?.some((f) => fields.includes(f)) ? `diff-${diff.mark}` : '';

const cell = (diff: RowDiff | undefined, field: string, base: string, html: string): string => {
  const classes = [base, cellDiff(diff, field)].filter(Boolean).join(' ');
  return `<td${classes ? ` class="${classes}"` : ''}>${html}</td>`;
};

/** A read-only flag cell; a dimmed box is one that cannot be changed at the moment (it is still shown, as in TIA). */
const flag = (value: boolean, diffClass: string, dimmed = false): string =>
  `<td class="chk${diffClass ? ` ${diffClass}` : ''}"><input type="checkbox" disabled${value ? ' checked' : ''}${dimmed ? ' class="dim"' : ''}></td>`;

/**
 * One tag as a row. Like TIA, the writable and visible flags only mean something for a tag that is accessible from
 * HMI / OPC UA: otherwise they are shown unchecked and dimmed.
 */
function tagRow(tag: PlcTag, index: number): string {
  const open = tag.accessible;
  const d = tag.diff;
  // the shown "writable" / "visible" boxes also depend on `accessible`, so either change marks them
  const dependent = (field: string): string => cellDiff(d, field, 'accessible');
  return (
    `<tr${rowAttr(d)}><td class="rownum">${index + 1}</td><td class="name">${escapeHtml(tag.name)}</td>` +
    `${cell(d, 'dataType', '', escapeHtml(tag.dataType))}${cell(d, 'address', 'address', escapeHtml(tag.address))}` +
    `${flag(tag.retain, cellDiff(d, 'retain'))}${flag(open, cellDiff(d, 'accessible'))}` +
    `${flag(open && tag.writable, dependent('writable'), !open)}${flag(open && tag.visible, dependent('visible'), !open)}` +
    `<td></td>${cell(d, 'comment', '', escapeHtml(tag.comment))}</tr>`
  );
}

const constantRow = (constant: PlcConstant, index: number): string => {
  const d = constant.diff;
  return (
    `<tr${rowAttr(d)}><td class="rownum">${index + 1}</td><td class="name">${escapeHtml(constant.name)}</td>` +
    `${cell(d, 'dataType', '', escapeHtml(constant.dataType))}${cell(d, 'value', 'value', escapeHtml(constant.value))}` +
    `${cell(d, 'comment', '', escapeHtml(constant.comment))}</tr>`
  );
};

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
