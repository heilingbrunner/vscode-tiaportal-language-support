import type { FlgNet } from '../parser/flgNetParser';

export interface PinRef {
  uid: string;
  pin: string;
}

export interface PinState {
  name: string;
  dir: 'in' | 'out';
  /** Source of the flow wire into this pin (`'rail'` = power rail). */
  flowSrc?: PinRef | 'rail';
  /** Text of the operand wired into this input pin. */
  accessIn?: string;
  flowDsts: PinRef[];
  /** Texts of operands written by this output pin. */
  accessOut: string[];
  /** True while the pin is wired only to `OpenCon`. */
  openOnly: boolean;
}

/** part uid -> pin name -> state, in order of first appearance. */
export type PinTable = Map<string, Map<string, PinState>>;

export function buildPinTable(net: FlgNet): PinTable {
  const table: PinTable = new Map();
  const ensure = (uid: string, pin: string, dir: 'in' | 'out'): PinState => {
    let pins = table.get(uid);
    if (!pins) {
      pins = new Map();
      table.set(uid, pins);
    }
    let state = pins.get(pin);
    if (!state) {
      state = { name: pin, dir, flowDsts: [], accessOut: [], openOnly: true };
      pins.set(pin, state);
    }
    return state;
  };

  for (const { src, dsts } of net.wires) {
    for (const dst of dsts) {
      if (dst.kind === 'name') {
        const dstPin = ensure(dst.uid, dst.pin, 'in');
        if (src.kind === 'rail') {
          dstPin.flowSrc = 'rail';
          dstPin.openOnly = false;
        } else if (src.kind === 'ident') {
          dstPin.accessIn = net.accesses.get(src.uid) ?? '';
          dstPin.openOnly = false;
        } else if (src.kind === 'name') {
          const srcPin = ensure(src.uid, src.pin, 'out');
          srcPin.flowDsts.push({ uid: dst.uid, pin: dst.pin });
          srcPin.openOnly = false;
          dstPin.flowSrc = { uid: src.uid, pin: src.pin };
          dstPin.openOnly = false;
        }
      } else if (dst.kind === 'ident' && src.kind === 'name') {
        const srcPin = ensure(src.uid, src.pin, 'out');
        srcPin.accessOut.push(net.accesses.get(dst.uid) ?? '');
        srcPin.openOnly = false;
      } else if (dst.kind === 'open' && src.kind === 'name') {
        ensure(src.uid, src.pin, 'out');
      }
    }
  }
  return table;
}
