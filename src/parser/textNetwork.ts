import { child, childrenNamed, type XNode } from './xml';
import { formatAccess, formatInstance } from './access';

function textOf(node: XNode): string {
  return child(node, 'Text')?.raw ?? node.raw;
}

/** Renders one child of a StructuredText / StlStatement element back to source text. */
function renderNode(node: XNode): string {
  switch (node.name) {
    case 'Token':
      return node.attrs.Text ?? '';
    case 'Blank':
      return ' '.repeat(Number(node.attrs.Num ?? '1'));
    case 'NewLine':
      return '\n'.repeat(Number(node.attrs.Num ?? '1'));
    case 'Parameter':
      return `${node.attrs.Name ?? ''}${node.children.map(renderNode).join('')}`;
    case 'Text':
      return node.raw;
    case 'Comment':
      return `(*${textOf(node)}*)`;
    case 'LineComment':
      return `//${textOf(node)}`;
    case 'Access':
      return renderAccess(node);
    default:
      return node.children.map(renderNode).join('');
  }
}

/** An FB/FC call: the callee (instance or block name) followed by the nested `(param := value, ...)` token stream. */
function renderCallInfo(callInfo: XNode): string {
  const instance = child(callInfo, 'Instance');
  const callee = instance ? formatInstance(instance) : `"${callInfo.attrs.Name ?? ''}"`;
  const body = callInfo.children.filter((c) => c.name !== 'Instance');
  return `${callee}${body.map(renderNode).join('')}`;
}

function renderAccess(access: XNode): string {
  if (access.attrs.Scope === 'Call') {
    const instruction = child(access, 'Instruction');
    if (instruction) {
      return `${instruction.attrs.Name ?? ''}${instruction.children.map(renderNode).join('')}`;
    }
    const callInfo = child(access, 'CallInfo');
    if (callInfo) {
      return renderCallInfo(callInfo);
    }
  }
  return formatAccess(access);
}

/** SCL: concatenates the token stream into source lines. */
export function renderStructuredText(source: XNode): string[] {
  return source.children.map(renderNode).join('').split('\n');
}

/** STL: one line per statement (`label: OP operand`). */
export function renderStatementList(source: XNode): string[] {
  const lines: string[] = [];
  for (const statement of childrenNamed(source, 'StlStatement')) {
    const label = child(child(statement, 'LabelDeclaration'), 'Label')?.attrs.Name;
    const op = child(statement, 'StlToken')?.attrs.Text ?? '';
    if (op === 'EMPTY_LINE') {
      lines.push('');
      continue;
    }
    const operands = childrenNamed(statement, 'Access').map(renderAccess);
    const comment = statement.children
      .filter((c) => c.name === 'LineComment' || c.name === 'Comment')
      .map(renderNode);
    const code = [op, ...operands].filter(Boolean).join(' ');
    lines.push([label ? `${label}:` : '', code, ...comment].filter(Boolean).join(' '));
  }
  return lines;
}
