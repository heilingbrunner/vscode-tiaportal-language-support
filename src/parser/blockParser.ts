import { layoutLad } from '../layout/ladLayout';
import type { BlockKind, BlockModel, NetworkBody, NetworkModel } from '../model/types';
import { parseFlgNet } from './flgNetParser';
import { parseInterface } from './interfaceParser';
import { displayLanguage, parseLanguage } from './languages';
import { renderStatementList, renderStructuredText } from './textNetwork';
import { attributeOf, child, childrenNamed, parseXml, pickText, type XNode } from './xml';

const BLOCK_NODE = /^SW\.Blocks\.(FB|FC|OB)$/;

function parseBody(source: XNode | undefined, language: string): NetworkBody {
  switch (source?.name) {
    case 'FlgNet': {
      const parsed = parseFlgNet(source);
      const net = language === 'FBD' ? { ...parsed, fbd: true } : parsed;
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
  // F_LAD / F_FBD are drawn like LAD / FBD; only the name shown differs
  const language = parseLanguage(attributeOf(unit, 'ProgrammingLanguage') ?? '');
  let body: NetworkBody;
  try {
    body = parseBody(source, language.base);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown error';
    body = { kind: 'text', language: 'error', lines: [`Network could not be rendered: ${message}`] };
  }
  return {
    index,
    title: pickText(objectList, 'Title', culture),
    comment: pickText(objectList, 'Comment', culture),
    language: displayLanguage(language),
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
    language: displayLanguage(parseLanguage(attributeOf(block, 'ProgrammingLanguage') ?? '')),
    memoryLayout: attributeOf(block, 'MemoryLayout') ?? '',
    title: pickText(objectList, 'Title', culture),
    comment: pickText(objectList, 'Comment', culture),
    sections: parseInterface(block, culture),
    networks: childrenNamed(objectList, 'SW.Blocks.CompileUnit').map((unit, i) =>
      parseNetwork(unit, i + 1, culture),
    ),
  };
}
