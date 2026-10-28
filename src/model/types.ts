import type { LadScene } from '../layout/scene';

export type BlockKind = 'FB' | 'FC' | 'OB' | 'DB' | 'UDT';

export interface InterfaceMember {
  name: string;
  datatype: string;
  startValue: string;
  /** Display text for the Retain column ("Retain", "Non-retain", "Set in IDB" or empty). */
  retain: string;
  /** Data blocks only: the member is retained (shown as a checkbox). */
  retainChecked?: boolean;
  /** Data blocks only: `startValue` is the type default, which TIA shows greyed. */
  startIsDefault?: boolean;
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
  | { kind: 'text'; language: string; lines: string[] }
  /** SCL or STL source of a network, shown as a numbered code pane (highlighted when `tokens` is set). */
  | { kind: 'code'; language: string; lines: string[]; tokens?: CodeToken[][] };

export interface NetworkModel {
  index: number;
  title: string;
  comment: string;
  language: string;
  body: NetworkBody;
}

/** A run of source text with one highlight class (empty class = plain text). */
export interface CodeToken {
  text: string;
  cls: string;
}

/** A `REGION ... END_REGION` entry of the code outline; `line` is 1-based. */
export interface Region {
  name: string;
  line: number;
  depth: number;
}

/** A foldable range of code lines (1-based, inclusive). */
export interface Fold {
  from: number;
  to: number;
}

/** SCL code of a block source; `tokens` is filled in by the highlighter when available. */
export interface CodeInfo {
  lines: string[];
  regions: Region[];
  folds: Fold[];
  tokens?: CodeToken[][];
}

export interface DataBlockInfo {
  optimizedAccess: boolean;
  nonRetain: boolean;
  version: string;
  family: string;
  author: string;
  /** Name of the function block for an instance data block, else empty. */
  instanceOf: string;
}

/** Header data of a user-defined type (`kind === 'UDT'`). */
export interface TypeInfo {
  version: string;
}

export interface BlockModel {
  kind: BlockKind;
  /** Present for `kind === 'DB'`. */
  dataBlock?: DataBlockInfo;
  /** Present for `kind === 'UDT'`. */
  typeInfo?: TypeInfo;
  /** Present for blocks read from SCL source. */
  code?: CodeInfo;
  name: string;
  number: string;
  language: string;
  memoryLayout: string;
  title: string;
  comment: string;
  sections: InterfaceSection[];
  networks: NetworkModel[];
}
