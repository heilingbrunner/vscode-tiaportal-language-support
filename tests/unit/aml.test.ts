import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isAmlSource, parseAml } from '../../src/parser/amlParser';

const root = fileURLToPath(new URL('../..', import.meta.url));
const source = readFileSync(join(root, 'fixtures', 'sample.aml'), 'utf-8');
const model = parseAml(source, 'en-US')!;

describe('isAmlSource', () => {
  it('recognises a CAEX file', () => {
    expect(isAmlSource(source)).toBe(true);
    expect(isAmlSource('<Document><SW.Blocks.FB/></Document>')).toBe(false);
  });
});

describe('parseAml', () => {
  it('returns undefined for XML that is not CAEX', () => {
    expect(parseAml('<Document/>', 'en-US')).toBeUndefined();
  });

  it('throws on malformed XML so the viewer can report it', () => {
    expect(() => parseAml('<CAEXFile><InstanceHierarchy></CAEXFile>', 'en-US')).toThrow();
  });

  it('reads the writer header', () => {
    expect(model.fileName).toBe('Sample.aml');
    expect(model.header).toMatchObject({
      writerName: 'Totally Integrated Automation Portal',
      writerVendor: 'Siemens',
      writerVersion: '2100',
      writerRelease: '2100.0.121.1',
      lastWritten: '2026-11-05T15:30:50Z',
      schemaVersion: '2.15',
    });
  });

  it('flattens the hierarchy in document order with depth and ancestor path', () => {
    const names = model.elements.map((e) => `${e.depth}:${e.name}`);
    expect(names.slice(0, 5)).toEqual(['0:Project', '1:PN', '1:Hardware', '2:PLC_1', '3:PROFINET interface']);
    const plc = model.elements.find((e) => e.id === 'd-1')!;
    expect(plc.path).toBe('Project / Hardware');
    expect(plc.parentId).toBe('h-1');
  });

  it('takes the last segment of each supported role class', () => {
    expect(model.elements.find((e) => e.id === 'n-1')!.roles).toEqual(['Node']);
    expect(model.elements.find((e) => e.id === 'p-1')!.roles).toEqual([]);
  });

  it('reads attribute values by name', () => {
    const plc = model.elements.find((e) => e.id === 'd-1')!;
    expect(plc.attributes).toMatchObject({ TypeIdentifier: 'OrderNumber:6ES7 511-1AK02-0AB0', PositionNumber: '0', BuiltIn: 'false' });
  });

  it('picks the comment translation of the culture, else the default value', () => {
    const comment = (culture: string): string => parseAml(source, culture)!.elements.find((e) => e.id === 'd-1')!.attributes.Comment;
    expect(comment('de-DE')).toBe('Hauptsteuerung');
    expect(comment('en-US')).toBe('Main controller');
    expect(comment('fr-FR')).toBe('Main controller');
    // the setting is matched case-insensitively and by language alone when the region is not in the file
    expect(comment('de-de')).toBe('Hauptsteuerung');
    expect(comment('de')).toBe('Hauptsteuerung');
    expect(comment('de-AT')).toBe('Hauptsteuerung');
    expect(comment('')).toBe('Main controller');
    // translations are not attributes of their own
    expect(Object.keys(model.elements.find((e) => e.id === 'd-1')!.attributes).some((k) => k.startsWith('aml-lang'))).toBe(false);
  });

  it('does not take an interface of another class that happens to end in /Tag for a PLC tag', () => {
    const other = source.replace('RefBaseClassPath="AutomationProjectConfigurationInterfaceClassLib/Tag"', 'RefBaseClassPath="SomeOtherLib/Tag"');
    expect(parseAml(other, 'en-US')!.tags).toEqual([]);
  });

  it('collects the PLC tags of a tag table element', () => {
    expect(model.tags).toEqual([
      { table: 'Default tag table', name: 'A2548.0', dataType: 'Bool', ioType: 'Output', address: '2848.0', length: '', comment: '' },
    ]);
  });

  it('resolves links through the ids of the interfaces to the elements that own them', () => {
    expect(model.links[0]).toEqual({ name: 'Link To Port_1', from: 'Project / Hardware / PLC_1 / PROFINET interface / Port_1', to: 'Project / Hardware / Drive_1 / Port_1' });
  });

  it('resolves a link that names an element id directly, ignoring the case of the id', () => {
    // TIA writes the id of the node / subnet element (here `N-1` for `n-1`) rather than that of one of its interfaces
    expect(model.links[2]).toEqual({ name: 'Link To Subnet_1', from: 'Project / Hardware / PLC_1 / PROFINET interface / IE1', to: 'Project / PN' });
  });

  it('keeps a link whose partner is unknown, showing the raw reference', () => {
    expect(model.links[1].to).toBe('missing:CommunicationPortInterface');
  });

  it('accepts a file with a byte order mark', () => {
    expect(parseAml(`﻿${source}`, 'en-US')!.elements).toHaveLength(model.elements.length);
  });
});
