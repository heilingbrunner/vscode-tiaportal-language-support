import type { CodeInfo, CodeToken, Fold } from '../model/types';
import { escapeHtml } from './svg';

const MAX_OUTLINE_DEPTH = 6;

function lineHtml(text: string, tokens: CodeToken[] | undefined): string {
  if (!tokens) {
    return escapeHtml(text);
  }
  return tokens
    .map((t) => (t.cls ? `<span class="${escapeHtml(t.cls)}">${escapeHtml(t.text)}</span>` : escapeHtml(t.text)))
    .join('');
}

function outlineHtml(code: CodeInfo): string {
  if (code.regions.length === 0) {
    return '';
  }
  const items = code.regions
    .map(
      (r) =>
        `<button class="outline-item" data-line="${r.line}" data-depth="${Math.min(r.depth, MAX_OUTLINE_DEPTH)}">${escapeHtml(r.name || 'REGION')}</button>`,
    )
    .join('');
  return `<nav class="outline" aria-label="Regions">${items}</nav>`;
}

/**
 * Renders code as a line-numbered pane with fold toggles and a REGION outline.
 * `idPrefix` keeps line ids unique when a page holds several panes (one per network).
 */
export function renderCode(code: CodeInfo, idPrefix = ''): string {
  const foldAt = new Map<number, Fold>();
  for (const fold of code.folds) {
    // folds are sorted by start line, outermost first: keep the outermost one per line
    if (!foldAt.has(fold.from)) {
      foldAt.set(fold.from, fold);
    }
  }
  const rows = code.lines.map((text, i) => {
    const line = i + 1;
    const fold = foldAt.get(line);
    const toggle = fold
      ? `<span class="fold" data-from="${fold.from}" data-to="${fold.to}">▾</span>`
      : '<span class="fold none"></span>';
    // only the main code pane takes part in folding and the outline (they address lines by number)
    const lineAttr = idPrefix === '' ? ` data-line="${line}"` : '';
    const mark = code.lineMarks?.[i];
    const cls = mark ? `cl diff-${mark}` : 'cl';
    return `<div class="${cls}" id="${idPrefix}L${line}"${lineAttr}><span class="ln">${line}</span>${toggle}<span class="tx">${lineHtml(text, code.tokens?.[i])}</span></div>`;
  });
  const outline = outlineHtml(code);
  return `<section class="code-view${outline ? '' : ' no-outline'}">${outline}<div class="code-pane">${rows.join('')}</div></section>`;
}
