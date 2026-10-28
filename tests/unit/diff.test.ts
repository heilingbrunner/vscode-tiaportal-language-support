import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { alignSequences } from '../../src/diff/align';
import { diffModels } from '../../src/diff/modelDiff';
import type { SceneItem } from '../../src/layout/scene';
import type { BlockModel, NetworkModel } from '../../src/model/types';
import { parseBlock } from '../../src/parser/blockParser';
import { renderBlockHtml } from '../../src/render/html';

const root = fileURLToPath(new URL('../..', import.meta.url));
const assets = { cspSource: 'csp', nonce: 'n', styleUri: 'style.css', scriptUri: 'viewer.js' };
const block = parseBlock(readFileSync(join(root, 'fixtures', 'boxes.xml'), 'utf-8'), 'de-DE')!;

const ladItems = (model: BlockModel, network = 0): SceneItem[] => {
  const body = model.networks[network]!.body;
  return body.kind === 'lad' ? body.scene.items : [];
};

/** Copy of `model` whose text items reading `from` read `to` instead. */
function withChangedText(model: BlockModel, from: string, to: string): BlockModel {
  const networks = model.networks.map((n): NetworkModel => {
    if (n.body.kind !== 'lad') {
      return n;
    }
    const items = n.body.scene.items.map((i) => (i.t === 'text' && i.s === from ? { ...i, s: to } : i));
    return { ...n, body: { ...n.body, scene: { ...n.body.scene, items } } };
  });
  return { ...model, networks };
}

describe('alignSequences', () => {
  it('pairs equal entries and leaves inserted and removed ones out', () => {
    expect(alignSequences(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd', 'e'])).toEqual([
      [0, 0],
      [2, 2],
      [3, 3],
    ]);
  });

  it('returns nothing for completely different sequences', () => {
    expect(alignSequences(['a'], ['b'])).toEqual([]);
  });
});

describe('diffModels', () => {
  const firstText = ladItems(block).find((i) => i.t === 'text' && i.cls === 'operand');
  const original = firstText?.t === 'text' ? firstText.s : '';

  it('marks nothing when both versions are identical', () => {
    const { oldModel, newModel } = diffModels(block, block);
    expect(ladItems(oldModel).some((i) => i.diff)).toBe(false);
    expect(ladItems(newModel).some((i) => i.diff)).toBe(false);
    expect(oldModel.networks.some((n) => n.diff)).toBe(false);
  });

  it('marks a changed LAD operand red in the old and green in the new version', () => {
    expect(original).not.toBe('');
    const changed = withChangedText(block, original, 'CHANGED_OPERAND');
    const { oldModel, newModel } = diffModels(block, changed);
    const oldMarked = ladItems(oldModel).filter((i) => i.diff);
    const newMarked = ladItems(newModel).filter((i) => i.diff);
    expect(oldMarked.map((i) => i.diff)).toEqual(['del']);
    expect(newMarked.map((i) => i.diff)).toEqual(['add']);
    expect(oldMarked[0]).toMatchObject({ t: 'text', s: original });
    expect(newMarked[0]).toMatchObject({ t: 'text', s: 'CHANGED_OPERAND' });
    expect(oldModel.networks[0]!.diff).toBe('del');
    expect(newModel.networks[0]!.diff).toBe('add');
  });

  it('does not mutate its inputs', () => {
    const changed = withChangedText(block, original, 'CHANGED_OPERAND');
    diffModels(block, changed);
    expect(ladItems(block).some((i) => i.diff)).toBe(false);
    expect(ladItems(changed).some((i) => i.diff)).toBe(false);
  });

  it('marks a changed member cell and flags its section', () => {
    const [section, ...rest] = block.sections;
    const member = section!.members[0]!;
    const edited: BlockModel = {
      ...block,
      sections: [{ ...section!, members: [{ ...member, datatype: 'LReal' }, ...section!.members.slice(1)] }, ...rest],
    };
    const { oldModel, newModel } = diffModels(block, edited);
    expect(oldModel.sections[0]!.members[0]!.diff).toEqual({ mark: 'del', fields: ['datatype'] });
    expect(newModel.sections[0]!.members[0]!.diff).toEqual({ mark: 'add', fields: ['datatype'] });
    expect(newModel.sections[0]!.diffInside).toBe('add');
  });

  it('marks an added member as a whole row, only in the new version', () => {
    const [section, ...rest] = block.sections;
    const added = { ...section!.members[0]!, name: 'BrandNew' };
    const edited: BlockModel = { ...block, sections: [{ ...section!, members: [...section!.members, added] }, ...rest] };
    const { oldModel, newModel } = diffModels(block, edited);
    expect(newModel.sections[0]!.members.at(-1)!.diff).toEqual({ mark: 'add' });
    expect(oldModel.sections[0]!.members.some((m) => m.diff)).toBe(false);
  });

  it('marks changed source lines in both versions', () => {
    const base: BlockModel = { ...block, networks: [], code: { lines: ['a', 'b', 'c'], regions: [], folds: [] } };
    const edited: BlockModel = { ...base, code: { lines: ['a', 'B', 'c', 'd'], regions: [], folds: [] } };
    const { oldModel, newModel } = diffModels(base, edited);
    expect(oldModel.code!.lineMarks).toEqual([undefined, 'del', undefined]);
    expect(newModel.code!.lineMarks).toEqual([undefined, 'add', undefined, 'add']);
  });

  it('marks networks that exist in one version only', () => {
    const extra: NetworkModel = {
      index: 9,
      title: 'Extra',
      comment: '',
      language: 'SCL',
      body: { kind: 'text', language: 'SCL', lines: ['x := 1;'] },
    };
    const { oldModel, newModel } = diffModels(block, { ...block, networks: [...block.networks, extra] });
    expect(oldModel.networks.some((n) => n.diff)).toBe(false);
    expect(newModel.networks.at(-1)!.diff).toBe('add');
  });
});

describe('rendering a comparison', () => {
  it('renders the marks as diff classes and leaves unmarked pages without any', () => {
    const firstText = ladItems(block).find((i) => i.t === 'text' && i.cls === 'operand');
    const original = firstText?.t === 'text' ? firstText.s : '';
    const { oldModel, newModel } = diffModels(block, withChangedText(block, original, 'CHANGED_OPERAND'));
    const oldHtml = renderBlockHtml(oldModel, assets);
    const newHtml = renderBlockHtml(newModel, assets);
    expect(oldHtml).toContain('<g class="diff-del">');
    expect(newHtml).toContain('<g class="diff-add">');
    expect(oldHtml).toContain('net-diff-del');
    expect(renderBlockHtml(block, assets)).not.toMatch(/diff-(add|del)/);
  });
});
