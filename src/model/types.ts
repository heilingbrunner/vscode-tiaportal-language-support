import type { LadScene } from '../layout/scene';

export type BlockKind = 'FB' | 'FC' | 'OB';

export interface InterfaceMember {
  name: string;
  datatype: string;
  startValue: string;
  /** Display text for the Retain column ("Retain", "Non-retain", "Set in IDB" or empty). */
  retain: string;
  accessible: boolean;
  writable: boolean;
  visible: boolean;
  setpoint: boolean;
  comment: string;
  children: InterfaceMember[];
}

export interface InterfaceSection {
  name: string;
  members: InterfaceMember[];
}

export type NetworkBody =
  | { kind: 'empty' }
  | { kind: 'lad'; scene: LadScene }
  | { kind: 'text'; language: string; lines: string[] };

export interface NetworkModel {
  index: number;
  title: string;
  comment: string;
  language: string;
  body: NetworkBody;
}

export interface BlockModel {
  kind: BlockKind;
  name: string;
  number: string;
  language: string;
  memoryLayout: string;
  title: string;
  comment: string;
  sections: InterfaceSection[];
  networks: NetworkModel[];
}
