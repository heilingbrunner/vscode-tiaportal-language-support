import type { TagTable } from '../parser/tagTableParser';
import { createCollector, type ObjectHits } from './hits';
import type { Matcher } from './matcher';

/**
 * Finds the hits of a matcher in a PLC tag table: its name, and the name, data type, address and comment of every
 * tag, and the name, data type, value and comment of every constant. Undefined when there are none. Only the first
 * `maxHits` hits are kept (see `createCollector`).
 */
export function searchTagTable(table: TagTable, matcher: Matcher, maxHits = Infinity): ObjectHits | undefined {
  const { add, result } = createCollector(matcher, maxHits);
  add('name', 'Name', table.name);
  for (const tag of table.tags) {
    const where = (what: string): string => `Tags\\${tag.name}\\${what}`;
    add('tag', where('Name'), tag.name);
    add('tag', where('Data type'), tag.dataType);
    add('tag', where('Address'), tag.address);
    add('tag', where('Comment'), tag.comment);
  }
  for (const constant of table.constants) {
    const where = (what: string): string => `Constants\\${constant.name}\\${what}`;
    add('constant', where('Name'), constant.name);
    add('constant', where('Data type'), constant.dataType);
    add('constant', where('Value'), constant.value);
    add('constant', where('Comment'), constant.comment);
  }
  return result('TAGS', table.name);
}
