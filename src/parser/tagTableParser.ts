import { attributeOf, child, childrenNamed, parseXml, pickText, type XNode } from './xml';

export interface PlcTag {
  name: string;
  dataType: string;
  /** The logical address such as `%I1300.3`; empty for a tag without one. */
  address: string;
  comment: string;
  retain: boolean;
  /** Accessible from HMI / OPC UA; the writable and visible flags only apply to an accessible tag. */
  accessible: boolean;
  writable: boolean;
  visible: boolean;
}

export interface PlcConstant {
  name: string;
  dataType: string;
  value: string;
  comment: string;
}

/** A PLC tag table with its tags and user constants. */
export interface TagTable {
  name: string;
  tags: PlcTag[];
  constants: PlcConstant[];
}

const TABLE_NODE = 'SW.Tags.PlcTagTable';

/** A cheap test, before parsing, for an XML that holds a tag table: the viewer and the search parse XML once, by what it holds. */
export const isTagTableSource = (text: string): boolean => text.includes(`<${TABLE_NODE}`);
const TAG_NODE = 'SW.Tags.PlcTag';
const CONSTANT_NODE = 'SW.Tags.PlcUserConstant';

/** A boolean attribute of the export; an export only names the ones that differ from TIA's default. */
const flagOf = (node: XNode, name: string, fallback: boolean): boolean => {
  const value = attributeOf(node, name);
  return value === undefined ? fallback : value.toLowerCase() === 'true';
};

const tagOf = (node: XNode, culture: string): PlcTag => ({
  name: attributeOf(node, 'Name') ?? '',
  dataType: attributeOf(node, 'DataTypeName') ?? '',
  address: attributeOf(node, 'LogicalAddress') ?? '',
  comment: pickText(child(node, 'ObjectList'), 'Comment', culture),
  retain: flagOf(node, 'Retain', false),
  accessible: flagOf(node, 'ExternalAccessible', true),
  writable: flagOf(node, 'ExternalWritable', true),
  visible: flagOf(node, 'ExternalVisible', true),
});

const constantOf = (node: XNode, culture: string): PlcConstant => ({
  name: attributeOf(node, 'Name') ?? '',
  dataType: attributeOf(node, 'DataTypeName') ?? '',
  value: attributeOf(node, 'Value') ?? '',
  comment: pickText(child(node, 'ObjectList'), 'Comment', culture),
});

/**
 * Parses a TIA Openness export of a PLC tag table. Returns `undefined` when the XML is not one (a block export, for
 * example); throws on malformed XML.
 */
export function parseTagTable(source: string, culture: string): TagTable | undefined {
  const table = parseXml(source).children.find((c) => c.name === TABLE_NODE);
  if (!table) {
    return undefined;
  }
  const objects = child(table, 'ObjectList');
  return {
    name: attributeOf(table, 'Name') ?? '',
    tags: childrenNamed(objects, TAG_NODE).map((n) => tagOf(n, culture)),
    constants: childrenNamed(objects, CONSTANT_NODE).map((n) => constantOf(n, culture)),
  };
}
