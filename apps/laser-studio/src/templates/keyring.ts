// The keyring section most templates share, and the function that turns its values into the
// engine's spec. A template says `...keyringFields('outside')` and `keyring: keyringFrom(values)`.
//
// 2026-09-21: the control is Loop tab | None. There is no "Hole" — a pet tag whose loop had been
// dragged into the bone's waist showed the hole made no sense most of the time, so only the
// keyring stays, and it has to work perfectly. A design whose PRODUCT is a hole through the body
// cuts that hole itself, at its own hanging point — `hangHoleFields` + `hangingHoleCentre` below.
//
// 2026-09-22: …with ONE opt-in, which lasted six days, replacing the matching keychains' bespoke
// "Hanging hole" toggle with the usual keyring placed as a hole by default. That was built as a
// third option, Hole, that five designs opted into (`hole: true`) and four defaulted to — a hole
// punched through the body and HELD there, `holdInside` pulling it back whenever a drag took its
// border off the part.
//
// 2026-09-28: Loop tab | None again, everywhere, and the tab does what the hole was for, since it
// can be placed as a hole.
// A loop tab carries its own ring of material — the lug is `dia + 2 × ring` across and is welded
// on — so wherever it is dragged, even beside an edge, the hole keeps its wall and there is
// nothing to hold it back from. A design that used to default to the hole now RESTS its tab inside
// the part instead (`keyringFields(…, { rest: 'inside' })`), on the inward track where that hole
// sat, and builds exactly what the hole built there (measured: the same plate to the last digit on
// all four). From there it drags like any tab: out past the edge, straddling it, or anywhere
// inside. No clamp, and the neck welds on when it floats clear.
//
// Where the ring sits ALONG the edge is dragged on the preview: the drag writes hidden values —
// `ringPos`, the exact fraction around the outline, plus `ringSide`/`ringAlong` so a saved file
// still reads as "left edge, 42 %" and older files load where they were. The loop's reach and a
// free nudge are settings, the way the name keychain has them.
import { blankById, buildBlank, edgePoint, type BlankParams, type Shapes } from '@vostok/laser';
import type { KeyringSpec } from '../engine/types';
import { holdInside, holeTrack } from '../engine/editorGeometry';
import { num, str, type Field, type Values } from './types';

/** The Ring control's tooltip. One sentence, because a tooltip is all it is (2026-09-21). */
export const RING_HELP = 'Grows a tab off the edge with a hole in it.';
/** …and the same sentence for a design whose tab rests inside the part (`rest: 'inside'`). */
export const RING_INSIDE_HELP = 'A hole with its own border; drag it anywhere, even outside.';

/**
 * What the shared Ring control may be set to: a loop tab, or nothing.
 *
 * `'inside'` — a hole the user punched through the body and dragged around — is GONE from the
 * control (2026-09-21: the hole made no sense most of the time, so only the keyring stays, and it
 * has to work perfectly). It survives here only as a deprecated alias so that a template still
 * passing it, and every project file saved before then, opens as a loop tab instead of as a mode
 * with no option to select. Where a hole through the body IS the product — a pet disc, an
 * ornament's cap — the template cuts that hole into its OWN geometry at its own hanging point (see
 * `hangingHoleCentre` below); it is never this control.
 *
 * `'hole'` — the 2026-09-22 opt-in — is gone from here too (2026-09-28). A project that saved it
 * still carries the word: `coerceValues` turns it into a tab resting inside, with the same drag,
 * and `keyringFrom` reads a stray one the same way. No form offers it and no template passes it.
 */
export type RingMode = 'outside' | 'none' | 'inside';

/** The value the select holds, given what a template asked for. No form ever shows a select whose
 *  value is not one of its options — which is what a bare `'inside'` would be. */
const ringValue = (mode: RingMode): string => (mode === 'inside' ? 'outside' : mode);

