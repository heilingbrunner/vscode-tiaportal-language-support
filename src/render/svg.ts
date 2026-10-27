import type { LadScene, SceneItem } from '../layout/scene';

const HALF_SYMBOL = 10;
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

function renderItem(item: SceneItem): string {
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
  const { cx, y } = item;
  const left = `M${num(cx - 4)},${num(y - SYMBOL_HEIGHT)} Q${num(cx - 13)},${num(y)} ${num(cx - 4)},${num(y + SYMBOL_HEIGHT)}`;
  const right = `M${num(cx + 4)},${num(y - SYMBOL_HEIGHT)} Q${num(cx + 13)},${num(y)} ${num(cx + 4)},${num(y + SYMBOL_HEIGHT)}`;
  const mark = item.mark
    ? `<text class="mark" x="${num(cx)}" y="${num(y + 4)}" text-anchor="middle">${escapeHtml(item.mark)}</text>`
    : '';
  return `<path class="sym" d="${left}"/><path class="sym" d="${right}"/>${mark}`;
}

/** Renders a LAD scene as an inline SVG string (all text is escaped). */
export function sceneToSvg(scene: LadScene): string {
  const w = Math.ceil(scene.width);
  const h = Math.ceil(scene.height);
  return (
    `<svg class="lad" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" data-w="${w}" data-h="${h}">` +
    scene.items.map(renderItem).join('') +
    '</svg>'
  );
}
