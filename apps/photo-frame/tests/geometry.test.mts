// The real builders across their range, in node with manifold-3d and no browser: every outline,
// corner, border, profile, face layout and stand, on every photo size, builds; every part is a
// closed mesh; every slicer object lies on the bed; nothing standing sinks under the table; the
// preview's picture sits on the card. The designs and their rules are designs.test.mts.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import Module from 'manifold-3d';
import { buildModel, type BuildSettings } from '../src/geometry/build';
import { frameLayout, holderLayout, type FrameSpec, type Outline, type Corners, type Border, type Profile, type FaceLayout, type StandKind } from '../src/geometry/layout';
import { musicArt, socialArt } from '../src/geometry/glyphs';
import type { Ring } from '../src/geometry/outline';
import { fitText, tokenOf, type Face } from '../src/text';
import { SIZES_FOR, printOf, standsFor, type PhotoId } from '../src/sizes';

const wasm: any = await Module();
wasm.setup();

const FONTS_PKG = join(process.cwd(), '../../packages/fonts');
const opentype = createRequire(join(FONTS_PKG, 'package.json'))('opentype.js');
const parse = (id: string): Face => {
  const file = readFileSync(join(FONTS_PKG, 'src/fonts', `${id}.ttf`));
  return opentype.parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
};
const fredoka = parse('fredoka');
const pacifico = parse('pacifico');
const icons = parse('icon-fallback');

let failures = 0;
let checks = 0;
function check(ok: boolean, what: string) {
  checks++;
  if (!ok) {
    failures++;
    if (failures < 40) console.error('FAIL', what);
  }
}

