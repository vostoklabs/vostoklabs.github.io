// The preview: the part at true proportions with millimetre rulers, in three views — "2D
// Design" (the sheet as it will look on the material, engraves burnt), "3D Preview" (the product
// put together: layers stacked by thickness, a stand's plate leaning on its feet) and "Export
// Preview" (the cut file on a white sheet: red cut, blue score, black engrave). One thing on it
// is live: the keyring hole, dragged along the outline (docs/briefs/laser-studio-preview-spec.md).
// Everything else is a form's illustration. The same drawing at thumbnail size is what the
// gallery shows — the glued-up stack for a two-layer design (`assembledLayout`).
import { OPS, bboxOf, burnStyle, materialById, type Box } from '@vostok/laser';
import { themeColor, el, segmentedControl, sliderRow, button } from '@vostok/ui-kit';
import type { BuildOutput, KeyringSpec } from './engine/types';
import { assembledLayout, assembledPieces, type Assembled } from './assembled';
import { distanceToOutline, finalHoleCentre, insideShapes, keyringCentre, nearestOutlinePoint } from './engine/editorGeometry';
import { getUnit, onUnitChange, setUnit, type Unit } from './units';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** The Export Preview's sheet: white, so red, blue and black read as what they are. */
const PAPER = '#ffffff';
/** The material the Preview view shows. One for now; a picker can come later. */
const PREVIEW_MATERIAL = 'ply3';
const SNAP_PX = 6;
const num = (v: number) => (Math.abs(v) < 5e-4 ? '0' : v.toFixed(3));

export type ViewMode = 'preview' | 'three' | 'file';

/** Is WebGL itself missing, or did the 3D view fail for some other reason? Two different
 *  sentences, and only this can tell them apart. */
