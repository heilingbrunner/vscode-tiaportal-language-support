import { child, childText, childrenNamed, type XNode } from './xml';

/** Formats a `<Component>` list (inside `<Symbol>` or `<Instance>`) as TIA shows it. */
function formatComponents(scope: string, container: XNode): string {
  const parts: string[] = [];
  childrenNamed(container, 'Component').forEach((component, i) => {
    const hasQuotes = component.children.some(
      (c) => c.name === 'BooleanAttribute' && c.attrs.Name === 'HasQuotes' && c.text === 'true',
    );
    let text = component.attrs.Name ?? '';
    if (i === 0) {
      if (scope.startsWith('Local')) {
        text = `#${text}`;
      } else if (scope.startsWith('Global') || hasQuotes) {
        text = `"${text}"`;
      }
    } else if (hasQuotes) {
      text = `"${text}"`;
    }
    const indices = childrenNamed(component, 'Access').map(formatAccess);
    if (indices.length > 0) {
      text += `[${indices.join(',')}]`;
    }
    if (component.attrs.SliceAccessModifier) {
      text += `.%${component.attrs.SliceAccessModifier.toUpperCase()}`;
    }
    parts.push(text);
  });
  return parts.join('.');
}

function formatConstant(access: XNode): string {
  const constant = child(access, 'Constant');
  return childText(constant, 'ConstantValue');
}

/**
 * A user constant is exported by name only: `"NAME"` for a global one, `#NAME` for one of the block.
 * The name is a `Name` attribute, or the value text when the constant sits in an index expression.
 */
function formatNamedConstant(access: XNode): string {
  const constant = child(access, 'Constant');
  const name = constant?.attrs.Name || childText(constant, 'ConstantValue');
  if (!name) {
    return '';
  }
  return access.attrs.Scope === 'LocalConstant' ? `#${name}` : `"${name}"`;
}

function formatAddress(access: XNode): string {
  const indirect = child(access, 'Indirect');
  if (indirect) {
    const { Width = '', Area = '', Register = '', BitOffset = '0' } = indirect.attrs;
    return `${Area}${Width}[${Register},P#${BitOffset}]`;
  }
  const absolute = child(access, 'Absolute');
  if (absolute) {
    return absolute.attrs.Address ?? '%?';
  }
  return '%?';
}

/** Text for an `<Access>` element (operand of a contact, pin value, index expression...). */
export function formatAccess(access: XNode): string {
  const scope = access.attrs.Scope ?? '';
  switch (scope) {
    case 'LiteralConstant':
    case 'TypedConstant':
      return formatConstant(access);
    case 'GlobalConstant':
    case 'LocalConstant':
      return formatNamedConstant(access);
    case 'Address':
    case 'AddressConstant':
      return formatAddress(access);
    case 'Label':
      return child(access, 'Label')?.attrs.Name ?? '';
    case 'Call':
      return child(access, 'Instruction')?.attrs.Name ?? '';
    default: {
      const symbol = child(access, 'Symbol');
      return symbol ? formatComponents(scope, symbol) : '';
    }
  }
}

/** Text for an `<Instance>` element of a call or a stateful part (timer...). */
export function formatInstance(instance: XNode): string {
  return formatComponents(instance.attrs.Scope ?? '', instance);
}
