// Every template through the whole build with no browser: the design, then the solids from manifold.
// It checks what a customer would notice on the print: every part closed and inside the card, the
// lettering never under its floor, a QR code only where it scans, the pocket covered, and a card
// that does not fit its text saying so rather than shrinking into something unreadable.
//
// PREVIEW=1 also writes each template's front and back as SVG to tests/.out/ for a person to look at.
//
// The faces are the shelf's own font files, read with the opentype.js that @vostok/fonts depends on,
// resolved from there rather than made a dependency of the app for a test.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import Module from 'manifold-3d';
import { buildDesign, QR_LEFT_OUT, QR_MOVED, type Assets, type Template } from '../src/design/build';
import { designSvg } from '../src/design/svg';
import type { Face } from '../src/design/text';
import { TEMPLATES } from '../src/design/templates';
import { buildSolid, LAYER, type SolidParams } from '../src/geometry/solid';
import { BORDER } from '../src/design/layout';
import type { Face as CardFace } from '../src/design/types';
import { DEFAULT_SETTINGS, raiseOf, type CardSettings } from '../src/state';

const FONTS_PKG = join(process.cwd(), '../../packages/fonts');
const opentype = createRequire(join(FONTS_PKG, 'package.json'))('opentype.js');
const face = (id: string): Face => {
  const file = readFileSync(join(FONTS_PKG, 'src/fonts', `${id}.ttf`));
  return opentype.parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
};
const fallback = face('roboto');
// Stand-ins for the contact icons and the tap mark, in the symbol frame (centred, longest side 1):
// a ring, as an icon with a counter is. The app loads the real ones from the symbol library, which
// reads the font registry, and a node test loads no registry (check:layers).
const ring = (r: number, n = 32) => Array.from({ length: n }, (_, i): [number, number] => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)]);
const standIn = [[ring(0.5), ring(0.3).reverse()]];
const icons: Assets['icons'] = { classic: { phone: standIn, email: standIn, web: standIn }, modern: { phone: standIn, email: standIn, web: standIn } };
const assetsFor = (font: string): Assets => ({ faces: { main: face(font), fallback }, icons, tap: standIn });

const wasm = await Module();
wasm.setup();

let failures = 0;
let checks = 0;
function check(ok: boolean, what: string) {
  checks++;
  if (!ok) {
    failures++;
    console.error('FAIL', what);
  }
}

/** Every edge shared by exactly two triangles. */
function closed(tris: Uint32Array): boolean {
  const edges = new Map<string, number>();
  for (let t = 0; t < tris.length; t += 3) {
    for (let i = 0; i < 3; i++) {
      const a = tris[t + i]!;
      const b = tris[t + ((i + 1) % 3)]!;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  return [...edges.values()].every((n) => n === 2);
}

function bounds(v: Float32Array) {
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < v.length; i += 3) {
    b.minX = Math.min(b.minX, v[i]!); b.maxX = Math.max(b.maxX, v[i]!);
    b.minY = Math.min(b.minY, v[i + 1]!); b.maxY = Math.max(b.maxY, v[i + 1]!);
    b.minZ = Math.min(b.minZ, v[i + 2]!); b.maxZ = Math.max(b.maxZ, v[i + 2]!);
  }
  return b;
}

type Box2 = { minX: number; maxX: number; minY: number; maxY: number };
const boxOf = (pts: number[][]): Box2 => ({ minX: Math.min(...pts.map((q) => q[0]!)), maxX: Math.max(...pts.map((q) => q[0]!)), minY: Math.min(...pts.map((q) => q[1]!)), maxY: Math.max(...pts.map((q) => q[1]!)) });
const meet = (a: Box2, b: Box2, e = 0.05) => a.maxX > b.minX + e && a.minX < b.maxX - e && a.maxY > b.minY + e && a.minY < b.maxY - e;
/** Inside islands of rings, even-odd within each island. */
function inside([x, y]: number[], shapes: number[][][][]): boolean {
  return shapes.some((island) => {
    let odd = false;
    for (const ring of island) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]!;
        const [xj, yj] = ring[j]!;
        if ((yi! > y!) !== (yj! > y!) && x! < ((xj! - xi!) * (y! - yi!)) / (yj! - yi!) + xi!) odd = !odd;
      }
    }
    return odd;
  });
}
/** What an island (its biggest ring the outline, the others holes) covers inside a box, mm²: each
 *  ring clipped to the box (Sutherland-Hodgman) and measured. */