function webglBlocked(): boolean {
  try {
    const c = document.createElement('canvas');
    return !(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return true; }
}
type Pt = [number, number];

const svgEl = (tag: string, attrs: Record<string, string | number> = {}): SVGElement => {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

function pathD(shapes: [number, number][][][]): string {
  return shapes.flat().filter((r) => r.length >= 3).map((r) => `M ${r.map(([x, y]) => `${num(x)} ${num(y)}`).join(' L ')} Z`).join(' ');
}

/** Open runs — a score the outline cut into arcs, the seams of a welded word. No closing `Z`:
 *  these are lines, and closing one would draw a chord straight across the piece. */
function openD(paths: [number, number][][]): string {
  return paths.filter((r) => r.length >= 2).map((r) => `M ${r.map(([x, y]) => `${num(x)} ${num(y)}`).join(' L ')}`).join(' ');
}

interface Palette { plate: string; plateStroke: string; engrave: string; score: string; cut: string }

function palette(mode: ViewMode): Palette {
  if (mode === 'file') return { plate: PAPER, plateStroke: OPS.cut.color, engrave: OPS.engrave.color, score: OPS.score.color, cut: OPS.cut.color };
  const m = materialById(PREVIEW_MATERIAL);
  const b = burnStyle(m.hex, m.id);
  return { plate: b.material, plateStroke: b.cut, engrave: b.engrave, score: b.score, cut: b.cut };
}

/** The part alone, Y up flipped for the screen. Shared by the preview and the gallery. */
function drawPart(into: SVGElement, out: BuildOutput, p: Palette): SVGGElement {
  const g = svgEl('g', { class: 'ls-part', transform: 'scale(1,-1)' }) as SVGGElement;
  if (out.plate.length) {
    g.append(svgEl('path', { class: 'ls-plate', d: pathD(out.plate as never), 'fill-rule': 'evenodd', fill: p.plate, stroke: p.plateStroke, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }));
  }
  for (const o of out.objects) {
    if (o.id === 'plate') continue;
    if (o.image) {
      const img = o.image;
      const wrap = svgEl('g', { transform: `translate(0 ${num(2 * img.y + img.height)}) scale(1,-1)` });
      wrap.append(svgEl('image', { href: img.href, x: num(img.x), y: num(img.y), width: num(img.width), height: num(img.height), preserveAspectRatio: 'none' }));
      g.append(wrap);
      continue;
    }
    const fill = OPS[o.op].mode === 'fill';
    const colour = o.op === 'engrave' ? p.engrave : o.op === 'score' ? p.score : p.cut;
    if (o.shapes.length) {
      g.append(svgEl('path', { class: 'ls-object', 'data-op': o.op, d: pathD(o.shapes as never), 'fill-rule': 'evenodd', fill: fill ? colour : 'none', stroke: fill ? 'none' : colour, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }));
    }
    if (o.paths?.length) {
      g.append(svgEl('path', { class: 'ls-object', 'data-op': o.op, d: openD(o.paths as never), fill: 'none', stroke: colour, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }));
    }
  }
  into.append(g);
  return g;
}

/** The dark sheet's look in the Assembled view: a walnut under the birch. Two tones the eye
 *  reads as two materials — never a colour the customer has to buy. */
const DARK: Palette = { plate: '#8a5a2b', plateStroke: '#4e3115', engrave: '#2b190b', score: '#d7bb8f', cut: '#d7bb8f' };

/** And the kraft sheet's: a third material, not a third wood. The bracelet set's holder card
 *  really is paper, and it is only ever scored, so its marks read as a pressed line rather than a
 *  burn. The plate is NOT the design doc's suggested `#c9a877`: the preview's own plain sheet is
 *  basswood `#c9a978` (`materialById('ply3').hex`), so that kraft would have come out the same
 *  colour as the bars lying on it — measured, not copied. This one is a stop darker and greyer,
 *  the way 300 gsm kraft sits against basswood. */
const CARD: Palette = { plate: '#b58e63', plateStroke: '#7a5f3d', engrave: '#3a2c18', score: '#5b4526', cut: '#7a5f3d' };

/** The stack glued up: each piece's outline and marks moved from the sheet to its assembled
 *  position, the dark sheet under the light one. What a two-layer design's card shows. */
function drawAssembled(into: SVGElement, out: BuildOutput, asm: Assembled): SVGGElement {
  const g = svgEl('g', { class: 'ls-part ls-part--assembled', transform: 'scale(1,-1)' }) as SVGGElement;
  const light = palette('preview');
  const within = (b: Box, box: Box) => b.minX >= box.minX - 0.05 && b.maxX <= box.maxX + 0.05 && b.minY >= box.minY - 0.05 && b.maxY <= box.maxY + 0.05;
  for (const { part, dx, dy } of asm.pieces) {
    const p = part.material === 'dark' ? DARK : part.material === 'card' ? CARD : light;
    // A ghost: the piece is really behind the one in front of it, and a flat picture has no other
    // way of saying so. An unfilled dashed outline with its marks faded reads as "and there is
    // another one of these behind"; a solid copy nudged up and left reads as a second product.
    const ghost = part.previewStyle === 'dashed';
    const gg = svgEl('g', { transform: `translate(${num(dx)} ${num(dy)})`, ...(ghost ? { opacity: 0.5 } : {}) });
    const islands = out.plate.filter((isl) => within(bboxOf([isl]), part.box));
    if (islands.length) {
      gg.append(svgEl('path', {
        d: pathD(islands as never), 'fill-rule': 'evenodd',
        fill: ghost ? 'none' : p.plate, stroke: p.plateStroke, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke',
        ...(ghost ? { 'stroke-dasharray': '4 3' } : {}),
      }));
    }
    // A part's objects carry its id as a prefix; the primary's carry none.
    const prefix = part.id === 'main' ? null : `${part.id}:`;
    for (const o of out.objects) {
      if (o.id === 'plate' || o.image) continue;
      if (prefix ? !o.id.startsWith(prefix) : o.id.includes(':')) continue;
      const fill = OPS[o.op].mode === 'fill';
      const colour = o.op === 'engrave' ? p.engrave : o.op === 'score' ? p.score : p.cut;
      if (o.shapes.length) gg.append(svgEl('path', { d: pathD(o.shapes as never), 'fill-rule': 'evenodd', fill: fill ? colour : 'none', stroke: fill ? 'none' : colour, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }));
      if (o.paths?.length) gg.append(svgEl('path', { d: openD(o.paths as never), fill: 'none', stroke: colour, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }));
    }
    g.append(gg);
  }
  into.append(g);
  return g;
}

/** A standalone SVG of the part for a card or a tile — the glued-up stack for a two-layer design. */
export function thumbSvg(out: BuildOutput, pad = 0.12): SVGSVGElement {
  const asm = assembledLayout(out);
  const b = asm?.box ?? out.bbox;
  const w = Math.max(b.maxX - b.minX, 1);
  const h = Math.max(b.maxY - b.minY, 1);
  const p = Math.max(w, h) * pad;
  const svg = svgEl('svg', { viewBox: `${num(b.minX - p)} ${num(-b.maxY - p)} ${num(w + 2 * p)} ${num(h + 2 * p)}`, preserveAspectRatio: 'xMidYMid meet' }) as SVGSVGElement;
  // The material look, not the cut-file colours. A card answers "what do I get", and at card
  // size the file palette turns a scored design into red-and-blue noise — the connected-text
  // card read as a broken tool when the tool was fine.
  if (asm) drawAssembled(svg, out, asm);
  else drawPart(svg, out, palette('preview'));
  return svg;
}

export function thumbDataUrl(out: BuildOutput): string {
  const svg = thumbSvg(out);
  svg.setAttribute('xmlns', SVG_NS);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.outerHTML)}`;
}

export interface HoleCommit {
  /** How far the ring has been moved from its resting place on the outline, mm — the same two
   *  numbers the nudge pad writes, so the pointer and the pad are one control. */
  dx: number;
  dy: number;
}

export interface PreviewOptions {
  /** Every frame of a hole drag: a line for the status readout. */
  onHoleLive?(text: string): void;
  /** Once, on release or on an arrow-key nudge. */
  onHoleCommit?(hole: HoleCommit): void;
}

export interface Preview {
  root: HTMLElement;
  render(out: BuildOutput | null, keyring?: KeyringSpec | null): void;
  getMode(): ViewMode;
  /** The one line the file needs read — shown in the Export Preview's legend, nowhere else. */
  setNote(text: string): void;
}

/** The editor's stage: the view switch, rulers, a light grid, the part, the hole handle. */
export function createPreview(host: HTMLElement, opts: PreviewOptions = {}): Preview {
  const svg = svgEl('svg', { class: 'ls-preview__svg', preserveAspectRatio: 'xMidYMid meet' }) as SVGSVGElement;
  let mode: ViewMode = 'preview';
  /** Everything a mode change does to the stage, in one place. */
  const applyMode = (m: ViewMode) => {
    mode = m;
    root.dataset.mode = m;
    threeHost.hidden = m !== 'three';
    materialBar.hidden = m !== 'three';
    legend.hidden = m !== 'file';
    svg.style.display = m === 'three' ? 'none' : '';
  };
  const modeSwitch = segmentedControl<ViewMode>({
    options: [{ value: 'preview', label: '2D Design' }, { value: 'three', label: '3D Preview' }, { value: 'file', label: 'Export Preview' }],
    value: mode,
    onChange: (m) => { applyMode(m); if (last) render(last, keyring); },
  });
  modeSwitch.classList.add('ls-preview__mode');
  const unitSwitch = segmentedControl<Unit>({
    options: [{ value: 'mm', label: 'mm' }, { value: 'in', label: 'in' }],
    value: getUnit(),
    onChange: (u) => setUnit(u),
  });
  unitSwitch.classList.add('ls-preview__unit');
  onUnitChange(() => { unitSwitch.setValue(getUnit()); if (last) render(last, keyring); });
  // The switches live in a bar above the drawing, never over it: a ruler label under a
  // control is a ruler label nobody can read.
  const bar = el('div', { className: 'ls-preview__bar' }, [modeSwitch, unitSwitch]);
  const threeHost = el('div', { className: 'ls-preview__three' }); threeHost.hidden = true;
  let thickness = 3;
  let materialPreview: Awaited<ReturnType<typeof import('@vostok/laser/material-preview')['createMaterialPreview']>> | null = null;
  let loading3d = false;
  /** What the 3D view draws: the product put together when the design says how, else the
   *  sheet as it is. Each piece gets the tone of the sheet it is cut from. */
  const solidOf = (out: BuildOutput) => {
    const pieces = assembledPieces(out, thickness);
    if (!pieces) return out;
    return {
      plate: out.plate, objects: out.objects,
      // `thickness` is the piece's own (a kraft card is 0.6 mm whatever the sheet slider says —
      // packet R, 2026-09-21); the tone stays the preview's, read from the theme, not a hex.
      pieces: pieces.map((p) => ({ plate: p.plate, objects: p.objects, pose: p.pose, thickness: p.thickness, ...(p.material === 'dark' ? { hex: DARK.plate } : p.material === 'card' ? { hex: CARD.plate } : {}) })),
    };
  };
  const materialBar = el('div', { className: 'ls-material-bar' }, [
    sliderRow({ label: 'Thickness', value: 3, min: 1, max: 10, step: 0.5, unit: 'mm', help: 'Your sheet, for this preview only.', onInput: v => { thickness = v; if(last)materialPreview?.render(solidOf(last), thickness); } }),
    button({ label: 'Reset view', emphasis: 'ghost', onClick: () => { materialPreview?.reset(); if(last)materialPreview?.render(solidOf(last), thickness); } }),
  ]); materialBar.hidden = true;
  const note = el('p', { className: 'vl-hint' }); note.hidden = true;
  const legend = el('div', { className: 'ls-export-legend' }, [
    el('span', { text: 'Cut', attrs: { 'data-op': 'cut' } }),
    el('span', { text: 'Score', attrs: { 'data-op': 'score' } }),
    el('span', { text: 'Engrave', attrs: { 'data-op': 'engrave' } }),
    note,
  ]); legend.hidden = true;
  const root = el('div', { className: 'ls-preview' }, [bar, svg, threeHost, materialBar, legend]);
  async function update3d() {
    if(materialPreview){ if(last)materialPreview.render(solidOf(last), thickness);return; }
    if(loading3d)return; loading3d = true;
    try {
      const {createMaterialPreview}=await import('@vostok/laser/material-preview');
      if(!root.isConnected)return;
      materialPreview=createMaterialPreview(threeHost);if(last)materialPreview.render(solidOf(last),thickness);
    } catch (err) {
      // The error was swallowed by a bare `catch {}`, so the one sentence on screen was the
      // only thing anybody — customer or us — ever got. It says nothing about WHY and nothing
      // about what to do, and on a machine where 3D works for every other site that is a dead
      // end. Report it, and say the thing that actually fixes it (Ian, 2026-09-23: live site,
      // "3D preview requires WebGL", where the site itself renders fine).
      console.error('[laser-studio] 3D preview failed to start:', err);
      const why = webglBlocked()
        ? 'This browser is not giving us WebGL. It is usually off in Settings → System → “Use graphics acceleration when available”; chrome://gpu says which.'
        : `3D could not start: ${(err as Error)?.message ?? err}`;
      threeHost.replaceChildren(
        el('p', { className: 'vl-hint', text: why }),
        el('p', { className: 'vl-hint', text: 'The 2D design and the export are unaffected.' }),
      );
    }
    finally { loading3d=false; }
  }
  const cleanup = new MutationObserver(() => { if (!root.isConnected) {materialPreview?.dispose(); cleanup.disconnect();} });
  cleanup.observe(document.body, { childList:true, subtree:true });
  root.dataset.mode = mode;
  host.append(root);

  let last: BuildOutput | null = null;
  let keyring: KeyringSpec | null = null;
  let partG: SVGGElement | null = null;
  let holeC: SVGCircleElement | null = null;
  let lugC: SVGCircleElement | null = null;
  /** How far the ring sits from the edge, mm — the handle's announced value. */
  let holeGap = 0;
  // The viewBox is cut to the stage's own aspect ratio so the grid fills the box; a resize
  // therefore re-renders. The resting state is right without it (`render` is what drew it).
  new ResizeObserver(() => { if (last && !drag) render(last, keyring); }).observe(svg);

  function render(out: BuildOutput | null, k: KeyringSpec | null = keyring) {
    last = out;
    keyring = k;
    partG = null;
    holeC = null;
    lugC = null;
    svg.replaceChildren();
    // How many islands were built, whichever view shows them: the browser tests wait on it, so
    // it is stamped before the 3D view hands over to the canvas.
    svg.setAttribute('data-pieces', String(out?.plate.length ?? 0));
    if(mode === 'three') { void update3d(); return; }
    if (!out || !out.objects.length) {
      svg.setAttribute('viewBox', '-40 -30 80 60');
      return;
    }
    const b: Box = out.bbox;
    const w = Math.max(b.maxX - b.minX, 1);
    const h = Math.max(b.maxY - b.minY, 1);
    // Air around the part and room for the rulers on the top and left edges.
    const pad = Math.max(w, h) * 0.18;
    const ruler = Math.max(w, h) * 0.09;
    let x0 = b.minX - pad - ruler;
    let y0 = b.minY - pad;
    let vw = w + 2 * pad + ruler;
    let vh = h + 2 * pad + ruler;
    const aspect = svg.clientWidth && svg.clientHeight ? svg.clientWidth / svg.clientHeight : 4 / 3;
    if (vw / vh < aspect) { const nw = vh * aspect; x0 -= (nw - vw) / 2; vw = nw; }
    else { const nh = vw / aspect; y0 -= (nh - vh) / 2; vh = nh; }
    svg.setAttribute('viewBox', `${num(x0)} ${num(-(y0 + vh))} ${num(vw)} ${num(vh)}`);

    const line = themeColor('--line', '#2f3440');
    const muted = themeColor('--muted', '#9aa3b2');
    const fs = Math.max(vw, vh) * 0.028;
    // Ticks every nice number of the CURRENT unit — 10 mm or 0.5 in — drawn in mm.
    const inches = getUnit() === 'in';
    const step = inches ? niceStep(Math.max(w, h) / 25.4) * 25.4 : niceStep(Math.max(w, h));
    const tickLabel = (mm: number) => (inches ? String(+(mm / 25.4).toFixed(2)) : String(Math.round(mm)));

    // The rulers sit on the view's top and left edges; the grid fills the rest, ruled every
    // `step` mm from the part's bottom-left corner so the ticks and the lines agree.
    const rulerX = x0 + ruler;
    const rulerY = y0 + vh - ruler;
    const grid: string[] = [];
    for (let x = b.minX - Math.ceil((b.minX - rulerX) / step) * step; x <= x0 + vw; x += step) if (x >= rulerX) grid.push(`M ${num(x)} ${num(-rulerY)} V ${num(-y0)}`);
    for (let y = b.minY - Math.ceil((b.minY - y0) / step) * step; y <= rulerY; y += step) if (y >= y0) grid.push(`M ${num(rulerX)} ${num(-y)} H ${num(x0 + vw)}`);
    if(mode === 'preview') svg.append(svgEl('path', { d: grid.join(' '), fill: 'none', stroke: line, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', opacity: 0.22 }));

    const rulers = svgEl('g', { fill: muted, 'font-size': num(fs), 'font-family': 'inherit' });
    const tick = (x1: number, y1: number, x2: number, y2: number) => svgEl('path', { d: `M ${num(x1)} ${num(y1)} L ${num(x2)} ${num(y2)}`, stroke: muted, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' });
    const label = (x: number, y: number, text: string, anchor = 'middle') => { const t = svgEl('text', { x: num(x), y: num(y), 'text-anchor': anchor }); t.textContent = text; return t; };
    rulers.append(tick(rulerX, -rulerY, x0 + vw, -rulerY));
    rulers.append(tick(rulerX, -rulerY, rulerX, -y0));
    for (let x = b.minX - Math.ceil((b.minX - rulerX) / step) * step; x <= x0 + vw; x += step) {
      if (x < rulerX) continue;
      rulers.append(tick(x, -rulerY, x, -(rulerY + ruler * 0.25)));
      rulers.append(label(x, -(rulerY + ruler * 0.4), tickLabel(x - b.minX)));
    }
    for (let y = b.minY - Math.ceil((b.minY - y0) / step) * step; y <= rulerY; y += step) {
      if (y < y0) continue;
      rulers.append(tick(rulerX, -y, rulerX - ruler * 0.25, -y));
      rulers.append(label(rulerX - ruler * 0.35, -y + fs * 0.35, tickLabel(y - b.minY), 'end'));
    }
    if(mode === 'preview') svg.append(rulers);
    partG = drawPart(svg, out, palette(mode));

    // A batch names its sheet: a dashed page guide per sheet, drawn under the parts and never
    // exported — furniture, not geometry.
    if (mode === 'preview' && out.sheets && out.sheets.pages.length) {
      const guides = svgEl('g', { class: 'ls-sheet-guides', fill: 'none', stroke: muted, 'stroke-width': 1, 'stroke-dasharray': '4 3', 'vector-effect': 'non-scaling-stroke', opacity: 0.7 });
      out.sheets.pages.forEach((pg, i) => {
        guides.append(svgEl('rect', { x: num(pg.minX), y: num(-pg.maxY), width: num(pg.maxX - pg.minX), height: num(pg.maxY - pg.minY), rx: 1 }));
        const t = svgEl('text', { x: num(pg.minX + 2), y: num(-pg.maxY - fs * 0.5), 'font-size': num(fs * 0.85), fill: muted, stroke: 'none', 'font-family': 'inherit' });
        t.textContent = `Sheet ${i + 1} · ${Math.round(pg.maxX - pg.minX)} × ${Math.round(pg.maxY - pg.minY)} mm`;
        guides.append(t);
      });
      svg.insertBefore(guides, partG);
    }

    // A design of several pieces names each one under its outline — "Backer", "Base",
    // "Tile 3" — so the sheet reads as a kit, not a scatter. The design view only: the cut
    // file is the parts alone, and the labels are never lasered.
    //
    // Sized from the AIR under the piece, not from how far the view is zoomed out. Sized from
    // the zoom, a place-card run wrote row-1's labels straight across row-2's cards: the gap
    // between rows is 4 mm whatever the zoom, and a 3.5 mm label is what fits in it. Under
    // 2.5 mm there is no room for a word at all, so the name goes on the piece as a tooltip.
    if (mode === 'preview' && out.parts.length > 1) {
      const gap = labelGap(out.parts);
      const labelFs = Math.min(3.5, 0.7 * gap);
      const labels = svgEl('g', { class: 'ls-part-labels', fill: muted, 'font-size': num(labelFs), 'font-family': 'inherit', 'text-anchor': 'middle' });
      for (const part of out.parts) {
        if (!part.label) continue;
        if (gap >= 2.5) {
          const t = svgEl('text', { x: num((part.box.minX + part.box.maxX) / 2), y: num(-(part.box.minY - labelFs * 1.1)) });
          t.textContent = part.label;
          labels.append(t);
          continue;
        }
        // Nowhere to write it: an invisible patch over the piece carrying the name on hover.
        // Pointer events reach the `svg` either way, so the hole drag is untouched.
        const hit = svgEl('rect', {
          x: num(part.box.minX), y: num(-part.box.maxY),
          width: num(Math.max(part.box.maxX - part.box.minX, 0.01)),
          height: num(Math.max(part.box.maxY - part.box.minY, 0.01)),
          fill: 'none', 'pointer-events': 'all',
        });
        const title = svgEl('title');
        title.textContent = part.label;
        hit.append(title);
        labels.append(hit);
      }
      svg.append(labels);
    }

    // The hole handle: a dashed ring the user can grab. Only when there is a hole to move.
    if (mode === 'preview' && out.hole && k?.enabled && out.body.length) {
      const accent = themeColor('--accent', '#5b9dff');
      holeGap = distanceToOutline(out.body, out.hole.centre);
      const [cx, cy] = out.hole.centre;
      if (k.mode === 'outside') {
        lugC = svgEl('circle', { class: 'ls-lug', cx: num(cx), cy: num(cy), r: num(k.dia / 2 + k.ring), fill: 'none', stroke: accent, 'stroke-width': 1, 'stroke-dasharray': '2 2', 'vector-effect': 'non-scaling-stroke', opacity: 0.6 }) as SVGCircleElement;
        partG.append(lugC);
      }
      holeC = svgEl('circle', {
        class: 'ls-hole', cx: num(cx), cy: num(cy), r: num(k.dia / 2 + 1.5),
        fill: 'none', stroke: accent, 'stroke-width': 1.5, 'stroke-dasharray': '3 2', 'vector-effect': 'non-scaling-stroke',
        tabindex: '0', role: 'slider', 'aria-label': 'Keyring position — drag to move it, arrow keys to nudge',
        'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(holeGap)),
      }) as SVGCircleElement;
      holeC.addEventListener('keydown', onHoleKey);
      partG.append(holeC);
    }
  }

  // ------------------------------------------------------------ the hole drag
  interface Drag { pointerId: number; inverse: DOMMatrix; pxPerMm: number; start: Pt; centre0: Pt; base: Pt; pending: PointerEvent | null; frame: number; centre: Pt; offset: Pt; ghost: SVGGElement | null }
  let drag: Drag | null = null;

  /** Client px → part mm through the flipped part group, read once per gesture. */
  function project(client: Pt, inverse: DOMMatrix): Pt {
    const p = svg.createSVGPoint();
    p.x = client[0];
    p.y = client[1];
    const q = p.matrixTransform(inverse);
    return [q.x, q.y];
  }

  function holeHit(e: PointerEvent): boolean {
    if (!holeC || !partG || !last?.hole || !keyring) return false;
    const m = partG.getScreenCTM();
    if (!m) return false;
    const p = svg.createSVGPoint();
    p.x = last.hole.centre[0];
    p.y = last.hole.centre[1];
    const s = p.matrixTransform(m);
    const rPx = (keyring.dia / 2 + 1.5) * Math.hypot(m.a, m.b);
    const slop = e.pointerType === 'touch' ? Math.max(rPx, 22) : rPx + 6;
    return Math.hypot(e.clientX - s.x, e.clientY - s.y) <= slop;
  }

  function onDown(e: PointerEvent) {
    if (e.button !== 0 || drag || !last?.hole || !keyring || !partG || !holeHit(e)) return;
    const m = partG.getScreenCTM();
    if (!m) return;
    const inverse = m.inverse();
    drag = {
      pointerId: e.pointerId, inverse, pxPerMm: Math.hypot(m.a, m.b),
      start: project([e.clientX, e.clientY], inverse), centre0: [...last.hole.centre] as Pt,
      base: keyringCentre(last.body, keyring), pending: null, frame: 0,
      centre: [...last.hole.centre] as Pt, offset: [keyring.dx ?? 0, keyring.dy ?? 0], ghost: null,
    };
    svg.setPointerCapture(e.pointerId);
    root.dataset.dragging = '';
    holeC?.focus?.();
    e.preventDefault();
  }

  function onMove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.pending = e;
    if (!drag.frame) drag.frame = requestAnimationFrame(flush);
  }

  function flush() {
    if (!drag || !last || !keyring) return;
    drag.frame = 0;
    const e = drag.pending;
    drag.pending = null;
    if (!e) return;
    const p = project([e.clientX, e.clientY], drag.inverse);
    let target: Pt = [drag.centre0[0] + p[0] - drag.start[0], drag.centre0[1] + p[1] - drag.start[1]];
    // One snap, and it is the placement people ask for by name: the ring centred ON the edge,
    // half of it outside the part.
    const onEdge = nearestOutlinePoint(last.body, target);
    const snapped = Math.hypot(onEdge[0] - target[0], onEdge[1] - target[1]) <= SNAP_PX / drag.pxPerMm;
    if (snapped) target = onEdge;
    const want: Pt = [target[0] - drag.base[0], target[1] - drag.base[1]];
    const fin = finalHoleCentre(last.body, { ...keyring, dx: want[0], dy: want[1] }).centre;
    // What the clamp allowed, not what was asked for — so the pad and the pointer agree.
    drag.offset = [fin[0] - drag.base[0], fin[1] - drag.base[1]];
    drag.centre = fin;
    moveHandle(fin);
    showGhost(fin);
    opts.onHoleLive?.(placement(last.body, keyring, fin, snapped));
  }

  function moveHandle(c: Pt) {
    for (const n of [holeC, lugC]) if (n) { n.setAttribute('cx', num(c[0])); n.setAttribute('cy', num(c[1])); }
    if (last) holeC?.setAttribute('aria-valuenow', String(Math.round(distanceToOutline(last.body, c))));
  }

  /** What the status line says while the ring is being moved. */
  function placement(body: BuildOutput['body'], k: KeyringSpec, centre: Pt, snapped: boolean): string {
    const gap = distanceToOutline(body, centre);
    const within = insideShapes(body, centre);
    if (snapped || gap < 0.4) return 'On the edge — half of the ring outside';
    if (k.mode === 'inside') return `Hole · ${gap.toFixed(1)} mm from the edge`;
    return within ? `Loop inside the part · ${gap.toFixed(1)} mm from the edge` : `Loop outside the edge · ${gap.toFixed(1)} mm clear`;
  }

  /** The plate with the hole at the candidate centre, faked with a mask — no worker call. In
   *  loop-tab mode the tab is a circle drawn under the body. */
  function showGhost(c: Pt) {
    if (!drag || !last || !keyring || !partG) return;
    const p = palette(mode);
    if (!drag.ghost) {
      (partG.querySelector('.ls-plate') as SVGElement | null)?.setAttribute('visibility', 'hidden');
      const id = `ls-ghost-${Math.random().toString(36).slice(2)}`;
      const mask = svgEl('mask', { id, maskUnits: 'userSpaceOnUse', x: -10000, y: -10000, width: 20000, height: 20000 });
      mask.append(svgEl('rect', { x: -10000, y: -10000, width: 20000, height: 20000, fill: 'white' }));
      mask.append(svgEl('circle', { class: 'ls-ghost__hole', r: num(keyring.dia / 2), fill: 'black' }));
      const painted = svgEl('g', { mask: `url(#${id})` });
      if (keyring.mode === 'outside') painted.append(svgEl('circle', { class: 'ls-ghost__lug', r: num(keyring.dia / 2 + keyring.ring), fill: p.plate, stroke: p.plateStroke, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }));
      painted.append(svgEl('path', { d: pathD(last.body as never), 'fill-rule': 'evenodd', fill: p.plate, stroke: p.plateStroke, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }));
      const cut = svgEl('circle', { class: 'ls-ghost__cut', r: num(keyring.dia / 2), fill: 'none', stroke: p.plateStroke, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' });
      drag.ghost = svgEl('g', { class: 'ls-ghost' }) as SVGGElement;
      drag.ghost.append(mask, painted, cut);
      partG.insertBefore(drag.ghost, partG.firstChild);
    }
    for (const n of drag.ghost.querySelectorAll('circle')) { n.setAttribute('cx', num(c[0])); n.setAttribute('cy', num(c[1])); }
  }

  function endDrag(commit: boolean) {
    const d = drag;
    if (!d) return;
    if (d.frame) cancelAnimationFrame(d.frame);
    if (commit && d.pending) { d.frame = 0; flush(); }
    if (svg.hasPointerCapture(d.pointerId)) svg.releasePointerCapture(d.pointerId);
    drag = null;
    delete root.dataset.dragging;
    const moved = Math.hypot(d.centre[0] - d.centre0[0], d.centre[1] - d.centre0[1]) > 1e-6;
    if (commit && moved && last) {
      holeGap = distanceToOutline(last.body, d.centre);
      opts.onHoleCommit?.({ dx: d.offset[0], dy: d.offset[1] });
      return; // the commit's rebuild re-renders, ghost and all
    }
    d.ghost?.remove();
    (partG?.querySelector('.ls-plate') as SVGElement | null)?.removeAttribute('visibility');
    if (last?.hole) moveHandle(last.hole.centre);
  }

  /** Arrow keys move the ring 1 mm (10 with Shift), the same freedom the pointer has. */
  function onHoleKey(e: KeyboardEvent) {
    if (!last || !keyring || !last.body.length) return;
    const step = e.shiftKey ? 10 : 1;
    const delta: Record<string, Pt> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();
    const base = keyringCentre(last.body, keyring);
    const now = finalHoleCentre(last.body, keyring).centre;
    const want: Pt = [now[0] + d[0] - base[0], now[1] + d[1] - base[1]];
    const fin = finalHoleCentre(last.body, { ...keyring, dx: want[0], dy: want[1] }).centre;
    opts.onHoleCommit?.({ dx: fin[0] - base[0], dy: fin[1] - base[1] });
  }

  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', (e) => {
    if (drag) { onMove(e); return; }
    root.dataset.cursor = holeHit(e) ? 'grab' : '';
  });
  svg.addEventListener('pointerup', (e) => { if (drag && e.pointerId === drag.pointerId) endDrag(true); });
  svg.addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.pointerId) endDrag(false); });
  svg.addEventListener('lostpointercapture', (e) => { if (drag && e.pointerId === drag.pointerId) endDrag(false); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drag) endDrag(false); });

  return {
    root, render, getMode: () => mode,
    setNote: (text) => { note.textContent = text; note.hidden = !text; },
  };
}

/**
 * The air under the pieces, mm: the smallest vertical gap between a piece and one below it
 * that shares any of its width.
 *
 * That is where a label goes, and it is the layout's own gap — the engine places a wrapped run
 * with a fixed gap between rows whatever the zoom. A single row has nothing below it and gets
 * Infinity, which the caller reads as "as much room as the label wants".
 */
function labelGap(parts: BuildOutput['parts']): number {
  let gap = Infinity;
  for (const a of parts) {
    for (const b of parts) {
      if (a === b) continue;
      if (b.box.maxY > a.box.minY) continue;
      if (b.box.maxX <= a.box.minX || b.box.minX >= a.box.maxX) continue;
      gap = Math.min(gap, a.box.minY - b.box.maxY);
    }
  }
  return gap;
}

/** 5, 10, 20, 50… whichever keeps five to ten ticks along the longer side. */
function niceStep(span: number): number {
  const raw = span / 6;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-6))));
  for (const m of [1, 2, 5, 10]) if (raw <= m * mag) return m * mag;
  return 10 * mag;
}
