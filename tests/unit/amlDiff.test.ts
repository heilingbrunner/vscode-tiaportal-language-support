import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { diffAml } from '../../src/diff/amlDiff';
import { parseAml, type AmlModel } from '../../src/parser/amlParser';

const root = fileURLToPath(new URL('../..', import.meta.url));
const source = readFileSync(join(root, 'fixtures', 'sample.aml'), 'utf-8');
const parse = (text: string): AmlModel => parseAml(text, 'en-US')!;
const oldModel = parse(source);

const marked = <T extends { diff?: unknown }>(rows: T[]): T[] => rows.filter((r) => r.diff);
const byId = (model: AmlModel, id: string) => model.elements.find((e) => e.id === id)!;

describe('diffAml', () => {
  it('marks nothing when both versions are the same', () => {
    const { oldModel: o, newModel: n } = diffAml(oldModel, parse(source));
    for (const model of [o, n]) {
      expect(marked(model.elements)).toEqual([]);
      expect(marked(model.tags)).toEqual([]);
      expect(marked(model.links)).toEqual([]);
    }
  });

  it('marks only the changed cell of an element, on both sides', () => {
    const changed = parse(source.replace('192.168.0.1', '192.168.0.9'));
    const { oldModel: o, newModel: n } = diffAml(oldModel, changed);
    expect(byId(o, 'n-1').diff).toEqual({ mark: 'del', fields: ['@NetworkAddress'] });
    expect(byId(n, 'n-1').diff).toEqual({ mark: 'add', fields: ['@NetworkAddress'] });
    expect(marked(o.elements)).toHaveLength(1);
    expect(marked(n.elements)).toHaveLength(1);
  });

  it('marks an element that only the new version has as added, and the reverse as deleted', () => {
    const added = parse(source.replace('<InternalElement ID="t-1"', '<InternalElement ID="d-3" Name="Drive_2"><SupportedRoleClass RefRoleClassPath="L/Device" /></InternalElement>\n<InternalElement ID="t-1"'));
    const forward = diffAml(oldModel, added);
    expect(byId(forward.newModel, 'd-3').diff).toEqual({ mark: 'add' });
    expect(forward.oldModel.elements.some((e) => e.id === 'd-3')).toBe(false);
    const backward = diffAml(added, oldModel);
    expect(byId(backward.oldModel, 'd-3').diff).toEqual({ mark: 'del' });
  });

  it('matches elements by id, whatever the case of the id', () => {
    const upper = parse(source.replace('ID="d-1"', 'ID="D-1"'));
    const { oldModel: o, newModel: n } = diffAml(oldModel, upper);
    expect(marked(o.elements)).toEqual([]);
    expect(marked(n.elements)).toEqual([]);
  });

  it('marks a renamed element only, not what lies below it (their path text changes, they do not)', () => {
    const renamed = parse(source.replace('Name="PLC_1"', 'Name="PLC_2"'));
    const { oldModel: o, newModel: n } = diffAml(oldModel, renamed);
    expect(byId(n, 'd-1').diff).toEqual({ mark: 'add', fields: ['name'] });
    expect(marked(n.elements).map((e) => e.id)).toEqual(['d-1']);
    expect(marked(o.elements).map((e) => e.id)).toEqual(['d-1']);
  });

  it('keeps the links and tags of a renamed element or tag table unmarked', () => {
    const renamed = parse(source.replace('Name="PLC_1"', 'Name="PLC_2"').replace('Name="Default tag table"', 'Name="Renamed table"'));
    const { oldModel: o, newModel: n } = diffAml(oldModel, renamed);
    for (const model of [o, n]) {
      expect(marked(model.links)).toEqual([]);
      expect(marked(model.tags)).toEqual([]);
    }
  });

  it('reports an element that was moved below another parent through its path', () => {
    const moved: AmlModel = {
      ...parse(source),
      elements: parse(source).elements.map((e) => (e.id === 'e-1' ? { ...e, parentId: 't-1', path: 'Project / Default tag table' } : e)),
    };
    const { oldModel: o, newModel: n } = diffAml(oldModel, moved);
    expect(byId(o, 'e-1').diff).toEqual({ mark: 'del', fields: ['path'] });
    expect(byId(n, 'e-1').diff).toEqual({ mark: 'add', fields: ['path'] });
  });

  it('reports a changed role', () => {
    const changed = parse(source.replace('RefRoleClassPath="AutomationProjectConfigurationRoleClassLib/Node"', 'RefRoleClassPath="AutomationProjectConfigurationRoleClassLib/NodeX"'));
    expect(byId(diffAml(oldModel, changed).oldModel, 'n-1').diff).toEqual({ mark: 'del', fields: ['roles'] });
  });

  it('marks the changed field of a tag', () => {
    const changed = parse(source.replace('<Value>Bool</Value>', '<Value>Int</Value>'));
    const { oldModel: o, newModel: n } = diffAml(oldModel, changed);
    expect(o.tags[0].diff).toEqual({ mark: 'del', fields: ['dataType'] });
    expect(n.tags[0].diff).toEqual({ mark: 'add', fields: ['dataType'] });
  });

  it('matches a link by its two endpoints and reports a changed name', () => {
    const renamed = parse(source.replace('Link To Port_1', 'Link To Port_X'));
    const { oldModel: o, newModel: n } = diffAml(oldModel, renamed);
    expect(marked(o.links)).toMatchObject([{ name: 'Link To Port_1', diff: { mark: 'del', fields: ['name'] } }]);
    expect(marked(n.links)[0].diff).toEqual({ mark: 'add', fields: ['name'] });
  });

  it('marks a link whose endpoint changed as removed and added', () => {
    const rewired = parse(source.replace('RefPartnerSideB="pi-2:CommunicationPortInterface"', 'RefPartnerSideB="s-1:CommunicationPortInterface"'));
    const { oldModel: o, newModel: n } = diffAml(oldModel, rewired);
    expect(o.links[0].diff).toEqual({ mark: 'del' });
    expect(n.links.filter((l) => l.diff?.mark === 'add')).toHaveLength(1);
  });

  it('does not change the models it was given', () => {
    const snapshot = JSON.stringify(oldModel);
    diffAml(oldModel, parse(source.replace('192.168.0.1', '192.168.0.9')));
    expect(JSON.stringify(oldModel)).toBe(snapshot);
  });
});
