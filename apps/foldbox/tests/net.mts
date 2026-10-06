// Does the derivation actually hold? Run with `pnpm --filter foldbox test:net`.
//
// The extremes here are not arbitrary: 200x20x200, 50x50x8 and 60x60x60 are the cases
// that broke the first formulas we tried, so every style is held to them.

import { solve } from '../src/geometry/solve';
import { buildNet } from '../src/geometry/net';
import { buildStyle } from '../src/geometry/styles';
import { DEFAULT_PARAMS, type BoxParams, type StyleId } from '../src/types';
import { at, polysBounds, dist, key, onSegment, signedArea, snapPt } from '../src/geometry/poly';
import type { Pt } from '../src/types';

const STYLES: StyleId[] = [
  'mailer',
  'mailer-flaps',
  'tray',
  'tray-lid',
  'cake-box',
  'tuck-top',
  'snap-lock',
  'gable',
  'sleeve',
  'divider',
];

const CASES: [string, Partial<BoxParams>][] = [
  ['default 90x60x40', {}],
  ['tall thin 200x20x200', { lengthMm: 200, widthMm: 20, heightMm: 200 }],
  ['flat square 50x50x8', { lengthMm: 50, widthMm: 50, heightMm: 8 }],
  ['cube 60x60x60', { lengthMm: 60, widthMm: 60, heightMm: 60 }],
  ['tiny 20x20x20', { lengthMm: 20, widthMm: 20, heightMm: 20 }],
  ['big 250x180x120', { lengthMm: 250, widthMm: 180, heightMm: 120 }],
  ['thick stock', { caliperMm: 1.2 }],
  ['no window', { window: false } as Partial<BoxParams>],
  ['dividers 4x3', { dividerCols: 4, dividerRows: 3 }],
  ['hang slot, short', { hangTab: 'hole', heightMm: 12 }],
  ['hang slot, tall', { hangTab: 'hole', heightMm: 120 }],
  ['header, single ply', { hangTab: 'single' }],
  ['header, double ply', { hangTab: 'double' }],
  ['tab on the left end', { hangTab: 'double', hangEnd: 'left' }],
  ['tab on both ends', { hangTab: 'double', hangEnd: 'both' }],
  ['lid tab, both ends', { hangTab: 'single', hangEnd: 'both' }],
  ['tab on a flat box', { hangTab: 'double', hangEnd: 'both', heightMm: 10 }],
  ['lid wings', { lidWings: true }],
  ['lid wings + tab', { lidWings: true, hangTab: 'single' }],
  ['lid wings on thick stock', { lidWings: true, caliperMm: 1.2 }],
  ['window on the base', { window: true, windowFace: 'ml-base' }],
  ['window on the back wall', { window: true, windowFace: 'ml-back' }],
  ['round hole', { hangTab: 'single', hangHole: 'round' }],
  ['round hole header', { hangTab: 'double', hangHole: 'round' }],
  ['round hole slot', { hangTab: 'hole', hangHole: 'round' }],
  ['round hole, narrow', { hangTab: 'single', hangHole: 'round', widthMm: 22 }],
];

const bbox = (poly: [number, number][]) => polysBounds([poly]);
const fmt = (b: [number, number, number, number]) =>
  `[${b.map((v) => v.toFixed(1)).join(", ")}]`;

let failures = 0;
let checks = 0;

function fail(msg: string): void {
  failures++;
  console.error(`  FAIL  ${msg}`);
}
function ok(cond: boolean, msg: string): void {
  checks++;
  if (!cond) fail(msg);
}

