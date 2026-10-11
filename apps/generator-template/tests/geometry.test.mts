// The demo geometry across its range, with no browser: every part a closed mesh, the letters on
// the tag and clear of its edge and its hole, and text too long for the tag made smaller rather
// than left hanging off it. Replace it with your own product's test when you replace the geometry.
//
// The faces are the shelf's own font files, read with the opentype.js that @vostok/fonts depends
// on, resolved from there rather than made a dependency of the app for a test.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { buildTag, fitSettings, type Face } from '../src/geometry';
import { DEFAULT_SETTINGS, type TagSettings } from '../src/state';

const FONTS_PKG = join(process.cwd(), '../../packages/fonts');
const opentype = createRequire(join(FONTS_PKG, 'package.json'))('opentype.js');

/** The font cards in main.ts; Pacifico is a script, whose letters overlap each other. */
const FACES = ['russo-one', 'anton', 'bebas-neue', 'bungee', 'luckiest-guy', 'righteous', 'pacifico', 'permanent-marker'];
const faces = new Map<string, Face>();
for (const id of FACES) {
  const file = readFileSync(join(FONTS_PKG, 'src/fonts', `${id}.ttf`));
  faces.set(id, opentype.parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)));
}
const faceOf = (id: string): Face => faces.get(id)!;

let failures = 0;
let checks = 0;
function check(ok: boolean, what: string) {
  checks++;
  if (!ok) {
    failures++;
    console.error('FAIL', what);
  }
}

/** Every edge shared by exactly two triangles, and no triangle with a repeated corner. */
function closed(indices: Uint32Array): boolean {
  const edges = new Map<string, number>();
  for (let t = 0; t < indices.length; t += 3) {
    const tri = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) return false;
    for (let i = 0; i < 3; i++) {
      const a = tri[i]!;
      const b = tri[(i + 1) % 3]!;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  return [...edges.values()].every((n) => n === 2);
}

/** Inside the tag's rounded outline, `inset` in from its edge. */
function insideTag(s: TagSettings, x: number, y: number, inset: number): boolean {
  const a = s.width / 2 - inset;
  const b = s.height / 2 - inset;
  const r = Math.max(0, Math.min(s.radius - inset, a, b));
  const dx = Math.abs(x) - (a - r);
  const dy = Math.abs(y) - (b - r);
  if (Math.abs(x) > a + 1e-6 || Math.abs(y) > b + 1e-6) return false;
  return dx <= 0 || dy <= 0 || Math.hypot(dx, dy) <= r + 1e-6;
}

const TEXTS = ['Hello', 'Alexandra Konstantinova', 'AW 8%'];
const SIZES: [number, number][] = [[20, 10], [60, 25], [150, 80], [30, 60]];

for (const font of FACES) {
  for (const text of TEXTS) {
    for (const [width, height] of SIZES) {
      for (const radius of [0, 40]) {
        for (const hole of [true, false]) {
          const asked: TagSettings = { ...DEFAULT_SETTINGS, font, text, width, height, radius, hole, holeSize: 6 };
          const s = fitSettings(asked);
          const name = `${font} "${text}" ${width}x${height} r${radius} hole ${hole}`;
          const built = buildTag(asked, faceOf(font));
          for (const part of built.parts) check(closed(part.indices), `${name}: ${part.name} is a closed mesh`);

          const letters = built.parts.find((p) => p.name === 'Letters');
          check(!!letters, `${name}: letters were built`);
          if (!letters) continue;
          const holeX = -s.width / 2 + 2.5 + s.holeSize / 2;
          let onTag = true;
          let clearOfHole = true;
          let standing = true;
          const p = letters.positions;
          for (let i = 0; i < p.length; i += 3) {
            const x = p[i]!;
            const y = p[i + 1]!;
            const z = p[i + 2]!;
            if (!insideTag(s, x, y, 2.9)) onTag = false;
            if (s.hole && Math.hypot(x - holeX, y) < s.holeSize / 2 + 2.9) clearOfHole = false;
            if (z < s.thickness - 1e-4 || z > s.thickness + s.raise + 1e-4) standing = false;
          }
          check(onTag, `${name}: letters stay 3 mm inside the tag's outline`);
          check(!s.hole || clearOfHole, `${name}: letters stay 3 mm clear of the hole`);
          check(standing, `${name}: letters stand on the tag, ${s.raise} mm tall`);
          check(built.textSize <= s.textSize + 1e-9, `${name}: text never drawn bigger than asked`);
        }
      }
    }
  }
}

// Long text on a short tag is made smaller, and says so.
const russo = faceOf(DEFAULT_SETTINGS.font);
const long = buildTag({ ...DEFAULT_SETTINGS, text: 'Alexandra Konstantinova' }, russo);
check(long.shrunk && long.textSize < DEFAULT_SETTINGS.textSize, 'long text is made smaller to fit');
// Smaller than the sliders go, and a hole bigger than the tag: fitted, with the text still on it.
const tiny = buildTag({ ...DEFAULT_SETTINGS, width: 5, height: 5, holeSize: 30 }, russo);
check(tiny.parts.length === 2 && closed(tiny.parts[1]!.indices), 'an impossible tag is fitted, and keeps its text');
const blank = buildTag({ ...DEFAULT_SETTINGS, text: '   ' }, russo);
check(blank.parts.length === 1, 'no text builds the bare tag');

if (failures) {
  console.error(`${failures} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`geometry: ${checks} checks passed`);
