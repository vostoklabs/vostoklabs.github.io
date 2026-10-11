import { el, svgNode } from '../dom';
import { groupCaption, type ValueRow } from './controls';

/*
  A small picture of a keycap's top seen from above, with a numbered spot where each legend
  sits: tap a spot to pick that legend. An "All" choice beside the spots picks all of them at
  once.

  It is a radio group, one choice among the spots and "All", because that is what it is: the
  picture is the label for each choice, so a list of "Legend 1, Legend 2" is not needed beside
  it. One Tab stop, the arrow keys move the choice, as in `segmentedControl()`.

  Drawn with elements and classes only. The spots are positioned through the CSSOM, and the
  picture's proportions reach the stylesheet as a custom property, so a host whose
  content-security policy refuses style attributes draws it the same.
*/

export interface CapMapSpot<T extends string = string> {
  value: T;
  /** Its name for a screen reader and the tooltip ("Legend 2"). The spot shows its number. */
  label: string;
  /** Where it sits on the top, from 0 to 1: across from the left edge, and down from the top. */
  x: number;
  y: number;
}

export interface CapMapOptions<T extends string = string> {
  /** Caption over the picture. */
  label?: string;
  /** Optional "?" tooltip next to the caption (implies a caption line). */
  help?: string;
  /** The top's proportions, in millimetres. The picture is drawn to them, not to scale. */
  width: number;
  height: number;
  /** One spot per legend, numbered from 1 in this order. */
  spots: CapMapSpot<T>[];
  value: T;
  /** A choice under the picture that picks every spot at once ("All legends"). */
  all?: { value: T; label: string };
  onChange: (value: T) => void;
}

export type CapMapHandle<T extends string = string> = ValueRow<T> & {
  /**
   * Swap the spots: another layout, or another number of legends. A choice that is no longer
   * offered falls back to the first spot (or "All" when there are none), and `onChange` fires
   * with it, so the app never edits a legend the picture no longer shows.
   */
  setSpots(spots: CapMapSpot<T>[]): void;
  /** Redraw the top to other proportions (another key size), keeping the spots where they are
   *  on it. */
  setShape(width: number, height: number): void;
};

/** The rim of the cap round its top, as a share of the top's shorter side. */
const RIM = 0.14;

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.5));

