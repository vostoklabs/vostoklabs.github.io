// How big a slot has to be for the thing that goes through it.
//
// This file exists because four hardcoded millimetre floors in `rollEnd` were doing
// the job of a fit calculation, and they were doing it wrong at every size we ship:
//
//     slotW = Math.max(2.5 * t, 1.8)
//
// One ply passes through that slot — the inner wall's nib tab, thickness t. The 1.8 mm
// floor beat the derived branch for six of the seven stocks and five of the eight
// printed sheet thicknesses, so the default printed mailer cut a 1.800 mm slot for a
// 0.400 mm tab: four and a half times wider than the thing it was gripping. The
// derived branch was no better — 2.5t is sized for two and a half plies — so there was
// no caliper at which the formula produced a snug slot.
//
// The replacement is the obvious one, stated once: slot = ply + clearance, floored by
// what the machine can actually cut.

import type { BoxParams, Machine } from '../types';

/** The print fields the sheet's own geometry is derived from — a structural subset
 *  of `BoxParams`, so a `BoxParams` is one of these.
 *
 *  These live HERE, next to the slot fit, rather than in the exporter, because the
 *  blank and the mesh both have to agree about where a fold's material starts. When
 *  they did not, the mailer's floor silently lost its top slab: `keepOutMm` placed
 *  the lock slots at `hingeWidthMm / 2` from the fold while the groove was actually
 *  cut at the enforced floor below, so every slot overhung the panel's pull-back by
 *  28 microns and the whole 92 x 61 mm base printed one layer thick. */
export interface SheetSpec {
  layerHeightMm: number;
  sheetLayers: number;
  hingeLayers: number;
  hingeWidthMm: number;
}

export function sheetThicknessMm(o: SheetSpec): number {
  return Math.max(1, o.sheetLayers) * o.layerHeightMm;
}

export function hingeThicknessMm(o: SheetSpec): number {
  return Math.max(1, Math.min(o.hingeLayers, o.sheetLayers)) * o.layerHeightMm;
}

/** The narrowest groove a sheet this thick can actually fold in.
 *
 *  Bending a slab of thickness t through an angle needs the outer face to travel
 *  further than the inner one, and the band has to be long enough to supply that:
 *  pi*t/2 for a right angle, pi*t to fold flat. Below it the two slabs either side of
 *  the groove meet before the fold is finished and the part simply stops.
 *
 *  The floor is the FLAT figure, because a box has 180 degree folds in it — a doubled
 *  webbed corner, a tuck rolling over — and sizing for 90 leaves those jammed. */
export function minHingeWidthMm(o: SheetSpec): number {
  return Math.PI * sheetThicknessMm(o);
}

/** The FLAT part of the groove — full-width thinned material, honouring the floor. */
export function effectiveHingeWidthMm(o: SheetSpec): number {
  return Math.max(o.hingeWidthMm, minHingeWidthMm(o));
}

/** How far a chamfer walks the slab wall back from the groove floor.
 *
 *  A square inside corner at the root of the groove is a stress riser: all the bend
 *  strain arrives at one line of filament, and rigid PLA splits there where card
 *  would simply crease. Walking the wall back one layer height per layer gives a
 *  45 degree ramp out of the floor, which is also the steepest step FDM prints
 *  without an overhang.
 *
 *  Zero when the slab is a single layer, because there is then nothing to ramp: at
 *  the default 2-layer sheet on a 1-layer hinge the slab IS one layer, its wall is
 *  one layer tall, and any chamfer would be sub-layer. It needs a 3-layer sheet
 *  before it is geometry rather than arithmetic. Capped, so an 8-layer sheet does
 *  not open a 4 mm trench in the name of a fillet. */
const MAX_CHAMFER_MM = 0.8;

export function slabChamferMm(o: SheetSpec): number {
  const layer = o.layerHeightMm;
  const slabLayers = Math.round((sheetThicknessMm(o) - hingeThicknessMm(o)) / layer);
  if (slabLayers < 2) return 0;
  return Math.min((slabLayers - 1) * layer, MAX_CHAMFER_MM);
}

/** Clearance for a printed tab, per side. Tighter than card because the part is
 *  dimensionally accurate, but not zero: PLA does not compress, so a tab that is a
 *  hair oversized does not squeeze through, it stops. */
const PRINT_CLEAR_MM = 0.2;

/** How thick a panel that ends up SANDWICHED between two plies is built.
 *
 *  It drops into a gap one sheet thick, so building it at full sheet thickness jams:
 *  card crushes and PLA does not. Hinge thickness was the answer to that, and it was
 *  the right answer for exactly one sheet — two layers on a one-layer hinge, where
 *  half the gap is a sensible flap. At three layers it leaves a 0.2 mm tongue
 *  rattling in a 0.6 mm slot, and a lid flap that loose does not hold a lid shut.
 *
 *  So it is the gap minus ONE clearance, rounded DOWN to whole layers — the same
 *  clearance the slots are cut with, because it is the same fit — and never under
 *  the hinge, since a flap thinner than the crease it folds on is not a thing. At
 *  the default sheet it still comes out at one layer, which is why nothing that
 *  already prints changes shape.
 *
 *  `plies` is how many thicknesses of the panel end up IN that gap. One for a dust
 *  flap or a tuck lug. TWO for a webbed corner, whose halves fold onto each other
 *  before the fold-over end comes down and traps the pair — budgeting a web the whole
 *  gap puts two of them in it and the corner will not close.
 */
