import { XMLValidator } from 'fast-xml-parser';
import type { RowDiff } from './tagTableParser';
import { child, childrenNamed, childText, parseXml, type XNode } from './xml';

/** Metadata of the tool that wrote the file (`AdditionalInformation/WriterHeader`) and the CAEX schema version. */
export interface AmlHeader {
  writerName: string;
  writerVendor: string;
  writerVersion: string;
  writerRelease: string;
  lastWritten: string;
  schemaVersion: string;
}

/** One `InternalElement` of the instance hierarchy (a project, device, device item, node, tag table ...). */
export interface AmlElement {
  id: string;
  name: string;
  /** Set by a version comparison; the fields are `name`, `roles`, `path` and `@<attribute name>`. */
  diff?: RowDiff;
  /** Names of the ancestors joined by ` / `; empty for a root element. */
  path: string;
  depth: number;
  parentId?: string;
  /** Last segment of each supported role class, for example `Device`, `DeviceItem`, `Node`. */
  roles: string[];
  /** Attribute values by name; a translated attribute (`aml-lang=..`) holds the text of the chosen culture. */
  attributes: Record<string, string>;
}

/** A PLC tag: an `ExternalInterface` whose base class is the TIA `Tag` interface. */
export interface AmlTag {
  table: string;
  /** Lower-cased id of the tag table element: it identifies the table when its name changes. */
  tableId: string;
  name: string;
  diff?: RowDiff;
  dataType: string;
  ioType: string;
  address: string;
  length: string;
  comment: string;
}

/** A connection between two interfaces, shown as the elements that own them. */
export interface AmlLink {
  name: string;
  diff?: RowDiff;
  from: string;
  to: string;
  /** Lower-cased id of the element at each end (the raw reference when the file does not contain it). */
  fromId: string;
  toId: string;
}

export interface AmlModel {
  fileName: string;
  header: AmlHeader;
  elements: AmlElement[];
  tags: AmlTag[];
  links: AmlLink[];
}

const LANG_PREFIX = 'aml-lang=';
const TAG_INTERFACE = 'AutomationProjectConfigurationInterfaceClassLib/Tag';

/** Cheap check that a text is a CAEX / AutomationML file before it is parsed. */
export const isAmlSource = (text: string): boolean => text.includes('<CAEXFile');

const lastSegment = (path: string | undefined): string => (path ?? '').split('/').pop() ?? '';

/**
 * Value of an `Attribute`: the translation of `culture` (case-insensitive; a language alone such as `de` also matches
 * `de-DE`) when there is one, else its own `<Value>`.
 */
function attributeValue(attribute: XNode, culture: string): string {
  const own = childText(attribute, 'Value');
  if (!culture) {
    return own;
  }
  const wanted = culture.toLowerCase();
  const language = wanted.split('-')[0];
  const translations = childrenNamed(attribute, 'Attribute')
    .filter((a) => a.attrs.Name?.startsWith(LANG_PREFIX))
    .map((a) => ({ culture: a.attrs.Name.slice(LANG_PREFIX.length).toLowerCase(), text: childText(a, 'Value') }))
    .filter((t) => t.text);
  const match = translations.find((t) => t.culture === wanted) ?? translations.find((t) => t.culture.split('-')[0] === language);
  return match?.text ?? own;
}

function readAttributes(node: XNode, culture: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const attribute of childrenNamed(node, 'Attribute')) {
    const name = attribute.attrs.Name;
    if (name && !name.startsWith(LANG_PREFIX)) {
      result[name] = attributeValue(attribute, culture);
    }
  }
  return result;
}

function readHeader(root: XNode): AmlHeader {
  const writer = child(
    childrenNamed(root, 'AdditionalInformation').find((info) => child(info, 'WriterHeader')),
    'WriterHeader',
  );
  return {
    writerName: childText(writer, 'WriterName'),
    writerVendor: childText(writer, 'WriterVendor'),
    writerVersion: childText(writer, 'WriterVersion'),
    writerRelease: childText(writer, 'WriterRelease'),
    lastWritten: childText(writer, 'LastWritingDateTime'),
    schemaVersion: root.attrs.SchemaVersion ?? '',
  };
}

