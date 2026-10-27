import { layoutLad } from '../layout/ladLayout';
import type { BlockKind, BlockModel, NetworkBody, NetworkModel } from '../model/types';
import { parseFlgNet } from './flgNetParser';
import { parseInterface } from './interfaceParser';
import { renderStatementList, renderStructuredText } from './textNetwork';
import { attributeOf, child, childrenNamed, parseXml, type XNode } from './xml';

const BLOCK_NODE = /^SW\.Blocks\.(FB|FC|OB)$/;

/** Picks the text of a `MultilingualText` for `culture`, else the first non-empty item. */
function pickText(objectList: XNode | undefined, composition: string, culture: string): string {
  const text = objectList?.children.find(
    (c) => c.name === 'MultilingualText' && c.attrs.CompositionName === composition,
  );
  const items = childrenNamed(child(text, 'ObjectList'), 'MultilingualTextItem').map((item) => ({
    culture: attributeOf(item, 'Culture') ?? '',
    text: attributeOf(item, 'Text') ?? '',
  }));
  return (items.find((i) => i.culture === culture && i.text) ?? items.find((i) => i.text))?.text ?? '';
}

function parseBody(source: XNode | undefined): NetworkBody {
  switch (source?.name) {
    case 'FlgNet': {
      const net = parseFlgNet(source);
      return net.parts.size === 0 ? { kind: 'empty' } : { kind: 'lad', scene: layoutLad(net) };
    }
    case 'StatementList':
      return { kind: 'code', language: 'STL', lines: renderStatementList(source) };
    case 'StructuredText':
      return { kind: 'code', language: 'SCL', lines: renderStructuredText(source) };
    default:
      return { kind: 'empty' };
  }
}

function parseNetwork(unit: XNode, index: number, culture: string): NetworkModel {
  const objectList = child(unit, 'ObjectList');
  const source = child(child(child(unit, 'AttributeList'), 'NetworkSource'), 'FlgNet')
    ?? child(child(unit, 'AttributeList'), 'NetworkSource')?.children[0];
  let body: NetworkBody;
  try {
    body = parseBody(source);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown error';
    body = { kind: 'text', language: 'error', lines: [`Network could not be rendered: ${message}`] };
  }
  return {
    index,
    title: pickText(objectList, 'Title', culture),
    comment: pickText(objectList, 'Comment', culture),
    language: attributeOf(unit, 'ProgrammingLanguage') ?? '',
    body,
  };
}

/**
 * Parses a TIA Openness block export (FB/FC/OB) into a view model.
 * Returns `undefined` when the XML is not such a block; throws on malformed XML.
 */
export function parseBlock(source: string, culture: string): BlockModel | undefined {
  const root = parseXml(source);
  const block = root.children.find((c) => BLOCK_NODE.test(c.name));
  if (!block) {
    return undefined;
  }
  const objectList = child(block, 'ObjectList');
  return {
    kind: block.name.slice('SW.Blocks.'.length) as BlockKind,
    name: attributeOf(block, 'Name') ?? '',
    number: attributeOf(block, 'Number') ?? '',
    language: attributeOf(block, 'ProgrammingLanguage') ?? '',
    memoryLayout: attributeOf(block, 'MemoryLayout') ?? '',
    title: pickText(objectList, 'Title', culture),
    comment: pickText(objectList, 'Comment', culture),
    sections: parseInterface(block, culture),
    networks: childrenNamed(objectList, 'SW.Blocks.CompileUnit').map((unit, i) =>
      parseNetwork(unit, i + 1, culture),
    ),
  };
}
