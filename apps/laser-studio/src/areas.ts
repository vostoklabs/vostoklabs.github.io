// Pattern areas: which surfaces of an uploaded SVG the pattern fills.
//
// An SVG traced by the symbol picker comes back as ISLANDS — `symbolIslands` re-nests the
// tracer's loose rings by containment, so each island is one FACE of the drawing: an outer
// ring and the holes punched in it. A face is a surface with an area, which is exactly what
// the laser cuts out and exactly what a pattern can fill, so it is already the thing the
// customer points at. Picking is therefore a set of island indices and nothing else — no
// second geometry pass, no hit-test of our own (SVG's `fill-rule: evenodd` hit-tests a face
// with holes correctly, so a face nested in another face's hole is clickable on its own).
//
// The stored value is `"<char>|<i>,<j>"`: the artwork it was picked ON, then the faces. Import
// a different SVG and the char no longer matches, so the pick falls back to "every area"
// rather than pointing at faces of a drawing that is gone. An empty value means every area
// too — which is what a one-piece silhouette (an earring blank) wants without a single click.
import { bboxOf, signedArea, type Shapes } from '@vostok/laser';
import {
  button, buttonRow, closeAllMenus, el, openMenu, splitDialog, toggleSwitch,
  type SvgImportChoice, type SvgImportPart,
} from '@vostok/ui-kit';
import { insideShapes } from './engine/editorGeometry';
import { symbolLayer } from './engine/text';
import { readSymbols, symbolIslands } from './symbols/model';
import type { Values } from './templates/types';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** The size the picker traces at. A face's INDEX does not move with scale, so any size does. */
const NOMINAL = 100;

/** The artwork's faces, in the one order everything here counts in. */
export async function artworkFaces(values: Values, key: string): Promise<Shapes> {
  const char = String(values[key] ?? '');
  if (!char) return [];
  const layers = await symbolLayer(char, NOMINAL, 'cut', { symbols: readSymbols(values) });
  return symbolIslands(layers.flatMap((l) => l.shapes));
}

/** The picked faces, or null for "every one of them" — an empty value, or a pick made on a
 *  different artwork. An EMPTY set is a real answer (the customer cleared them all). */
export function pickedAreas(value: string, char: string): Set<number> | null {
  const bar = value.indexOf('|');
  if (bar < 0 || value.slice(0, bar) !== char) return null;
  // `.filter(Boolean)` BEFORE `Number`, and it is not cosmetic: `Number('')` is 0, so an empty
  // list — the customer turning every area off — parsed as "face 0" and patterned it.
  const ids = value.slice(bar + 1).split(',').filter(Boolean).map(Number).filter((x) => Number.isInteger(x) && x >= 0);
  return new Set(ids);
}

export const areasValue = (char: string, ids: Iterable<number>): string =>
  `${char}|${[...ids].sort((a, b) => a - b).join(',')}`;

/** The faces at a size, about the origin. The picker and `build()` both take the faces from
 *  `artworkFaces` and scale THAT — never re-trace at a different size — so a face keeps the
 *  index it was clicked under. */
export const scaleFaces = (faces: Shapes, k: number): Shapes =>
  faces.map((face) => face.map((ring) => ring.map(([x, y]) => [x * k, y * k] as [number, number])));

/** The longest side of the artwork's box, at whatever size it was traced. */
export function spanOf(faces: Shapes): number {
  const b = bboxOf(faces);
  return Math.max(b.maxX - b.minX, b.maxY - b.minY, 0.001);
}

/**
 * Everything on the artwork you can click: every face, then every HOLE in one.
 *
 * A hole is an area too. On a box panel the square in the middle is the one place the pattern
 * belongs, and a cut file draws that square as a line, so it traces as a hole in the panel —
 * the only surface anyone wanted was the one they could not click (2026-09-27). Clicking a
 * hole fills it back in and patterns it: its line is no longer cut, because cutting it would
 * drop the pattern out with the square. Holes start OFF, so an earring's hanging hole stays a
 * hole until someone points at it.
 *
 * The faces keep their indices and the holes come after them, so a pick saved before holes
 * could be picked still lands on the same faces.
 */