export function sandwichThicknessMm(o: SheetSpec, plies = 1): number {
  const sheet = sheetThicknessMm(o);
  const layers = Math.floor((sheet - PRINT_CLEAR_MM) / (plies * o.layerHeightMm) + 1e-9);
  return Math.min(sheet, Math.max(hingeThicknessMm(o), layers * o.layerHeightMm));
}

/** Half the groove's full opening at the TOP of the sheet: the flat band, plus the
 *  chamfer that ramps out of it. Nothing that is not hinge may come closer to a fold
 *  than this — which is what `keepOutMm` below enforces on the blank. */
export function grooveHalfOpeningMm(o: SheetSpec): number {
  return effectiveHingeWidthMm(o) / 2 + slabChamferMm(o);
}

/** A slot's sizing, and an honest account of how it was arrived at. */
export interface SlotFit {
  /** Width across the ply. */
  widthMm: number;
  /** Clearance allowed per side, before any minimum-feature widening. */
  clearMm: number;
  /** The smallest slot this process can actually produce. */
  minFeatureMm: number;
  /** True when `minFeatureMm` won over the ideal fit, so the lock is looser than
   *  asked for. The caller raises a diagnostic; it is never silently swallowed. */
  coarse: boolean;
  /** How close to a crease a cut may come. A fold needs uncut board beside it. */
  keepOutMm: number;
}

/** Clearance for a tab in card, per side.
 *
 *  NOT scaled from caliper. The binding tolerance is not the board's thickness, it is
 *  where the tab ENDS UP — and on a hand-folded box that is the accumulated error of
 *  folding a double crease, which is a few tenths regardless of how thin the card is.
 *  A caliper-scaled clearance gets tighter exactly as the board gets floppier, which
 *  is backwards. */
const CARD_CLEAR_MM = 0.2;

/** What a drag knife can cut and still have the waste sliver release from the mat. */
const BLADE_MIN_SLOT_MM = 0.8;

/** How far clear of the groove's outer edge a printed cut is placed. See `keepOut`. */
const GROOVE_KEEPOUT_MARGIN_MM = 0.1;

/** Work out the slot fit for the current material and machine.
 *
 *  `plyMm` is the thickness of what actually passes through — one ply for a nib tab,
 *  two for a strap that doubles. Passing the box's caliper when two plies go through
 *  is the mistake this signature is shaped to prevent. */
export function slotFit(p: BoxParams, machine: Machine, plyMm: number): SlotFit {
  const printing = p.makeMode === 'print';
  const clear = printing ? PRINT_CLEAR_MM : CARD_CLEAR_MM;

  // The floor is a property of the process, not a constant.
  //   FDM  — a slot narrower than about a nozzle bridges itself shut.
  //   laser — the beam is the tool, so the kerf is the floor, with a little over.
  //   blade — nothing to do with kerf (a drag knife's is zero); it is whether the
  //           waste comes out.
  const minFeature = printing
    ? Math.max(0.5, p.layerHeightMm * 2)
    : machine.kerfMm > 0
      ? Math.max(0.4, 2 * machine.kerfMm)
      : BLADE_MIN_SLOT_MM;

  const ideal = plyMm + 2 * clear;
  const width = Math.max(ideal, minFeature);

  // Only call it coarse when the excess is something a hand can feel. The blade floor
  // beats the ideal fit on 300 gsm by twenty microns, and a warning that fires on
  // twenty microns is a warning nobody reads by the third box.
  const COARSE_MM = 0.12;

  // How close a cut may come to a fold. On card that is just "do not undercut the
  // crease". On the printed sheet the crease is a GROOVE of real width, and cutting
  // into it removes the hinge, so the keep-out is the groove's own half-opening.
  //
  // `grooveHalfOpeningMm`, NOT `p.hingeWidthMm / 2`. The slider is a request; the
  // groove is cut at `max(request, pi * sheet)` and now ramps out of that by a
  // chamfer as well. Reading the raw slider put the mailer's four lock slots 28
  // microns inside the groove they had to stay clear of, and the exporter — which
  // will not roof over a hole — answered by leaving the entire base at hinge
  // thickness. One layer of floor under the whole box.
  //
  // The extra margin is what keeps that from being a knife-edge decision: the slot
  // clears the groove by a tenth of a millimetre rather than by nothing, so no
  // rounding anywhere downstream can put it back inside.
  const keepOut = printing ? Math.max(0.3, grooveHalfOpeningMm(p) + GROOVE_KEEPOUT_MARGIN_MM) : 0.3;

  return {
    widthMm: width,
    clearMm: clear,
    minFeatureMm: minFeature,
    coarse: width > ideal + COARSE_MM,
    keepOutMm: keepOut,
  };
}

/** The fit a builder gets when nobody passed one — card at the default clearance.
 *  Present so the primitives stay callable from tests and demos without a machine. */
export const DEFAULT_SLOT_FIT: SlotFit = {
  widthMm: 0.38 + 2 * CARD_CLEAR_MM,
  clearMm: CARD_CLEAR_MM,
  minFeatureMm: BLADE_MIN_SLOT_MM,
  coarse: false,
  keepOutMm: 0.3,
};