function areaIn(island: number[][][], b: Box2): number {
  const clipped = (ring: number[][]) => {
    let pts = ring;
    const sides: [(p: number[]) => boolean, (p: number[], q: number[]) => number[]][] = [
      [(p) => p[0]! >= b.minX, (p, q) => [b.minX, p[1]! + ((q[1]! - p[1]!) * (b.minX - p[0]!)) / (q[0]! - p[0]!)]],
      [(p) => p[0]! <= b.maxX, (p, q) => [b.maxX, p[1]! + ((q[1]! - p[1]!) * (b.maxX - p[0]!)) / (q[0]! - p[0]!)]],
      [(p) => p[1]! >= b.minY, (p, q) => [p[0]! + ((q[0]! - p[0]!) * (b.minY - p[1]!)) / (q[1]! - p[1]!), b.minY]],
      [(p) => p[1]! <= b.maxY, (p, q) => [p[0]! + ((q[0]! - p[0]!) * (b.maxY - p[1]!)) / (q[1]! - p[1]!), b.maxY]],
    ];
    for (const [keep, cut] of sides) {
      const out: number[][] = [];
      pts.forEach((p, i) => {
        const q = pts[(i + 1) % pts.length]!;
        if (keep(p)) out.push(p);
        if (keep(p) !== keep(q)) out.push(cut(p, q));
      });
      pts = out;
    }
    let a = 0;
    pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]!; a += p[0]! * q[1]! - q[0]! * p[1]!; });
    return Math.abs(a / 2);
  };
  const all = island.map((r) => clipped(r));
  const whole = island.map((r) => { let a = 0; r.forEach((p, i) => { const q = r[(i + 1) % r.length]!; a += p[0]! * q[1]! - q[0]! * p[1]!; }); return Math.abs(a / 2); });
  const outer = whole.indexOf(Math.max(...whole));
  return all.reduce((sum, a, i) => sum + (i === outer ? a : -a), 0);
}
const grid = (b: Box2, n = 6) => Array.from({ length: (n + 1) ** 2 }, (_, k) => [b.minX + ((b.maxX - b.minX) * (k % (n + 1))) / n, b.minY + ((b.maxY - b.minY) * Math.floor(k / (n + 1))) / n]);

/**
 * What a printable face must not have: two kinds of piece over each other (lettering, icons, the
 * mark, the QR), anything inside a QR's square with its quiet zone, a pattern, carving or a hole
 * under one, or a QR half on a colour field and half off, where no phone would read it.
 */
function clashes(face: CardFace, qrs: Box2[], cutouts: number[][][][]): string[] {
  const out: string[] = [];
  type Piece = { box: Box2; island: number[][][] };
  const byRole = new Map<string, Piece[]>();
  for (const ink of face.ink) {
    const list = byRole.get(ink.role) ?? [];
    for (const island of ink.shapes) list.push({ box: boxOf(island.flat()), island: island as number[][][] });
    byRole.set(ink.role, list);
  }
  const roles = [...byRole.keys()];
  const all = (ps: Piece[]) => boxOf(ps.flatMap((q) => [[q.box.minX, q.box.minY], [q.box.maxX, q.box.maxY]]));
  // Two islands overlap where their boxes meet and a corner of one lies inside the other (a frame
  // or an L round a mark has a box that covers the mark without touching it).
  const over = (a: Piece, b: Piece) => meet(a.box, b.box) && (a.island.some((r) => r.some((pt) => inside(pt, [b.island]))) || b.island.some((r) => r.some((pt) => inside(pt, [a.island]))));
  for (let i = 0; i < roles.length; i++) {
    for (let j = i + 1; j < roles.length; j++) {
      const a = byRole.get(roles[i]!)!;
      const b = byRole.get(roles[j]!)!;
      if (meet(all(a), all(b)) && a.some((x) => b.some((y) => over(x, y)))) out.push(`${roles[i]} over ${roles[j]}`);
    }
  }
  const p = face.pattern;
  const areas = [...face.carved, ...cutouts, ...(p ? (p.mode === 'cut' && p.lattice ? p.lattice.region : p.shapes) : [])] as number[][][][];
  for (const q of qrs) {
    const pts = grid(q);
    const inner = { minX: q.minX + 0.05, maxX: q.maxX - 0.05, minY: q.minY + 0.05, maxY: q.maxY - 0.05 };
    for (const [role, pieces] of byRole) if (role !== 'qr' && pieces.some((x) => meet(x.box, inner, 0) && areaIn(x.island, inner) > 0.01)) out.push(`${role} in the QR's square`);
    if (areas.some((island) => meet(boxOf(island.flat()), inner, 0) && areaIn(island, inner) > 0.01)) out.push('a pattern, carving or hole under the QR');
    if (face.fields.length) {
      const on = pts.map((pt) => inside(pt, face.fields as number[][][][]) && !inside(pt, face.gaps as number[][][][]));
      if (on.some((v) => v !== on[0])) out.push('the QR across the edge of a colour field');
    }
  }
  return out;
}

