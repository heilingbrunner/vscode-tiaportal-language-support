import { describe, expect, it } from 'vitest';
import { renderSearchHtml } from '../../src/render/searchHtml';

const assets = { cspSource: 'vscode-resource:', nonce: 'abc123', styleUri: 'media/search.css', scriptUri: 'media/search.js' };
const html = renderSearchHtml(assets);

describe('renderSearchHtml', () => {
  it('only allows the script that carries its nonce, and no inline style', () => {
    expect(html).toContain("script-src 'nonce-abc123'");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('<script nonce="abc123" src="media/search.js"></script>');
    expect(html).not.toMatch(/<script(?![^>]*src=)/);
    expect(html).not.toMatch(/\sstyle=/);
  });

  it('has the form fields of the TIA search', () => {
    for (const id of ['term', 'folder', 'exact', 'start', 'stop', 'browse', 'summary', 'limit-tree', 'results']) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('Search for:');
    expect(html).toContain('Search in:');
    expect(html).toContain('Find exact match');
    expect(html).toContain('Start search');
    expect(html).toContain('Limit search to:');
    expect(html).toContain('Search result');
    expect(html).toContain('Path');
  });

  it('labels every input', () => {
    expect(html).toContain('for="term"');
    expect(html).toContain('for="folder"');
  });
});