export interface ArtworkAreas {
  /** The faces, then one area per hole: its ring, less any face that sits inside it. */
  areas: Shapes;
  /** How many of `areas` are faces. The rest are holes. */
  solid: number;
  /** Per hole area (index − solid): the face it is a hole in, and which of that face's rings. */
  holeOf: [number, number][];
}

export function areasOf(faces: Shapes): ArtworkAreas {
  const holeOf: [number, number][] = [];
  faces.forEach((face, i) => face.forEach((_, k) => { if (k > 0) holeOf.push([i, k]); }));
  // A face drawn inside a hole (a disc in a hoop) is not part of the hole's surface: it is its
  // own area, so the hole area goes round it. The tightest hole around it is the one it is in.
  const within: number[][] = holeOf.map(() => []);
  faces.forEach((face, j) => {
    const p = face[0]?.[0];
    if (!p) return;
    let best = -1;
    let bestArea = Infinity;
    holeOf.forEach(([i, k], h) => {
      const ring = faces[i]![k]!;
      const a = Math.abs(signedArea(ring));
      if (i !== j && a < bestArea && insideShapes([[ring]], p)) { best = h; bestArea = a; }
    });
    if (best >= 0) within[best]!.push(j);
  });
  const holes = holeOf.map(([i, k], h) => [faces[i]![k]!, ...within[h]!.map((j) => faces[j]![0]!)]);
  return { areas: [...faces, ...holes], solid: faces.length, holeOf };
}

/** The region the pattern may fill: the areas that were picked, or every face for "all". */
export const regionOf = (a: ArtworkAreas, picked: Set<number> | null): Shapes =>
  picked ? a.areas.filter((_, i) => picked.has(i)) : a.areas.slice(0, a.solid);

/** The faces to cut, with every picked hole filled back in. */
export function filledFaces(a: ArtworkAreas, picked: Set<number> | null): Shapes {
  const faces = a.areas.slice(0, a.solid);
  const filled = new Set<string>();
  for (const i of picked ?? []) {
    const hole = i >= a.solid ? a.holeOf[i - a.solid] : undefined;
    if (hole) filled.add(`${hole[0]},${hole[1]}`);
  }
  return filled.size ? faces.map((face, i) => face.filter((_, k) => !filled.has(`${i},${k}`))) : faces;
}

/** How much is patterned, in the words the panel card, the picker and the status line share. */
export function pickedCount(a: ArtworkAreas, picked: Set<number> | null): { all: boolean; n: number; text: string } {
  const n = picked ? [...picked].filter((i) => i < a.areas.length).length : a.solid;
  const holes = picked ? [...picked].some((i) => i >= a.solid && i < a.areas.length) : false;
  const all = !holes && n === a.solid;
  // "5 of 7" is wrong the moment a hole is in the count, so a pick with holes is just counted.
  const text = holes ? `${n} ${n === 1 ? 'area' : 'areas'}` : `${n} of ${a.solid} areas`;
  return { all, n, text };
}

const svgEl = (tag: string, attrs: Record<string, string> = {}): SVGElement => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

const n = (v: number) => (Math.abs(v) < 5e-4 ? '0' : v.toFixed(3));

/** One face as a path, Y flipped for the screen. The holes ride in the same `d`, read even-odd,
 *  so they are transparent AND untouchable — a click in a hole is not a click on the face. */
const faceD = (face: Shapes[number]): string =>
  face.filter((r) => r.length >= 3).map((r) => `M ${r.map(([x, y]) => `${n(x)} ${n(-y)}`).join(' L ')} Z`).join(' ');

export interface AreaStage {
  svg: SVGSVGElement;
  /** Repaint from the sets, in place — so a keyboard focus survives a toggle. */
  sync(picked: Set<number> | null, removed?: Set<number>): void;
}

/** What a clickable stage can do to one shape. */
export interface AreaActions {
  /** Left click / Space: pattern it, or leave it plain. */
  toggle(i: number): void;
  /** Delete: take it out of the artwork altogether. */
  remove(i: number): void;
  /** Right click / Menu key: everything else, at the pointer. */
  menu(i: number, at: { x: number; y: number }): void;
}

/**
 * The artwork drawn face by face. With `on` each face is a checkbox you click and right-click; without
 * it the stage is a picture (the panel's card, which is not interactive and says so). `solid`
 * says where the faces end and the holes (`areasOf`) begin: a hole is drawn as the empty space
 * it is until it is picked.
 */