const params = (s: CardSettings): SolidParams => ({ thickness: s.thickness, raise: raiseOf(s), inlay: 0.6, pocketDepth: s.nfcTag === '25c' ? 1 : 0.4 });
/** A template opens with its own pattern and pattern mode, as the app sets them on a switch. */
const opened = (t: Template, s: CardSettings): CardSettings => ({ ...s, template: t.id, ...(t.pattern ? { pattern: t.pattern.value, patternMode: t.pattern.mode ?? 'colour' } : {}) });
const OUT = join(process.cwd(), 'tests/.out');
const preview = process.env.PREVIEW === '1';
if (preview) mkdirSync(OUT, { recursive: true });
const sheet: string[] = [];
const near = (a: number, step: number) => Math.abs(a / step - Math.round(a / step)) < 1e-4;
/** A one-sided card may be out of room; when it is, it says so in one sentence with the fix. */
const ONE_SIDE = /^One side cannot hold/;
/** Raised lettering (0.6 mm) and flat: the switch and its height together. */
const FINISHES: [string, Pick<CardSettings, 'raised' | 'raise'>][] = [['raised', { raised: true, raise: 0.6 }], ['flush', { raised: false, raise: 0.6 }]];

async function run(label: string, s: CardSettings, expectClean = true) {
  const t = TEMPLATES.find((x) => x.id === s.template)!;
  const d = await buildDesign(s, assetsFor(s.font), t);
  if (expectClean && s.twoSided) check(d.warnings.length === 0, `${label}: no warnings (got ${JSON.stringify(d.warnings)})`);
  if (expectClean && !s.twoSided) check(d.warnings.length === 0 || (d.warnings.length === 1 && ONE_SIDE.test(d.warnings[0]!)), `${label}: clean, or the one-side sentence (got ${JSON.stringify(d.warnings)})`);
  const r = buildSolid(wasm, d, params(s));
  check(r.parts.some((p) => p.colour === d.card.toLowerCase()), `${label}: has the card`);
  if (expectClean) check(r.warnings.length === 0, `${label}: solid builds clean (${JSON.stringify(r.warnings)})`);
  check(near(r.thickness, LAYER), `${label}: thickness on a layer line (${r.thickness})`);
  for (const p of r.parts) {
    check(closed(p.triVerts), `${label}: ${p.colour} part is closed`);
    const b = bounds(p.vertProperties);
    check(b.minX >= -d.w / 2 - 1e-3 && b.maxX <= d.w / 2 + 1e-3 && b.minY >= -d.h / 2 - 1e-3 && b.maxY <= d.h / 2 + 1e-3, `${label}: ${p.colour} inside the card`);
    check(b.minZ >= -1e-4, `${label}: ${p.colour} on the plate or above`);
  }
  if ((s.nfc || t.nfc) && r.pocketCeiling !== null) check(near(r.pocketCeiling, LAYER), `${label}: pocket ceiling on a layer line (${r.pocketCeiling})`);
  // A card that will print has every piece clear of every other.
  if (d.warnings.length === 0) {
    for (const [side, face] of [['front', d.front], ['back', d.back]] as const) {
      if (!face) continue;
      const c = clashes(face, d.qrs.filter((q) => q.side === side).map((q) => q.box), d.cutouts as number[][][][]);
      check(c.length === 0, `${label}: nothing on the ${side} lies over anything else (${c.join('; ')})`);
    }
  }
  if (d.pocket) {
    const { at, r: pr } = d.pocket;
    check(Math.abs(at[0]) + pr <= d.w / 2 - BORDER / 2 + 1e-6 && Math.abs(at[1]) + pr <= d.h / 2 - BORDER / 2 + 1e-6, `${label}: the pocket keeps its border of card (${at.map((v) => v.toFixed(1))})`);
  }
  // A reveal turns the card under the front's top layers its colour, the back face too: what the
  // back prints in the card's colour has to be laid in there, or it vanishes into the reveal.
  if (d.reveal && d.back?.ink.some((i) => i.colour.toLowerCase() === d.card.toLowerCase())) {
    check(r.parts.some((p) => p.colour === d.card.toLowerCase() && bounds(p.vertProperties).minZ < 1e-4), `${label}: the back's card-coloured pieces print on the back face`);
  }
  if (preview) {
    const front = designSvg(d, 'front', { width: 340, background: '#2a2d33', pocket: true });
    const back = d.back ? designSvg(d, 'back', { width: 340, background: '#2a2d33', pocket: true }) : '';
    writeFileSync(join(OUT, `${label}.front.svg`), front);
    if (back) writeFileSync(join(OUT, `${label}.back.svg`), back);
    sheet.push(`<figure><figcaption>${label} ${[...d.warnings, ...d.notes, ...r.notes].join(' · ')}</figcaption>${front}${back}</figure>`);
  }
  return { d, r };
}

