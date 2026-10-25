/**
 * The base-shape picker: every shape in a window of its own, in the middle of the screen, the
 * way "Browse all" opens the font library.
 *
 * Ian, choosing a shape and drawing one being two jobs:
 *
 *   "we still need an option just to choose the shapes, not all want to just go and manually
 *    edit. so we need a choose menu ... with basic shapes, and extra button to enter custom
 *    shape menu."
 *
 * So this answers "which shape", the shape editor (private) answers "now change it", and the
 * only way into the editor from here is a button that says so.
 *
 * ## Why a window, and closed by a pick
 *
 * It was a drawer down the right-hand side, so the model stayed in sight and rebuilt behind it
 * while you clicked along the grid. The Shape category now has the common shapes as a grid of
 * pictures in the rail itself, so this is the "all of them" view, and Ian found a drawer for it
 * odd beside the font library's window (2026-10-25). Like that window, it closes on a pick: the
 * choice is the point, and undo covers a wrong one.
 *
 * ## Where the knobs went
 *
 * A polygon's sides, a star's points and sharpness, a rounded square's corners: they sat in the
 * drawer under the shape they belong to, because in the sidebar of the day they "asked about the
 * shape in a place the shape was not". They are under the Shape grid now (ui.ts), which IS the
 * place the shape is, and a window that closes on a pick has nowhere to keep them.
 */
import { button, dialog, thumbGrid, thumbTile, type DialogHandle } from '@vostok/ui-kit';
import { shapeGroups, type ShapeEntry } from '../shapes/directory';

export interface ShapePickerOptions {
  /** The shape in use, by directory id. Null when the base is a drawing or follows the design. */
  selectedId: string | null;
  onPick(entry: ShapeEntry): void;
  /** The way out, into the 2-D editor. */
  onDrawYourOwn(): void;
  /** Optional pill on the editor button. Undefined leaves it unmarked, which is correct for
   *  the public build, where the editor is not in the bundle at all. */
  paidBadge?: string;
}

export function openShapePicker(opts: ShapePickerOptions): DialogHandle {
  const body = document.createElement('div');
  let handle: DialogHandle | null = null;

  for (const group of shapeGroups()) {
    const tiles = group.shapes.map((sh) => thumbTile({
      svgPath: sh.thumb,
      label: sh.name,
      selected: sh.id === opts.selectedId,
      onClick: () => {
        handle?.close();
        opts.onPick(sh);
      },
    }));
    // 76px rather than the 64px default: these are silhouettes rather than icons, and a
    // five-point star at 64 reads as a blob.
    body.append(thumbGrid({ heading: group.label, tiles, minPx: 76 }));
  }

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
        handle?.close();
        opts.onDrawYourOwn();
      },
    }));
  }

  handle = dialog({ title: 'Choose a shape', content: body, wide: true, actions: [{ label: 'Close' }] });
  return handle;
}
