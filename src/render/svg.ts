import { textWidth } from '../layout/nodes';
import type { LadScene, SceneItem } from '../layout/scene';

const HALF_SYMBOL = 10;
const LABEL_H = 20;
const SYMBOL_HEIGHT = 11;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const num = (n: number): string => String(Math.round(n * 10) / 10);

/** Highlight rectangle behind a changed text or symbol (lines and boxes are recoloured by CSS only). */
function diffBackground(item: SceneItem): string {
  const rect = (x: number, y: number, w: number, h: number): string =>
    `<rect class="diff-bg" x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="2"/>`;
  switch (item.t) {
    case 'text': {
      const w = textWidth(item.s) + 6;
      const x = item.anchor === 'start' ? item.x - 3 : item.anchor === 'middle' ? item.x - w / 2 : item.x - w + 3;
      return rect(x, item.y - 12, w, 16);
    }
    case 'contact':
    case 'coil':
      return rect(item.cx - HALF_SYMBOL - 6, item.y - SYMBOL_HEIGHT - 3, 2 * HALF_SYMBOL + 12, 2 * SYMBOL_HEIGHT + 6);
    default:
      return '';
  }
}

function renderItem(item: SceneItem): string {
  const svg = renderShape(item);
  return item.diff ? `<g class="diff-${item.diff}">${diffBackground(item)}${svg}</g>` : svg;
}

function renderShape(item: SceneItem): string {
  switch (item.t) {
    case 'line':
      return `<polyline class="${item.cls}" points="${item.pts.map(([x, y]) => `${num(x)},${num(y)}`).join(' ')}"/>`;
    case 'text':
      return `<text class="${item.cls}" x="${num(item.x)}" y="${num(item.y)}" text-anchor="${item.anchor}">${escapeHtml(item.s)}</text>`;
    case 'box':
      return (
        `<rect class="box" x="${num(item.x)}" y="${num(item.y)}" width="${num(item.w)}" height="${num(item.h)}"/>` +
        `<rect class="boxhead" x="${num(item.x)}" y="${num(item.y)}" width="${num(item.w)}" height="${item.headH}"/>`
      );
    case 'contact':
      return renderContact(item);
    case 'coil':
      return renderCoil(item);
    case 'bubble':
      return `<circle class="bubble" cx="${num(item.x)}" cy="${num(item.y)}" r="3.5"/>`;
  }
}

function renderContact(item: Extract<SceneItem, { t: 'contact' }>): string {
  const { cx, y } = item;
  const bars =
    `<line class="sym" x1="${num(cx - HALF_SYMBOL)}" y1="${num(y - SYMBOL_HEIGHT)}" x2="${num(cx - HALF_SYMBOL)}" y2="${num(y + SYMBOL_HEIGHT)}"/>` +
    `<line class="sym" x1="${num(cx + HALF_SYMBOL)}" y1="${num(y - SYMBOL_HEIGHT)}" x2="${num(cx + HALF_SYMBOL)}" y2="${num(y + SYMBOL_HEIGHT)}"/>`;
  const slash = item.negated
    ? `<line class="sym" x1="${num(cx - 6)}" y1="${num(y + 8)}" x2="${num(cx + 6)}" y2="${num(y - 8)}"/>`
    : '';
  const edge = item.edge
    ? `<text class="mark" x="${num(cx)}" y="${num(y + 4)}" text-anchor="middle">${item.edge}</text>`
    : '';
  return bars + slash + edge;
}

function renderCoil(item: Extract<SceneItem, { t: 'coil' }>): string {
  const { cx, y, half } = item;
  const inner = half - 6;
  const outer = half + 3;
  const left = `M${num(cx - inner)},${num(y - SYMBOL_HEIGHT)} Q${num(cx - outer)},${num(y)} ${num(cx - inner)},${num(y + SYMBOL_HEIGHT)}`;
  const right = `M${num(cx + inner)},${num(y - SYMBOL_HEIGHT)} Q${num(cx + outer)},${num(y)} ${num(cx + inner)},${num(y + SYMBOL_HEIGHT)}`;
  const mark = item.mark
    ? `<text class="mark" x="${num(cx)}" y="${num(y + 4)}" text-anchor="middle">${escapeHtml(item.mark)}</text>`
    : '';
  return `<path class="sym" d="${left}"/><path class="sym" d="${right}"/>${mark}`;
}

/** Renders a LAD scene as an inline SVG string (all text is escaped). */
export function sceneToSvg(scene: LadScene): string {
  const labels = scene.labels ?? [];
  const top = labels.length * LABEL_H;
  const w = Math.ceil(scene.width);
  const h = Math.ceil(scene.height) + top;
  const labelText = labels
    .map((l, i) => `<text class="label" x="6" y="${num(i * LABEL_H + 13)}">${escapeHtml(l)}</text>`)
    .join('');
  const body = scene.items.map(renderItem).join('');
  return (
    `<svg class="lad" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" data-w="${w}" data-h="${h}">` +
    labelText +
    (top ? `<g transform="translate(0,${top})">${body}</g>` : body) +
    '</svg>'
  );
}
