import type { BlockModel, InterfaceMember, InterfaceSection, NetworkModel } from '../model/types';
import { renderCode } from './code';
import { escapeHtml, sceneToSvg } from './svg';

export interface HtmlAssets {
  cspSource: string;
  nonce: string;
  styleUri: string;
  scriptUri: string;
}

const FLAG_COLUMNS = [
  'Accessible from HMI/OPC UA',
  'Writable from HMI/OPC UA',
  'Visible in HMI engineering',
  'Setpoint',
];
const FB_COLUMNS = ['#', 'Name', 'Data type', 'Default value', 'Retain', ...FLAG_COLUMNS, 'Comment'];
const DB_COLUMNS = ['#', 'Name', 'Data type', 'Start value', 'Retain', ...FLAG_COLUMNS, 'Supervision', 'Comment'];

/** Row numbering and layout options shared by all rows of one interface table. */
interface TableState {
  db: boolean;
  columns: number;
  row: number;
}

const check = (value: boolean, enabled: boolean): string =>
  `<td class="chk"><input type="checkbox" disabled${value ? ' checked' : ''}${enabled ? '' : ' class="off"'}></td>`;

function memberRows(
  member: InterfaceMember,
  id: string,
  parent: string,
  depth: number,
  flags: boolean,
  state: TableState,
): string {
  const hasChildren = member.children.length > 0;
  // FB interfaces start fully collapsed (hidden rows); data blocks show their top level, nested rows start collapsed
  const hidden = state.db ? depth > 1 : true;
  // struct, array and UDT rows start collapsed (their children are hidden), as in TIA
  const caretClass = hasChildren ? 'caret collapsed' : 'caret';
  const caret = hasChildren ? `<span class="${caretClass}" data-toggle="${id}">▾</span>` : '<span class="caret none"></span>';
  const start = member.startIsDefault ? ' class="start default"' : ' class="start"';
  const retain = state.db
    ? check(member.retainChecked ?? false, flags)
    : `<td>${escapeHtml(member.retain)}</td>`;
  const supervision = state.db ? '<td></td>' : '';
  // TIA numbers the visible rows only; rows that start hidden are numbered by viewer.js when they are shown
  if (!hidden) {
    state.row++;
  }
  const row =
    `<tr${hidden ? ' class="hidden"' : ''} data-id="${id}" data-parent="${parent}"><td class="rownum">${hidden ? '' : state.row}</td>` +
    `<td class="name" data-depth="${depth}">${caret}${escapeHtml(member.name)}</td>` +
    `<td>${escapeHtml(member.datatype)}</td><td${start}>${escapeHtml(member.startValue)}</td>${retain}` +
    `${check(member.accessible, flags)}${check(member.writable, flags)}${check(member.visible, flags)}${check(member.setpoint, flags)}` +
    `${supervision}<td>${escapeHtml(member.comment)}</td></tr>`;
  const children = member.children
    .map((c, i) => memberRows(c, `${id}.${i}`, id, depth + 1, flags, state))
    .join('');
  return row + children;
}

function sectionRows(section: InterfaceSection, index: number, state: TableState): string {
  const id = `s${index}`;
  const flags = !['Temp', 'Constant', 'Return'].includes(section.name);
  state.row++;
  const caretClass = state.db ? 'caret' : 'caret collapsed';
  const header =
    `<tr class="section" data-id="${id}" data-parent=""><td class="rownum">${state.row}</td>` +
    `<td colspan="${state.columns - 1}"><span class="${caretClass}" data-toggle="${id}">▾</span>${escapeHtml(section.name)}</td></tr>`;
  return header + section.members.map((m, i) => memberRows(m, `${id}.${i}`, id, 1, flags, state)).join('');
}

function interfaceTable(sections: InterfaceSection[], db: boolean): string {
  const columns = db ? DB_COLUMNS : FB_COLUMNS;
  const state: TableState = { db, columns: columns.length, row: 0 };
  const head = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  return (
    `<table class="interface"><thead><tr>${head}</tr></thead><tbody>` +
    sections.map((s, i) => sectionRows(s, i, state)).join('') +
    '</tbody></table>'
  );
}