export function areaStage(faces: Shapes, picked: Set<number> | null, on?: AreaActions, solid = faces.length): AreaStage {
  const b = bboxOf(faces);
  const w = Math.max(b.maxX - b.minX, 1);
  const h = Math.max(b.maxY - b.minY, 1);
  const pad = Math.max(w, h) * 0.06;
  const svg = svgEl('svg', {
    viewBox: `${n(b.minX - pad)} ${n(-b.maxY - pad)} ${n(w + 2 * pad)} ${n(h + 2 * pad)}`,
    class: 'ls-area-stage',
    ...(on ? { role: 'group', 'aria-label': 'The shapes in your artwork' } : { 'aria-hidden': 'true' }),
  }) as SVGSVGElement;
  const name = (i: number) => (i < solid ? `Shape ${i + 1} of ${solid}` : `Hole ${i - solid + 1} of ${faces.length - solid}`);
  const paths = faces.map((face, i) => {
    const p = svgEl('path', { class: 'ls-area', d: faceD(face), 'fill-rule': 'evenodd', 'data-hole': String(i >= solid) });
    if (on) {
      p.setAttribute('role', 'checkbox');
      p.setAttribute('aria-label', name(i));
      p.setAttribute('tabindex', '0');
      p.addEventListener('click', () => on.toggle(i));
      p.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); on.toggle(i); return; }
        // Delete on a focused shape is the keyboard's version of the menu's Remove: a context
        // menu opened with the Menu key is one route, but not one anybody finds by accident.
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); on.remove(i); }
      });
      // The menu the whole window now hangs on. `contextmenu` covers the Menu key and
      // Shift+F10 as well as the right button, so the keyboard gets it for free.
      p.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        on.menu(i, { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY });
      });
    }
    svg.append(p);
    return p;
  });
  const sync = (picked: Set<number> | null, removed?: Set<number>) => {
    paths.forEach((p, i) => {
      const gone = removed?.has(i) ?? false;
      const lit = !gone && (picked ? picked.has(i) : i < solid);
      p.setAttribute('data-on', String(lit));
      p.setAttribute('data-removed', String(gone));
      if (on) {
        p.setAttribute('aria-checked', String(lit));
        p.setAttribute('aria-label', gone ? `${name(i).replace(/ of \d+$/, '')} — removed` : name(i));
      }
    });
  };
  sync(picked);
  return { svg, sync };
}

// --------------------------------------------------------------------- the picker window --

export interface AreaPickerOptions {
  /** The artwork as it stands: the shapes the stage draws and the customer clicks. */
  faces: Shapes;
  /** The pick to open on; null is every shape. */
  picked: Set<number> | null;
  /** The file this was traced from, when there is one — an uploaded SVG has it, a library
   *  icon does not. Given, the window can show the file and trace it again. */
  file?: {
    name: string;
    svgText: string;
    parts: SvgImportPart[];
    choices: Record<number, SvgImportChoice>;
    issues: string[];
    /** Trace the file again on new choices. Empty means the choices leave nothing to cut. */
    retrace(choices: Record<number, SvgImportChoice>): Shapes;
  };
  /** The pick, and — when the artwork itself was changed — the shapes it was made on. */
  onDone(result: { picked: Set<number>; shapes?: Shapes; choices?: Record<number, SvgImportChoice> }): void;
}

/**
 * One window for the customer's own SVG: the artwork big enough to click, every shape in it
 * lit, and a right-click menu on each one.
 *
 * It replaced two windows and then a list. The import wizard used to stand in FRONT of the
 * upload asking about "parts" before the customer had seen anything come out, so it moved in
 * here beside the artwork (2026-09-22). Its per-part Fill / Line / Off rows came with it,
 * and on a real file that was forty-five rows all reading "outline in the file", none of them
 * attached to anything on screen, so nobody could tell what they were changing or how.
 *
 * So the rows are gone. What they could do, a right-click on the shape itself now does — you
 * point at the thing and it is the thing that changes. The one decision that was never about a
 * single part, "is this a drawing of lines or of shapes", is left as one switch.
 */
