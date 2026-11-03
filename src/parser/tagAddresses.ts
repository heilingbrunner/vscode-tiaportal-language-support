import type { TagTable } from './tagTableParser';

/** Maps the text of an operand (`"Motor_On"`) to the absolute address of the PLC tag it names (`%Q4.0`). */
export type AddressResolver = (operand: string) => string | undefined;

/** A global tag is written in double quotes; a name with a dot is a member of a data block, not a tag. */
const TAG_OPERAND = /^"([^".]+)"$/;

/** Builds a resolver from the tag tables of a project; the first table that defines a name wins, names are case-insensitive. */
export function buildAddressResolver(tables: readonly TagTable[]): AddressResolver {
  const addresses = new Map<string, string>();
  for (const table of tables) {
    for (const tag of table.tags) {
      const key = tag.name.toLowerCase();
      if (tag.address !== '' && !addresses.has(key)) {
        addresses.set(key, tag.address);
      }
    }
  }
  return (operand) => {
    const name = TAG_OPERAND.exec(operand.trim())?.[1];
    return name === undefined ? undefined : addresses.get(name.toLowerCase());
  };
}
