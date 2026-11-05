import type { AmlElement, AmlLink, AmlModel, AmlTag } from '../parser/amlParser';
import { diffRows } from './tagTableDiff';

export interface DiffedAml {
  oldModel: AmlModel;
  newModel: AmlModel;
}

type Fields<T> = ReadonlyArray<readonly [string, (row: T) => unknown]>;

const KEY_SEPARATOR = '\u0000';

/** An element is the same element in both versions when its id is (GUIDs differ in case between writers). */
const elementKey = (e: AmlElement): string => (e.id ? e.id.toLowerCase() : `${e.path}/${e.name}`);

/** The fields compared for an element: its own columns and every attribute either version has (as `@<name>`). */
function elementFields(oldModel: AmlModel, newModel: AmlModel): Fields<AmlElement> {
  const attributeNames = new Set<string>();
  for (const element of [...oldModel.elements, ...newModel.elements]) {
    Object.keys(element.attributes).forEach((name) => attributeNames.add(name));
  }
  return [
    ['name', (e) => e.name],
    ['roles', (e) => e.roles.join(',')],
    // the path text also changes when an ancestor is renamed, which is that ancestor's difference, not this element's:
    // an element has moved when its parent is another one
    ['path', (e) => e.parentId?.toLowerCase() ?? ''],
    ...[...attributeNames].map((name): readonly [string, (e: AmlElement) => unknown] => [`@${name}`, (e) => e.attributes[name] ?? '']),
  ];
}

const TAG_FIELDS: Fields<AmlTag> = [
  ['dataType', (t) => t.dataType],
  ['ioType', (t) => t.ioType],
  ['address', (t) => t.address],
  ['length', (t) => t.length],
  ['comment', (t) => t.comment],
];

/** A link is the same link when it joins the same two elements (by id, so renames do not matter); a link with a new end is a removed and an added one. */
const LINK_FIELDS: Fields<AmlLink> = [['name', (l) => l.name]];

/**
 * Compares two versions of a hardware export and returns copies whose differing rows carry red (`del`) / green (`add`)
 * marks: a row that only one version has is marked as a whole, a row of both only in the cells that differ.
 */
export function diffAml(oldModel: AmlModel, newModel: AmlModel): DiffedAml {
  const elements = diffRows(oldModel.elements, newModel.elements, elementFields(oldModel, newModel), elementKey);
  const tags = diffRows(oldModel.tags, newModel.tags, TAG_FIELDS, (t) => `${t.tableId}${KEY_SEPARATOR}${t.name}`);
  const links = diffRows(oldModel.links, newModel.links, LINK_FIELDS, (l) => `${l.fromId}${KEY_SEPARATOR}${l.toId}`);
  return {
    oldModel: { ...oldModel, elements: elements.old, tags: tags.old, links: links.old },
    newModel: { ...newModel, elements: elements.new, tags: tags.new, links: links.new },
  };
}
