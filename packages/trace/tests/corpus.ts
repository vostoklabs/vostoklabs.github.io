/*
  The files the SVG reader's readings are pinned on, and how a reading is reduced to one hash.

  Every Lucide icon once, with its markup built attribute for attribute the way the apps build
  it, and a handful of drawings Lucide has none of: filled shapes, holes both ways, a background
  rectangle, a cut file in millimetres, a transform round the artboard, white parts, a file the
  import window has already been through. A reading that changes for any of them changes a hash.
*/
import { createHash, type Hash } from 'node:crypto';
import { icons, type IconNode } from 'lucide';
import type { SvgOptions } from '../src/logo';

/** A choice made in the import window: path 0 drawn as an outline, path 1 filled in another
 *  colour, path 2 switched off. */
const CHOSEN: SvgOptions['overrides'] = { 0: { mode: 'outline' }, 1: { mode: 'fill', hex: '#00ae42' }, 2: { mode: 'off' } };

/** The readings pinned, by name: each switch on its own, and a choice from the import window read
 *  as a cut file, and read the way the clicker reads one (as painted, with the background
 *  removed). */
export const READINGS: [string, SvgOptions][] = [
  ['as the file says', {}],
  ['strokes filled', { fillStrokes: true }],
  ['as painted', { asPainted: true }],
  ['as painted, strokes filled', { asPainted: true, fillStrokes: true }],
  ['background removed', { removeBg: true }],
  ['chosen in the import window', { overrides: CHOSEN }],
  ['chosen, background removed, as painted', { overrides: CHOSEN, removeBg: true, asPainted: true }],
];

const HEADER = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';

/** An icon's markup, as the keycap's and the clicker's icon pickers write it. */
export function iconSvg(node: IconNode): string {
  let inner = '';
  for (const [tag, attrs] of node) {
    let a = '';
    for (const [k, v] of Object.entries(attrs)) a += ` ${k}="${v}"`;
    inner += `<${tag}${a}/>`;
  }
  return HEADER + inner + '</svg>';
}

/** Every icon once. Lucide lists some icons under more than one name, as the same node. */
export function lucideFiles(): [string, string][] {
  const seen = new Set<IconNode>();
  const out: [string, string][] = [];
  for (const [name, node] of Object.entries(icons) as [string, IconNode][]) {
    if (seen.has(node)) continue;
    seen.add(node);
    out.push([name, iconSvg(node)]);
  }
  return out;
}

