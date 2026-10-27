import type { BlockModel, InterfaceMember, InterfaceSection, NetworkModel } from '../model/types';
import { escapeHtml, sceneToSvg } from './svg';

export interface HtmlAssets {
  cspSource: string;
  nonce: string;
  styleUri: string;
  scriptUri: string;
}

const COLUMNS = [
  'Name',
  'Data type',
  'Default value',
  'Retain',
  'Accessible from HMI/OPC UA',
  'Writable from HMI/OPC UA',
  'Visible in HMI engineering',
  'Setpoint',
  'Comment',
];

const check = (value: boolean, enabled: boolean): string =>
  `<td class="chk"><input type="checkbox" disabled${value ? ' checked' : ''}${enabled ? '' : ' class="off"'}></td>`;

function memberRows(
  member: InterfaceMember,
  id: string,
  parent: string,
  depth: number,
  flags: boolean,
): string {
  const hasChildren = member.children.length > 0;
  const caret = hasChildren ? `<span class="caret" data-toggle="${id}">▾</span>` : '<span class="caret none"></span>';
  const row =
    `<tr data-id="${id}" data-parent="${parent}"><td class="name" data-depth="${depth}">${caret}${escapeHtml(member.name)}</td>` +
    `<td>${escapeHtml(member.datatype)}</td><td>${escapeHtml(member.startValue)}</td><td>${escapeHtml(member.retain)}</td>` +
    `${check(member.accessible, flags)}${check(member.writable, flags)}${check(member.visible, flags)}${check(member.setpoint, flags)}` +
    `<td>${escapeHtml(member.comment)}</td></tr>`;
  const children = member.children
    .map((c, i) => memberRows(c, `${id}.${i}`, id, depth + 1, flags))
    .join('');
  return row + children;
}

function sectionRows(section: InterfaceSection, index: number): string {
  const id = `s${index}`;
  const flags = !['Temp', 'Constant', 'Return'].includes(section.name);
  const header =
    `<tr class="section" data-id="${id}" data-parent=""><td colspan="${COLUMNS.length}">` +
    `<span class="caret" data-toggle="${id}">▾</span>${escapeHtml(section.name)}</td></tr>`;
  return header + section.members.map((m, i) => memberRows(m, `${id}.${i}`, id, 1, flags)).join('');
}

function interfaceTable(sections: InterfaceSection[]): string {
  const head = COLUMNS.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  return (
    `<table class="interface"><thead><tr>${head}</tr></thead><tbody>` +
    sections.map(sectionRows).join('') +
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

/** Renders the whole block view (interface table, block title, networks) as an HTML document. */
export function renderBlockHtml(model: BlockModel, assets: HtmlAssets): string {
  const csp =
    `default-src 'none'; style-src ${assets.cspSource}; script-src 'nonce-${assets.nonce}'; img-src ${assets.cspSource} data:;`;
  const blockComment = model.comment ? `<div class="comment">${escapeHtml(model.comment)}</div>` : '';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${assets.styleUri}">
<title>${escapeHtml(model.name)}</title></head>
<body>
<header class="block-head"><h1>${escapeHtml(model.name)} <span class="kind">[${escapeHtml(model.kind)}${escapeHtml(model.number)}]</span></h1>
<div class="props"><span>Language: ${escapeHtml(model.language)}</span><span>Memory: ${escapeHtml(model.memoryLayout)}</span>
<label class="zoom">Zoom <input id="zoom" type="range" min="50" max="200" step="10" value="100"><output id="zoom-out">100%</output></label></div></header>
${interfaceTable(model.sections)}
<section class="block-title"><h2><span class="label">Block title:</span> ${escapeHtml(model.title)}</h2>${blockComment}</section>
${model.networks.map(networkSection).join('\n')}
<script nonce="${assets.nonce}" src="${assets.scriptUri}"></script>
</body></html>`;
}

/** Page shown when the XML is not a TIA block export, or could not be parsed. */
export function renderMessageHtml(message: string, assets: HtmlAssets): string {
  const csp = `default-src 'none'; style-src ${assets.cspSource};`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${assets.styleUri}"><title>TIA Block View</title></head>
<body><p class="message">${escapeHtml(message)}</p></body></html>`;
}
