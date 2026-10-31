import type { HtmlAssets } from './html';

/**
 * The page of the "Search in project" view: the search form, the "Limit search to" tree and the result tree, laid
 * out like TIA Portal's. The trees are built by media/search.js from the messages of the extension, so this page is
 * static and carries no search data.
 */
export function renderSearchHtml(assets: HtmlAssets): string {
  const csp = `default-src 'none'; style-src ${assets.cspSource}; script-src 'nonce-${assets.nonce}';`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${assets.styleUri}">
<title>Search in project</title></head>
<body>
<form id="search-form" class="search-box" autocomplete="off">
  <h1>Search</h1>
  <label class="field" for="term">Search for:</label>
  <input id="term" type="text" list="terms" spellcheck="false" autofocus>
  <label class="field" for="folder">Search in:</label>
  <div class="folder-row">
    <input id="folder" type="text" list="folders" spellcheck="false">
    <button type="button" id="browse" title="Choose a folder" aria-label="Choose a folder">…</button>
  </div>
  <label class="exact"><input type="checkbox" id="exact"> Find exact match</label>
  <div class="actions">
    <button type="submit" id="start" class="primary">Start search</button>
    <button type="button" id="stop" hidden>Stop</button>
  </div>
  <datalist id="terms"></datalist>
  <datalist id="folders"></datalist>
</form>
<div class="result-bar">
  <span id="summary" role="status" aria-live="polite">Result:</span>
  <progress id="progress" hidden></progress>
  <span class="spacer"></span>
  <button type="button" id="expand-all" class="link" disabled>Expand all</button>
  <button type="button" id="collapse-all" class="link" disabled>Collapse all</button>
</div>
<div class="body">
  <aside class="limit" aria-label="Limit search to">
    <h2>Limit search to:</h2>
    <div id="limit-tree"></div>
  </aside>
  <main class="result-pane">
    <div class="result-head" aria-hidden="true">
      <div class="cell">Search result<span id="col-grip" class="col-grip"></span></div>
      <div class="cell">Path</div>
    </div>
    <div id="results" role="tree" aria-label="Search result" tabindex="0"></div>
  </main>
</div>
<script nonce="${assets.nonce}" src="${assets.scriptUri}"></script>
</body></html>`;
}