// 1. Every template at its defaults, both finishes, one- and two-sided, with and without a QR.
for (const t of TEMPLATES) {
  for (const [finish, raise] of FINISHES) {
    for (const twoSided of [true, false]) {
      for (const qr of [true, false]) {
        const label = `${t.id}-${finish}-${twoSided ? '2s' : '1s'}-${qr ? 'qr' : 'noqr'}`;
        await run(label, opened(t, { ...DEFAULT_SETTINGS, ...raise, twoSided, qr }));
      }
    }
  }
}

// 2. Every size.
for (const size of ['85x55', '89x51', '90x50', '91x55']) {
  for (const t of TEMPLATES) await run(`${t.id}-${size}`, opened(t, { ...DEFAULT_SETTINGS, size }));
}

// 3. The lettering never goes under its floors, whatever is typed.
for (const t of TEMPLATES) {
  const { d } = await run(`${t.id}-long-email`, opened(t, { ...DEFAULT_SETTINGS, email: 'alexandra.montgomery-fitzgerald@northwindcreativestudio.com' }), false);
  check(d.warnings.some((w) => /email/.test(w)), `${t.id}: a too-long email says so (${JSON.stringify(d.warnings)})`);
}

// 4. Empty details build a card; an empty name too; no logo at all, and initials.
for (const t of TEMPLATES) {
  await run(`${t.id}-blank`, opened(t, { ...DEFAULT_SETTINGS, name: '', title: '', company: '', phone: '', email: '', website: '', qr: false }), false);
  await run(`${t.id}-nologo`, opened(t, { ...DEFAULT_SETTINGS, logoMode: 'none' }));
  await run(`${t.id}-initials`, opened(t, { ...DEFAULT_SETTINGS, logoMode: 'initials' }));
}

// 5. NFC: every template, both finishes, with the tap mark; the card grows to hold the tag.
for (const t of TEMPLATES) {
  for (const [finish, raise] of FINISHES) {
    for (const tag of ['25', '30', '25c']) {
      const { r } = await run(`${t.id}-nfc-${tag}-${finish}`, opened(t, { ...DEFAULT_SETTINGS, ...raise, nfc: true, nfcTag: tag, nfcMark: true }));
      check(r.pocketCeiling !== null, `${t.id}-nfc-${tag}-${finish}: has a pocket`);
    }
  }
}