function finite(polys: number[][][]): boolean {
  return polys.every((p) => p.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
}

for (const style of STYLES) {
  console.log(`\n${style}`);
  for (const [name, over] of CASES) {
    const p: BoxParams = { ...DEFAULT_PARAMS, style, ...over };
    let r;
    try {
      r = solve(p);
    } catch (e) {
      fail(`${name}: threw — ${(e as Error).message}`);
      continue;
    }
    const net = r.net;
    const tag = `${name}`;

    ok(finite(net.cutRings), `${tag}: cut rings contain a non-finite coordinate`);
    ok(
      net.panels.every((pl) => finite([pl.outline, ...pl.holes])),
      `${tag}: a panel has a non-finite coordinate`,
    );

    // Every panel with a parent must have found its hinge. A missing crease means
    // the builder placed a panel where it does not touch its parent — the one bug
    // this whole architecture exists to make impossible to hide.
    const withParent = net.panels.filter((x) => x.parent).length;
    ok(
      net.creases.length === withParent,
      `${tag}: ${net.creases.length} creases for ${withParent} parented panels — a panel is not touching its parent`,
    );

    // No crease may lie on the cut boundary: it would be cut through instead of folded.
    const boundaryEdges = new Set<string>();
    for (const ring of net.cutRings) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        boundaryEdges.add(`${key(a)}|${key(b)}`);
        boundaryEdges.add(`${key(b)}|${key(a)}`);
      }
    }
    for (const c of net.creases) {
      if (boundaryEdges.has(`${key(c.a)}|${key(c.b)}`)) {
        fail(`${tag}: crease ${c.panelId} lies on the cut outline`);
        break;
      }
    }

    for (const c of net.creases) {
      if (dist(c.a, c.b) < 1) {
        fail(`${tag}: crease ${c.panelId} is ${dist(c.a, c.b).toFixed(2)} mm long — degenerate`);
        break;
      }
    }

    // Exactly the expected number of separate blanks, wound the right way.
    const outers = net.cutRings.filter((x) => signedArea(x) > 0).length;
    const expected = style === 'tray-lid' ? 2 : style === 'divider' ? 0 : 1;
    ok(outers === expected, `${tag}: ${outers} blank(s), expected ${expected}`);

    // Holes must be wound the other way, or the exporter will read them as parts —
    // and they must actually be INSIDE the panel they claim to be a hole in. A hole
    // that escapes its panel is a closed cut ring floating in the waste: nothing else
    // checks for it, the connectivity test only counts outer rings, and the first
    // anyone knows about it is a blade tracking across the sheet.
    for (const pl of net.panels) {
      const pb = bbox(pl.outline);
      for (const h of pl.holes) {
        if (signedArea(h) === 0) fail(`${tag}: zero-area hole in ${pl.id}`);
        const hb = bbox(h);
        if (hb[0] < pb[0] - 1e-6 || hb[1] < pb[1] - 1e-6 || hb[2] > pb[2] + 1e-6 || hb[3] > pb[3] + 1e-6) {
          fail(
            `${tag}: a hole in ${pl.id} escapes the panel — hole ${fmt(hb)} vs panel ${fmt(pb)}`,
          );
          break;
        }
      }
    }

    // No two apertures anywhere in the blank may overlap. Panels tile the sheet and
    // never overlap each other, so two holes that DO overlap are always a bug — and
    // it is invisible everywhere else: the blank still comes out as one piece and
    // every hole is still inside its own panel. The mailer's two hand holes — since
    // removed — were drawn 90 degrees out and ate each other for exactly this reason,
    // and windows, hang slots and handle grips can all still do it.
    const apertures = net.panels.flatMap((pl) => pl.holes.map((h) => ({ id: pl.id, b: bbox(h) })));
    for (let i = 0; i < apertures.length; i++) {
      for (let j = i + 1; j < apertures.length; j++) {
        const a = apertures[i]!;
        const c = apertures[j]!;
        const gap = 1e-6;
        const overlaps =
          a.b[0] < c.b[2] - gap && c.b[0] < a.b[2] - gap &&
          a.b[1] < c.b[3] - gap && c.b[1] < a.b[3] - gap;
        if (overlaps) {
          fail(`${tag}: apertures overlap — ${a.id} ${fmt(a.b)} vs ${c.id} ${fmt(c.b)}`);
          i = apertures.length;
          break;
        }
      }
    }

    // A notch is meant to REMOVE material. If adding one grows the blank, the arc is
    // sweeping the wrong way and the "notch" is a bump.
    if (p.thumbNotch) {
      const without = solve({ ...p, thumbNotch: false });
      const grew = Math.max(
        r.netSizeMm[0] - without.netSizeMm[0],
        r.netSizeMm[1] - without.netSizeMm[1],
      );
      ok(grew <= 1e-6, `${tag}: the thumb notch made the blank ${grew.toFixed(2)} mm BIGGER`);
    }

    const [w, h] = r.netSizeMm;
    ok(w > 0 && h > 0, `${tag}: net has no size`);
    ok(r.largestCubeMm >= 0, `${tag}: largestCube went negative`);

    console.log(
      `  ok  ${name.padEnd(22)} ${w.toFixed(0)}×${h.toFixed(0)} mm · ` +
        `${net.panels.length} panels · ${net.creases.length} creases · ` +
        `${outers} blank${outers === 1 ? '' : 's'} · cube≤${r.largestCubeMm}`,
    );
  }
}

