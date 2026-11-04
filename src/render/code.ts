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

function outlineHtml(code: CodeInfo, side: boolean): string {
  if (code.regions.length === 0) {
    return '';
  }
  const items = code.regions
    .map(
      (r) =>
        `<button class="outline-item" data-line="${r.line}" data-depth="${Math.min(r.depth, MAX_OUTLINE_DEPTH)}">${escapeHtml(r.name || 'REGION')}</button>`,
    )
    .join('');
  return `<nav class="${side ? 'outline outline-side' : 'outline'}" aria-label="Regions">${items}</nav>`;
}

/** The code view and its REGION outline as separate pieces, for a page that gives the outline a panel of its own. */
export interface CodeParts {
  /** The outline navigation (empty when the code has no regions). */
  outline: string;
  /** The line-numbered code view, without the outline. */
  view: string;
}

/**
 * Renders code as a line-numbered pane with fold toggles and a REGION outline.
 * `idPrefix` keeps line ids unique when a page holds several panes (one per network).
 */
export function renderCode(code: CodeInfo, idPrefix = ''): string {
  const { outline, view } = renderCodeParts(code, idPrefix, false);
  return outline ? view.replace('<div class="code-pane', `${outline}<div class="code-pane`) : view;
}

/** Like `renderCode`, but returns the outline apart from the code view (marked as a side panel when `side`). */
export function renderCodeParts(code: CodeInfo, idPrefix = '', side = true): CodeParts {
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
    // the address column of an STL network (absolute addresses of the operands, like TIA Portal)
    const address = code.addresses ? `<span class="addr">${escapeHtml(code.addresses[i] ?? '')}</span>` : '';
    return `<div class="${cls}" id="${idPrefix}L${line}"${lineAttr}><span class="ln">${line}</span>${toggle}<span class="tx">${lineHtml(text, code.tokens?.[i])}</span>${address}</div>`;
  });
  const outline = outlineHtml(code, side);
  const paneClass = code.addresses ? 'code-pane has-addr' : 'code-pane';
  const view = `<section class="code-view${outline ? '' : ' no-outline'}"><div class="${paneClass}">${rows.join('')}</div></section>`;
  return { outline, view };
}
