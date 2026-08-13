// The solver: one silhouette in, a set of flat, kerf-compensated, laser-ready
// parts out.
//
// THE ASSEMBLY, because the rest of this file only makes sense with it in mind.
// Two copies of the same silhouette stand at right angles, crossing on a shared
// vertical axis. Along that axis both copies want the same material, so each
// gives up half of it:
//
//     profile A  slot cut from its TOP edge down to the midpoint
//     profile B  slot cut from its BOTTOM edge up to the midpoint
//
// Below the midpoint only A has material on the axis; above it, only B. They
// slide together and lock. A third part — a disc with a `+`-shaped through slot
// — takes a tab from each and holds the feet apart. (A laser cannot cut a blind
// pocket, so the tabs go all the way through.)
//
// B's bottom slot splits its own tab in two, and both halves sit on the same
// line, which is exactly why one straight arm of the `+` accepts them both.
//
// KERF. Everything here is drawn NOMINAL and then offset by +kerf/2 at the very
// end. That single offset is correct in all three places at once: it grows the
// outer boundary by k/2 (the beam then takes it back), and narrows every slot
// and notch by k (the beam then opens them back up). Verified against manifold
// 3.5.1 — offset(+0.1) on a 40 mm disc with a 3 mm slot gives 40.200 outer and
// 2.800 slot. The sign is easy to get backwards; it is +, not −.

import type {
  Diagnostic,
  Layout,
  Part,
  Placement,
  PreviewPart,
  RGB,
  Ring,
  SlotParams,
  SolveResult,
} from '../types';
import { MATERIALS, SHEETS } from '../types';
import * as poly from './polygon';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Section = any;
type Solid = any;
type Wasm = any;

/** Material either side of a slot, as a multiple of thickness. Below this the
 *  web is a sliver: it snaps on plywood and crazes on acrylic. */
const WEB_FACTOR = 1.5;

/** Simplification epsilon in MILLIMETRES. The tracer's own epsilon is in pixels
 *  and far too fine once scaled — 2,000-vertex paths make a laser stutter. */
const SIMPLIFY_MM = 0.06;

/** How far the two crossed profiles tip before they fall over. The base disc is
 *  sized so the assembled centre of mass sits inside this cone. */
const TIP_ANGLE_DEG = 20;

/** Below this the disc is decoration, not a base — the object topples if you
 *  breathe on it, and a smaller sheet is not worth a product that falls over. */
const MIN_TIP_ANGLE_DEG = 12;

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Scale + translate rings in place-free fashion (pure). */
function transform(rings: Ring[], s: number, dx: number, dy: number): Ring[] {
  return rings.map((r) => r.map((p) => [p[0] * s + dx, p[1] * s + dy] as [number, number]));
}