// The derivation's own contract, checked directly rather than through solve().
console.log('\nderivation invariants');
{
  const p: BoxParams = { ...DEFAULT_PARAMS, style: 'tuck-top' };
  const { parts } = buildStyle(p);
  const net = buildNet(parts);
  const creaseKeys = new Set(net.creases.map((c) => `${key(c.a)}|${key(c.b)}`));
  ok(creaseKeys.size === net.creases.length, 'two creases share the same hinge segment');
  const depths = new Set(net.creases.map((c) => c.depth));
  ok(depths.size > 1, 'every crease came out at the same depth — the fold tree is flat');
  ok(
    net.creases.every((c) => c.dir === (c.foldAngle >= 0 ? 'valley' : 'mountain')),
    'fold direction disagrees with the fold angle',
  );
}

// EVERY INTERIOR EDGE IS A FOLD. This is the derivation's own rule — "tree edges are the
// creases, non-tree edges are the cuts" is only half of it, because an edge can be neither:
// interior (it has a reverse twin, so there is material on both sides) and yet not the fold
// tree's, because the tree holds one hinge per panel and a panel can touch two neighbours.
//
// The webbed corner does it by construction, and the dieline was missing 100 mm of fold
// line on a webbed tray and 130 mm on the hinged lid — on the one corner in the catalogue
// that is genuinely hard to fold by eye. `printable.ts` never had the bug, because it
// grooves by geometry; `net.webFolds` is the same rule applied to the flat file.
console.log('\nevery interior edge is marked as a fold');
{
  const WEBBED: StyleId[] = ['tray-webbed', 'flap-cover'];
  let marked = 0;
  let webbed = 0;
  for (const style of [...STYLES, ...WEBBED]) {
    for (const [name, over] of CASES) {
      const p: BoxParams = { ...DEFAULT_PARAMS, style, ...over };
      const net = solve(p).net;
      const tag = `${style}/${name}`;

      // Every directed panel edge, then the ones whose reverse also exists.
      const dir = new Set<string>();
      const edges: { a: Pt; b: Pt }[] = [];
      for (const panel of net.panels) {
        for (let i = 0; i < panel.outline.length; i++) {
          const a = snapPt(at(panel.outline, i));
          const b = snapPt(at(panel.outline, i + 1));
          dir.add(`${key(a)}|${key(b)}`);
          edges.push({ a, b });
        }
      }
      const covers = (e: { a: Pt; b: Pt }): boolean => {
        const mid: Pt = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
        for (const c of net.creases) if (onSegment(mid, c.a, c.b)) return true;
        for (const f of net.webFolds) if (onSegment(mid, f.a, f.b)) return true;
        for (const s of net.slits) {
          for (let i = 0; i + 1 < s.points.length; i++) {
            if (onSegment(mid, s.points[i] as Pt, s.points[i + 1] as Pt)) return true;
          }
        }
        return false;
      };
      for (const e of edges) {
        if (!dir.has(`${key(e.b)}|${key(e.a)}`)) continue;
        marked++;
        ok(covers(e), `${tag}: an interior edge has no fold line on it (${e.a}) - (${e.b})`);
      }
      // And a web fold is never ON a cut ring, which would be a fold line drawn along an
      // edge that is about to be cut away.
      for (const f of net.webFolds) {
        webbed++;
        const mid: Pt = [(f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2];
        for (const ring of net.cutRings) {
          for (let i = 0; i < ring.length; i++) {
            ok(
              !onSegment(mid, at(ring, i), at(ring, i + 1)),
              `${tag}: a web fold lies on a cut ring`,
            );
          }
        }
      }
    }
  }
  console.log(`  ok  ${marked} interior edges across ${STYLES.length + WEBBED.length} styles · ${webbed} of them folds the tree cannot hold`);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
}
