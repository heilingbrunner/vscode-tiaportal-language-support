import type { DiffMark } from '../model/diff';
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
/** A user-defined type has default values, but neither a retain setting nor sections. */
const UDT_COLUMNS = ['#', 'Name', 'Data type', 'Default value', ...FLAG_COLUMNS, 'Supervision', 'Comment'];

type TableKind = 'block' | 'db' | 'udt';

/** Row numbering and layout options shared by all rows of one interface table. */
interface TableState {
  /** Data blocks and types: top level rows are shown and there is a Supervision column. */
  db: boolean;
  udt: boolean;
  columns: number;
  row: number;
}

const classAttr = (...names: string[]): string => {
  const joined = names.filter(Boolean).join(' ');
  return joined ? ` class="${joined}"` : '';
};

/** Cell class for a member whose own cells (not the whole row) differ between the two versions. */
const cellDiff = (member: InterfaceMember, field: string): string =>
  member.diff?.fields?.includes(field) ? `diff-${member.diff.mark}` : '';

/** Wraps already escaped HTML in a coloured span when it differs between the two versions. */
const diffSpan = (mark: DiffMark | undefined, html: string): string => (mark ? `<span class="diff-${mark}">${html}</span>` : html);

const check = (value: boolean, enabled: boolean, diff = ''): string =>
  `<td${classAttr('chk', diff)}><input type="checkbox" disabled${value ? ' checked' : ''}${enabled ? '' : ' class="off"'}></td>`;

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
  const start = classAttr('start', member.startIsDefault ? 'default' : '', cellDiff(member, 'start'));
  const retain = state.udt
    ? ''
    : state.db
      ? check(member.retainChecked ?? false, flags, cellDiff(member, 'retain'))
      : `<td${classAttr(cellDiff(member, 'retain'))}>${escapeHtml(member.retain)}</td>`;
  const supervision = state.db ? '<td></td>' : '';
  // TIA numbers the visible rows only; rows that start hidden are numbered by viewer.js when they are shown
  if (!hidden) {
    state.row++;
  }
  const rowClass = classAttr(
    hidden ? 'hidden' : '',
    member.diff && !member.diff.fields ? `diff-${member.diff.mark}` : '',
    member.diffInside ? `has-diff-${member.diffInside}` : '',
  );
  const row =
    `<tr${rowClass} data-id="${id}" data-parent="${parent}"><td class="rownum">${hidden ? '' : state.row}</td>` +
    `<td class="name" data-depth="${depth}">${caret}${escapeHtml(member.name)}</td>` +
    `<td${classAttr(cellDiff(member, 'datatype'))}>${escapeHtml(member.datatype)}</td><td${start}>${escapeHtml(member.startValue)}</td>${retain}` +
    `${check(member.accessible, flags, cellDiff(member, 'accessible'))}${check(member.writable, flags, cellDiff(member, 'writable'))}` +
    `${check(member.visible, flags, cellDiff(member, 'visible'))}${check(member.setpoint, flags, cellDiff(member, 'setpoint'))}` +
    `${supervision}<td${classAttr(cellDiff(member, 'comment'))}>${escapeHtml(member.comment)}</td></tr>`;
  const children = member.children
    .map((c, i) => memberRows(c, `${id}.${i}`, id, depth + 1, flags, state))
    .join('');
  return row + children;
}

function sectionRows(section: InterfaceSection, index: number, state: TableState): string {
  const id = `s${index}`;
  const flags = !['Temp', 'Constant', 'Return'].includes(section.name);
  if (state.udt) {
    // TIA's type editor lists the members directly, without a section row
    return section.members.map((m, i) => memberRows(m, `${id}.${i}`, '', 1, flags, state)).join('');
  }
  state.row++;
  const caretClass = state.db ? 'caret' : 'caret collapsed';
  const rowClass = ['section', section.members.length === 0 ? 'empty' : '', section.diffInside ? `has-diff-${section.diffInside}` : '']
    .filter(Boolean)
    .join(' ');
  const header =
    `<tr class="${rowClass}" data-id="${id}" data-parent=""><td class="rownum">${state.row}</td>` +
    `<td colspan="${state.columns - 1}"><span class="${caretClass}" data-toggle="${id}">▾</span>${escapeHtml(section.name)}</td></tr>`;
  return header + section.members.map((m, i) => memberRows(m, `${id}.${i}`, id, 1, flags, state)).join('');
}

function interfaceTable(sections: InterfaceSection[], kind: TableKind): string {
  const columns = kind === 'db' ? DB_COLUMNS : kind === 'udt' ? UDT_COLUMNS : FB_COLUMNS;
  const state: TableState = { db: kind !== 'block', udt: kind === 'udt', columns: columns.length, row: 0 };
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
    case 'text': {
      const lines = body.lines.map((line, i) => {
        const mark = body.lineMarks?.[i];
        return mark ? `<span class="diff-line diff-${mark}">${escapeHtml(line) || ' '}</span>` : escapeHtml(line);
      });
      return `<pre class="code lang-${escapeHtml(body.language.toLowerCase())}">${lines.join('\n')}</pre>`;
    }
    case 'code':
      return renderCode(
        { lines: body.lines, regions: [], folds: [], tokens: body.tokens, lineMarks: body.lineMarks },
        `n${network.index}-`,
      );
    case 'empty':
      return '<div class="empty">(empty network)</div>';
  }
}

function networkSection(network: NetworkModel): string {
  const title = network.title ? `: ${diffSpan(network.titleDiff, escapeHtml(network.title))}` : ':';
  const comment = network.comment ? `<div class="comment">${diffSpan(network.commentDiff, escapeHtml(network.comment))}</div>` : '';
  return (
    `<section${classAttr('network', network.diff ? `net-diff-${network.diff}` : '')} id="n${network.index}">` +
    `<h2 data-toggle-network><span class="caret">▾</span>Network ${network.index}${title}` +
    `<span class="lang">${escapeHtml(network.language)}</span></h2>` +
    `<div class="network-body">${comment}${networkBody(network)}</div></section>`
  );
}

function headerProps(model: BlockModel): string {
  if (model.kind === 'UDT') {
    const version = model.typeInfo?.version ?? '';
    return version === '' ? '' : `<span>Version: ${escapeHtml(version)}</span>`;
  }
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
  if (model.kind === 'UDT') {
    return model.sections.every((s) => s.members.length === 0)
      ? '<p class="notice">This data type declares no members.</p>'
      : interfaceTable(model.sections, 'udt');
  }
  return interfaceTable(model.sections, model.kind === 'DB' ? 'db' : 'block');
}

function titleBlock(model: BlockModel): string {
  if ((model.kind === 'DB' || model.kind === 'UDT' || model.code) && model.title === '') {
    return '';
  }
  const comment = model.comment ? `<div class="comment">${diffSpan(model.commentDiff, escapeHtml(model.comment))}</div>` : '';
  const title = diffSpan(model.titleDiff, escapeHtml(model.title));
  return `<section class="block-title"><h2><span class="label">Block title:</span> ${title}</h2>${comment}</section>`;
}

/** Renders the whole viewer page (interface table, block title, networks) as an HTML document. */
export function renderBlockHtml(model: BlockModel, assets: HtmlAssets): string {
  const csp =
    `default-src 'none'; style-src ${assets.cspSource}; script-src 'nonce-${assets.nonce}'; img-src ${assets.cspSource} data:;`;
  const zoom =
    model.networks.some((n) => n.body.kind === 'lad')
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
<link rel="stylesheet" href="${assets.styleUri}"><title>TIA Viewer</title></head>
<body><p class="message">${escapeHtml(message)}</p></body></html>`;
}