// 5b. The pocket finds solid card: on a one-sided card, and under a pattern cut through, where it
//     moves off the holes or the pattern keeps off it; with the tap mark and without.
for (const t of TEMPLATES) {
  for (const mark of [false, true]) {
    const label = `${t.id}-1s-nfc-${mark ? 'mark' : 'hidden'}`;
    const { r } = await run(label, opened(t, { ...DEFAULT_SETTINGS, twoSided: false, qr: false, nfc: true, nfcTag: '30', nfcMark: mark }));
    check(r.pocketCeiling !== null, `${label}: has a pocket`);
  }
}
for (const t of TEMPLATES.filter((x) => x.pattern)) {
  for (const mark of [false, true]) {
    for (const pattern of [t.pattern!.value, 'honeycomb']) {
      const label = `${t.id}-cut-${pattern}-nfc-${mark ? 'mark' : 'hidden'}`;
      const { r } = await run(label, { ...opened(t, DEFAULT_SETTINGS), pattern, patternMode: 'cut', nfc: true, nfcTag: '30', nfcMark: mark });
      check(r.pocketCeiling !== null, `${label}: has a pocket`);
    }
  }
}

// 5c. The tag where the customer dragged it: it goes there, kept inside its border and off the
//     holes, and the tap mark finds the nearest clear place.
for (const t of TEMPLATES.filter((x) => !x.nfc)) {
  for (const at of [[0, 0], [-60, 40]] as [number, number][]) {
    const label = `${t.id}-nfc-dragged-${at.join('_')}`;
    const { d, r } = await run(label, opened(t, { ...DEFAULT_SETTINGS, nfc: true, nfcTag: '25', nfcAt: at }));
    check(r.pocketCeiling !== null, `${label}: has a pocket`);
    if (at[0] === 0 && !t.portrait && !d.cutouts.length) check(!!d.pocket && Math.hypot(d.pocket.at[0], d.pocket.at[1]) < 1e-6, `${label}: the tag goes where it was dropped (${d.pocket?.at})`);
  }
}

// 5d. Where the logo and the QR go and what the back says: each face carries what it was given,
//     and a front that cannot hold its QR says so rather than printing it over the lettering.
const NO_FRONT_QR = /^No room for the QR code on the front/;
for (const t of TEMPLATES) {
  const cases: [string, Partial<CardSettings>][] = [
    ['qr-front', { qrPlace: 'front' }],
    ['logo-front-name', { logoPlace: 'front', backText: 'name' }],
    ['back-qr-only', { logoPlace: 'front', backText: 'none' }],
    ['back-logo-only', { qrPlace: 'front', backText: 'none' }],
    ['back-empty', { qrPlace: 'front', logoPlace: 'front', backText: 'none' }],
  ];
  for (const [name, over] of cases) {
    const label = `${t.id}-${name}`;
    const s = opened(t, { ...DEFAULT_SETTINGS, ...over });
    const { d } = await run(label, s, false);
    check(d.warnings.every((w) => NO_FRONT_QR.test(w)), `${label}: nothing to say but a front with no room for the QR (${JSON.stringify(d.warnings)})`);
    const qrFace = t.qrSide ?? s.qrPlace;
    // On the face asked for, or moved to the back (and said so) when the front has no room.
    const moved = d.notes.includes(QR_MOVED);
    check(!d.qrs.some((q) => q.side !== (moved ? 'back' : qrFace)), `${label}: the QR is only on the ${moved ? 'back, moved there' : qrFace} (${JSON.stringify(d.qrs.map((q) => q.side))})`);
    check(d.qrs.length > 0, `${label}: the card has its QR code`);
    if (s.logoPlace === 'front' && !t.markFixed) check(!d.back?.ink.some((i) => i.role === 'logo'), `${label}: no logo on the back`);
    if (s.backText === 'name') check(d.back?.ink.some((i) => i.role !== 'logo' && i.role !== 'qr') ?? false, `${label}: the back says the name`);
  }
}

