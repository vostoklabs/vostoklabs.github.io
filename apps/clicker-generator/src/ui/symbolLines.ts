// What a clicker says, line by line: Text mode's lines and the rows of a Blocks clicker, each a
// kit `symbolTextField`. One "Add symbol" serves all of them (Laser Studio's Symbols & icons),
// and the symbol clicked in the text gets its own controls under the lines.
//
// A line stays a plain string; a symbol is one private-use character in it, and what it looks
// like lives in a map beside the lines (the store's `textSymbols` or `blockSymbols`). This file
// edits both and hands every change back. The map it reads is the one it was last given.
import {
  ICONS,
  button,
  el,
  iconButton,
  nextSymbolChar,
  placeSymbol,
  shiftSymbol,
  symbolInspector,
  symbolTextField,
  toast,
  type SymbolPlacement,
  type SymbolTextFieldHandle,
} from '@vostok/ui-kit';
import type { BlockSymbol } from '../geometry/blockLayout';
import { lookOf, lookRings } from '../image/symbolRings';
import { lucideImg, pickSymbol, ringsSvg, type TracedSymbol } from './symbols';

export type SymbolMap = Record<string, BlockSymbol>;

export interface LineSpec {
  /** Beside the field: "Line 2", "Row 1". */
  label: string;
  /** Muted, inside the field's right edge: how many keys a row has. */
  hint?: string;
  /** In code points; a symbol is one. */
  maxLength?: number;
  /** A key per character: a symbol added to a full row takes the key at the cursor. */
  overwrite?: boolean;
  /** Puts a remove button beside the field. */
  onRemove?: () => void;
}

export interface SymbolLinesOptions {
  /** Before / After / Both sides in the symbol's controls. A line of words has two ends to put
   *  a symbol at; a row of keys has a key per character, and the move arrows place it. */
  placement: boolean;
  /** The symbols changed. Always before the `onLine` that uses a new one, so a build never
   *  meets a character it has no drawing for. */
  onSymbols(next: SymbolMap): void;
  /** A line's text changed: typed, or a symbol went in, moved or came out. */
  onLine(index: number, text: string): void;
}

export interface SymbolLines {
  /** "Add symbol", for the heading's row. */
  addButton: HTMLElement;
  /** The fields. */
  lines: HTMLElement;
  /** The clicked symbol's controls, under the lines. */
  inspector: HTMLElement;
  /** New fields for these lines: the layout changed, or a line came or went. */
  setLines(specs: LineSpec[], values: string[]): void;
  /** Text set elsewhere (a load, a preset). A field being typed in is left alone. */
  setValues(values: string[]): void;
  /** The map as the store has it now. Redraws the symbols when it changed. */
  setSymbols(next: SymbolMap): void;
  /** One field's hint, after its row's key count changed. */
  setHint(index: number, hint: string): void;
  /** Put the caret in a field: a line just added. */
  focus(index: number): void;
}

/** A symbol given a new drawing keeps its size, place, turn and twin. */
function reshaped(sym: BlockSymbol, picked: TracedSymbol): BlockSymbol {
  const { scale, dx, dy, rotation, flip } = lookOf(sym);
  return { kind: 'rings', label: picked.label, rings: picked.rings, scale, dx, dy, rotation, flip, ...(sym.pair ? { pair: sym.pair } : {}) };
}

