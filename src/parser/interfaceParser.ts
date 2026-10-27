import type { InterfaceMember, InterfaceSection } from '../model/types';
import { child, childrenNamed, type XNode } from './xml';

const SECTION_ORDER = ['Input', 'Output', 'InOut', 'Static', 'Temp', 'Constant', 'Return'];
/** Sections whose members have no Accessible/Writable/Visible/Setpoint flags in TIA. */
const FLAGLESS_SECTIONS = new Set(['Temp', 'Constant', 'Return']);

const RETAIN_TEXT: Record<string, string> = {
  Retain: 'Retain',
  NonRetain: 'Non-retain',
  SetInIDB: 'Set in IDB',
};

function booleanAttribute(member: XNode, name: string): boolean | undefined {
  const attr = child(member, 'AttributeList')?.children.find(
    (c) => c.name === 'BooleanAttribute' && c.attrs.Name === name,
  );
  return attr ? attr.text === 'true' : undefined;
}

function commentOf(member: XNode, culture: string): string {
  const items = childrenNamed(child(member, 'Comment'), 'MultiLanguageText');
  const preferred = items.find((i) => i.attrs.Lang === culture && i.text);
  return (preferred ?? items.find((i) => i.text))?.text ?? '';
}

function parseMember(member: XNode, flagless: boolean, culture: string): InterfaceMember {
  const flag = (name: string, fallback: boolean): boolean =>
    flagless ? false : (booleanAttribute(member, name) ?? fallback);
  return {
    name: member.attrs.Name ?? '',
    datatype: member.attrs.Datatype ?? '',
    startValue: child(member, 'StartValue')?.text ?? '',
    retain: RETAIN_TEXT[member.attrs.Remanence ?? ''] ?? '',
    accessible: flag('ExternalAccessible', true),
    writable: flag('ExternalWritable', true),
    visible: flag('ExternalVisible', true),
    setpoint: flag('SetPoint', false),
    comment: commentOf(member, culture),
    children: childrenNamed(member, 'Member').map((m) => parseMember(m, flagless, culture)),
  };
}

/** Parses `<Interface><Sections><Section><Member>` into ordered sections (empty ones included). */
export function parseInterface(attributeListParent: XNode, culture: string): InterfaceSection[] {
  const sections = child(child(child(attributeListParent, 'AttributeList'), 'Interface'), 'Sections');
  const parsed = childrenNamed(sections, 'Section').map((section) => {
    const name = section.attrs.Name ?? '';
    const flagless = FLAGLESS_SECTIONS.has(name);
    return {
      name,
      members: childrenNamed(section, 'Member').map((m) => parseMember(m, flagless, culture)),
    };
  });
  const rank = (name: string): number => {
    const i = SECTION_ORDER.indexOf(name);
    return i < 0 ? SECTION_ORDER.length : i;
  };
  return parsed.sort((a, b) => rank(a.name) - rank(b.name));
}