// 5e. The cards adapted from Laser Studio's and Window: a logo placed on the front is drawn there
//     (Window's used to vanish), on a card with a back and on one without; Tall's pattern runs from
//     the card's top to its foot round its panel, whose walls give way to a line that needs them; a
//     QR with the logo in it fits Tall's and Window's backs; Framed keeps the rule under the name
//     where its lines fit with it.
for (const id of ['window', 'half', 'framed', 'tall', 'logo-tile']) {
  const t = TEMPLATES.find((x) => x.id === id)!;
  const cases: [string, Partial<CardSettings>][] = [
    ['logo-on-front', { logoPlace: 'front' }],
    ['logo-on-front-raised', { logoPlace: 'front', raised: true }],
    ['logo-one-sided', { twoSided: false, qr: false }],
  ];
  for (const [name, over] of cases) {
    const label = `${id}-${name}`;
    const { d } = await run(label, opened(t, { ...DEFAULT_SETTINGS, ...over }));
    check(d.front.ink.some((i) => i.role === 'logo'), `${label}: the logo is on the front`);
  }
}
{
  const tall = TEMPLATES.find((x) => x.id === 'tall')!;
  const { d } = await run('tall-pattern-to-foot', opened(tall, DEFAULT_SETTINGS));
  const ys = (d.front.pattern?.shapes ?? []).flat(2).map((p) => p[1]!);
  check(ys.length > 0 && Math.min(...ys) < -d.h / 2 + 2 && Math.max(...ys) > d.h / 2 - 2, `tall: the pattern runs from the card's top to its foot (${Math.min(...ys).toFixed(1)} to ${Math.max(...ys).toFixed(1)})`);
  // The email's second half is 47 mm at the floor: more than the panel holds between its walls, and
  // less than the card's width. The walls give way rather than the email being refused.
  await run('tall-panel-walls-give-way', opened(tall, { ...DEFAULT_SETTINGS, email: 'jo@northwindstudio.com' }));
  for (const id of ['tall', 'window']) await run(`${id}-qr-logo`, opened(TEMPLATES.find((x) => x.id === id)!, { ...DEFAULT_SETTINGS, qrLogo: true }));
  const { d: framed } = await run('framed-rule', opened(TEMPLATES.find((x) => x.id === 'framed')!, DEFAULT_SETTINGS));
  check(framed.front.ink.some((i) => i.role === 'rule'), 'framed: the rule under the name, where the lines fit with it');
}

// 5e. A QR code never stops a card: on every template, dots, a logo in its middle, a colour that
//     does not show on the card, the front asked for, one side only. The code fits (in square
//     modules, without the logo, on a tile, on the back) or, on a one-sided card with no room,
//     is left out and the QR panel says so; never a warning.
for (const t of TEMPLATES) {
  const cases: [string, Partial<CardSettings>][] = [
    ['dots', { qrStyle: 'dots' }],
    ['qr-logo', { qrLogo: true }],
    ['black-qr', { colors: { qr: '#161616' } }],
    ['front', { qrPlace: 'front' }],
    ['one-side', { twoSided: false }],
    ['contact-dots-logo', { qrKind: 'contact', qrStyle: 'dots', qrLogo: true }],
  ];
  for (const [name, over] of cases) {
    const label = `${t.id}-qr-never-stops-${name}`;
    const s = opened(t, { ...DEFAULT_SETTINGS, ...over });
    const { d } = await run(label, s, false);
    const qrWarnings = d.warnings.filter((w) => /QR|contact card/.test(w));
    check(qrWarnings.length === 0, `${label}: no warning about the code (${JSON.stringify(qrWarnings)})`);
    const leftOut = d.notes.some((n) => n.startsWith(QR_LEFT_OUT));
    check(d.qrs.length > 0 || leftOut, `${label}: the code is on the card, or the panel says why not (${JSON.stringify(d.notes)})`);
    if (s.twoSided && t.qrSide !== 'front') check(d.qrs.length > 0, `${label}: a two-sided card always carries its code`);
  }
}

// 6. Patterns in every mode on every template that has one.
for (const t of TEMPLATES.filter((x) => x.pattern)) {
  for (const mode of ['colour', 'carved', 'cut'] as const) {
    await run(`${t.id}-pattern-${mode}`, { ...opened(t, DEFAULT_SETTINGS), patternMode: mode });
  }
  await run(`${t.id}-honeycomb-cut`, { ...opened(t, DEFAULT_SETTINGS), pattern: 'honeycomb', patternMode: 'cut' });
}