export function symbolLines(opts: SymbolLinesOptions): SymbolLines {
  let map: SymbolMap = {};
  let specs: LineSpec[] = [];
  let fields: SymbolTextFieldHandle[] = [];
  /** The field "Add symbol" puts a symbol into: the last one written in. */
  let target = 0;
  let selected: string | null = null;

  const lines = el('div', { className: 'cg-block-lines' });
  const inspector = el('div', {});

  const drawing = (ch: string): Element | null => {
    const sym = map[ch];
    if (!sym) return null;
    return sym.kind === 'lucide' ? lucideImg(sym.name) : ringsSvg(lookRings(sym.rings, lookOf(sym)), 22);
  };
  const lineOf = (ch: string) => fields.findIndex((f) => f.getValue().includes(ch));
  /** The symbol and its twin, when "Both sides" made one. */
  const groupOf = (ch: string): string[] => {
    const pair = map[ch]?.pair;
    return [ch, ...Object.keys(map).filter((c) => c !== ch && pair !== undefined && map[c]!.pair === pair)];
  };
  const commit = (next: SymbolMap) => {
    map = next;
    opts.onSymbols(next);
  };
  const setLine = (i: number, text: string) => {
    fields[i]!.setValue(text);
    opts.onLine(i, text);
  };

  function select(ch: string | null, from: number) {
    selected = ch;
    fields.forEach((f, j) => {
      if (j !== from) f.setSelected(null);
    });
    showInspector();
  }

  function place(ch: string, where: SymbolPlacement) {
    const i = lineOf(ch);
    if (i < 0) return;
    const group = groupOf(ch);
    const next = { ...map };
    for (const c of group) if (c !== ch) delete next[c];
    const { pair: _old, ...solo } = next[ch]!;
    if (where === 'both') {
      const twin = nextSymbolChar((c) => c in map);
      const text = placeSymbol(fields[i]!.getValue(), group, 'both', twin, specs[i]?.maxLength);
      if (text === null) {
        toast('There is no room on this line for a second copy.', { kind: 'warn' });
        return;
      }
      next[ch] = { ...solo, pair: ch } as BlockSymbol;
      next[twin] = { ...solo, pair: ch } as BlockSymbol;
      commit(next);
      setLine(i, text);
    } else {
      next[ch] = solo as BlockSymbol;
      commit(next);
      setLine(i, placeSymbol(fields[i]!.getValue(), group, where) ?? fields[i]!.getValue());
    }
    fields[i]!.setSelected(ch);
  }

  function showInspector() {
    const ch = selected;
    const sym = ch ? map[ch] : undefined;
    if (!ch || !sym) {
      inspector.replaceChildren();
      return;
    }
    const look = lookOf(sym);
    const panel = symbolInspector({
      label: sym.label ?? 'Symbol',
      values: look,
      onChange: (patch) => {
        const next = { ...map };
        for (const c of groupOf(ch)) next[c] = { ...next[c]!, ...patch } as BlockSymbol;
        commit(next);
        if ('rotation' in patch || 'flip' in patch) for (const f of fields) f.repaint();
      },
      ...(opts.placement ? { onPlace: (where: SymbolPlacement) => place(ch, where) } : {}),
      onShift: (dir) => {
        const i = lineOf(ch);
        if (i < 0) return;
        setLine(i, shiftSymbol(fields[i]!.getValue(), ch, dir));
        fields[i]!.setSelected(ch);
      },
      onReplace: () =>
        pickSymbol(panel, (picked) => {
          const next = { ...map };
          for (const c of groupOf(ch)) next[c] = reshaped(next[c]!, picked);
          commit(next);
          for (const f of fields) f.repaint();
          panel.setLabel(picked.label);
        }),
      onRemove: () => {
        const i = lineOf(ch);
        const group = groupOf(ch);
        if (i >= 0) setLine(i, Array.from(fields[i]!.getValue()).filter((c) => !group.includes(c)).join(''));
        const next = { ...map };
        for (const c of group) delete next[c];
        commit(next);
        selected = null;
        showInspector();
      },
    });
    inspector.replaceChildren(panel);
  }

  const addButton = button({
    label: 'Add symbol',
    emphasis: 'secondary',
    onClick: () =>
      pickSymbol(addButton, (picked) => {
        const field = fields[target] ?? fields[0];
        if (!field) return;
        const ch = nextSymbolChar((c) => c in map);
        commit({ ...map, [ch]: { kind: 'rings', label: picked.label, rings: picked.rings } });
        // Fires onInput (the line, now holding it) and then selects it, which opens its controls.
        if (!field.insertAtCaret(ch)) {
          const { [ch]: _gone, ...rest } = map;
          commit(rest);
          toast('That line is full. Take a character out to make room for a symbol.', { kind: 'warn' });
        }
      }),
  });

  return {
    addButton,
    lines,
    inspector,
    setLines(next, values) {
      specs = next;
      fields = next.map((spec, i) =>
        symbolTextField({
          label: spec.label,
          inlineLabel: true,
          value: values[i] ?? '',
          ...(spec.maxLength ? { maxLength: spec.maxLength } : {}),
          ...(spec.overwrite ? { overwrite: true } : {}),
          ...(spec.hint ? { hint: spec.hint } : {}),
          ...(spec.onRemove
            ? { action: iconButton({ icon: ICONS.close, label: `Remove ${spec.label.toLowerCase()}`, onClick: spec.onRemove }) }
            : {}),
          renderSymbol: drawing,
          symbolLabel: (ch) => map[ch]?.label ?? 'Symbol',
          onInput: (v) => opts.onLine(i, v),
          onSelectSymbol: (ch) => select(ch, i),
          onFocus: () => {
            target = i;
          },
        }),
      );
      target = Math.min(target, Math.max(0, fields.length - 1));
      lines.replaceChildren(...fields);
      if (selected && lineOf(selected) < 0) selected = null;
      if (selected) fields[lineOf(selected)]!.setSelected(selected);
      showInspector();
    },
    setValues(values) {
      fields.forEach((f, i) => {
        if (!f.contains(document.activeElement)) f.setValue(values[i] ?? '');
      });
      if (selected && lineOf(selected) < 0) select(null, -1);
    },
    setSymbols(next) {
      if (next === map) return;
      map = next;
      for (const f of fields) f.repaint();
      if (selected && !map[selected]) select(null, -1);
    },
    setHint(index, hint) {
      fields[index]?.setHint(hint);
    },
    focus(index) {
      target = index;
      fields[index]?.focus();
    },
  };
}