/** Every edge shared by exactly two triangles. */
function closed(tri: Uint32Array): boolean {
  const edges = new Map<number, number>();
  for (let t = 0; t < tri.length; t += 3) {
    for (let i = 0; i < 3; i++) {
      const a = tri[t + i]!;
      const b = tri[t + ((i + 1) % 3)]!;
      if (a === b) return false;
      const key = a < b ? a * 4194304 + b : b * 4194304 + a;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  for (const n of edges.values()) if (n !== 2) return false;
  return true;
}

function zMin(p: { vertProperties: Float32Array; numProp: number }): number {
  let lo = Infinity;
  for (let i = 2; i < p.vertProperties.length; i += p.numProp) lo = Math.min(lo, p.vertProperties[i]!);
  return lo;
}

const HEART = tokenOf('\u{e87d}');
const SPEC: FrameSpec = { outline: 'rect', corners: 'rounded', border: 'regular', profile: 'flat', layout: 'chin', crest: false, lines: 1, stand: 'base' };

function settings(photo: PhotoId, frame: FrameSpec): BuildSettings {
  return { kind: 'frame', photo, orientation: 'portrait', customWidth: 70, customHeight: 100, frame, holder: 'bar', bodyColor: '#0a5cd5', inkColor: '#f7f7f5', baseColor: '#0a5cd5', matColor: '#ffffff' };
}

/** What the screen would print on this frame: words in each caption box, and the player or the post. */
function inkFor(s: BuildSettings): Ring[] {
  const L = frameLayout(s.frame, printOf(s));
  const out: Ring[] = [];
  L.captions.forEach((box, i) => out.push(...(fitText(fredoka, icons, i === 0 ? `Mia ${HEART} Leo` : '12.09.2024', box, 20)?.rings ?? [])));
  if (L.crest) out.push(...(fitText(pacifico, icons, 'M & L', L.crest.text, 20)?.rings ?? []));
  if (L.music) {
    out.push(...musicArt(L.music, null));
    out.push(...(fitText(fredoka, icons, 'Golden Hour', L.music.title, 20, 'left')?.rings ?? []));
    if (L.music.artist) out.push(...(fitText(fredoka, icons, 'The Band', L.music.artist, 20, 'left')?.rings ?? []));
    if (L.music.times) out.push(...(fitText(fredoka, icons, '1:25', L.music.times.left, 20, 'left')?.rings ?? []), ...(fitText(fredoka, icons, '3:45', L.music.times.right, 20)?.rings ?? []));
  }
  if (L.social) {
    out.push(...socialArt(L.social));
    out.push(...(fitText(fredoka, icons, 'mia.and.leo', L.social.name, 20, 'left')?.rings ?? []));
    out.push(...(fitText(fredoka, icons, '249 likes', L.social.likes, 20, 'left')?.rings ?? []));
  }
  return out;
}

let builds = 0;
const t0 = Date.now();
function run(s: BuildSettings, what: string, withInk = true) {
  let r;
  try {
    r = buildModel(wasm, { s, ink: withInk && s.kind === 'frame' ? inkFor(s) : [], seed: 'photo-frame/test' });
    builds++;
  } catch (e) {
    check(false, `${what}: build threw ${(e as Error).message}`);
    return;
  }
  check(r.print.length >= 1 && r.assembled.length === r.print.length, `${what}: the same parts in both poses`);
  for (const p of [...r.print, ...r.assembled, r.preview.card]) {
    check(p.triVerts.length > 0, `${what}: ${p.name} is not empty`);
    check(closed(p.triVerts), `${what}: ${p.name} is a closed mesh`);
  }
  const lowest = new Map<string, number>();
  for (const p of r.print) lowest.set(p.group, Math.min(lowest.get(p.group) ?? Infinity, zMin(p)));
  for (const [g, lo] of lowest) check(Math.abs(lo) < 1e-3, `${what}: ${g} lies on the bed (min z ${lo.toFixed(3)})`);
  for (const p of r.assembled) check(zMin(p) > -0.05, `${what}: ${p.name} stands above the table (min z ${zMin(p).toFixed(3)})`);
  check(r.preview.photo.every((v) => v.every(Number.isFinite)), `${what}: the preview picture has corners`);
}

// Every axis on its own, at every size the frame takes.
const AXES: [keyof FrameSpec, readonly unknown[]][] = [
  ['outline', ['rect', 'arch', 'scallop', 'ricrac', 'squiggle'] as Outline[]],
  ['corners', ['square', 'rounded', 'round'] as Corners[]],
  ['border', ['thin', 'regular', 'thick'] as Border[]],
  ['profile', ['flat', 'bevel', 'deep'] as Profile[]],
  ['layout', ['plain', 'chin', 'music', 'social'] as FaceLayout[]],
  ['stand', ['block', 'base', 'foot', 'kickstand', 'magnets', 'keychain', 'none'] as StandKind[]],
];
for (const photo of SIZES_FOR.frame) {
  const { pw, ph } = printOf(settings(photo, SPEC));
  for (const [axis, values] of AXES) {
    for (const v of values) {
      const frame = { ...SPEC, [axis]: v } as FrameSpec;
      if (frame.outline === 'squiggle' && ['base', 'block', 'foot'].includes(frame.stand)) frame.stand = 'magnets';
      if (frame.stand === 'magnets' && !standsFor('frame', pw, ph).includes('magnets')) continue;
      if (frame.stand === 'keychain' && !standsFor('frame', pw, ph).includes('keychain')) continue;
      run(settings(photo, frame), `${photo}/${axis}=${String(v)}`);
    }
  }
  // The song plaque with its artist and times, and the post.
  run(settings(photo, { ...SPEC, layout: 'music', border: 'thin', artist: true, times: true, stand: 'base' }), photo + '/song');
  run(settings(photo, { ...SPEC, layout: 'social', border: 'thin', stand: 'kickstand' }), photo + '/post');
  // Two lines and a crest (the wedding magnet).
  run(settings(photo, { ...SPEC, lines: 2, crest: true, stand: 'none' }), `${photo}/wedding`);
}

// The back plate never shows outside the frame: its whole outline, tail included, lies inside the
// frame's body outline (the right side stays straight over the plate's height, round corners or not).
{
  const { pointInRing } = await import('@vostok/shapes');
  const { outlineRecipe } = await import('../src/geometry/outline');
  for (const photo of SIZES_FOR.frame) {
    for (const outline of ['rect', 'arch', 'scallop', 'ricrac'] as Outline[]) {
      for (const corners of ['square', 'rounded', 'round'] as Corners[]) {
        for (const border of ['thin', 'regular', 'thick'] as Border[]) {
          const frame = { ...SPEC, outline, corners, border, layout: 'plain' as FaceLayout, stand: 'magnets' as StandKind };
          const L = frameLayout(frame, printOf(settings(photo, frame)));
          const body = outlineRecipe(L).rings[0]!;
          const tail = Math.min(7, L.rim - 1.0);
          const py = L.Ph / 2 + 1.0 - 0.25 + 0.3;
          const corners4: [number, number][] = [[-L.Pw / 2, -py], [L.Pw / 2 + tail, -py], [L.Pw / 2 + tail, py], [-L.Pw / 2, py]];
          check(corners4.every((p) => pointInRing(p, body)), `${photo}/${outline}/${corners}/${border}: the back plate stays inside the frame`);
        }
      }
    }
  }
}

// A spread of mixed designs on the Instant mini.
const pick = <T,>(list: readonly T[], i: number) => list[i % list.length]!;
for (let i = 0; i < 60; i++) {
  const frame: FrameSpec = {
    outline: pick(['rect', 'arch', 'scallop', 'ricrac', 'squiggle'] as Outline[], i),
    corners: pick(['square', 'rounded', 'round'] as Corners[], i * 7 + 1),
    border: pick(['thin', 'regular', 'thick'] as Border[], i * 5 + 2),
    profile: pick(['flat', 'bevel', 'deep'] as Profile[], i * 3 + 1),
    layout: pick(['plain', 'chin', 'music', 'social'] as FaceLayout[], i * 11 + 3),
    crest: i % 9 === 0,
    lines: i % 3,
    stand: pick(['block', 'base', 'foot', 'kickstand', 'magnets', 'keychain', 'none'] as StandKind[], i * 13 + 5),
  };
  if (frame.outline === 'squiggle' && ['base', 'block', 'foot'].includes(frame.stand)) frame.stand = 'kickstand';
  run(settings('mini', frame), `mix ${i} ${JSON.stringify(frame)}`);
}

// Holders, with and without words on the front.
for (const photo of SIZES_FOR.holder) {
  for (const holder of ['bar', 'pill', 'heart'] as const) {
    const s: BuildSettings = { ...settings(photo, SPEC), kind: 'holder', holder };
    const H = holderLayout(holder, printOf(s), true);
    const ink = H.textBox ? fitText(fredoka, icons, `Mia ${HEART}`, H.textBox, 20)?.rings ?? [] : [];
    for (const words of [[], ink]) {
      try {
        const r = buildModel(wasm, { s, ink: words, seed: 'photo-frame/test' });
        builds++;
        for (const p of [...r.print, ...r.assembled]) check(closed(p.triVerts), `holder ${photo}/${holder}: ${p.name} closed`);
        if (words.length && H.textBox) check(r.print.some((p) => p.name === 'Text'), `holder ${photo}/${holder}: the words are inlaid`);
      } catch (e) {
        check(false, `holder ${photo}/${holder}: build threw ${(e as Error).message}`);
      }
    }
  }
}

console.log(`${checks - failures}/${checks} checks passed over ${builds} builds in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (failures) process.exit(1);