export function solve(wasm: Wasm, outline: Ring[], params: SlotParams): SolveResult {
  const { CrossSection } = wasm;
  const created: { delete(): void }[] = [];
  const track = <T extends { delete(): void }>(o: T): T => {
    created.push(o);
    return o;
  };

  const diagnostics: Diagnostic[] = [];
  const material = MATERIALS.find((m) => m.id === params.materialId) ?? MATERIALS[0];
  const sheet = SHEETS.find((s) => s.id === params.sheetId) ?? SHEETS[0];

  try {
    if (!outline.length) {
      throw new Error('No silhouette — the image traced to nothing.');
    }

    const t = Math.max(0.1, params.thicknessMm);
    const k = Math.max(0, params.kerfMm);
    const c = params.clearanceMm;

    // Nominal slot width. The +kerf/2 offset at the end turns this into
    // (t + c − k) as drawn, which the beam re-opens to (t + c) in the material.
    const W = t + c;
    if (W - k <= 0.05) {
      diagnostics.push({
        level: 'error',
        code: 'slot-narrower-than-beam',
        message: `A ${W.toFixed(2)} mm slot is narrower than the ${k.toFixed(2)} mm beam — it would close up completely.`,
        fix: 'Reduce the kerf figure, or use thicker material.',
      });
    }
    const minWeb = WEB_FACTOR * t;
    const need = W + 2 * minWeb;

    // ── 1. scale the normalised outline to millimetres, bottom edge at y = 0 ──
    const raw = track(new CrossSection(outline, 'NonZero'));
    let rings = raw.toPolygons() as Ring[];
    let bb = poly.bbox(rings);
    const h0 = bb[3] - bb[1];
    if (h0 <= 1e-6) throw new Error('The silhouette has no height.');
    const s = params.heightMm / h0;
    rings = transform(rings, s, -((bb[0] + bb[2]) / 2) * s, -bb[1] * s);

    // ── 2. clean, then keep only the largest island ──
    const cleaned = track(track(new CrossSection(rings, 'NonZero')).simplify(SIMPLIFY_MM));
    const islands = cleaned.decompose() as Section[];
    islands.forEach((i) => created.push(i));
    if (!islands.length) throw new Error('The silhouette is empty after cleaning.');
    let mainIsland = islands[0];
    let mainArea = mainIsland.area();
    let totalIslandArea = 0;
    for (const isl of islands) {
      const a = isl.area();
      totalIslandArea += a;
      if (a > mainArea) {
        mainArea = a;
        mainIsland = isl;
      }
    }
    if (islands.length > 1) {
      const lostPct = (100 * (totalIslandArea - mainArea)) / Math.max(1e-9, totalIslandArea);
      diagnostics.push({
        level: lostPct > 10 ? 'warning' : 'info',
        code: 'islands-dropped',
        message: `The image traced to ${islands.length} separate shapes; only the largest was used (${lostPct.toFixed(0)}% of the area discarded).`,
        fix: 'Use an image whose subject is one connected shape, or raise the background-removal threshold.',
      });
    }
    rings = mainIsland.toPolygons() as Ring[];
    bb = poly.bbox(rings);

    // ── 3. choose the crossing axis, then PROVE it ──
    //
    // Scoring alone is not enough. On a palm tree the highest-scoring vertical
    // line is often the one that threads up a narrow channel between two fronds
    // — it has the longest run of material, and it is exactly the axis whose
    // slot slices the crown in half and drops 39% of the part on the floor.
    // A quarter of a millimetre either side of it is fine.
    //
    // So the candidates are ranked, then built and counted, and the first one
    // that keeps the part whole wins. Building is a handful of booleans; there
    // is no cheaper way to know, and guessing costs the user a ruined sheet.
    const candidates = rankAxes(rings, bb, need, params.axisFrac);
    if (!candidates.length) {
      throw new Error(
        'No vertical line through this shape has enough material to carry a joint. Try a taller size or a chunkier silhouette.',
      );
    }

    const tb = t; // the base is cut from the same sheet
    const protrude = Math.max(0, params.tabProtrudeMm);
    const tabBottom = -(tb + protrude);
    const relief = Math.min(0.6, W / 3);

    interface Attempt {
      axis: AxisCand;
      profA: Section;
      profB: Section;
      /** Fraction of the part that a slot cuts loose, 0..1, worst of the two. */
      loss: number;
      tabW: number;
      vm: number;
    }

    /** Fraction of a section's area that is NOT its largest connected piece. */
    const looseFraction = (sec: Section): number => {
      const pieces = sec.decompose() as Section[];
      pieces.forEach((pc) => created.push(pc));
      if (pieces.length < 2) return 0;
      let all = 0;
      let max = 0;
      for (const pc of pieces) {
        const a = pc.area();
        all += a;
        if (a > max) max = a;
      }
      return all > 0 ? (all - max) / all : 0;
    };

    const build = (cand: AxisCand): Attempt => {
      const { x: cx, v0: cv0, v1: cv1 } = cand;
      // Where the two slots meet. A true half-lap is 0.5; the control exists
      // because the midpoint of a silhouette's spine is not always where a
      // joint looks or works best.
      const cvm = cv0 + clamp(params.jointFrac, 0.15, 0.85) * (cv1 - cv0);
      const wBottom = widthAt(rings, Math.min(cv0 + 1, cvm), cx) ?? need;
      const tabW =
        params.tabWidthMm > 0
          ? clamp(params.tabWidthMm, W + 4, 120)
          : clamp(0.7 * wBottom, W + 5, 60);
      const tabTop = Math.min(cv0 + 2, cvm - 1);

      const body = track(new CrossSection(rings, 'NonZero'));
      const withTab = params.base
        ? track(
            body.add(
              track(
                track(CrossSection.square([tabW, tabTop - tabBottom], true)).translate([
                  cx,
                  (tabTop + tabBottom) / 2,
                ]),
              ),
            ),
          )
        : body;

      const top = cv1 + 10;
      const bottom = tabBottom - 10;
      const shaft = (y0: number, y1: number): Section =>
        track(track(CrossSection.square([W, y1 - y0], true)).translate([cx, (y0 + y1) / 2]));

      // Relief goes in the two CORNERS of the slot floor, not across its tip.
      //
      // A semicircular tip looks like the obvious answer and is wrong: it lets
      // the part's material creep back across the middle of the slot, exactly
      // where the mating plate has to pass. Two profiles built that way overlap
      // by 2·t·(2r² − πr²/2) — at t = 3, W = 3.03 that is 5.9 mm³ of solid
      // interference, and the parts simply cannot be pushed together.
      // Dogbones at (x ± W/2, vm) remove the stress riser, leave the centre of
      // the floor at vm so the joint still seats flush, and only ever take
      // material away.
      let slotA = track(shaft(cvm, top));
      let slotB = track(shaft(bottom, cvm));
      if (params.filletSlotEnds) {
        for (const side of [-1, 1]) {
          const bone = track(
            track(CrossSection.circle(relief, poly.circleSegments(relief, 0.015))).translate([
              cx + (side * W) / 2,
              cvm,
            ]),
          );
          slotA = track(slotA.add(bone));
          slotB = track(slotB.add(bone));
        }
      }

      const profA = track(withTab.subtract(slotA));
      const profB = track(withTab.subtract(slotB));
      const loss = Math.max(looseFraction(profA), looseFraction(profB));
      return { axis: cand, profA, profB, loss, tabW, vm: cvm };
    };

    /** Slivers off a tapering tip are unavoidable and invisible; losing a limb
     *  is not. This is the line between the two. */
    const ACCEPTABLE_LOSS = 0.02;

    let attempt: Attempt | null = null;
    for (const cand of candidates) {
      const a = build(cand);
      if (a.loss <= ACCEPTABLE_LOSS) {
        attempt = a;
        break;
      }
      if (!attempt || a.loss < attempt.loss) attempt = a;
    }
    if (!attempt) throw new Error('Could not build a joint anywhere on this shape.');

    const { x: ax, v0, v1, minWidth, midWidth } = attempt.axis;
    const vm = attempt.vm;
    const tabW = attempt.tabW;

    // The formula the user actually needs when it fails: how tall must the
    // object be for its narrowest point on this axis to carry the joint?
    if (midWidth < need) {
      const scaleNeeded = need / Math.max(1e-6, midWidth);
      diagnostics.push({
        level: 'error',
        code: 'web-too-thin',
        message: `Where the two halves lock together the shape is only ${midWidth.toFixed(1)} mm wide. A ${t.toFixed(1)} mm slot needs ${need.toFixed(1)} mm there (${minWeb.toFixed(1)} mm either side).`,
        fix: `Raise the height to about ${Math.ceil(params.heightMm * scaleNeeded)} mm, or move to thinner material.`,
      });
    } else if (minWidth < need) {
      diagnostics.push({
        level: 'warning',
        code: 'thin-web-somewhere',
        message: `The shape narrows to ${minWidth.toFixed(1)} mm somewhere along the joint, leaving webs under ${minWeb.toFixed(1)} mm.`,
        fix: 'It will assemble, but handle those sections gently — thin webs snap in plywood and craze in acrylic.',
      });
    }

    if (attempt.loss > ACCEPTABLE_LOSS) {
      diagnostics.push({
        level: attempt.loss > 0.05 ? 'error' : 'warning',
        code: 'slot-severs-part',
        message: `The slot cuts the profile into separate pieces — ${(attempt.loss * 100).toFixed(0)}% of it would fall away, and no other crossing line does better.`,
        fix: 'Raise the height, move to thinner material, or set the crossing axis by hand over a chunkier part of the silhouette.',
      });
    }

    const profA = attempt.profA;
    const profB = attempt.profB;

    // ── 6. collect the parts ──
    const partsRaw: { id: string; label: string; sec: Section }[] = [
      { id: 'profile-a', label: 'Profile A (slot on top)', sec: profA },
      { id: 'profile-b', label: 'Profile B (slot underneath)', sec: profB },
    ];
    if (params.base) {
      const comY = tb + poly.centroid(rings)[1];
      const autoDia = 2 * comY * Math.tan((TIP_ANGLE_DEG * Math.PI) / 180);
      const minDia = tabW + 12;

      // Shrink the disc to fit rather than overflowing the sheet.
      //
      // The stability rule sizes the base from the centre of mass, and on a tall
      // slim design it asks for a disc that will not share a sheet with the two
      // profiles. Refusing outright is unhelpful when a slightly smaller disc
      // still stands perfectly well — so trim it to whatever the leftover strip
      // can hold and say what that cost in tip angle. A hand-set diameter is
      // never touched.
      const profileRow = poly.bbox(profA.toPolygons() as Ring[]);
      const rowH = profileRow[3] - profileRow[1] + k;
      // Both figures are NOMINAL, and every part grows by one kerf once the
      // compensation offset lands — the profile row above and the disc itself.
      // Forget the disc's share and the trimmed base lands 0.2 mm over the
      // edge, which is exactly as overflowed as 20 mm over.
      const roomBelow = sheet.heightMm - 8 - rowH - params.partGapMm - k - 0.05;

      let dia = params.baseDiaMm > 0 ? params.baseDiaMm : clamp(autoDia, minDia, 400);
      if (params.baseDiaMm <= 0 && dia > roomBelow && roomBelow >= minDia) {
        const tipDeg = (Math.atan(roomBelow / 2 / Math.max(1e-6, comY)) * 180) / Math.PI;
        // Below this the disc has stopped being a base and become a token. A
        // trimmed base is a reasonable trade; one that falls over is not, and
        // shipping it quietly would be the worst of both.
        const tooTippy = tipDeg < MIN_TIP_ANGLE_DEG;
        diagnostics.push({
          level: tooTippy ? 'error' : 'warning',
          code: tooTippy ? 'base-too-small' : 'base-trimmed',
          message: tooTippy
            ? `This design needs a ⌀${autoDia.toFixed(0)} mm base to stand, and only ⌀${roomBelow.toFixed(0)} mm fits beside the profiles — it would tip at ${tipDeg.toFixed(0)}° and fall over.`
            : `The base was trimmed from ⌀${autoDia.toFixed(0)} to ⌀${roomBelow.toFixed(0)} mm so it fits the sheet beside the profiles. It now tips at about ${tipDeg.toFixed(0)}° instead of ${TIP_ANGLE_DEG}°.`,
          fix: tooTippy
            ? 'Use a larger sheet, or make the design shorter so the base has room.'
            : 'It will still stand. For the full-size base, use a larger sheet or a shorter design.',
        });
        dia = roomBelow;
      }

      const rad = dia / 2;
      const armLen = tabW + c;
      const armW = t + c;
      const disc = track(CrossSection.circle(rad, poly.circleSegments(rad)));
      const armX = track(CrossSection.square([armLen, armW], true));
      const armY = track(CrossSection.square([armW, armLen], true));
      const base = track(track(disc.subtract(armX)).subtract(armY));
      partsRaw.push({ id: 'base', label: `Base disc ⌀${dia.toFixed(0)} mm`, sec: base });
      if (dia > Math.min(sheet.widthMm, sheet.heightMm)) {
        diagnostics.push({
          level: 'warning',
          code: 'base-oversize',
          message: `The base wants to be ⌀${dia.toFixed(0)} mm, which will not fit the selected sheet.`,
          fix: 'Set the base diameter by hand, or choose a larger sheet.',
        });
      }
    }

    // ── 7. kerf, then out to rings ──
    const parts: Part[] = [];
    let cutLengthMm = 0;
    for (const p of partsRaw) {
      const grown = track(track(p.sec.offset(k / 2, 'Miter', 2)).simplify(0.02));
      const pieces = grown.decompose() as Section[];
      pieces.forEach((i) => created.push(i));
      if (!pieces.length) continue;
      let keep = pieces[0];
      let keepA = keep.area();
      let allA = 0;
      for (const pc of pieces) {
        const a = pc.area();
        allA += a;
        if (a > keepA) {
          keepA = a;
          keep = pc;
        }
      }
      // Severance was already diagnosed against the nominal geometry during the
      // axis search; here we only make sure no loose sliver reaches the file.
      void allA;
      const pRings = keep.toPolygons() as Ring[];
      cutLengthMm += poly.perimeter(pRings);
      parts.push({ id: p.id, label: p.label, rings: pRings, bbox: poly.bbox(pRings) });
    }

    // ── 8. lay the parts out on the sheet ──
    const layout = nest(parts, sheet, params.partGapMm);
    if (layout.overflow) {
      diagnostics.push({
        level: 'error',
        code: 'sheet-overflow',
        message: `The parts do not fit on ${sheet.name}.`,
        fix: 'Reduce the height, or pick a bigger sheet.',
      });
    }

    // ── 9. the assembled preview ──
    const preview = buildPreview(wasm, track, partsRaw, params, t, tb, ax, hexToRgb(material.hex));

    if (!material.h2dSafe && material.note) {
      diagnostics.push({
        level: 'warning',
        code: 'material-not-h2d',
        message: material.note,
        fix: 'Pick plywood or opaque acrylic for a Bambu H2D; keep this choice for a CO₂ machine.',
      });
    } else if (material.note) {
      diagnostics.push({ level: 'info', code: 'material-note', message: material.note });
    }

    return {
      parts,
      layout,
      preview,
      diagnostics,
      cutLengthMm,
      axisFrac: (ax - bb[0]) / Math.max(1e-9, bb[2] - bb[0]),
      tabWidthMm: tabW,
      jointHeightMm: vm,
      assembledHeightMm: params.heightMm + (params.base ? tb : 0),
    };
  } finally {
    for (const o of created) {
      try {
        o.delete();
      } catch {
        /* already gone */
      }
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Horizontal extent of the material containing `x` at height `y`. */
function widthAt(rings: Ring[], y: number, x: number): number | null {
  const iv = poly.intervalAt(poly.horizontalIntervals(rings, y), x);
  return iv ? iv[1] - iv[0] : null;
}

export interface AxisCand {
  x: number;
  v0: number;
  v1: number;
  /** Narrowest the shape gets anywhere along the joint. */
  minWidth: number;
  /** Width at the midpoint, where the two halves actually lock. */
  midWidth: number;
  score: number;
}

/** Rank the vertical lines this shape could be crossed on, best first.
 *
 *  Not the centroid and not the bbox centre: on a palm tree the centroid sits
 *  in the crown, where a slot would separate the fronds from the trunk. What we
 *  want is the strongest continuous spine — the longest run of material that
 *  stays wide enough to carry a joint.
 *
 *  Tapering tips are forgiven. Judging an axis by its strict minimum width
 *  would reject every shape that comes to a point, so the score uses a low
 *  percentile, and the midpoint width — the only place the joint actually
 *  bears — is scored separately.
 *
 *  This returns a LIST rather than a winner because the score cannot see
 *  severance: the caller builds them in order until one keeps the part whole.
 *  Candidates are spread out, because two lines a fifth of a millimetre apart
 *  are the same guess twice. */
function rankAxes(
  rings: Ring[],
  bb: [number, number, number, number],
  need: number,
  override: number | null,
): AxisCand[] {
  const [minX, , maxX] = bb;
  const width = maxX - minX;
  if (width <= 1e-6) return [];

  const evaluate = (x: number): AxisCand | null => {
    const all = poly.verticalIntervals(rings, x);
    // The crossing line must pass through ONE unbroken run of material.
    //
    // Two profiles conflict wherever both have material on the axis, and the
    // slot is a single rectangle: a line that crosses the shape twice (through
    // a hole, or up between a pair of legs) leaves the second run unslotted,
    // and the two profiles then try to occupy the same millimetre of space
    // outside the joint. A gap at the midpoint is worse still — the parts would
    // slide straight past each other with nothing to seat against.
    if (all.length !== 1) return null;
    const iv = all[0];
    const span = iv[1] - iv[0];
    if (span <= 1e-6) return null;

    const SAMPLES = 48;
    const inset = Math.min(0.02 * span, 1);
    const widths: number[] = [];
    for (let j = 0; j <= SAMPLES; j++) {
      const y = iv[0] + inset + ((span - 2 * inset) * j) / SAMPLES;
      widths.push(widthAt(rings, y, x) ?? 0);
    }
    const sorted = [...widths].sort((a, b) => a - b);
    const p15 = sorted[Math.floor(sorted.length * 0.15)];
    const mid = widthAt(rings, (iv[0] + iv[1]) / 2, x) ?? 0;

    // Centrality is only a tiebreak — a strong off-centre spine beats a weak
    // central one every time.
    const centre = 1 - Math.abs((x - (minX + maxX) / 2) / (width / 2));

    // The spine has to reach the ground.
    //
    // Width alone will happily choose a line through the widest part of the
    // design and ignore that it floats. On a palm that means a crossing axis up
    // in the fronds: the two profiles then never meet along the trunk, the tab
    // grows into a 65 mm stalk hanging off the crown to reach the base, and the
    // bottom-slotted profile is split into two thin prongs for its whole
    // length. It assembles, and it is the wrong object. A short penalty rather
    // than a rejection, so a design that genuinely has no grounded spine can
    // still fall back to one.
    const grounded = iv[0] <= bb[1] + 0.03 * (bb[3] - bb[1]) ? 1 : 0.15;

    const score =
      span * clamp(mid / need, 0, 1) * clamp(p15 / need, 0, 1) * (0.9 + 0.1 * centre) * grounded;

    return { x, v0: iv[0], v1: iv[1], minWidth: sorted[0], midWidth: mid, score };
  };

  if (override !== null) {
    const forced = evaluate(minX + clamp(override, 0, 1) * width);
    return forced ? [forced] : [];
  }

  const N = 161;
  const all: AxisCand[] = [];
  for (let i = 1; i < N - 1; i++) {
    const cand = evaluate(minX + (width * i) / (N - 1));
    if (cand && cand.score > 0) all.push(cand);
  }
  if (!all.length) return [];
  all.sort((a, b) => b.score - a.score);

  // Keep the best few, spread across the shape.
  const MIN_SEPARATION = Math.max(1.5, width * 0.03);
  const picked: AxisCand[] = [];
  for (const cand of all) {
    if (picked.every((p) => Math.abs(p.x - cand.x) >= MIN_SEPARATION)) picked.push(cand);
    if (picked.length >= 8) break;
  }

  // Refine the front-runner so it is not stuck on the scan grid, and put the
  // refined version first.
  const step = width / (N - 1);
  let best = picked[0];
  for (let i = -4; i <= 4; i++) {
    const cand = evaluate(best.x + (i * step) / 5);
    if (cand && cand.score > best.score) best = cand;
  }

  // Snap to centre when centre is as good.
  //
  // A traced silhouette is never exactly symmetric — anti-aliasing alone moves
  // the score by a fraction of a percent — so on a heart, a circle, anything
  // with an obvious middle, the winner lands at 44.6% or 51.2% and the tool
  // looks like it is guessing. It is not, but that distinction is worth nothing
  // to someone watching the crossing line sit visibly off-centre. If the middle
  // scores within a whisker of the best, take the middle.
  const centreCand = evaluate((minX + maxX) / 2);
  if (centreCand && centreCand.score >= best.score * 0.97) best = centreCand;

  picked[0] = best;
  return picked;
}

/** Shelf packing: sort by height, fill rows left to right. With three parts
 *  this is optimal often enough, and it is deterministic — the same design
 *  always lands on the same sheet positions, which matters when someone cuts
 *  the file twice. */
function nest(parts: Part[], sheet: { widthMm: number; heightMm: number; id: string; name: string }, gap: number): Layout {
  const margin = 4;
  const usableW = sheet.widthMm - 2 * margin;
  const order = [...parts].sort(
    (a, b) => b.bbox[3] - b.bbox[1] - (a.bbox[3] - a.bbox[1]),
  );
  const placements: Placement[] = [];
  let rowY = margin;
  let rowH = 0;
  let cursorX = margin;
  let overflow = false;

  for (const p of order) {
    const w = p.bbox[2] - p.bbox[0];
    const h = p.bbox[3] - p.bbox[1];
    if (w > usableW) {
      overflow = true;
      continue;
    }
    if (cursorX > margin && cursorX + w > margin + usableW) {
      rowY += rowH + gap;
      rowH = 0;
      cursorX = margin;
    }
    if (rowY + h > sheet.heightMm - margin) overflow = true;
    placements.push({ partId: p.id, dx: cursorX - p.bbox[0], dy: rowY - p.bbox[1], rot: 0 });
    cursorX += w + gap;
    rowH = Math.max(rowH, h);
  }

  return { sheet: sheet as Layout['sheet'], placements, overflow, usedHeightMm: rowY + rowH + margin };
}

/** Extrude the nominal (pre-kerf) parts and stand them up as they assemble.
 *  The preview deliberately uses the nominal geometry: showing the user a
 *  kerf-compensated part would render the slots visibly wrong. */
function buildPreview(
  wasm: Wasm,
  track: <T extends { delete(): void }>(o: T) => T,
  partsRaw: { id: string; label: string; sec: Section }[],
  params: SlotParams,
  t: number,
  tb: number,
  ax: number,
  color: RGB,
): PreviewPart[] {
  const out: PreviewPart[] = [];
  for (const p of partsRaw) {
    let solid: Solid;
    if (p.id === 'base') {
      solid = track(p.sec.extrude(tb));
    } else {
      // Extrude in XY, then tip it upright: rotate([90,0,0]) sends the profile's
      // +Y (its height) to +Z and its thickness to −Y, so re-centre on Y.
      const flat = track(p.sec.extrude(t));
      const upright = track(track(flat.rotate([90, 0, 0])).translate([-ax, t / 2, tb]));
      solid = p.id === 'profile-b' ? track(upright.rotate([0, 0, 90])) : upright;
    }
    const mesh = solid.getMesh();
    out.push({
      id: p.id,
      label: p.label,
      positions: mesh.vertProperties as Float32Array,
      indices: mesh.triVerts as Uint32Array,
      color,
    });
  }
  return out;
}
