import { el, uid } from '../dom';
import {
  clampEdit,
  hasSymbol,
  insertText,
  isSymbolChar,
  moveSymbol,
  removeSymbolAt,
  snapOffset,
} from '../symbols/rules';
import { textField } from './elements';

/*
  One line of text with symbols in it.

  The value is a plain string; a symbol is one private-use code point inside it (see
  `symbols/rules.ts`), and the app says what each one looks like through `renderSymbol`. While
  the value holds no symbol this is the kit's own text input, untouched: native caret, IME and
  undo. The first symbol swaps in a contenteditable line that draws each symbol as a token —
  click or Enter selects it, Delete or Backspace removes it, dragging moves it — and the input
  comes back when the last symbol goes. Both sit in one box that carries the field's border, so
  the swap does not move a pixel.

  The field never learns where symbols are stored or how they are traced. It reports every
  edit through `onInput`, a selected token through `onSelectSymbol`, and takes new symbols
  through `insertAtCaret` — which is what an "Add symbol" button calls once the library hands
  back a pick. Several fields can share one such button: `onFocus` says which field was last
  in use, and its caret is remembered after focus leaves for the library.

  Rules worth knowing:
  - `maxLength` counts code points, so a symbol is one character, and it is enforced on every
    path in: typing, pasting, dropping and `insertAtCaret`.
  - Pasted and dropped text arrives as plain text with each line break turned into a space;
    Enter does nothing. It is one line.
  - The value is read from the editor's own structure, never from `textContent`, so a drawing
    that carries text of its own (an SVG `<title>`) cannot leak into it.
*/

export interface SymbolTextFieldOptions {
  /** Shown above the field — or beside it with `inlineLabel` — and its accessible name. */
  label: string;
  /** The label to the LEFT of the field, on one row with it. */
  inlineLabel?: boolean;
  /** Text; symbols are code points U+F0000–U+10FFFD. */
  value: string;
  placeholder?: string;
  /** In code points. */
  maxLength?: number;
  /** A slot per character, such as a key per character on a row of keys: when the field is
   *  full, `insertAtCaret` puts the symbol in place of the character after the caret (the last
   *  one, at the end) instead of refusing it. */
  overwrite?: boolean;
  /** Muted text inside the field's right edge, such as a count of what the text holds. */
  hint?: string;
  /** A control beside the field, outside its box: the field's own "Add symbol" button. */
  action?: HTMLElement;
  /** The drawing for one symbol, about 24 px square. Null draws an empty dashed square, so a
   *  symbol the app no longer knows can still be seen and removed. */
  renderSymbol(char: string): Element | null;
  /** A symbol's name, for its tooltip and screen readers. Default "Symbol". */
  symbolLabel?(char: string): string;
  /** Every edit the person makes, and every `insertAtCaret` that went in. Never `setValue`. */
  onInput(value: string): void;
  /** A token was selected (click, Enter, a drop, an insert), or the selected symbol left the
   *  text (null). */
  onSelectSymbol?(char: string | null): void;
  /** Focus entered the field. */
  onFocus?(): void;
}

export type SymbolTextFieldHandle = HTMLElement & {
  getValue(): string;
  /** Replace the text. Fires nothing; keeps the selection if its symbol is still there. */
  setValue(value: string): void;
  /**
   * Insert at the caret the field last had, replacing the text it had selected, cut to fit
   * `maxLength` (or, with `overwrite`, in place of the character at the caret). Fires
   * `onInput`, then — when `text` is one symbol — selects it and fires `onSelectSymbol`. False
   * when nothing fitted.
   */
  insertAtCaret(text: string): boolean;
  setHint(text: string): void;
  /** Takes effect on the next edit; text already over the new limit is left as it is. */
  setMaxLength(n: number | undefined): void;
  /** Mark the tokens of one symbol as selected, or none. Fires nothing. */
  setSelected(char: string | null): void;
  /** Redraw every token, after the app changed what one looks like. */
  repaint(): void;
  /** Focus the field at the caret it last had. */
  focus(): void;
};