export function capMap<T extends string = string>(opts: CapMapOptions<T>): CapMapHandle<T> {
  const rim = svgNode('rect', { class: 'vl-cap-map__rim' });
  const top = svgNode('rect', { class: 'vl-cap-map__top' });
  const art = svgNode('svg', { class: 'vl-cap-map__art', 'aria-hidden': 'true', focusable: 'false' }, [rim, top]);
  const face = el('div', { className: 'vl-cap-map__face' }, [art]);
  const group = el('div', { className: 'vl-cap-map', attrs: { role: 'radiogroup' } }, [face]);

  let spots = opts.spots;
  let active = opts.value;
  let disabled = false;
  const spotButtons = new Map<T, HTMLButtonElement>();

  const all = opts.all;
  const allButton = all
    ? (el('button', {
        className: 'vl-cap-map__all',
        text: all.label,
        attrs: { type: 'button', role: 'radio', 'aria-checked': 'false' },
        on: { click: () => choose(all.value) },
      }) as HTMLButtonElement)
    : null;
  if (allButton) group.append(allButton);

  /* ------------------------------------------------------------------ the picture -- */

  let shape = { w: 1, h: 1, m: RIM };
  const drawShape = (width: number, height: number) => {
    const w = width > 0 ? width : 1;
    const h = height > 0 ? height : 1;
    const m = Math.min(w, h) * RIM;
    const W = w + 2 * m;
    const H = h + 2 * m;
    shape = { w, h, m };
    const n = (v: number) => String(Number(v.toFixed(4)));
    art.setAttribute('viewBox', `0 0 ${n(W)} ${n(H)}`);
    for (const [k, v] of Object.entries({ x: 0, y: 0, width: W, height: H, rx: Math.min(W, H) * 0.13 })) rim.setAttribute(k, n(v));
    for (const [k, v] of Object.entries({ x: m, y: m, width: w, height: h, rx: Math.min(w, h) * 0.11 })) top.setAttribute(k, n(v));
    // The face is sized from this in CSS (`aspect-ratio`), so the picture keeps the cap's shape.
    face.style.setProperty('--cap-ratio', String(Number((W / H).toFixed(4))));
  };

  /** A spot's place as a share of the face, which is the top plus its rim on every side. */
  const placeSpot = (b: HTMLElement, s: CapMapSpot<T>) => {
    const { w, h, m } = shape;
    const pct = (v: number) => `${Number(v.toFixed(3))}%`;
    b.style.left = pct(((m + clamp01(s.x) * w) / (w + 2 * m)) * 100);
    b.style.top = pct(((m + clamp01(s.y) * h) / (h + 2 * m)) * 100);
  };

  /* ------------------------------------------------------------------- the choice -- */

  const values = (): T[] => [...spots.map((s) => s.value), ...(all ? [all.value] : [])];
  const radios = (): HTMLButtonElement[] => [...spotButtons.values(), ...(allButton ? [allButton] : [])];

  /** Repaint the choice. Shared by taps, keys and `setValue`, so the three cannot drift. */
  const paint = () => {
    const everything = !!all && active === all.value;
    for (const [value, b] of spotButtons) {
      const on = value === active;
      b.classList.toggle('is-active', on);
      // With "All" chosen, every spot is part of the choice: each is marked, none is filled.
      b.classList.toggle('is-included', everything);
      b.setAttribute('aria-checked', String(on));
    }
    if (allButton) {
      allButton.classList.toggle('is-active', everything);
      allButton.setAttribute('aria-checked', String(everything));
    }
    // One Tab stop for the group, on the choice, or on the first spot while nothing is chosen.
    const list = radios();
    const stop = list.find((b) => b.getAttribute('aria-checked') === 'true') ?? list[0];
    for (const b of list) {
      b.tabIndex = b === stop ? 0 : -1;
      b.disabled = disabled;
    }
  };

  function choose(value: T) {
    if (value === active) return;
    active = value;
    paint();
    opts.onChange(value);
  }

  const renderSpots = () => {
    for (const b of spotButtons.values()) b.remove();
    spotButtons.clear();
    spots.forEach((s, i) => {
      const b = el('button', {
        className: 'vl-cap-map__spot',
        text: String(i + 1),
        attrs: { type: 'button', role: 'radio', 'aria-checked': 'false', 'aria-label': s.label, title: s.label },
        on: { click: () => choose(s.value) },
      }) as HTMLButtonElement;
      placeSpot(b, s);
      spotButtons.set(s.value, b);
      face.append(b);
    });
  };

  // The radio-group keys: arrows step through the spots, then "All", wrapping at the ends;
  // Home and End jump to the first and last. A step chooses, as a tap does.
  group.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    const step = k === 'ArrowRight' || k === 'ArrowDown' ? 1 : k === 'ArrowLeft' || k === 'ArrowUp' ? -1 : 0;
    if (!step && k !== 'Home' && k !== 'End') return;
    const order = values();
    if (!order.length || disabled) return;
    e.preventDefault();
    const at = order.indexOf(active);
    const from = at === -1 ? (step > 0 ? -1 : 0) : at;
    const next =
      k === 'Home' ? order[0]! :
      k === 'End' ? order[order.length - 1]! :
      order[(from + step + order.length) % order.length]!;
    choose(next);
    (next === all?.value ? allButton : spotButtons.get(next))?.focus();
  });

  drawShape(opts.width, opts.height);
  renderSpots();
  paint();

  let root: HTMLElement = group;
  if (opts.label || opts.help) {
    const cap = groupCaption(opts.label, opts.help);
    if (opts.label) group.setAttribute('aria-labelledby', cap.textId);
    root = el('div', { className: 'vl-control' }, [cap.line, group]);
  }

  const handle = root as unknown as CapMapHandle<T>;
  // An unknown value is ignored rather than clearing the choice, as in `segmentedControl`.
  handle.setValue = (value, notify = false) => {
    if (!values().includes(value) || value === active) return;
    active = value;
    paint();
    if (notify) opts.onChange(value);
  };
  handle.getValue = () => active;
  handle.setDisabled = (d) => {
    disabled = d;
    handle.classList.toggle('vl-control--disabled', d);
    handle.setAttribute('aria-disabled', String(d));
    paint();
  };
  handle.setSpots = (next) => {
    spots = next;
    renderSpots();
    const offered = values();
    if (offered.length && !offered.includes(active)) {
      active = offered[0]!;
      paint();
      opts.onChange(active);
      return;
    }
    paint();
  };
  handle.setShape = (width, height) => {
    drawShape(width, height);
    spots.forEach((s) => {
      const b = spotButtons.get(s.value);
      if (b) placeSpot(b, s);
    });
  };
  return handle;
}
