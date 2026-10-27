export type Pt = [number, number];

export type TextClass = 'operand' | 'pin' | 'title' | 'head' | 'type' | 'hint';

export type SceneItem =
  | { t: 'line'; pts: Pt[]; cls: 'wire' | 'rail' | 'tick' }
  | { t: 'text'; x: number; y: number; s: string; cls: TextClass; anchor: 'start' | 'middle' | 'end' }
  | { t: 'box'; x: number; y: number; w: number; h: number; headH: number }
  | { t: 'contact'; cx: number; y: number; negated: boolean; edge: '' | 'P' | 'N' }
  | { t: 'coil'; cx: number; y: number; mark: string }
  | { t: 'bubble'; x: number; y: number };

/** Drawing instructions for one LAD network, in pixel coordinates. */
export interface LadScene {
  width: number;
  height: number;
  items: SceneItem[];
}
