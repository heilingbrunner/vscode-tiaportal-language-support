import { formatAccess, formatInstance } from './access';
import { child, childrenNamed, type XNode } from './xml';

export type Conn =
  | { kind: 'rail' }
  | { kind: 'ident'; uid: string }
  | { kind: 'name'; uid: string; pin: string }
  | { kind: 'open'; uid: string };

/** One wire: the first connection is the source, the rest are destinations. */
export interface FlgWire {
  src: Conn;
  dsts: Conn[];
}

export interface FlgParam {
  name: string;
  section: string;
  type: string;
}

export interface FlgPart {
  uid: string;
  /** Part name (`Contact`, `Move`, ...) or the called block name for calls. */
  name: string;
  isCall: boolean;
  blockType: string;
  instance: string;
  negated: Set<string>;
  templates: Record<string, string>;
  disabledEno: boolean;
  params: FlgParam[];
}

export interface FlgNet {
  accesses: Map<string, string>;
  parts: Map<string, FlgPart>;
  wires: FlgWire[];
  /** Jump labels declared before the rungs (SD format only). */
  labels?: string[];
}

function parseConn(node: XNode): Conn | undefined {
  const uid = node.attrs.UId ?? '';
  switch (node.name) {
    case 'Powerrail':
      return { kind: 'rail' };
    case 'IdentCon':
      return { kind: 'ident', uid };
    case 'NameCon':
      return { kind: 'name', uid, pin: node.attrs.Name ?? '' };
    case 'OpenCon':
      return { kind: 'open', uid };
    default:
      return undefined;
  }
}

function parsePart(node: XNode): FlgPart {
  const callInfo = child(node, 'CallInfo');
  const instanceNode = child(callInfo ?? node, 'Instance');
  const templates: Record<string, string> = {};
  for (const t of childrenNamed(node, 'TemplateValue')) {
    templates[t.attrs.Name ?? ''] = t.text;
  }
  return {
    uid: node.attrs.UId ?? '',
    name: callInfo ? (callInfo.attrs.Name ?? '') : (node.attrs.Name ?? ''),
    isCall: node.name === 'Call',
    blockType: callInfo?.attrs.BlockType ?? '',
    instance: instanceNode ? formatInstance(instanceNode) : '',
    negated: new Set(childrenNamed(node, 'Negated').map((n) => n.attrs.Name ?? '')),
    templates,
    disabledEno: node.attrs.DisabledENO === 'true',
    params: childrenNamed(callInfo, 'Parameter').map((p) => ({
      name: p.attrs.Name ?? '',
      section: p.attrs.Section ?? '',
      type: p.attrs.Type ?? '',
    })),
  };
}

/** Parses a `<FlgNet>` element into parts, operand accesses and wires. */
export function parseFlgNet(flgNet: XNode): FlgNet {
  const accesses = new Map<string, string>();
  const parts = new Map<string, FlgPart>();
  for (const node of child(flgNet, 'Parts')?.children ?? []) {
    if (node.name === 'Access') {
      accesses.set(node.attrs.UId ?? '', formatAccess(node));
    } else if (node.name === 'Part' || node.name === 'Call') {
      const part = parsePart(node);
      parts.set(part.uid, part);
    }
  }
  const wires: FlgWire[] = [];
  for (const wire of childrenNamed(child(flgNet, 'Wires'), 'Wire')) {
    const conns = wire.children.map(parseConn).filter((c): c is Conn => c !== undefined);
    const [src, ...dsts] = conns;
    if (src) {
      wires.push({ src, dsts });
    }
  }
  return { accesses, parts, wires };
}