export function openAreaPicker(opts: AreaPickerOptions) {
  let faces = opts.faces;
  /** The faces AND their holes, the things on the stage you can click. */
  let a = areasOf(faces);
  let picked = new Set(opts.picked ?? faces.map((_, i) => i));
  /** Shapes taken out of the ARTWORK, not merely left unpatterned. A traced file arrives with
   *  strays in it — a duplicated board, an artboard rectangle the background rule did not
   *  catch — and the only honest way to say which is to point at one. */
  let removed = new Set<number>();
  let changedTrace = false;
  const choices: Record<number, SvgImportChoice> = { ...(opts.file?.choices ?? {}) };
  const strokeParts = (opts.file?.parts ?? []).filter((p) => p.kind === 'stroke' && !p.why);
  /** Past this many, "click the shape you want" stops being a thing anyone can do. A drawing
   *  read as LINES is the usual cause: a stroke becomes ribbon geometry, and a curve's ribbon
   *  comes back as one sliver per segment — a 7-path tic-tac-toe grid traced into 272. */
  const BUSY = 60;

  const stageHost = el('div', { className: 'ls-area-picker__stage' });
  const hint = el('p', { className: 'ls-area-picker__count', attrs: { 'aria-live': 'polite' } });
  const problem = el('p', { className: 'vl-hint ls-area-picker__problem' });
  const restore = button({
    label: 'Bring every shape back', emphasis: 'ghost',
    onClick: () => { removed.clear(); paint(); },
  });

  /** The face an area belongs to: itself, or the face a hole is punched in. Removing a face
   *  takes its holes with it. */
  const faceOf = (i: number) => (i < a.solid ? i : a.holeOf[i - a.solid]![0]);

  const actions: AreaActions = {
    toggle: (i) => {
      // A removed shape's first click brings it back rather than patterning something that is
      // not there — the ghost on the stage is an invitation, not a dead area.
      if (removed.has(faceOf(i))) { removed.delete(faceOf(i)); paint(); return; }
      if (picked.has(i)) picked.delete(i); else picked.add(i);
      paint();
    },
    // A hole is not a shape in the artwork, so there is nothing to remove: leaving it open is
    // what un-picking it already does.
    remove: (i) => { if (i >= a.solid) return; removed.add(i); picked.delete(i); paint(); },
    menu: (i, at) => {
      const gone = removed.has(faceOf(i));
      openMenu({
        anchor: stageHost,
        at,
        entries: gone
          ? [{ label: 'Bring this shape back', onSelect: () => actions.toggle(i) }]
          : i >= a.solid ? [
            picked.has(i)
              ? { label: 'Leave this hole open', onSelect: () => actions.toggle(i) }
              : { label: 'Pattern inside this hole', onSelect: () => actions.toggle(i) },
            { label: 'Pattern only this hole', onSelect: () => { picked = new Set([i]); paint(); } },
          ] : [
            picked.has(i)
              ? { label: 'Leave this shape plain', onSelect: () => actions.toggle(i) }
              : { label: 'Pattern this shape', onSelect: () => actions.toggle(i) },
            { label: 'Pattern only this shape', onSelect: () => { picked = new Set([i]); paint(); } },
            { separator: true },
            { label: 'Remove this shape', shortcut: 'Del', onSelect: () => actions.remove(i) },
            {
              label: 'Keep only this shape',
              onSelect: () => {
                removed = new Set(faces.map((_, k) => k).filter((k) => k !== i));
                picked = new Set([i]);
                paint();
              },
            },
          ],
      });
    },
  };

  let stage: AreaStage | null = null;
  const drawStage = () => {
    stage = faces.length ? areaStage(a.areas, picked, actions, a.solid) : null;
    stageHost.replaceChildren(...(stage ? [stage.svg] : [el('p', { className: 'vl-hint', text: 'Nothing to cut in this file.' })]));
  };
  const paint = () => {
    stage?.sync(picked, new Set(a.areas.map((_, i) => i).filter((i) => removed.has(faceOf(i)))));
    const kept = faces.length - removed.size;
    const lit = [...picked].filter((i) => i < a.areas.length && !removed.has(faceOf(i)));
    const on = lit.length;
    const holes = lit.some((i) => i >= a.solid);
    hint.textContent = !faces.length ? ''
      : on === kept && !holes ? `Every shape patterned — all ${kept}.`
        : on === 0 ? 'Nothing patterned yet.'
          : holes ? `${on} ${on === 1 ? 'area' : 'areas'} patterned.`
            : `${on} of ${kept} shapes patterned.`;
    restore.hidden = removed.size === 0;
    // The footer says the one thing that stops this window working, and what to do about it.
    problem.textContent = kept === 0
      ? 'Every shape is removed — there is nothing left to cut.'
      : faces.length > BUSY
        ? `This traced into ${faces.length} separate shapes, which is too many to pick from. ${strokeParts.length ? 'Try the “Lines are solid shapes” switch.' : 'The drawing may be too detailed for this.'}`
        : '';
  };
  drawStage();
  paint();

  const all = button({
    label: 'Pattern all', emphasis: 'ghost',
    onClick: () => { picked = new Set(faces.map((_, i) => i).filter((i) => !removed.has(i))); paint(); },
  });
  const none = button({ label: 'Clear', emphasis: 'ghost', onClick: () => { picked.clear(); paint(); } });

  const controls = el('div', { className: 'ls-area-controls' }, [
    el('p', { className: 'vl-label', text: 'Shapes' }),
    hint,
    el('p', { className: 'vl-hint', text: 'Click a shape, or a hole in one, to pattern it. Right-click for more.' }),
    buttonRow(all, none),
    restore,
  ]);

  const file = opts.file;
  if (file) {
    // The file itself, as a data URI. NEVER inlined into the DOM: an uploaded SVG is untrusted
    // input and can carry script; an <img> renders it inert. (The import window's own rule.)
    const img = el('img', { attrs: { alt: file.name } }) as HTMLImageElement;
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(file.svgText)))}`;
    controls.append(
      el('p', { className: 'vl-label', text: 'Your file' }),
      el('div', { className: 'ls-area-file' }, [img]),
    );
    // The ONE file-level question, and the only part of the old list that was never about a
    // single part: is this a drawing of lines, or of shapes? On a real file the per-part
    // version was forty-five switches; as one switch it is a question someone can answer.
    if (strokeParts.length) {
      controls.append(toggleSwitch({
        label: 'Lines are solid shapes',
        checked: strokeParts.every((p) => choices[p.index]?.mode === 'fill'),
        help: 'For a drawing made of outlines rather than filled shapes.',
        onChange: (v) => {
          for (const part of strokeParts) choices[part.index] = { ...choices[part.index], mode: v ? 'fill' : 'outline' };
          faces = file.retrace(choices);
          a = areasOf(faces);
          changedTrace = true;
          // The shapes ARE the trace's, so re-tracing renumbers them: a pick or a removal made
          // on the old artwork would land on whatever happens to sit at that index now.
          picked = new Set(faces.map((_, i) => i));
          removed = new Set();
          drawStage();
          paint();
        },
      }));
    }
    for (const issue of file.issues) controls.append(el('p', { className: 'vl-hint', text: issue }));
  }

  splitDialog({
    title: 'Your SVG',
    stage: el('div', { className: 'ls-area-picker' }, [stageHost]),
    controls,
    footer: problem,
    controlsWidth: 300,
    stageMinHeight: 380,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Done',
        primary: true,
        onClick: () => {
          const keep = faces.map((_, i) => i).filter((i) => !removed.has(i));
          // Removing a shape renumbers the rest, so the pick is remapped to the numbering the
          // build will see rather than left pointing at indices that moved under it.
          const next = new Set<number>();
          keep.forEach((from, to) => { if (picked.has(from)) next.add(to); });
          // Holes are numbered after the faces, face by face, so they move twice: by the faces
          // removed ahead of them, and by the holes those faces took with them.
          let hole = keep.length;
          a.holeOf.forEach(([face], h) => {
            if (removed.has(face)) return;
            if (picked.has(a.solid + h)) next.add(hole);
            hole++;
          });
          opts.onDone({
            picked: next,
            ...(changedTrace || removed.size ? { shapes: keep.map((i) => faces[i]!), choices } : {}),
          });
        },
      },
    ],
    // A menu is `position: fixed` and outlives the dialog that opened it, so it is closed with
    // the window however the window went away.
    onClose: () => closeAllMenus(),
  });
}