const TOKEN = 'vl-symbol-field__token';
const LINE_BREAKS = /\r\n?|\n/g;

/** A text field that holds symbols as inline tokens. */
export function symbolTextField(opts: SymbolTextFieldOptions): SymbolTextFieldHandle {
  let value = opts.value;
  let max = opts.maxLength;
  let selected: string | null = null;
  /** Whether the token editor is the one showing. */
  let rich = false;
  /** The token editor's last caret, kept for `insertAtCaret` once focus has gone elsewhere.
   *  The plain input keeps its own selection when it loses focus, so it is read directly. */
  let caret = { start: value.length, end: value.length };
  /** The offset of the token being dragged. */
  let dragFrom: number | null = null;
  let composing = false;
  /** The value when an IME composition began: `maxLength` is held against it at the end. */
  let composedFrom: string | null = null;

  const field = textField({ label: opts.label, value, placeholder: opts.placeholder, onInput: () => plainInput() });
  const input = field.field;
  input.autocomplete = 'off';
  input.spellcheck = false;

  const editor = el('div', {
    className: 'vl-symbol-field__rich',
    attrs: { contenteditable: 'true', role: 'textbox', 'aria-multiline': 'false', spellcheck: 'false' },
  });
  const label = field.querySelector('label');
  if (label) {
    label.id = uid('vl-symbol-label');
    editor.setAttribute('aria-labelledby', label.id);
  } else {
    editor.setAttribute('aria-label', opts.placeholder ?? 'Text');
  }
  const hint = el('span', { className: 'vl-symbol-field__hint', attrs: { id: uid('vl-symbol-hint') } });
  input.setAttribute('aria-describedby', hint.id);
  editor.setAttribute('aria-describedby', hint.id);

  const box = el('div', { className: 'vl-symbol-field__box' }, [input, editor, hint]);
  field.append(box);
  const root = el('div', {
    className: `vl-symbol-field${opts.inlineLabel ? ' vl-symbol-field--inline' : ''}`,
  }, [field]) as unknown as SymbolTextFieldHandle;
  if (opts.action) root.append(opts.action);

  /* ------------------------------------------------ reading the token editor */

  const isToken = (node: Node): node is HTMLElement => node instanceof HTMLElement && node.classList.contains(TOKEN);

  /** How much of the value a node stands for: its text, with a token as its one symbol and
   *  nothing else — whatever text the drawing inside it holds. */
  const lengthOf = (node: Node): number => {
    if (node.nodeType === Node.TEXT_NODE) return (node as Text).data.length;
    if (isToken(node)) return (node.dataset.char ?? '').length;
    let n = 0;
    for (const child of Array.from(node.childNodes)) n += lengthOf(child);
    return n;
  };
  const textOf = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return (node as Text).data;
    if (isToken(node)) return node.dataset.char ?? '';
    let s = '';
    for (const child of Array.from(node.childNodes)) s += textOf(child);
    return s;
  };

  /** A DOM position inside the editor as an offset into the value. A position inside a token
   *  counts as before it when it is at its very start, and after it otherwise. */
  const offsetOf = (container: Node, offset: number): number => {
    let node = container;
    let at = 0;
    if (node.nodeType === Node.TEXT_NODE) at = offset;
    else for (let i = 0; i < offset && i < node.childNodes.length; i++) at += lengthOf(node.childNodes[i]!);
    while (node !== editor) {
      if (isToken(node)) at = at > 0 ? lengthOf(node) : 0;
      for (let s = node.previousSibling; s; s = s.previousSibling) at += lengthOf(s);
      const parent = node.parentNode;
      if (!parent) return value.length;
      node = parent;
    }
    return at;
  };

  const tokenOffset = (token: HTMLElement): number => {
    const parent = token.parentNode!;
    return offsetOf(parent, Array.from(parent.childNodes).indexOf(token));
  };

  /** The editor's selection as value offsets, or null when the selection is elsewhere. */
  const richSelection = (): { start: number; end: number } | null => {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!editor.contains(r.startContainer) || !editor.contains(r.endContainer)) return null;
    return { start: offsetOf(r.startContainer, r.startOffset), end: offsetOf(r.endContainer, r.endOffset) };
  };

  const remember = () => {
    if (!rich) return;
    const s = richSelection();
    if (s) caret = s;
  };

  /** The caret or selection an insert replaces, wherever focus is now. */
  const insertRange = (): { start: number; end: number } =>
    rich ? caret : { start: input.selectionStart ?? value.length, end: input.selectionEnd ?? value.length };

  /** Where the caret is now, when focus is in the field. */
  const caretNow = (): number =>
    rich ? (richSelection()?.end ?? caret.end) : (input.selectionEnd ?? value.length);

  const hasFocus = () => box.contains(document.activeElement);

  /** Put the caret in the editor at a value offset. */
  const placeRichCaret = (offset: number) => {
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    let at = offset;
    let placed = false;
    for (const node of Array.from(editor.childNodes)) {
      const len = lengthOf(node);
      if (node.nodeType === Node.TEXT_NODE && at <= len) {
        range.setStart(node, Math.max(0, at));
        placed = true;
        break;
      }
      if (node.nodeType !== Node.TEXT_NODE && at <= 0) {
        range.setStartBefore(node);
        placed = true;
        break;
      }
      at -= len;
    }
    if (!placed) range.setStart(editor, editor.childNodes.length);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  };

  /** Focus whichever editor is showing, with the caret at a value offset. */
  const focusAt = (offset: number) => {
    const at = snapOffset(value, offset);
    caret = { start: at, end: at };
    if (rich) {
      editor.focus({ preventScroll: true });
      placeRichCaret(at);
    } else {
      input.focus({ preventScroll: true });
      input.setSelectionRange(at, at);
    }
  };

  /* ------------------------------------------------------------- drawing */

  function token(ch: string): HTMLElement {
    const name = opts.symbolLabel?.(ch) || 'Symbol';
    const selectable = !!opts.onSelectSymbol;
    const art = opts.renderSymbol(ch) ?? el('span', { className: 'vl-symbol-field__missing' });
    return el('span', {
      className: TOKEN,
      attrs: {
        contenteditable: 'false',
        draggable: 'true',
        tabindex: '0',
        role: 'button',
        'aria-label': selectable ? `Edit ${name}` : name,
        'aria-pressed': String(ch === selected),
        title: `${name} — drag to move${selectable ? ', click to edit' : ''}`,
        'data-char': ch,
      },
    }, [
      // The symbol's own character, invisible, so the editor's text and its DOM positions
      // carry the token at its real width in the value.
      el('span', { className: 'vl-symbol-field__marker', text: ch }),
      art,
    ]);
  }

  /** Show the right editor for the value, and redraw the tokens. */
  function paint() {
    rich = hasSymbol(value);
    input.hidden = rich;
    editor.hidden = !rich;
    if (input.value !== value) input.value = value;
    if (!rich) {
      editor.replaceChildren();
      return;
    }
    // Text, token, text, token, text: a text node on both sides of every token, empty or not,
    // so the caret always has somewhere to stand between two symbols and after the last.
    const nodes: Node[] = [];
    let run = '';
    for (const ch of value) {
      if (!isSymbolChar(ch)) {
        run += ch;
        continue;
      }
      nodes.push(document.createTextNode(run), token(ch));
      run = '';
    }
    nodes.push(document.createTextNode(run));
    editor.replaceChildren(...nodes);
  }

  function markSelection() {
    for (const t of Array.from(editor.querySelectorAll<HTMLElement>(`.${TOKEN}`))) {
      t.setAttribute('aria-pressed', String(t.dataset.char === selected));
    }
  }

  function choose(ch: string) {
    selected = ch;
    markSelection();
    opts.onSelectSymbol?.(ch);
  }

  /* -------------------------------------------------------------- editing */

  /** An edit the person made: store it, report it, and let go of a selected symbol that is no
   *  longer in the text. */
  function edited(next: string) {
    if (next === value) return;
    value = next;
    opts.onInput(value);
    if (selected !== null && !value.includes(selected)) {
      selected = null;
      opts.onSelectSymbol?.(null);
    }
  }

  /** An edit the field made itself (a drop, a paste, a removal, an insert): store it, redraw,
   *  and put the caret after it if focus was in the field. */
  function commit(next: string, at: number, focus = hasFocus()) {
    edited(next);
    caret = { start: at, end: at };
    paint();
    if (focus) focusAt(at);
    // Unfocused, the plain input still remembers a caret, and the next insert goes there.
    else if (!rich) input.setSelectionRange(at, at);
  }

  /** After a native edit: hold it to `maxLength`, report it, and swap editors if the text has
   *  just gained its first symbol or lost its last. */
  function settle(next: string, at: number | undefined) {
    if (composing) {
      edited(next);
      return;
    }
    const fixed = clampEdit(composedFrom ?? value, next, max, at);
    composedFrom = null;
    if (fixed) {
      commit(fixed.value, fixed.caret, true);
      return;
    }
    edited(next);
    const end = at ?? next.length;
    caret = { start: end, end };
    if (hasSymbol(value) !== rich) {
      paint();
      focusAt(end);
    }
  }

  function plainInput() {
    settle(input.value, input.selectionEnd ?? undefined);
  }

  function richInput() {
    settle(textOf(editor), richSelection()?.end);
  }

  for (const target of [input, editor]) {
    target.addEventListener('compositionstart', () => {
      composing = true;
      composedFrom ??= value;
    });
    target.addEventListener('compositionend', () => {
      composing = false;
      if (target === input) plainInput();
      else richInput();
    });
  }

  editor.addEventListener('input', richInput);
  for (const type of ['keyup', 'mouseup', 'blur'] as const) editor.addEventListener(type, remember);

  editor.addEventListener('beforeinput', (e) => {
    const type = e.inputType;
    if (type === 'insertParagraph' || type === 'insertLineBreak' || type.startsWith('format')) e.preventDefault();
  });

  const tokenOf = (target: EventTarget | null): HTMLElement | null => {
    const t = target instanceof Element ? target.closest<HTMLElement>(`.${TOKEN}`) : null;
    return t && editor.contains(t) ? t : null;
  };

  editor.addEventListener('click', (e) => {
    const t = tokenOf(e.target);
    if (t?.dataset.char) choose(t.dataset.char);
  });

  editor.addEventListener('keydown', (e) => {
    const t = tokenOf(e.target);
    if (!t) {
      if (e.key === 'Enter') e.preventDefault();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (t.dataset.char) choose(t.dataset.char);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const edit = removeSymbolAt(value, tokenOffset(t));
      commit(edit.value, edit.caret, true);
    }
  });

  editor.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData?.getData('text/plain') ?? '').replace(LINE_BREAKS, ' ');
    const at = richSelection() ?? caret;
    const edit = insertText(value, at.start, at.end, text, max);
    if (edit) commit(edit.value, edit.caret, true);
  });

  /* ---------------------------------------------------------- drag to move */

  /* Selected TEXT dragged within the editor is the browser's to move, as in any text box; only
     a token drag and a drop from outside are handled here. */
  let nativeDrag = false;
  const endDrag = () => {
    dragFrom = null;
    nativeDrag = false;
    box.classList.remove('vl-symbol-field__box--dragging');
  };

  /** The value offset under a point, or null when the point is not over the editor. */
  const pointOffset = (x: number, y: number): number | null => {
    const doc = document as unknown as {
      caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?(x: number, y: number): Range | null;
    };
    let node: Node | null = null;
    let offset = 0;
    if (doc.caretPositionFromPoint) {
      const p = doc.caretPositionFromPoint(x, y);
      if (p) ({ offsetNode: node, offset } = p);
    } else if (doc.caretRangeFromPoint) {
      const r = doc.caretRangeFromPoint(x, y);
      if (r) ({ startContainer: node, startOffset: offset } = r);
    }
    return node && editor.contains(node) ? offsetOf(node, offset) : null;
  };

  editor.addEventListener('dragstart', (e) => {
    const t = tokenOf(e.target);
    if (!t) {
      nativeDrag = true;
      return;
    }
    dragFrom = tokenOffset(t);
    e.dataTransfer?.setData('text/plain', t.dataset.char ?? '');
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });
  editor.addEventListener('dragover', (e) => {
    if (nativeDrag) return;
    // Taken whether it is a token moving or text arriving: the drop below handles both, so
    // the browser never inserts the dragged markup itself.
    e.preventDefault();
    if (dragFrom === null) return;
    box.classList.add('vl-symbol-field__box--dragging');
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  });
  editor.addEventListener('dragend', endDrag);
  editor.addEventListener('drop', (e) => {
    if (nativeDrag) return;
    e.preventDefault();
    const from = dragFrom;
    endDrag();
    const at = pointOffset(e.clientX, e.clientY) ?? value.length;
    if (from === null) {
      const text = (e.dataTransfer?.getData('text/plain') ?? '').replace(LINE_BREAKS, ' ');
      const edit = text ? insertText(value, at, at, text, max) : null;
      if (edit) commit(edit.value, edit.caret);
      return;
    }
    const cp = value.codePointAt(from);
    if (cp === undefined) return;
    const edit = moveSymbol(value, from, at);
    commit(edit.value, edit.caret);
    choose(String.fromCodePoint(cp));
  });

  /* ------------------------------------------------------------- the box */

  box.addEventListener('focusin', () => opts.onFocus?.());
  // The padding and the hint are part of the field: a press there focuses it.
  box.addEventListener('mousedown', (e) => {
    if (e.target !== box && e.target !== hint) return;
    e.preventDefault();
    focusAt(value.length);
  });
  // The label points at the input; while the token editor is showing, it focuses that instead.
  label?.addEventListener('click', (e) => {
    if (!rich) return;
    e.preventDefault();
    focusAt(caret.end);
  });

  /* --------------------------------------------------------------- handle */

  root.getValue = () => value;
  root.setValue = (next) => {
    if (next === value) return;
    const focused = hasFocus();
    const at = focused ? caretNow() : next.length;
    value = next;
    composedFrom = null;
    if (selected !== null && !value.includes(selected)) selected = null;
    caret = { start: snapOffset(value, at), end: snapOffset(value, at) };
    paint();
    if (focused) focusAt(at);
  };
  root.insertAtCaret = (text) => {
    const clean = text.replace(LINE_BREAKS, ' ');
    const range = insertRange();
    let edit = insertText(value, range.start, range.end, clean, max);
    if (!edit && opts.overwrite && range.start === range.end && value) {
      // Full: the character after the caret gives up its slot, or the last one at the end.
      const at = snapOffset(value, range.start);
      const after = Array.from(value.slice(at))[0];
      const before = Array.from(value.slice(0, at)).pop() ?? '';
      edit = after ? insertText(value, at, at + after.length, clean, max) : insertText(value, at - before.length, at, clean, max);
    }
    if (!edit) return false;
    commit(edit.value, edit.caret);
    if (isSymbolChar(clean)) choose(clean);
    return true;
  };
  root.setHint = (text) => {
    hint.textContent = text;
    hint.hidden = !text;
  };
  root.setMaxLength = (n) => {
    max = n;
  };
  root.setSelected = (ch) => {
    selected = ch;
    markSelection();
  };
  root.repaint = () => {
    const focused = hasFocus();
    const at = focused ? caretNow() : caret.end;
    paint();
    if (focused) focusAt(at);
  };
  root.focus = () => focusAt(rich ? caret.end : (input.selectionEnd ?? value.length));

  root.setHint(opts.hint ?? '');
  paint();
  return root;
}
