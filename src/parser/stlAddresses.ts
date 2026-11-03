import type { BlockModel } from '../model/types';
import type { AddressResolver } from './tagAddresses';

/** `INSTRUCTION operand;` with an optional trailing `//` comment; the instruction is a word (`A`, `FP`) or a symbol (`=`). */
const STL_LINE = /^\s*(?:[A-Za-z][A-Za-z0-9_]*|[=<>+*-][A-Za-z0-9=<>]*)\s+([^;/]+?)\s*(?:;|\/\/|$)/;
/** A number or a typed literal (`6`, `-1.5`, `T#5s`, `16#FF`): TIA shows the constant itself in the address column. */
const LITERAL = /^(?:[+-]?\d[\d_.]*|[A-Za-z]+#[\w#.:_+-]+)$/;

/** The text of the address column for one STL line: the tag's absolute address, or a literal repeated; empty otherwise. */
export function stlAddress(line: string, resolve: AddressResolver): string {
  const operand = STL_LINE.exec(line)?.[1]?.trim();
  if (operand === undefined) {
    return '';
  }
  return resolve(operand) ?? (LITERAL.test(operand) ? operand : '');
}

/** The address column of a code network, one entry per line; `undefined` when no line has an address. */
export function stlAddresses(lines: readonly string[], resolve: AddressResolver): string[] | undefined {
  const addresses = lines.map((line) => stlAddress(line, resolve));
  return addresses.some((a) => a !== '') ? addresses : undefined;
}

/** Returns a copy of the model whose STL networks carry the address column. */
export function withAddresses(model: BlockModel, resolve: AddressResolver): BlockModel {
  const networks = model.networks.map((network) => {
    const { body } = network;
    if (body.kind !== 'code' || body.language !== 'STL') {
      return network;
    }
    const addresses = stlAddresses(body.lines, resolve);
    return addresses ? { ...network, body: { ...body, addresses } } : network;
  });
  return { ...model, networks };
}
