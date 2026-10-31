import { XMLParser } from 'fast-xml-parser';

/** Order-preserving, namespace-free view of an XML element. */
export interface XNode {
  name: string;
  attrs: Record<string, string>;
  children: XNode[];
  /** Concatenated direct text content, trimmed. */
  text: string;
  /** Concatenated direct text content exactly as written (leading blanks matter in code comments). */
  raw: string;
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseAttributeValue: false,
  parseTagValue: false,
  htmlEntities: false,
  processEntities: { enabled: true, maxTotalExpansions: 5_000_000, maxExpandedLength: 100_000 },
  trimValues: false,
});

const TEXT_KEY = '#text';
const ATTR_KEY = ':@';
const ATTR_PREFIX = '@_';

type RawNode = Record<string, unknown>;

function convert(raw: RawNode): XNode | undefined {
  const name = Object.keys(raw).find((k) => k !== ATTR_KEY);
  if (name === undefined || name === TEXT_KEY) {
    return undefined;
  }
  const attrs: Record<string, string> = {};
  const rawAttrs = raw[ATTR_KEY] as Record<string, unknown> | undefined;
  if (rawAttrs) {
    for (const [key, value] of Object.entries(rawAttrs)) {
      attrs[key.startsWith(ATTR_PREFIX) ? key.slice(ATTR_PREFIX.length) : key] = String(value);
    }
  }
  const children: XNode[] = [];
  let text = '';
  for (const child of (raw[name] as RawNode[]) ?? []) {
    if (TEXT_KEY in child) {
      text += String(child[TEXT_KEY]);
      continue;
    }
    const converted = convert(child);
    if (converted) {
      children.push(converted);
    }
  }
  return { name, attrs, children, text: text.trim(), raw: text };
}

/** Parses XML text into an ordered tree; returns the root element (e.g. `Document`). */
export function parseXml(source: string): XNode {
  const clean = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const roots = (parser.parse(clean) as RawNode[])
    .map(convert)
    .filter((n): n is XNode => n !== undefined && !n.name.startsWith('?') && !n.name.startsWith('!'));
  const root = roots[0];
  if (!root) {
    throw new Error('XML document has no root element');
  }
  return root;
}

export function child(node: XNode | undefined, name: string): XNode | undefined {
  return node?.children.find((c) => c.name === name);
}

export function childrenNamed(node: XNode | undefined, name: string): XNode[] {
  return node ? node.children.filter((c) => c.name === name) : [];
}

export function childText(node: XNode | undefined, name: string): string {
  return child(node, name)?.text ?? '';
}

/** Value of an `<AttributeList>` entry such as `<Name>`, `<Number>` or `<BooleanAttribute Name=..>`. */
export function attributeOf(node: XNode | undefined, name: string): string | undefined {
  const list = child(node, 'AttributeList');
  const direct = child(list, name);
  if (direct) {
    return direct.text;
  }
  return list?.children.find((c) => c.attrs.Name === name)?.text;
}

/** Picks the text of a `MultilingualText` for `culture`, else the first non-empty item. */
export function pickText(objectList: XNode | undefined, composition: string, culture: string): string {
  const text = objectList?.children.find(
    (c) => c.name === 'MultilingualText' && c.attrs.CompositionName === composition,
  );
  const items = childrenNamed(child(text, 'ObjectList'), 'MultilingualTextItem').map((item) => ({
    culture: attributeOf(item, 'Culture') ?? '',
    text: attributeOf(item, 'Text') ?? '',
  }));
  return (items.find((i) => i.culture === culture && i.text) ?? items.find((i) => i.text))?.text ?? '';
}
