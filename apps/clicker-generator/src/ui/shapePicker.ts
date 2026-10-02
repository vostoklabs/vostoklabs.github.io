/**
 * The base-shape picker.
 *
 * Ian's note, and the reason this exists beside the editor rather than inside it:
 *
 *   "we still need an option just to choose the shapes, not all want to just go and manually
 *    edit. so we need a choose menu that pop up on the right like before, with basic shapes,
 *    and extra button to enter custom shape menu."
 *
 * Choosing a shape and drawing one are two jobs, so they are two controls: this one answers
 * "which shape", the shape editor (private) answers "now change it",
 * and the only way into the editor from here is a button that says so.
 *
 * ## Why a drawer and not a dialog
 *
 * `drawer()` puts the panel at the edge with no backdrop and nothing made inert, so the model
 * keeps rebuilding while you click through the grid — which is the whole point of a picker
 * whose items are pictures of the thing you are looking at. A modal would hide the clicker
 * behind a grid of clickers. Every pick commits immediately for the same reason: there is no
 * OK button because there is nothing to confirm, and undo already covers a wrong click.
 *
 * ## Why the knobs are here
 *
 * "not intuitive how to increase/decrease the amount of faces/points."
 *
 * They were sliders in the sidebar, which asked about the shape in a place the shape was not.
 *
 * Here the knob sits directly under the shape it belongs to, appears only for the shapes that
 * have one, and is a `stepperRow` rather than a slider because a side count is COUNTED — five
 * points or six, never 5.4, and pressing + is easier to land than dragging a thumb across a
 * range of eight.
 */
import {
  button, drawer, sliderRow, stepperRow, thumbGrid, thumbTile,
  type DrawerHandle, type ThumbTileHandle, type ValueRow,
} from '@vostok/ui-kit';
import { shapeGroups, type ShapeEntry } from '../shapes/directory';

export interface ShapePickerOptions {
  /** The shape in use, by directory id. Null when the base is a drawing or follows the design. */
  selectedId: string | null;
  /** The knobs as the app has them, so opening the picker never moves one. Percentages are
   *  0–1 here, the way the store holds them; the rows show them as per cent. */
  params: { shapeSides: number; shapeCornerPct: number; shapeArmPct: number };
  onPick(entry: ShapeEntry): void;
  onSides(n: number): void;
  onCornerPct(v: number): void;
  onArmPct(v: number): void;
  /** The way out, into the 2-D editor. */
  onDrawYourOwn(): void;
  /** Optional pill on the editor button. Undefined leaves it unmarked, which is correct for
   *  the public build, where the editor is not in the bundle at all. */
  paidBadge?: string;
  onClose?(): void;
}