/** What a walk of the hierarchy collects; filled in place while walking, never exposed half-built. */
interface Walk {
  culture: string;
  elements: AmlElement[];
  tags: AmlTag[];
  /** Lower-cased id of an element or of one of its `ExternalInterface`s -> that element. */
  idOwners: Map<string, { id: string; path: string }>;
  links: { name: string; from: string; to: string }[];
}

function readTag(table: string, tableId: string, node: XNode, culture: string): AmlTag {
  const attributes = readAttributes(node, culture);
  return {
    table,
    tableId: tableId.toLowerCase(),
    name: node.attrs.Name ?? '',
    dataType: attributes.DataType ?? '',
    ioType: attributes.IoType ?? '',
    address: attributes.LogicalAddress ?? '',
    length: attributes.Length ?? '',
    comment: attributes.Comment ?? '',
  };
}

function walkElement(node: XNode, path: string, depth: number, parentId: string | undefined, walk: Walk): void {
  const name = node.attrs.Name ?? '';
  const id = node.attrs.ID ?? '';
  const fullPath = path ? `${path} / ${name}` : name;
  walk.elements.push({
    id,
    name,
    path,
    depth,
    parentId,
    roles: childrenNamed(node, 'SupportedRoleClass').map((r) => lastSegment(r.attrs.RefRoleClassPath)),
    attributes: readAttributes(node, walk.culture),
  });
  rememberId(walk, id, { id, path: fullPath });
  for (const itf of childrenNamed(node, 'ExternalInterface')) {
    rememberId(walk, itf.attrs.ID, { id, path: fullPath });
    if (itf.attrs.RefBaseClassPath === TAG_INTERFACE) {
      walk.tags.push(readTag(name, id, itf, walk.culture));
    }
  }
  for (const inner of childrenNamed(node, 'InternalElement')) {
    walkElement(inner, fullPath, depth + 1, id, walk);
  }
  // a link is written after the child elements, so this keeps the links in document order
  for (const link of childrenNamed(node, 'InternalLink')) {
    walk.links.push({ name: link.attrs.Name ?? '', from: link.attrs.RefPartnerSideA ?? '', to: link.attrs.RefPartnerSideB ?? '' });
  }
}

function rememberId(walk: Walk, key: string | undefined, owner: { id: string; path: string }): void {
  if (key) {
    walk.idOwners.set(key.toLowerCase(), owner);
  }
}

/**
 * `<id>:<interface name>` -> the id and path of the element the id belongs to (TIA writes the id of the element itself
 * or of one of its interfaces; GUIDs differ in case between writers), or the reference itself when it is unknown.
 */
function resolveRef(ref: string, owners: Map<string, { id: string; path: string }>): { id: string; path: string } {
  const owner = owners.get(ref.split(':')[0].toLowerCase());
  return owner ? { id: owner.id.toLowerCase(), path: owner.path } : { id: ref, path: ref };
}

/**
 * Parses a CAEX / AutomationML export (as written by TIA Portal's hardware export). Returns `undefined` when the XML is
 * not a CAEX file and throws when it is not well-formed XML.
 */
export function parseAml(text: string, culture: string): AmlModel | undefined {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const validation = XMLValidator.validate(clean);
  if (validation !== true) {
    throw new Error(validation.err.msg);
  }
  const root = parseXml(clean);
  if (root.name !== 'CAEXFile') {
    return undefined;
  }
  const walk: Walk = { culture, elements: [], tags: [], idOwners: new Map(), links: [] };
  for (const hierarchy of childrenNamed(root, 'InstanceHierarchy')) {
    for (const element of childrenNamed(hierarchy, 'InternalElement')) {
      walkElement(element, '', 0, undefined, walk);
    }
  }
  return {
    fileName: root.attrs.FileName ?? '',
    header: readHeader(root),
    elements: walk.elements,
    tags: walk.tags,
    links: walk.links.map((l) => {
      const from = resolveRef(l.from, walk.idOwners);
      const to = resolveRef(l.to, walk.idOwners);
      return { name: l.name, from: from.path, to: to.path, fromId: from.id, toId: to.id };
    }),
  };
}
