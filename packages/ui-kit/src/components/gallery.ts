import { el } from '../dom';

/* A gallery of things to start from — templates, presets, designs.

   The hub grew `hub-card` for its generators and the laser studio needed the same card for
   its templates: a picture, a name, a line, a few tags, one click. Two apps wanting one shape
   is the kit's cue (CLAUDE.md: fix it in the package). The card is a real <button>, so the
   whole surface is the action and keyboard users get it for free. */

export interface GalleryCardOptions {
  name: string;
  /** One line under the name. Clamped to two lines so a row's cards stay level. */
  blurb?: string;
  /** A rendered preview (an SVG, a canvas) or an image URL. Set later with `setThumb`. */
  thumb?: Element | string;
  /**
   * A second picture, laid over the first and shown while the card is hovered or has keyboard
   * focus: the design seen another way, its back beside its front, say. It fades in on the kit's
   * motion tier and simply swaps with reduced motion. Set later with `setHover`. Without it the
   * card is built exactly as it was.
   */
  hover?: Element | string;
  /** Small pills under the blurb — "keychain", "engrave + cut". */
  tags?: string[];
  /** A corner marker — "New", "Pro". */
  badge?: string;
  /**
   * The catalogue card: a smaller picture tile with the name and blurb beneath it, each held to
   * ONE line (the full blurb becomes the tooltip). For a gallery of dozens, where the two-line
   * card with its own panel turned a page of 44 designs into four screens of boxes. Pair it with
   * `galleryGrid({ dense: true })`. Tags are not drawn on a compact card.
   */
  compact?: boolean;
  onClick: () => void;
}

export type GalleryCardHandle = HTMLButtonElement & {
  /** Swap the preview once it has been rendered. */
  setThumb(thumb: Element | string): void;
  /** Swap the second picture (`hover`), or give a card built without one its first. */
  setHover(thumb: Element | string): void;
};

function thumbNode(thumb: Element | string): Element {
  if (typeof thumb === 'string') return el('img', { attrs: { src: thumb, alt: '', loading: 'lazy' } });
  return thumb;
}

export function galleryCard(opts: GalleryCardOptions): GalleryCardHandle {
  const thumb = el('div', { className: 'vl-gallery-card__thumb' });
  if (opts.thumb) thumb.append(thumbNode(opts.thumb));
  const badge = opts.badge ? el('span', { className: 'vl-gallery-card__badge', text: opts.badge }) : null;
  if (badge) thumb.append(badge);
  // The second picture's own layer, over the first and under the badge. It joins the tile only
  // once it holds a picture, so a card without one is built exactly as before.
  const hover = el('span', { className: 'vl-gallery-card__hover', attrs: { 'aria-hidden': 'true' } });
  const setHover = (t: Element | string) => {
    hover.replaceChildren(thumbNode(t));
    if (!hover.parentNode) thumb.insertBefore(hover, badge);
  };
  if (opts.hover) setHover(opts.hover);
  const body = el('div', { className: 'vl-gallery-card__body' }, [el('span', { className: 'vl-gallery-card__name', text: opts.name })]);
  if (opts.blurb) body.append(el('span', { className: 'vl-gallery-card__blurb', text: opts.blurb }));
  if (opts.tags?.length && !opts.compact) body.append(el('span', { className: 'vl-gallery-card__tags' }, opts.tags.map((t) => el('span', { className: 'vl-gallery-tag', text: t }))));
  const card = el('button', {
    className: opts.compact ? 'vl-gallery-card vl-gallery-card--compact' : 'vl-gallery-card',
    attrs: { type: 'button', ...(opts.compact && opts.blurb ? { title: opts.blurb } : {}) },
    on: { click: () => opts.onClick() },
  }, [thumb, body]) as GalleryCardHandle;
  card.setThumb = (t) => {
    // The first picture is whatever in the tile is neither the badge nor the second picture's layer.
    [...thumb.children].find((c) => c !== badge && c !== hover)?.remove();
    thumb.prepend(thumbNode(t));
  };
  card.setHover = setHover;
  return card;
}

export interface GalleryGridOptions {
  cards: HTMLElement[];
  /** Smallest card width before the grid drops a column, in px. Default 220. */
  minPx?: number;
  /** Tighter gutters, for `compact` cards. */
  dense?: boolean;
  /** The cards' picture shape, as a CSS aspect ratio ('4 / 5' for portrait pictures).
   *  Default '4 / 3'. */
  aspect?: string;
}

/** The responsive grid the cards sit in. */
export function galleryGrid(opts: GalleryGridOptions): HTMLElement {
  const grid = el('div', { className: opts.dense ? 'vl-gallery vl-gallery--dense' : 'vl-gallery' }, opts.cards);
  grid.style.setProperty('--vl-gallery-min', `${opts.minPx ?? 220}px`);
  if (opts.aspect) grid.style.setProperty('--vl-gallery-aspect', opts.aspect);
  return grid;
}