export function keyringFields(
  mode: RingMode = 'outside',
  /** A jump ring is 2 mm, a split ring 5 mm, a ribbon 3 mm — the design knows which. `side` and
   *  `along` (0–100 %) say where on the outline the ring rests before any drag: a swing tag
   *  hangs from top-centre, a bar keychain from its left end.
   *
   *  `ringNote` REPLACES the Ring control's tooltip with this design's own sentence — one
   *  short sentence, because a tooltip is all it is now.
   *
   *  `nudge` is how far the pad may move the ring, mm. The house rule is the part's own size
   *  (G25): the shipped 250 mm let a 60 mm tag grow a 247 mm cantilever
   *  bridged by one thin arm, reported as a structurally sound single island. A design that knows
   *  how big it is passes half its own longest side, so the ring can reach any point ON the part
   *  and nowhere else.
   *
   *  `maxDia` is the biggest hole this design's hardware could want, mm. The shared 12 mm is a
   *  padlock shackle; on a 25 mm pet tag or a charm it is a hole the part cannot survive, and
   *  a slider whose top end breaks the piece is not a range (G25).
   *
   *  `maxRing` is the same rule for the BORDER, and the same reason: the disc the lettering has
   *  to keep off is `dia/2 + ring`, so the shared 8 mm is a border on a luggage tag and a hole
   *  through the initial on a 22 mm one. Two templates were already patching the field after the
   *  fact with a `.map()`; this is that, by signature.
   *
   *  `rest` is where the tab rests before anyone drags it: `'outside'` (every design, since
   *  2026-09-21) stands the lug proud of the edge; `'inside'` sets it on the inward track, its
   *  border inside the part, where the hole the design used to default to sat (2026-09-28). It is
   *  a hidden value (`ringRest`) rather than a constant so a saved project keeps where ITS tab
   *  rests — a Loop tab saved before the change stood outside, and still does. */
  opts: { section?: string; dia?: number; ring?: number; side?: 'left' | 'top' | 'right' | 'bottom'; along?: number; ringNote?: string; nudge?: number; maxDia?: number; maxRing?: number; rest?: 'inside' | 'outside' } = {},
): Field[] {
  const section = opts.section ?? 'Keyring';
  const inside = opts.rest === 'inside';
  const shown = (v: Values) => str(v, 'ringMode') !== 'none';
  return [
    {
      // Loop tab or nothing. A saved 'inside' opens as 'outside' (`keyringFrom`), a saved 'hole'
      // as a tab resting inside (`coerceValues`), and a template that still passes 'inside' gets
      // a tab, so no form ever shows a select whose value is not one of its options.
      kind: 'select', key: 'ringMode', label: 'Ring', section, value: ringValue(mode),
      help: opts.ringNote ?? (inside ? RING_INSIDE_HELP : RING_HELP),
      options: [
        { value: 'outside', label: 'Loop tab' },
        { value: 'none', label: 'None' },
      ],
    },
    { kind: 'number', key: 'holeDia', label: 'Hole diameter', section, value: opts.dia ?? 4, min: 1.5, max: opts.maxDia ?? 12, step: 0.5, unit: 'mm', help: '4 mm for a jump ring, 5 mm for a split ring.', visibleWhen: shown },
    // On a loop tab this is the WALL: the material the tab carries round its hole, so the tab is
    // `dia + 2 × ring` across. It also sets how far the lug stands proud of the edge at rest (or,
    // resting inside, how far in from it) and the disc the lettering has to keep off.
    { kind: 'number', key: 'holeRing', label: 'Hole border', section, value: opts.ring ?? 2.5, min: 1, max: opts.maxRing ?? 8, step: 0.5, unit: 'mm', help: 'Material left around the hole.', visibleWhen: shown },
    { kind: 'position', key: 'ringDx', keyY: 'ringDy', label: 'Move the ring', section, value: 0, valueY: 0, max: opts.nudge ?? 250, step: 0.5, unit: 'mm', visibleWhen: shown },
    { kind: 'select', key: 'ringSide', label: 'Side', section, value: opts.side ?? 'left', hidden: true, options: [{ value: 'left', label: 'Left' }, { value: 'top', label: 'Top' }, { value: 'right', label: 'Right' }, { value: 'bottom', label: 'Bottom' }] },
    { kind: 'number', key: 'ringAlong', label: 'Position on that side', section, value: opts.along ?? 50, min: 0, max: 100, step: 1, unit: '%', hidden: true },
    { kind: 'number', key: 'ringPos', label: 'Position around the outline', section, value: -1, min: -1, max: 1, step: 0.001, hidden: true },
    { kind: 'select', key: 'ringRest', label: 'Tab rests', section, value: inside ? 'inside' : 'outside', hidden: true, options: [{ value: 'outside', label: 'Outside the edge' }, { value: 'inside', label: 'Inside the part' }] },
  ];
}