export function openShapePicker(opts: ShapePickerOptions): DrawerHandle {
  let pickedId = opts.selectedId;
  const params = { ...opts.params };
  const tiles = new Map<string, ThumbTileHandle>();

  const body = document.createElement('div');
  const knobs = document.createElement('div');
  /* The knob rows arrive as bare kit rows with no separation of their own, so a Points stepper
     and a Sharpness slider ended up touching: two labels, two controls and no air between the
     pairs, which reads as one four-part control rather than two. Spacing belongs on the
     CONTAINER rather than on the rows, because the rows are rebuilt on every pick. */
  knobs.className = 'cg-pick__knobs';

  for (const group of shapeGroups()) {
    const groupTiles = group.shapes.map((sh) => {
      const tile = thumbTile({
        svgPath: sh.thumb,
        label: sh.name,
        selected: sh.id === pickedId,
        onClick: () => pick(sh),
      });
      tiles.set(sh.id, tile);
      return tile;
    });
    // 76px rather than the 64px default: these are silhouettes rather than icons, and a
    // five-point star at 64 reads as a blob.
    body.append(thumbGrid({ heading: group.label, tiles: groupTiles, minPx: 76 }));
  }

  body.append(knobs);

  /* The knob rows are rebuilt on every pick rather than kept and hidden.

     Each row's min, max, step, label AND default come from the entry itself — a star's
     Sharpness is 30–80% and a cross's Arm width is 15–45%, and they are different questions
     wearing the same field. Reusing one row and rewriting its bounds is how a control ends up
     showing a value its own range excludes. */
  function paintKnobs(): void {
    knobs.replaceChildren();
    const entry = pickedId ? shapeGroups().flatMap((g) => g.shapes).find((s) => s.id === pickedId) : null;
    if (!entry) return;

    const rows: ValueRow<number>[] = [];
    if (entry.param) {
      rows.push(stepperRow({
        label: entry.param.label,
        help: 'How many sides or points the shape has.',
        min: entry.param.min,
        max: entry.param.max,
        step: entry.param.step,
        value: params.shapeSides,
        onInput: (v) => { params.shapeSides = v; opts.onSides(v); },
      }));
    }
    if (entry.corner) {
      rows.push(sliderRow({
        label: entry.corner.label,
        help: 'How far the corners are rounded off, as a share of the shape’s half-width.',
        min: entry.corner.min,
        max: entry.corner.max,
        step: entry.corner.step,
        value: Math.round(params.shapeCornerPct * 100),
        unit: '%',
        onInput: (v) => { params.shapeCornerPct = v / 100; opts.onCornerPct(v / 100); },
      }));
    }
    if (entry.feature) {
      rows.push(sliderRow({
        label: entry.feature.label,
        help: 'How deep the shape cuts in — a star’s valleys, a cross’s arms.',
        min: entry.feature.min,
        max: entry.feature.max,
        step: entry.feature.step,
        value: Math.round(params.shapeArmPct * 100),
        unit: '%',
        onInput: (v) => { params.shapeArmPct = v / 100; opts.onArmPct(v / 100); },
      }));
    }
    knobs.append(...rows);
  }

  function pick(sh: ShapeEntry): void {
    pickedId = sh.id;
    for (const [id, tile] of tiles) tile.setSelected(id === pickedId);
    /* Mirror the defaults `onShapePick` applies in the store, so the row that appears under a
       freshly picked Star reads 5 and not whatever the last shape's knob happened to be. The
       two are the same fact in two places; the alternative is the picker re-reading the store
       on every pick, which would make the drawer's contents depend on a rebuild finishing. */
    if (sh.param) params.shapeSides = sh.param.value;
    if (sh.corner) params.shapeCornerPct = sh.corner.value / 100;
    if (sh.feature) params.shapeArmPct = sh.feature.value / 100;
    opts.onPick(sh);
    paintKnobs();
  }

  paintKnobs();

  /* Two things a first-timer cannot know by looking: that one click is the whole commit —
     there is no OK button, because there is nothing to confirm — and that the answer appears
     BEHIND this panel rather than in it. A drawer with no backdrop is what makes the second
     one true, and it is exactly what makes it easy to miss. */
  const hint = document.createElement('p');
  hint.className = 'cg-pick__hint';
  hint.textContent = 'Click a shape to use it — the model updates behind this panel.';
  body.append(hint);

  /* The way into the editor, and the only one. It sits at the BOTTOM, after the grid: the
     shapes are the answer for almost everybody, and an escalation offered before the ordinary
     path has been read is an escalation people take by mistake.

     Omitted entirely in a build without the editor (`__SHAPE_EDITOR__`), because the editor is
     not merely locked there — it is not in the bundle, so a disabled button would promise
     something that cannot be reached by any route. */
  if (__SHAPE_EDITOR__) {
    body.append(button({
      label: 'Draw your own shape…',
      emphasis: 'secondary',
      block: true,
      // An optional marker. `opts.paidBadge` is undefined in the public build (the caller only
      // sets it under MAKERLAB), so no pill there.
      badge: opts.paidBadge,
      // Quieter while marked, the same treatment the Seller tools panel wears. Still clickable.
      className: opts.paidBadge ? 'vl-btn--locked' : undefined,
      title: opts.paidBadge
        ? 'Open the 2-D editor to change this shape, or draw one from scratch. Part of the lifetime commercial licence.'
        : 'Open the 2-D editor to change this shape, or draw one from scratch',
      onClick: () => {
        handle.close();
        opts.onDrawYourOwn();
      },
    }));
  }

  const handle = drawer({ title: 'Base shape', content: body, onClose: opts.onClose });
  return handle;
}
