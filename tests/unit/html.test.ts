import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseBlock } from '../../src/parser/blockParser';
import { renderBlockHtml } from '../../src/render/html';

const root = fileURLToPath(new URL('../..', import.meta.url));
const assets = { cspSource: 'csp', nonce: 'n', styleUri: 'style.css', scriptUri: 'viewer.js' };

describe('interface table', () => {
  const block = parseBlock(readFileSync(join(root, 'fixtures', 'boxes.xml'), 'utf-8'), 'de-DE')!;
  const filled = block.sections[0]!;
  const html = renderBlockHtml(
    { ...block, sections: [filled, { name: 'Output', members: [] }, { name: 'InOut', members: [] }] },
    assets,
  );
  const rows = [...html.matchAll(/<tr class="section([^"]*)"[^>]*>.*?<\/tr>/g)];

  it('marks sections without members as empty, so they can be shown in normal font weight', () => {
    expect(rows).toHaveLength(3);
    expect(rows[0]![1]).not.toContain('empty');
    expect(rows[1]![1]).toContain('empty');
    expect(rows[2]![1]).toContain('empty');
  });
});