const doc = (inner: string, root = 'viewBox="0 0 100 100"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${root}>${inner}</svg>`;

/** Drawings with fills in them, in the colours the reader has to keep apart. Presentation
 *  attributes only, so they read the same whether or not a caller flattens styles first. */
export const FILLED: [string, string][] = [
  ['a square with a square hole wound against it', doc(
    '<path d="M10 10 H90 V90 H10 Z M30 30 V70 H70 V30 Z" fill="#c8102e"/>',
  )],
  ['a square inside a square, even-odd', doc(
    '<path fill-rule="evenodd" d="M10 10 H90 V90 H10 Z M30 30 H70 V70 H30 Z" fill="#0a5cd5"/>',
  )],
  ['a white background behind a disc and a star', doc(
    '<rect width="100" height="100" fill="#ffffff"/>'
    + '<circle cx="50" cy="50" r="30" fill="#00ae42"/>'
    + '<polygon points="50,5 61,39 97,39 68,61 79,95 50,74 21,95 32,61 3,39 39,39" fill="#c8102e"/>',
  )],
  ['fills, a stroke, and a path with both', doc(
    '<circle cx="30" cy="30" r="20" fill="#0a5cd5" stroke="#000" stroke-width="3"/>'
    + '<path d="M60 20 L90 50 L60 80" fill="none" stroke="#c8102e" stroke-width="4" stroke-linecap="square" stroke-linejoin="bevel"/>'
    + '<ellipse cx="50" cy="80" rx="30" ry="10" fill="rgb(0, 174, 66)"/>'
    + '<polyline points="10,60 20,70 30,60 40,70" fill="none" stroke="navy" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>',
  )],
  ['a cut file in millimetres: panels as coloured lines over a fill nobody sees', doc(
    '<path d="M10 10 H90 V50 H10 Z" fill="rgb(255,255,255)" fill-opacity="0" stroke="rgb(255,0,0)" stroke-width="0.2"/>'
    + ['M20 20 H40', 'M40 20 V40', 'M40 40 H20', 'M20 40 V20'].map((d) => `<path d="${d}" fill="none" stroke="rgb(255,0,0)" stroke-width="0.2"/>`).join('')
    + '<path d="M60 40 A10 10 0 0 1 80 40" fill="none" stroke="rgb(0,0,255)" stroke-width="0.2"/>'
    + '<line x1="55" y1="15" x2="85" y2="15" stroke="rgb(0,0,255)" stroke-width="0.2"/>',
    'width="100mm" height="60mm" viewBox="0 0 100 60"',
  )],
  ['an artboard and a shape inside a scaling group', doc(
    '<g transform="matrix(0.5 0 0 0.5 0 0)">'
    + '<rect width="200" height="200" fill="#ffffff"/>'
    + '<path d="M40 40 h120 v120 h-120 z M70 70 v60 h60 v-60 z" fill="#000"/>'
    + '</g>',
  )],
  ['rounded rectangles, a short colour, an unseen path and an inherited ink', doc(
    '<rect x="10" y="10" width="80" height="40" rx="8" fill="#fc0"/>'
    + '<rect x="20" y="60" width="60" height="30" rx="5" ry="10" fill="none" stroke="#333" stroke-width="2"/>'
    + '<path d="M5 95 L95 5" opacity="0" stroke="#000"/>'
    + '<g fill="currentColor"><circle cx="85" cy="85" r="6"/></g>',
  )],
  ['nested outlines with sharp corners', doc(
    '<path d="M10 10 L90 10 L50 90 Z" fill="none" stroke="#7a3cff" stroke-width="3" stroke-miterlimit="10"/>'
    + '<path d="M35 25 L65 25 L50 55 Z" fill="none" stroke="#7a3cff" stroke-width="3" stroke-linejoin="miter"/>'
    + '<path d="M20 95 L50 70 L80 95" fill="none" stroke="#7a3cff" stroke-width="1.5" stroke-linecap="butt"/>',
  )],
];

/** For the keycap's one-colour reading: what it drops on its own, and what it then keeps. */
export const LEGEND_FILES: [string, string][] = [
  ...FILLED,
  ['white parts beside black ones', doc(
    '<circle cx="30" cy="30" r="20" fill="#fff"/>'
    + '<path d="M10 80 H90" fill="none" stroke="white" stroke-width="4"/>'
    + '<path d="M50 10 V60" fill="none" stroke="#000" stroke-width="4"/>'
    + '<rect x="60" y="60" width="30" height="30" fill="#000"/>',
  )],
  ['an artboard the size of the view box', doc(
    '<rect x="0" y="0" width="100" height="100" fill="#000"/><circle cx="50" cy="50" r="20" fill="#000"/>',
  )],
  ['an artboard at 100%', doc(
    '<rect width="100%" height="100%" fill="#222"/><path d="M20 20 H80 V80 H20 Z" fill="#000"/>',
  )],
  ['white parts and an artboard, in a file the import window has been through', doc(
    '<rect width="100" height="100" fill="#000"/>'
    + '<circle cx="30" cy="30" r="20" fill="#fff"/>'
    + '<path d="M10 80 H90" fill="none" stroke="white" stroke-width="4"/>',
    'viewBox="0 0 100 100" data-vl-chosen="1"',
  )],
  ['nothing but white', doc('<circle cx="50" cy="50" r="40" fill="#ffffff"/>')],
  ['sized by width and height, no view box', doc(
    '<path d="M4 4 L28 4 L16 28 Z" fill="#000"/>', 'width="32" height="32"',
  )],
  ['no size at all', doc('<circle cx="10" cy="10" r="5" fill="#000"/>', '')],
  ['every cap and join', doc(
    ['butt', 'square', 'round'].map((cap, i) => ['miter', 'bevel', 'round'].map((join, j) =>
      `<path d="M${10 + 30 * j} ${10 + 30 * i} l10 15 l10 -15" fill="none" stroke="#000" stroke-width="3" stroke-linecap="${cap}" stroke-linejoin="${join}"/>`,
    ).join('')).join('')
    + '<path d="M5 95 L5 95" fill="none" stroke="#000" stroke-width="3"/>'
    + '<path d="M60 90 H95" fill="none" stroke="#000" stroke-width="0"/>',
  )],
];

type Pt = [number, number];

/** A list of rings or lines: an array whose entries are arrays of points. */
const isRingList = (v: unknown): v is Pt[][] =>
  Array.isArray(v) && v.length > 0 && Array.isArray(v[0]) && (v[0].length === 0 || Array.isArray(v[0][0]));

/** A ring list as float64s: how many rings, then each ring's length and its coordinates. */
function ringBytes(list: Pt[][]): Uint8Array {
  let n = 1;
  for (const r of list) n += 1 + 2 * r.length;
  const f = new Float64Array(n);
  let i = 0;
  f[i++] = list.length;
  for (const r of list) {
    f[i++] = r.length;
    for (const [x, y] of r) { f[i++] = x; f[i++] = y; }
  }
  return new Uint8Array(f.buffer);
}

/**
 * One reading into the hash, or the error it threw: a file that stops reading is a change too.
 *
 * Everything is JSON except the coordinates, which go in as their float64 (or float32) bytes, a
 * ring list at a time. Exact to the bit, and quick enough to run over every icon: read as
 * painted, every triangle of a stroke is its own ring, and the same reading written out as JSON
 * text is two gigabytes for the icon set.
 */
export function hashReading(h: Hash, read: () => unknown): void {
  let text: string;
  try {
    text = JSON.stringify(read(), (_key, v) => {
      if (v instanceof Float32Array) {
        h.update(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
        return `f32 x${v.length}`;
      }
      if (isRingList(v)) {
        h.update(ringBytes(v));
        return `rings x${v.length}`;
      }
      return v;
    });
  } catch (err) {
    text = `throws: ${(err as Error).message}`;
  }
  h.update(`${text}\n`);
}

/** One hash over a list of files read the same way, each file's name before its reading. */
export function digestOf(files: [string, string][], read: (svg: string) => unknown): string {
  const h = createHash('sha256');
  for (const [name, svg] of files) {
    h.update(`${name}\n`);
    hashReading(h, () => read(svg));
  }
  return h.digest('hex');
}

/** The markup itself, so a change of icon set is told apart from a change of reading. */
export function inputDigest(files: [string, string][]): string {
  const h = createHash('sha256');
  for (const [name, svg] of files) h.update(`${name}\n${svg}\n`);
  return h.digest('hex');
}