// 7. Icons in every style, a QR with the logo in the middle and as a contact card, other faces.
for (const style of ['none', 'classic', 'classic-circle', 'modern', 'modern-square'] as const) {
  await run(`minimal-icons-${style}`, { ...DEFAULT_SETTINGS, iconStyle: style });
}
await run('minimal-qr-logo', { ...DEFAULT_SETTINGS, qrLogo: true });
for (const t of TEMPLATES) await run(`${t.id}-qr-large`, opened(t, { ...DEFAULT_SETTINGS, qrSize: 'large' }));
// A contact card scans on every template that can put its code on the back, and saves all of the
// card's details: the template's own back when it holds the whole vCard, else the back given over
// to the code. With long details it gives up the title, the website and the company, in that
// order, and says so; a template whose code is on the front by design says why it cannot.
for (const t of TEMPLATES) {
  const label = `${t.id}-qr-contact`;
  const { d } = await run(label, opened(t, { ...DEFAULT_SETTINGS, qrKind: 'contact' }), t.qrSide !== 'front');
  if (t.qrSide === 'front') {
    check(d.notes.some((n) => n.startsWith(QR_LEFT_OUT) && /Scan back/.test(n)), `${label}: says why the contact card does not fit (${JSON.stringify(d.notes)})`);
  } else {
    check(d.qrs.some((q) => q.side === 'back'), `${label}: the code is on the back`);
    check(d.notes.includes('QR saves your name, phone, email, company, website and title'), `${label}: the code saves every detail (${JSON.stringify(d.notes)})`);
  }
}
{
  const long = { ...DEFAULT_SETTINGS, qrKind: 'contact' as const, title: 'Principal Creative Director of Brand Experience', website: 'northwind-creative-studio.example.com/team/alexandra-montgomery', company: 'Northwind Creative Studio International' };
  const { d } = await run('minimal-qr-contact-long', long, false);
  const saves = d.notes.find((n) => n.startsWith('QR saves'));
  check(!!saves && saves.startsWith('QR saves your name, phone') && /; no room for your .*title$/.test(saves), `long contact details give up the extras, the title first, and say so (${saves})`);
}
for (const font of ['montserrat', 'archivo-black', 'playfair-display', 'russo-one']) await run(`minimal-${font}`, { ...DEFAULT_SETTINGS, font });
await run('swoosh-light', { ...DEFAULT_SETTINGS, template: 'swoosh', cardColor: '#f5f1e8', inkColor: '#1f2a44', accentColor: '#2f6f62' });

// 8. Colours of their own: a part set to its own colour gets its own filament; a QR set to the card's
//    colour cannot scan and says so.
{
  const { r } = await run('minimal-own-colours', { ...DEFAULT_SETTINGS, colors: { name: '#3b82f6', qr: '#e11d48' } });
  check(r.parts.some((p) => p.colour === '#3b82f6'), 'a name set to its own colour prints in it');
  const { d } = await run('minimal-qr-card-colour', { ...DEFAULT_SETTINGS, colors: { qr: DEFAULT_SETTINGS.cardColor } });
  const tiles = d.back?.ink.filter((i) => i.role === 'qr') ?? [];
  check(d.qrs.length === 1 && tiles.length === 2 && d.notes.some((n) => n.startsWith('The code stands on a tile')), `a QR in the card's colour stands on a tile of the filament that reads best (${JSON.stringify(d.notes)})`);
  check(tiles.some((i) => i.colour.toLowerCase() === DEFAULT_SETTINGS.cardColor.toLowerCase()) && tiles.some((i) => i.colour.toLowerCase() === DEFAULT_SETTINGS.inkColor.toLowerCase()), 'the code keeps its colour, the tile is the lettering filament');
}

if (preview) {
  writeFileSync(join(OUT, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Business cards</title><style>body{background:#1b1d22;color:#ccc;font:12px system-ui;display:grid;grid-template-columns:repeat(auto-fill,minmax(700px,1fr));gap:18px;padding:18px}figure{margin:0}svg{margin:4px}</style>${sheet.join('')}`);
  console.log(`preview: ${join(OUT, 'index.html')}`);
}
console.log(`${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
