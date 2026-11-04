/*
  What the embedded export sends: a clicker's top and its body as two plates of OBJ, and anything
  laid out by object key (the fit test, a batch run) as the one plate it always was.

    node apps/clicker-generator/tests/suites.mjs obj-plates

  Synthetic boxes rather than real builds: the thing under test is which part goes in which OBJ
  and where it sits, and a box of a known size makes a part in the wrong file obvious.
*/
import { clickerObjMtl, clickerObjPlates, splitsTopAndBody } from '../src/export/objExport.ts';
import type { ClickerPart, PartGroup, RGB } from '../src/types.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —  ${detail}` : ''}`);
  if (!ok) failures++;
};

/** A box `w × d × h` at (cx, cy), sitting on z0..z0+h. */
function box(name: string, group: PartGroup, color: RGB, [cx, cy, z0]: number[], [w, d, h]: number[], extra: Partial<ClickerPart> = {}): ClickerPart {
  const [x0, x1, y0, y1, z1] = [cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2, z0 + h];
  return {
    kind: group === 'top' ? 'cap' : 'body',
    group,
    colorRgb: color,
    name,
    numProp: 3,
    vertProperties: new Float32Array([
      x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
      x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
    ]),
    triVerts: new Uint32Array([
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
      1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
    ]),
    ...extra,
  };
}

const WHITE: RGB = [240, 240, 240];
const RED: RGB = [200, 30, 30];
const BLACK: RGB = [20, 20, 20];

/** A flat clicker: cap, two inks, a body below it. */
const clicker = (): ClickerPart[] => [
  box('top-base', 'top', WHITE, [0, 0, 10], [30, 30, 3]),
  box('top-color-1-0', 'top', RED, [-5, 0, 13], [6, 6, 0.8]),
  box('top-color-0-0', 'top', BLACK, [5, 0, 13], [6, 6, 0.8]),
  box('base-body', 'base', WHITE, [0, 0, 0], [32, 32, 10]),
];

/** The `o` names in an OBJ, in order. */
const objects = (obj: string) => [...obj.matchAll(/^o (.+)$/gm)].map((m) => m[1]!);
/** Every vertex of an OBJ. */
const verts = (obj: string) => [...obj.matchAll(/^v (\S+) (\S+) (\S+)$/gm)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
/** Each `o` block's vertices, by name. */
function blocks(obj: string): Map<string, number[][]> {
  const out = new Map<string, number[][]>();
  let cur: number[][] | null = null;
  for (const line of obj.split('\n')) {
    if (line.startsWith('o ')) out.set(line.slice(2), (cur = []));
    else if (line.startsWith('v ') && cur) cur.push(line.slice(2).split(' ').map(Number));
  }
  return out;
}
const faceIndicesFit = (obj: string) => {
  const n = verts(obj).length;
  return [...obj.matchAll(/^f (.+)$/gm)].every((m) => m[1]!.split(' ').every((c) => { const i = Number(c.split('/')[0]); return i >= 1 && i <= n; }));
};
/** The material each `o` uses. */
const mtlOf = (obj: string) => {
  const out = new Map<string, string>();
  let cur = '';
  for (const line of obj.split('\n')) {
    if (line.startsWith('o ')) cur = line.slice(2);
    else if (line.startsWith('usemtl ')) out.set(cur, line.slice(7));
  }
  return out;
};

{
  const parts = clicker();
  const { objs, mtl } = clickerObjPlates(parts);
  check('a clicker with a top and a body goes as two plates', objs.length === 2, `${objs.length} OBJ`);
  check('plate 1 holds only the top, every part of it', objects(objs[0]!).join() === 'top_top-base,top_top-color-1-0,top_top-color-0-0', objects(objs[0]!).join());
  check('plate 2 holds only the body', objects(objs[1]!).join() === 'base_base-body', objects(objs[1]!).join());
  check("each OBJ's faces index its own vertices", objs.every(faceIndicesFit));
  check('each OBJ carries the provenance mark', objs.every((o) => /^# .*vostok/im.test(o)), objs.map((o) => o.split('\n')[0]).join(' | '));
  const m0 = mtlOf(objs[0]!), m1 = mtlOf(objs[1]!);
  check('one MTL: white is one material on both plates', m0.get('top_top-base') === m1.get('base_base-body') && (mtl.match(/^newmtl /gm) ?? []).length === 3, mtl.replace(/\n/g, ' '));

  // Registration: the top's parts sit where the one-plate OBJ puts them, relative to each other.
  const single = blocks(clickerObjMtl(parts).obj);
  const split = blocks(objs[0]!);
  const offset = (b: Map<string, number[][]>, name: string) => b.get(name)![0]!.map((v, i) => v - b.get('top_top-base')![0]![i]!);
  const same = ['top_top-color-1-0', 'top_top-color-0-0'].every((n) => offset(single, n).every((d, i) => Math.abs(d - offset(split, n)[i]!) < 1e-6));
  check("the top's colours stay registered on the cap", same);
  check('both plates sit on the bed', [objs[0]!, objs[1]!].every((o) => Math.abs(Math.min(...verts(o).map((v) => v[2]!))) < 1e-6));
}

{
  // Letter blocks list the body first; the plate goes by group, not by order.
  const parts = [box('block-0', 'base', WHITE, [0, 0, 0], [40, 20, 10]), box('cap-0', 'top', WHITE, [-10, 0, 10], [18, 18, 8]), box('cap-1', 'top', WHITE, [10, 0, 10], [18, 18, 8])];
  const { objs } = clickerObjPlates(parts);
  check('a block set: the caps on plate 1, the body on plate 2, whatever the order', objs.length === 2 && objects(objs[0]!).join() === 'top_cap-0,top_cap-1' && objects(objs[1]!).join() === 'base_block-0', objs.map((o) => objects(o).join()).join(' / '));
}

{
  // The fit test's tiles, a batch run, one-sided parts: one plate, the text clickerObjMtl writes.
  const tiles = [-0.1, 0, 0.1].map((d, i) => box(`tile-${i}`, 'base', WHITE, [i * 25, 0, 0], [20, 20, 6], { objectKey: `tile-${i}` }));
  const batch = [
    box('top-base', 'top', WHITE, [0, 0, 10], [30, 30, 3], { objectKey: 'r01:top' }),
    box('base-body', 'base', WHITE, [0, 0, 0], [32, 32, 10], { objectKey: 'r01:base' }),
  ];
  const topOnly = [box('top-base', 'top', WHITE, [0, 0, 10], [30, 30, 3])];
  for (const [what, parts] of [['the fit test', tiles], ['a batch run', batch], ['a top alone', topOnly]] as const) {
    const { objs, mtl } = clickerObjPlates([...parts]);
    const one = clickerObjMtl([...parts]);
    check(`${what}: one plate, exactly as before`, objs.length === 1 && objs[0] === one.obj && mtl === one.mtl && !splitsTopAndBody([...parts]));
  }
}

{
  const credited = clickerObjPlates(clicker(), { sourceModel: 'Skull' });
  check("a cut model's credit is in both OBJs", credited.objs.every((o) => o.includes('Skull')));
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
if (failures) process.exit(1);