export function keyringFrom(v: Values): KeyringSpec {
  const mode = str(v, 'ringMode');
  const pos = num(v, 'ringPos');
  return {
    enabled: mode !== 'none',
    // Every ring is a loop tab. A saved 'inside' (the punched hole removed on 2026-09-21) opens as
    // one standing outside, as it has since that day; a saved 'hole' (the opt-in removed on
    // 2026-09-28) as one resting where that hole rested. `coerceValues` rewrites both when a
    // project is loaded; this is the net under anything that reaches the build without it.
    mode: 'outside',
    restInside: mode === 'hole' || (mode === 'outside' && str(v, 'ringRest') === 'inside'),
    side: (['left', 'top', 'right', 'bottom'].includes(str(v, 'ringSide')) ? str(v, 'ringSide') : 'left') as KeyringSpec['side'],
    along: num(v, 'ringAlong') / 100,
    dia: num(v, 'holeDia'),
    ring: num(v, 'holeRing'),
    position: Number.isFinite(pos) && pos >= 0 ? pos : -1,
    dx: num(v, 'ringDx'),
    dy: num(v, 'ringDy'),
  };
}

/** A keyring spec that builds nothing — for a design that hangs from a hole of its own. */
export const NO_KEYRING: KeyringSpec = { enabled: false, mode: 'outside', side: 'top', along: 0.5, dia: 4, ring: 2.5, position: -1, dx: 0, dy: 0 };

/** The two controls a design's OWN hanging hole needs: on/off and how big. Its POSITION is not a
 *  control — the shape decides where it hangs from. */
export function hangHoleFields(section: string, opts: { dia?: number; maxDia?: number; label?: string } = {}): Field[] {
  return [
    { kind: 'toggle', key: 'hangHole', label: opts.label ?? 'Hanging hole', section, value: true, help: 'Cut where the shape naturally hangs from.' },
    {
      kind: 'number', key: 'holeDia', label: 'Hole diameter', section, value: opts.dia ?? 5, min: 2, max: opts.maxDia ?? 8, step: 0.5, unit: 'mm',
      help: '5 mm for a split ring, 3 mm for a ribbon.',
      visibleWhen: (v) => v.hangHole !== false,
    },
  ];
}

/**
 * Where a shape hangs from, in its own frame: the blank's declared `holeAt` (a bone's upper-left
 * lobe, a star's top arm, a house's roof boss), else the top-centre of its real outline. Held
 * inside the part with `ring` mm of material all round, so a hole on a shape whose hanging point
 * is too thin for it moves to the nearest place that survives rather than breaking the edge.
 */
export function hangingHoleCentre(v: Values, fallbackBlank: string, shapes: Shapes, dia: number, ring: number): [number, number] {
  const def = blankById(str(v, 'blank')) ?? blankById(fallbackBlank)!;
  // The same mapping `shared.ts`'s (private) `blankParamsOf` makes — with the hole's own
  // diameter, because a blank's `holeAt` sizes its inset from it.
  const p: BlankParams = { ...def.defaults, width: num(v, 'width'), height: num(v, 'height'), corner: num(v, 'corner'), holeDia: dia, holeSide: 'none', pair: false };
  const at = def.holeAt?.(p) ?? edgePoint(buildBlank(def, p), 'top', 0.5);
  // The candidates `holdInside` falls back to are the inward track a punched hole rides, so a
  // hanging point the shape is too thin for lands somewhere the part survives.
  const k = { mode: 'inside' as const, side: 'top' as const, along: 0.5, dia, ring };
  return holdInside(shapes, at as [number, number], dia / 2 + ring, holeTrack(shapes, k));
}