function networkBody(network: NetworkModel): string {
  const { body } = network;
  switch (body.kind) {
    case 'lad':
      return `<div class="scroll">${sceneToSvg(body.scene)}</div>`;
    case 'text':
      return `<pre class="code lang-${escapeHtml(body.language.toLowerCase())}">${escapeHtml(body.lines.join('\n'))}</pre>`;
    case 'empty':
      return '<div class="empty">(empty network)</div>';
  }
}

function networkSection(network: NetworkModel): string {
  const title = network.title ? `: ${escapeHtml(network.title)}` : ':';
  const comment = network.comment ? `<div class="comment">${escapeHtml(network.comment)}</div>` : '';
  return (
    `<section class="network" id="n${network.index}">` +
    `<h2 data-toggle-network><span class="caret">▾</span>Network ${network.index}${title}` +
    `<span class="lang">${escapeHtml(network.language)}</span></h2>` +
    `<div class="network-body">${comment}${networkBody(network)}</div></section>`
  );
}

function headerProps(model: BlockModel): string {
  const info = model.dataBlock;
  if (model.kind !== 'DB' || !info) {
    return `<span>Language: ${escapeHtml(model.language)}</span><span>Memory: ${escapeHtml(model.memoryLayout)}</span>`;
  }
  const fields: Array<[string, string]> = [
    ['Optimized block access', info.optimizedAccess ? 'Yes' : 'No'],
    ['Version', info.version],
    ['Author', info.author],
    ['Family', info.family],
  ];
  return fields
    .filter(([, value]) => value !== '')
    .map(([label, value]) => `<span>${escapeHtml(label)}: ${escapeHtml(value)}</span>`)
    .join('');
}

function interfaceBlock(model: BlockModel): string {
  const instanceOf = model.dataBlock?.instanceOf ?? '';
  if (model.kind === 'DB' && instanceOf !== '') {
    return `<p class="notice">Instance data block of <strong>"${escapeHtml(instanceOf)}"</strong></p>`;
  }
  if (model.kind === 'DB' && model.sections.length === 0) {
    return '<p class="notice">This data block declares no variables.</p>';
  }
  return interfaceTable(model.sections, model.kind === 'DB');
}

function titleBlock(model: BlockModel): string {
  if ((model.kind === 'DB' || model.code) && model.title === '') {
    return '';
  }
  const comment = model.comment ? `<div class="comment">${escapeHtml(model.comment)}</div>` : '';
  return `<section class="block-title"><h2><span class="label">Block title:</span> ${escapeHtml(model.title)}</h2>${comment}</section>`;
}

/** Renders the whole block view (interface table, block title, networks) as an HTML document. */
export function renderBlockHtml(model: BlockModel, assets: HtmlAssets): string {
  const csp =
    `default-src 'none'; style-src ${assets.cspSource}; script-src 'nonce-${assets.nonce}'; img-src ${assets.cspSource} data:;`;
  const zoom =
    model.networks.length > 0
      ? '<label class="zoom">Zoom <input id="zoom" type="range" min="50" max="200" step="10" value="100"><output id="zoom-out">100%</output></label>'
      : '';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${assets.styleUri}">
<title>${escapeHtml(model.name)}</title></head>
<body>
<header class="block-head"><h1>${escapeHtml(model.name)} <span class="kind">[${escapeHtml(model.kind)}${escapeHtml(model.number)}]</span></h1>
<div class="props">${headerProps(model)}${zoom}</div></header>
${interfaceBlock(model)}
${titleBlock(model)}
${model.code ? renderCode(model.code) : ''}
${model.networks.map(networkSection).join('\n')}
<script nonce="${assets.nonce}" src="${assets.scriptUri}"></script>
</body></html>`;
}

/** Page shown when the file is not a TIA block export, or could not be parsed. */
export function renderMessageHtml(message: string, assets: HtmlAssets): string {
  const csp = `default-src 'none'; style-src ${assets.cspSource};`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${assets.styleUri}"><title>TIA Block View</title></head>
<body><p class="message">${escapeHtml(message)}</p></body></html>`;
}
