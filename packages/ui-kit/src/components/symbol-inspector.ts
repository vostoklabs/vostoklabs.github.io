import { el } from '../dom';
import { ICONS } from '../icons';
import {
  SYMBOL_ROTATE_STEP,
  nudgeSymbol,
  symbolReadout,
  turnSymbol,
  type SymbolPlacement,
  type SymbolTransform,
} from '../symbols/rules';
import { button, iconButton } from './button';
import { sliderRow, toggleSwitch, type SliderRowHandle, type ValueRow } from './controls';
import { dpad } from './dpad';
import { makeCollapsible } from './section';

/*
  The panel for one symbol placed in a text: how big it is, where it sits, which way it faces,
  and the way to swap it or take it out.

  Values in, callbacks out. It holds no text and no symbol data: an app shows it when its
  `symbolTextField` reports a selection, hands it the symbol's current transform, and writes
  each `onChange` patch to wherever that symbol lives. The pad and the size slider move it
  straight away, so the readout follows each press without waiting for the app.

  A part that EDITS a value (size, offset, flip) is on unless switched off. A part that ACTS
  (Before / After / Both sides, the move arrows, Replace, Remove) appears only when its
  callback is given — a button with nothing behind it is worse than no button.
*/

export interface SymbolInspectorOptions {
  /** The symbol's name, shown as "Symbol: <label>". */
  label: string;
  values: SymbolTransform;
  /** The Symbol size slider, 25–200 %. Default on. */
  size?: boolean;
  /** The offset pad and its readout. Default on. */
  offset?: boolean;
  /** The pad's rotate corners and the angle in the readout. Default on; needs `offset`. */
  rotate?: boolean;
  /** The Flip switch. Default on. */
  flip?: boolean;
  /** Every change from the slider, the pad and the switch: only the fields that moved. */
  onChange(patch: Partial<SymbolTransform>): void;
  /** Shows Before / After / Both sides. `placeSymbol` makes the edit. */
  onPlace?(where: SymbolPlacement): void;
  /** Shows the move-left / move-right arrows. `shiftSymbol` makes the edit. */
  onShift?(dir: -1 | 1): void;
  /** Shows Replace — typically opens the symbol library for this symbol. */
  onReplace?(): void;
  /** Shows Remove. */
  onRemove?(): void;
}

export type SymbolInspectorHandle = HTMLDetailsElement & {
  /** Show new values — another symbol selected, or the app corrected one. Fires nothing. */
  setValues(values: Partial<SymbolTransform>): void;
  /** Rename the heading, after a Replace. */
  setLabel(label: string): void;
};

/** One placed symbol's controls, as a disclosure headed "Symbol: <label>". */
export function symbolInspector(opts: SymbolInspectorOptions): SymbolInspectorHandle {
  const values: SymbolTransform = { ...opts.values };
  const withOffset = opts.offset !== false;
  const withAngle = withOffset && opts.rotate !== false;

  const summary = el('summary', { text: `Symbol: ${opts.label}` });
  const body = el('div', { className: 'vl-symbol-inspector__body' });
  const root = el('details', { className: 'vl-symbol-inspector' }, [summary, body]) as SymbolInspectorHandle;
  root.open = true;

  let readout: HTMLElement | null = null;
  const refresh = () => {
    if (readout) readout.textContent = symbolReadout(values, withAngle);
  };
  const change = (patch: Partial<SymbolTransform>) => {
    Object.assign(values, patch);
    refresh();
    opts.onChange(patch);
  };

  let size: SliderRowHandle | null = null;
  if (opts.size !== false) {
    size = sliderRow({
      label: 'Symbol size',
      value: Math.round(values.scale * 100),
      min: 25,
      max: 200,
      step: 5,
      unit: '%',
      onInput: (v) => change({ scale: v / 100 }),
    });
    body.append(size);
  }

  const { onPlace, onShift, onReplace, onRemove } = opts;
  if (onPlace || onShift) {
    const actions = el('div', { className: 'vl-symbol-inspector__actions' });
    if (onPlace) {
      actions.append(
        button({ label: 'Before', emphasis: 'secondary', onClick: () => onPlace('before') }),
        button({ label: 'After', emphasis: 'secondary', onClick: () => onPlace('after') }),
        button({ label: 'Both sides', emphasis: 'secondary', onClick: () => onPlace('both') }),
      );
    }
    if (onShift) {
      actions.append(
        el('span', { className: 'vl-symbol-inspector__reorder' }, [
          iconButton({ icon: ICONS.arrowLeft, label: 'Move symbol left', onClick: () => onShift(-1) }),
          iconButton({ icon: ICONS.arrowRight, label: 'Move symbol right', onClick: () => onShift(1) }),
        ]),
      );
    }
    body.append(el('div', {}, [el('p', { className: 'vl-label', text: 'Symbol position' }), actions]));
  }

  /* Flip sits with the offset because it answers the same question — which way the symbol
     faces where it stands — and an arrow or a paw on the wrong side of a word needs turning
     round, not a second copy. */
  let flip: ValueRow<boolean> | null = null;
  if (withOffset || opts.flip !== false) {
    const column = el('div');
    if (withOffset) {
      readout = el('p', { className: 'vl-hint vl-symbol-inspector__readout' });
      column.append(el('p', { className: 'vl-label', text: withAngle ? 'Offset & rotation' : 'Offset' }), readout);
    }
    if (opts.flip !== false) {
      flip = toggleSwitch({
        label: 'Flip',
        checked: values.flip,
        help: 'Mirror the symbol left to right.',
        onChange: (on) => change({ flip: on }),
      });
      column.append(flip);
    }
    const row = el('div', { className: 'vl-symbol-inspector__transform' }, [column]);
    if (withOffset) {
      row.append(
        dpad({
          compact: true,
          rotate: withAngle,
          rotateStep: SYMBOL_ROTATE_STEP,
          onMove: (dir) => change(nudgeSymbol(values, dir)),
          onRotate: (delta) => change({ rotation: turnSymbol(values.rotation, delta) }),
          onReset: () => change(withAngle ? { dx: 0, dy: 0, rotation: 0 } : { dx: 0, dy: 0 }),
        }).root,
      );
    }
    body.append(row);
  }

  if (onReplace || onRemove) {
    body.append(
      el('div', { className: 'vl-symbol-inspector__actions' }, [
        ...(onReplace ? [button({ label: 'Replace', emphasis: 'secondary', onClick: () => onReplace() })] : []),
        ...(onRemove ? [button({ label: 'Remove', emphasis: 'ghost', onClick: () => onRemove() })] : []),
      ]),
    );
  }

  makeCollapsible(root);
  refresh();

  root.setValues = (next) => {
    Object.assign(values, next);
    size?.setValue(Math.round(values.scale * 100));
    flip?.setValue(values.flip);
    refresh();
  };
  root.setLabel = (label) => {
    summary.textContent = `Symbol: ${label}`;
  };
  return root;
}
