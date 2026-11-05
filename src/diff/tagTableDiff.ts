import type { DiffMark } from '../model/diff';
import type { PlcConstant, PlcTag, RowDiff, TagTable } from '../parser/tagTableParser';

const OLD: DiffMark = 'del';
const NEW: DiffMark = 'add';

export interface DiffedTagTables {
  oldTable: TagTable;
  newTable: TagTable;
}

export interface Pair<T> {
  old: T[];
  new: T[];
}

/**
 * Rows are matched by key, by default their name (the n-th row of a key with the n-th of the same key); the fields that
 * differ are listed. A row without a partner is marked as a whole.
 */
export function diffRows<T extends { name: string; diff?: RowDiff }>(
  oldRows: T[],
  newRows: T[],
  fieldsOf: ReadonlyArray<readonly [string, (row: T) => unknown]>,
  keyOf: (row: T) => string = (row) => row.name,
): Pair<T> {
  const candidates = new Map<string, number[]>();
  newRows.forEach((row, j) => candidates.set(keyOf(row), [...(candidates.get(keyOf(row)) ?? []), j]));
  const newOut: T[] = newRows.map((row) => ({ ...row, diff: { mark: NEW } }));
  const oldOut = oldRows.map((row) => {
    const j = candidates.get(keyOf(row))?.shift();
    const partner = j === undefined ? undefined : newRows[j];
    if (j === undefined || !partner) {
      return { ...row, diff: { mark: OLD } };
    }
    const fields = fieldsOf.filter(([, get]) => get(row) !== get(partner)).map(([name]) => name);
    // an unchanged row carries no mark at all
    newOut[j] = fields.length > 0 ? { ...partner, diff: { mark: NEW, fields } } : partner;
    return fields.length > 0 ? { ...row, diff: { mark: OLD, fields } } : row;
  });
  return { old: oldOut, new: newOut };
}

const TAG_FIELDS: ReadonlyArray<readonly [string, (t: PlcTag) => unknown]> = [
  ['dataType', (t) => t.dataType],
  ['address', (t) => t.address],
  ['retain', (t) => t.retain],
  ['accessible', (t) => t.accessible],
  ['writable', (t) => t.writable],
  ['visible', (t) => t.visible],
  ['comment', (t) => t.comment],
];

const CONSTANT_FIELDS: ReadonlyArray<readonly [string, (c: PlcConstant) => unknown]> = [
  ['dataType', (c) => c.dataType],
  ['value', (c) => c.value],
  ['comment', (c) => c.comment],
];

/** Compares two versions of a tag table and returns copies whose differing rows carry red (`del`) / green (`add`) marks. */
export function diffTagTables(oldTable: TagTable, newTable: TagTable): DiffedTagTables {
  const tags = diffRows(oldTable.tags, newTable.tags, TAG_FIELDS);
  const constants = diffRows(oldTable.constants, newTable.constants, CONSTANT_FIELDS);
  return {
    oldTable: { ...oldTable, tags: tags.old, constants: constants.old },
    newTable: { ...newTable, tags: tags.new, constants: constants.new },
  };
}
