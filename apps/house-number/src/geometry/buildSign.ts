/**
 * The sign, assembled.
 *
 * Two coloured bodies out — a plate and its text — because that is what one filament
 * change prints and what every buyer in the category expects. Everything 2D that is worth
 * getting exactly right lives in `outlines.ts` and is checked headless; this file only
 * unions, subtracts and extrudes what that hands it.
 *
 * The manifold conventions here are the keychain's, deliberately: `withScope` for
 * Emscripten lifetimes, `bevelExtrude` for the chamfered top, `fillHoles` for outlines
 * that must not trap air. Two generators drifting on memory handling is how a WASM leak
 * gets found in the third one.
 */
import {
  plateOutline, keyhole, keyholePositions, bboxOf, plateSizeFor, signedArea,
  screwHolePositions, screwHolePositions4, circle, ccw, fitAngleFor, nudgeClear,
  lineContour, labelBarContour, bandContour, glyphReach, stencilBridges,
} from './outlines';
import type { SignParams, LineBox } from '../types';
import { MAX_PLATE_MM } from '../types';

type Keep = <M extends { delete(): void }>(m: M) => M;

/** Ensures every Emscripten object allocated inside `fn` is freed, thrown or not. */
export function withScope<T>(fn: (keep: Keep) => T): T {
  const created: { delete(): void }[] = [];
  const keep = <M extends { delete(): void }>(m: M) => { created.push(m); return m; };
  try {
    return fn(keep);
  } finally {
    for (const m of created) {
      try { m.delete(); } catch (e) { console.warn('Error deleting manifold object:', e); }
    }
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [Number.isFinite(r) ? r : 255, Number.isFinite(g) ? g : 255, Number.isFinite(b) ? b : 255];
}

function meshOf(solid: any): { vertProperties: Float32Array; triVerts: Uint32Array } {
  const m = solid.getMesh();
  return { vertProperties: m.vertProperties, triVerts: m.triVerts };
}

/**
 * Extrude with an optional chamfered top edge.
 *
 * Each component is inset about **its own** bounding box, so glyphs bevel in place rather
 * than sliding toward the word's centre — the same reason the keychain does it per
 * component rather than scaling the whole cross-section.
 */
function bevelExtrude(cs: any, height: number, chamfer: number, keep: Keep): any {
  if (chamfer <= 0.05) return keep(cs.extrude(height));
  const baseH = Math.max(0.01, height - chamfer);
  let solid = keep(cs.extrude(baseH));

  const components = (cs.decompose() as any[]) ?? [cs];
  for (const comp of components) {
    const compCS = keep(comp);
    const b = compCS.bounds() as { min: [number, number]; max: [number, number] };
    const W = b.max[0] - b.min[0];
    const H = b.max[1] - b.min[1];
    if (W <= 0.01 || H <= 0.01) continue;

    const cx = (b.min[0] + b.max[0]) / 2;
    const cy = (b.min[1] + b.max[1]) / 2;
    const scaleX = Math.max(0.01, (W - 2 * chamfer) / W);
    const scaleY = Math.max(0.01, (H - 2 * chamfer) / H);

    const centered = keep(compCS.translate([-cx, -cy]));
    const topCap = keep(
      centered.extrude(chamfer + 0.01, 0, 0, [scaleX, scaleY]).translate([cx, cy, baseH - 0.005]),
    );
    solid = keep(solid.add(topCap));
  }
  return solid;
}

/**
 * Drops interior holes, keeping outer loops only.
 *
 * Manifold winds outers CCW and holes CW, so refilling with `Positive` yields solid blobs.
 * Used on the *plate* outline and never on the text: a glyph's counters are the one place
 * holes are the point.
 */
function fillHoles(CrossSection: any, cs: any, keep: Keep): any {
  const polys = cs.toPolygons() as number[][][];
  const outers = polys.filter((p) => signedArea(p) > 0);
  if (outers.length === polys.length || outers.length === 0) return cs;
  return keep(new CrossSection(outers, 'Positive'));
}

/**
 * The raised border, as its own solid, sitting on the plate's top face.
 *
 * Not `bevelExtrude(ring, …)`, and the difference is the whole of the "frame doesn't remove
 * previous bevels" report. `bevelExtrude` insets a component about **its own bounding box**,
 * which is right for a glyph and wrong for a ring: shrinking a ring shrinks its hole too, so
 * the frame's inner wall leant *out over* the plate field — a negative-draft overhang that
 * droops when printed and steals clearance from the text. Here the outer edge is drawn in
 * and the inner edge pushed out, so both faces slope the way a chamfer should.
 *
 * The caller extrudes the plate with a flat top when a frame is on, so the outer wall runs
 * flush from the build plate to the top of the frame and is chamfered exactly once — rather
 * than a full-height ring landing on top of an already-chamfered lip and overhanging it.
 */
function frameSolid(
  CrossSection: any,
  outline: number[][][],
  width: number,
  height: number,
  chamfer: number,
  keep: Keep,
): any {
  const outer = keep(new CrossSection(outline, 'Positive'));
  const inner = keep(outer.offset(-width, 'Round', 2, 8));
  const ring = keep(outer.subtract(inner));

  const c = Math.min(chamfer, Math.max(0, width / 2 - 0.05), height - 0.05);
  if (c <= 0.05) return keep(ring.extrude(height));

  const baseH = Math.max(0.01, height - c);
  let solid = keep(ring.extrude(baseH));

  // The outline is centred on the origin by the caller, so a scale about the origin moves
  // each edge by the same amount all the way round and no re-centring is needed.
  const ob = outer.bounds() as { min: [number, number]; max: [number, number] };
  const ib = inner.bounds() as { min: [number, number]; max: [number, number] };
  const scale = (b: typeof ob, delta: number): [number, number] => {
    const w = b.max[0] - b.min[0];
    const h = b.max[1] - b.min[1];
    return [
      w > 0.01 ? Math.max(0.01, (w + 2 * delta) / w) : 1,
      h > 0.01 ? Math.max(0.01, (h + 2 * delta) / h) : 1,
    ];
  };

  const capOuter = keep(outer.extrude(c + 0.01, 0, 0, scale(ob, -c)));  // draws in going up
  const capInner = keep(inner.extrude(c + 0.01, 0, 0, scale(ib, c)));   // opens out going up
  const cap = keep(keep(capOuter.subtract(capInner)).translate([0, 0, baseH - 0.005]));
  solid = keep(solid.add(cap));
  return solid;
}

/**
 * Turns the finished assembly flat on the bed, when it only fits diagonally.
 *
 * Done on the vertices rather than in manifold: a rigid rotation about Z cannot change the
 * solid, and doing it here keeps every part in the same frame as its neighbours.
 */
function rotateParts(parts: SignPart[], degrees: number): void {
  const t = (degrees * Math.PI) / 180;
  const c = Math.cos(t), s = Math.sin(t);
  for (const p of parts) {
    const v = p.vertProperties;
    for (let i = 0; i < v.length; i += 3) {
      const x = v[i]!, y = v[i + 1]!;
      v[i] = x * c - y * s;
      v[i + 1] = x * s + y * c;
    }
  }
}

export interface SignPart {
  name: string;
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  colorRgb: [number, number, number];
}

export interface BuildResult {
  parts: SignPart[];
  warnings: string[];
  /** Finished plate footprint in mm, for the UI's size readout. */
  size: { width: number; height: number };
}

/**
 * @param wasm    the initialised manifold module
 * @param contours text outlines from `@vostok/fonts`, already laid out and centred
 */
export function buildSign(
  wasm: any,
  contours: number[][][],
  params: SignParams,
  textLines: LineBox[] = [],
): BuildResult {
  const { CrossSection } = wasm;
  const warnings: string[] = [];

  return withScope((keep) => {
    if (contours.length === 0) {
      return { parts: [], warnings: ['Type something to see it.'], size: { width: 0, height: 0 } };
    }

    /*
     * Text first: the plate is sized from it, not the other way round.
     *
     * **`NonZero`, not `Positive`.** `@vostok/fonts` flips Y when it converts opentype's
     * path commands, because the rest of the pipeline is Z-up — and flipping Y reverses
     * winding, so a glyph's outer loop arrives *negative*. Under `Positive` nothing filled
     * and the text body came out with zero triangles while the plate, whose outlines this
     * app winds itself, looked perfectly fine. `NonZero` fills whichever way the loops are
     * wound and still reads a counter as a hole, because a counter always winds against
     * its own outer.
     *
     * The plate keeps `Positive` below: those outlines are ours and deliberately CCW.
     */
    let textCS = keep(new CrossSection(contours, 'NonZero'));
    let textBox = bboxOf(contours);

    /*
     * The line is welded into the text body, not added as a separate part: with no plate it
     * has to be one solid with the glyphs or the sign prints as loose pieces.
     *
     * `bridge` is on only when there is no plate. On a plate the line keeps exactly the
     * thickness asked for and floats clear in the gap — stretching it there made the
     * thickness control inert and grew the bar into the glyphs.
     */
    if (params.divider !== 'none') {
      const beside = params.linePlacement === 'beside';

      if (params.divider === 'band' && textLines.length >= 2) {
        /*
         * The second line set INSIDE a filled bar and knocked out of it — reversed-out type,
         * the "34 / DRYFESDALE VIEW" look.
         *
         * The glyphs have to be split by line first. Subtracting *all* the text from the bar
         * and unioning that back over the whole text gives `bar ∪ glyphs` — the bar simply
         * fills in over line 2, which is the opposite of a knockout. What is wanted is
         * `line1 ∪ (bar − line2)`, so line 2 exists only as the void in the fill.
         */
        const box2 = textLines[1]!;
        const inLine2 = (loop: number[][]) => {
          const ys = loop.map((p) => p[1]!);
          const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
          return mid >= box2.minY - 0.5 && mid <= box2.maxY + 0.5;
        };
        const line1 = contours.filter((l) => !inLine2(l));
        const line2 = contours.filter(inLine2);

        const pad = Math.max(1, params.lineThickness);
        const bar = labelBarContour(box2, pad, pad * 0.6, params.lineOverhang);
        const barCS = keep(new CrossSection([ccw(bar)], 'Positive'));
        const line2CS = keep(new CrossSection(line2, 'NonZero'));
        const knockout = keep(barCS.subtract(line2CS));

        textCS = line1.length > 0
          ? keep(keep(new CrossSection(line1, 'NonZero')).add(knockout))
          : knockout;
        textBox = bboxOf([...contours, bar]);
      } else {
        // Measured, not guessed: where the bar has to reach to catch every glyph.
        const [la, lb] = textLines;
        const upperBox = la && lb ? (la.minY < lb.minY ? lb : la) : la;
        const lowerBox = la && lb ? (la.minY < lb.minY ? la : lb) : la;
        const bridge = params.shape === 'none';
        const reachUp = upperBox ? glyphReach(contours, upperBox).highestBottom : undefined;
        const reachDown = lowerBox ? glyphReach(contours, lowerBox).lowestTop : undefined;

        /*
         * Move the TEXT to the line, not the line to the text.
         *
         * With no plate the bar has to touch both blocks or the sign prints as loose pieces —
         * and stretching it to reach them made the thickness control useless: it spanned the
         * whole gap however thin it was asked to be, so a 2.5 mm line came out as a 40 mm
         * slab across the sign. The gap is the thing that was wrong, not the bar. So the bar
         * keeps exactly the thickness asked for, and the two blocks slide in to meet it.
         *
         * `lineSpacing` then reads as "how far apart before the bar closes the gap", which is
         * the only reading under which both controls do what they say.
         */
        let working = contours;
        if (bridge && !beside && upperBox && lowerBox && reachUp !== undefined && reachDown !== undefined) {
          const t = Math.max(0.2, params.lineThickness) / 2;
          const mid = (lowerBox.maxY + upperBox.minY) / 2 + params.lineOffset;
          const OVERLAP = 0.4;
          const upShift = (mid + t - OVERLAP) - reachUp;
          const downShift = (mid - t + OVERLAP) - reachDown;
          const inUpper = (loop: number[][]) => {
            const ys = loop.map((p) => p[1]!);
            return (Math.min(...ys) + Math.max(...ys)) / 2 > mid;
          };
          working = contours.map((loop) => {
            const dy = inUpper(loop) ? upShift : downShift;
            return loop.map((p) => [p[0]!, p[1]! + dy] as number[]);
          });
          textCS = keep(new CrossSection(working, 'NonZero'));
        }

        const bar = lineContour(textLines, bboxOf(working), {
          thickness: params.lineThickness,
          overhang: params.lineOverhang,
          length: params.lineLength,
          offset: params.lineOffset,
          beside,
          // Already brought together above, so the bar needs no stretching of its own.
          bridge: bridge && beside,
          reachUp,
          reachDown,
        });
        if (bar) {
          textCS = keep(textCS.add(keep(new CrossSection([ccw(bar)], 'Positive'))));
          textBox = bboxOf([...working, bar]);
          contours = working;
        }
      }
    }

    // Centre the text on the origin so the plate can be centred too. `getHorizontalContours`
    // already centres vertically; horizontally it starts at the caller's gap.
    const tx = -(textBox.minX + textBox.maxX) / 2;
    const ty = -(textBox.minY + textBox.maxY) / 2;
    const textCentred = keep(textCS.translate([tx, ty]));
    /** The same glyphs as plain polygons, in the model's frame — for bridges and hole clearance. */
    const centredContours = contours.map((loop) => loop.map((p) => [p[0]! + tx, p[1]! + ty] as number[]));

    // A frame is a wall standing inside the outline, so it eats clearance the same way the
    // margin does and has to be part of the size the plate is solved for.
    const frameH = params.frameFollowsText ? params.textThickness : params.frameHeight;
    const frameOn = params.frameOn && params.shape !== 'none';
    // Recessing needs a face to cut into, so both are meaningless with no plate.
    const recessed = params.relief === 'recessed' && params.shape !== 'none';
    const inlaid = params.relief === 'inlay' && params.shape !== 'none';
    const panelOn = params.panelOn && params.shape !== 'none';
    /** Set when a recess is cut, so the inlay body can be made to fill it exactly. */
    let recessDepth = 0;
    /*
     * The inset panel has to be paid for in the plate's size, like the frame and the margin.
     *
     * Without it the plate was sized to the text plus a margin and the panel was then inset
     * *inside* that — so the panel came out smaller than the text it was supposed to carry,
     * and the number hung off both ends of it in mid-air. A panel is a wall standing inward
     * from the edge; it costs exactly what it insets.
     */
    const clearance = params.padding
      + (frameOn ? params.frameWidth : 0)
      + (panelOn ? params.panelInset : 0);

    /*
     * Screw holes need room of their own, or they land under the text — but a FIXED strip,
     * deliberately not one that tracks the inset.
     *
     * Making the allowance follow the inset was self-defeating: the plate grew by exactly as
     * much as the inset moved the hole, so the hole stayed pinned 4.5 mm from the text at
     * every inset from 5 mm to 60 mm and the control did nothing at all. A constant strip at
     * each end gives the inset somewhere to move within, and `nudgeClear` further down stops
     * a hole ever reaching the glyphs.
     *
     * Four holes go to the corners, so they need the strip on BOTH axes; two sit on the
     * horizontal centreline and only need it at the ends.
     */
    const holeRoom = params.mount === 'screws' && params.shape !== 'none'
      ? params.mountHoleDia * 2.5
      : 0;
    const vHoleRoom = params.mountFourHoles ? holeRoom : 0;
    const autoW = plateSizeFor(textBox, clearance + holeRoom, params.shape, params.cornerRadius).width;
    const autoH = plateSizeFor(textBox, clearance + vHoleRoom, params.shape, params.cornerRadius).height;

    /*
     * An explicit size wins, but never below what the text needs.
     *
     * A pill takes its cap radius from half the short side, so its auto width is a function
     * of its height and no margin setting can bring it in — the auto answer was the only
     * answer it would give. Clamped upward rather than obeyed blindly: a plate too small to
     * hold the legend should grow, not crop it.
     */
    const minW = textBox.maxX - textBox.minX + 2;
    const minH = textBox.maxY - textBox.minY + 2;
    const width = params.plateWidth > 0 ? Math.max(params.plateWidth, minW) : autoW;
    const height = params.plateHeight > 0 ? Math.max(params.plateHeight, minH) : autoH;
    if (params.plateWidth > 0 && params.plateWidth < minW) {
      warnings.push(`Width raised to ${minW.toFixed(0)} mm — the text needs it.`);
    }
    /*
     * If it does not fit straight on, TURN it — do not just complain.
     *
     * A house sign is long and shallow, so the common oversize case fits comfortably across
     * the bed's diagonal. Telling the user to "print it in pieces" while the slicer's own
     * arrange would have rotated it is advice that is both wrong and irritating, so the
     * build does the rotation itself and the model arrives ready to slice.
     */
    let bedAngle = 0;
    if (Math.max(width, height) > MAX_PLATE_MM) {
      const angle = fitAngleFor(width, height, MAX_PLATE_MM);
      if (angle) {
        bedAngle = angle;
        warnings.push(`Turned ${angle}° so it fits the ${MAX_PLATE_MM} mm bed.`);
      } else {
        warnings.push(
          `This is ${Math.round(width)} × ${Math.round(height)} mm, larger than a ${MAX_PLATE_MM} mm bed `
          + `at any angle. Print it in pieces, or reduce the text size.`,
        );
      }
    }

    const parts: SignPart[] = [];
    /** Set when a frame is built, so it can be pushed after the plate as its own part. */
    let frameBody: any = null;

    /* ── The plate ───────────────────────────────────────────────────────────── */
    if (params.shape !== 'none') {
      const outline = plateOutline(params.shape, width, height, params.cornerRadius);
      let plateCS = keep(new CrossSection(outline, 'Positive'));
      plateCS = fillHoles(CrossSection, plateCS, keep);

      // Screw holes go through; keyholes are a pocket in the back and are handled after
      // the extrude, because they must not breach the front face.
      if (params.mount === 'screws') {
        // The inset is the user's now, not a number derived from the margin. On a pill the
        // plate is much wider than the text needs, so a margin-derived inset pinned the holes
        // to the far ends with no way to bring them in.
        const inset = Math.max(params.mountInset, frameOn ? params.frameWidth + params.mountHoleDia : 0);
        const wanted = params.mountFourHoles
          ? screwHolePositions4(width, height, params.mountHoleDia, inset)
          : screwHolePositions(width, height, params.mountHoleDia, inset);
        if (wanted.length === 0) {
          warnings.push('The plate is too small for screw holes at this inset. Reduce the inset, or add margin.');
        }

        /*
         * A hole under a glyph is the thing people photograph, so measure against the real
         * outlines rather than the bounding box.
         *
         * The box is both too coarse and too strict: a hole can sit in the gap between a 1
         * and a 2 — inside the box, clear of the ink — while a corner hole can be outside the
         * box on one axis and still clipped by a descender. `nudgeClear` slides the hole
        const centred = centredContours;
         */
        const centred = contours.map((loop) => loop.map((p) => [p[0]! + tx, p[1]! + ty] as number[]));

        /*
         * Nudge every hole by the SAME amount — the largest any of them needs.
         *
         * Pushing each one independently is what "holes behave very weird" was: each slid
         * outward along its own radius until its own local glyph cleared, so a pair ended up
         * at different distances from the centre and a set of four lost its symmetry
         * altogether. A mounting pattern is drilled into a wall from this; asymmetry is not a
         * detail, it is the sign hanging crooked. Solving them together keeps the pattern
         * symmetric by construction and still clears the worst-placed hole.
         */
        let push = 0;
        let stuck = false;
        for (const p of wanted) {
          const { at, clear } = nudgeClear(centred, p, params.mountHoleDia / 2, outline);
          if (!clear) stuck = true;
          push = Math.max(push, Math.hypot(at[0] - p[0], at[1] - p[1]));
        }

        for (const [px, py] of wanted) {
          const len = Math.hypot(px, py) || 1;
          const hx = px + (px / len) * push;
          const hy = py + (py / len) * push;
          const holeCS = keep(new CrossSection([ccw(circle(hx, hy, params.mountHoleDia / 2))], 'Positive'));
          plateCS = keep(plateCS.subtract(holeCS));
        }

        if (stuck) {
          warnings.push('A screw hole is tight against the text. Add margin, or reduce the hole inset.');
        } else if (push > 0.25) {
          warnings.push(`Screw holes moved out ${push.toFixed(1)} mm to clear the text.`);
        }
      }

      /*
       * A frame or an edge band means the plate's own top gets NO chamfer.
       *
       * Both sit ON the perimeter, and chamfering it first pulls the top face inward by
       * `chamfer` — so the thing standing on it overhangs the lip by exactly that much and a
       * groove appears between the two along the whole edge. Flat top here, and the outer
       * wall then runs flush from the bed to the top of whatever is standing on it.
       *
       * The cost is a sharp top edge on the plate's *other* edges when a band is on. That is
       * the right trade at a 0.4 mm default: a hairline missing from three edges is invisible,
       * a groove running the length of the fourth is what gets photographed.
       */
      const flatTop = frameOn || params.band !== 'none';
      let plate = flatTop
        ? keep(plateCS.extrude(params.plateThickness))
        : bevelExtrude(plateCS, params.plateThickness, params.chamfer, keep);

      // The frame is emitted as its own part rather than unioned into the plate, so it can
      // take a third filament. It is a separate body in the slicer either way — it sits on
      // the plate's face like the text does — so this costs nothing when the two colours
      // match, and buys the border-in-a-different-colour that every shop sign has.
      if (frameOn) {
        const frame = keep(frameSolid(
          CrossSection, outline, params.frameWidth, frameH, params.chamfer, keep,
        ).translate([0, 0, params.plateThickness]));
        frameBody = frame;
      }

      if (params.mount === 'keyhole') {
        /*
         * An undercut in the back face, in two layers — see `keyhole` in outlines.ts for
         * why a single-depth pocket cannot hold a screw at all.
         *
         * `mouth` is the shank-width slot at the back surface; `chamber` is the head-width
         * channel behind it. The step between the two is the lip the head is trapped by.
         * Neither ever reaches the front: a keyhole that shows through the face is the
         * failure that makes a sign unsellable.
         */
        const depth = Math.max(0.8, Math.min(params.plateThickness - 1, params.plateThickness * 0.7));
        const mouthDepth = Math.max(0.4, depth * 0.35);
        const headDia = params.mountHoleDia * 2.2;
        const travel = Math.max(headDia, params.mountHoleDia * 2);

        /*
         * Warn on the depth actually available, not on a guess at the plate thickness.
         *
         * The first version compared `plateThickness` against `headDia * 0.55 + 1`, which for
         * a 4.5 mm screw wanted 6.45 mm — so a 6 mm plate warned even though it cuts a 4.2 mm
         * pocket for a head that needs about 3. The House template tripped its own generator's
         * warning as a result. Measure `depth` against what the head needs; the two numbers
         * are then the same number.
         */
        const headDepth = Math.max(2.5, params.mountHoleDia * 0.7);
        if (depth < headDepth) {
          warnings.push(
            `The plate is thin for keyhole slots — a screw head needs about ${headDepth.toFixed(1)} mm `
            + `behind the face and there is ${depth.toFixed(1)} mm. Thicken the plate, or use screw holes.`,
          );
        }

        // Hung from the top edge, and the entry sits low enough that the slot above it stays
        // inside the plate: the sign drops by `travel`, so that much material has to be there.
        const ky = height / 2 - clearance - travel;
        for (const kx of keyholePositions(width)) {
          const k = keyhole(kx, ky, headDia, params.mountHoleDia, travel);
          const cut = (shape: number[][][], from: number, to: number) => {
            for (const loop of shape) {
              const cs = keep(new CrossSection([loop], 'Positive'));
              const pocket = keep(cs.extrude(to - from + 0.01).translate([0, 0, from - 0.005]));
              plate = keep(plate.subtract(pocket));
            }
          };
          cut(k.mouth, 0, mouthDepth);
          cut(k.chamber, mouthDepth, depth);
        }
      }

      /*
       * Recessed text: cut into the face rather than standing on it.
       *
       * The engraved-panel look, and the "6 sunk into a framed board" reference. It is one
       * part, not two — nothing stands proud to take a second filament — so the text body is
       * skipped entirely below and the plate carries the legend as a void. Depth is capped
       * below the plate thickness so the face is never punched through.
       */
      /*
       * The inset panel — a smaller board raised on the plate, in its own filament.
       *
       * The "6" reference: a dark surround, a wood panel inside it, the numeral on the panel.
       * It becomes the face, so the text sits on top of it and a recess cuts into it.
       */
      let panelBody: any = null;
      if (panelOn) {
        const inner = keep(keep(new CrossSection(outline, 'Positive'))
          .offset(-params.panelInset, 'Round', 2, 8));
        panelBody = keep(inner.extrude(params.panelHeight).translate([0, 0, params.plateThickness]));
      }

      /*
       * The edge band — a contrasting strip along one edge, in its own filament.
       *
       * The "300" reference. Intersected with the plate outline so it takes the plate's own
       * silhouette rather than ending in a square corner poking out of a rounded one, and
       * *subtracted* from the plate: the two bodies together are the plate, which is exactly
       * what a two-filament plate is in the slicer.
       */
      let bandBody: any = null;
      if (params.band !== 'none') {
        const strip = keep(new CrossSection(
          [ccw(bandContour(params.band, width, height, params.bandWidth))], 'Positive',
        ));
        const bandCS = keep(plateCS.intersect(strip));
        if (!bandCS.isEmpty()) {
          /*
           * Raised on the face, not cut out of it.
           *
           * It was a region of the plate in a second filament — flush, so it read as a
           * printed stripe. The reference is a bar standing proud exactly like the numerals
           * do: same height, same filament, the plateless "bar under the number" look put on
           * a plate. So it sits on top and the plate underneath is left whole.
           *
           * Extruded straight, NOT bevelled. `bevelExtrude` insets every edge of a component,
           * including the outer one the band shares with the plate — which would draw the
           * band in from the plate's wall and put back the very step the flat top above
           * exists to remove. A sharp top edge on a 2 mm bar is not worth a groove down the
           * side of the sign.
           */
          bandBody = keep(bandCS.extrude(params.textThickness)
            .translate([0, 0, params.plateThickness + (panelOn ? params.panelHeight : 0)]));
        }
      }

      /*
       * Recessed and inlay both cut the legend into the face; inlay then fills it.
       *
       * The face is the panel when there is one, so the cut lands on top of it.
       */
      if (recessed) {
        /*
         * Engraved cuts all the way through **the face layer** — a stencil.
         *
         * With a panel that layer is the panel, and the plate behind stays whole: the legend
         * then reads as the plate's own colour showing through the panel, which is exactly
         * the "6" reference — a dark numeral in a wood board because the board is cut and the
         * dark plate is behind it. With no panel the face layer is the plate itself, so it
         * cuts right through and the wall shows.
         *
         * Bridged, or the counters fall out — see `stencilBridges`.
         */
        // No counters means no ties, and manifold will not build a CrossSection from an empty
        // polygon list — "12" has no enclosed shape at all, so the guard is the common case
        // rather than the edge one.
        const ties = stencilBridges(centredContours, params.bridgeWidth);
        const bridged = ties.length > 0
          ? keep(textCentred.subtract(keep(new CrossSection(ties, 'Positive'))))
          : textCentred;
        if (panelOn && panelBody) {
          const through = keep(bridged.extrude(params.panelHeight + 2).translate([0, 0, params.plateThickness - 1]));
          panelBody = keep(panelBody.subtract(through));
        } else {
          const through = keep(bridged.extrude(params.plateThickness + 2).translate([0, 0, -1]));
          plate = keep(plate.subtract(through));
        }
      } else if (inlaid) {
        const faceZ = params.plateThickness + (panelOn ? params.panelHeight : 0);
        const maxDepth = (panelOn ? params.panelHeight : params.plateThickness) - 0.6;
        const depth = Math.max(0.2, Math.min(params.textThickness, maxDepth));
        recessDepth = depth;
        const cut = keep(textCentred.extrude(depth + 0.02).translate([0, 0, faceZ - depth]));
        if (panelOn && panelBody) panelBody = keep(panelBody.subtract(cut));
        else plate = keep(plate.subtract(cut));
      }

      parts.push({ name: 'plate', ...meshOf(plate), colorRgb: hexToRgb(params.plateColor) });
      if (bandBody) {
        parts.push({ name: 'band', ...meshOf(bandBody), colorRgb: hexToRgb(params.bandColor) });
      }
      if (panelBody) {
        parts.push({ name: 'panel', ...meshOf(panelBody), colorRgb: hexToRgb(params.panelColor) });
      }
      if (frameBody) {
        parts.push({ name: 'frame', ...meshOf(frameBody), colorRgb: hexToRgb(params.frameColor) });
      }
    }

    /* ── The text ────────────────────────────────────────────────────────────── */

    // Engraved: the legend is the void cut above, and there is no second body to emit.
    if (recessed) {
      if (bedAngle !== 0) rotateParts(parts, bedAngle);
      return { parts, warnings, size: { width, height } };
    }

    /*
     * Inlay: the same recess, filled flush with a second body in the second filament.
     *
     * This is what makes a sunk legend a two-colour sign rather than a single-colour
     * engraving. Deliberately NOT bevelled — the point is a face flush with the plate, and a
     * chamfer would leave a visible groove around every glyph. A hair under the recess depth
     * so the two solids share a surface instead of fighting over it.
     */
    if (inlaid) {
      const faceZ = params.plateThickness + (panelOn ? params.panelHeight : 0);
      const fill = keep(textCentred.extrude(recessDepth).translate([0, 0, faceZ - recessDepth]));
      parts.push({ name: 'text', ...meshOf(fill), colorRgb: hexToRgb(params.textColor) });
      if (bedAngle !== 0) rotateParts(parts, bedAngle);
      return { parts, warnings, size: { width, height } };
    }

    // Raised text stands on whatever the top face is — the panel when there is one.
    const baseZ = params.shape === 'none'
      ? 0
      : params.plateThickness + (panelOn ? params.panelHeight : 0);
    const textSolid = bevelExtrude(textCentred, params.textThickness, params.chamfer, keep);
    const textPlaced = keep(textSolid.translate([0, 0, baseZ]));

    if (params.shape === 'none') {
      // Individual glyphs, each its own body — the "single numbers for unit doors" case.
      // `decompose` splits the union back into the pieces that do not touch.
      const pieces = (textPlaced.decompose() as any[]) ?? [textPlaced];
      pieces.forEach((piece, i) => {
        parts.push({
          name: `glyph-${i + 1}`,
          ...meshOf(keep(piece)),
          colorRgb: hexToRgb(params.textColor),
        });
      });
      if (pieces.length > 1) {
        warnings.push(`${pieces.length} separate pieces — they print unattached.`);
      }
    } else {
      parts.push({ name: 'text', ...meshOf(textPlaced), colorRgb: hexToRgb(params.textColor) });
    }

    if (bedAngle !== 0) rotateParts(parts, bedAngle);
    return { parts, warnings, size: { width, height } };
  });
}
