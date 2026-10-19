// The pictures on the Background and Size tiles: drawn from each backdrop's own colours as SVG,
// instant and stable, while the stage beside them shows the real render.

import type { Backdrop } from '@vostok/render';

const uri = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

/** A backdrop as a little photo set: its wash, its floor, and a soft shadow where a product
 *  would sit. None is a checkerboard with the shadow on it, which is what the PNG will be. */
export function backdropSwatch(b: Backdrop): string {
  const shadow = '<ellipse cx="60" cy="68" rx="26" ry="6" fill="#000" fill-opacity="0.22"/>';
  if (!b.sky) {
    return uri(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 90">' +
        '<defs><pattern id="c" width="16" height="16" patternUnits="userSpaceOnUse">' +
        '<rect width="16" height="16" fill="#e6e8ec"/><rect width="8" height="8" fill="#c7cbd2"/>' +
        '<rect x="8" y="8" width="8" height="8" fill="#c7cbd2"/></pattern></defs>' +
        `<rect width="120" height="90" fill="url(#c)"/>${shadow}</svg>`,
    );
  }
  const [top, bottom] = b.sky;
  const wash = b.radial
    ? `<radialGradient id="g" cx="0.5" cy="0.42" r="0.75"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></radialGradient>`
    : `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`;
  const floor = b.floor
    ? `<linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${b.floor}" stop-opacity="0"/><stop offset="0.35" stop-color="${b.floor}"/></linearGradient>`
    : '';
  return uri(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 90">' +
      `<defs>${wash}${floor}</defs>` +
      '<rect width="120" height="90" fill="url(#g)"/>' +
      (b.floor ? '<rect y="50" width="120" height="40" fill="url(#f)"/>' : '') +
      `${shadow}</svg>`,
  );
}

/** A photo's shape: a rounded frame of its proportion, in the muted grey that reads on both
 *  themes. Dashed for the custom size, which is the customer's own. */
export function sizeSwatch(width: number, height: number, dashed = false): string {
  const k = 64 / Math.max(width, height);
  const w = width * k;
  const h = height * k;
  return uri(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 90">' +
      `<rect x="${(120 - w) / 2}" y="${(90 - h) / 2}" width="${w}" height="${h}" rx="5" fill="#909bad" fill-opacity="0.18" stroke="#909bad" stroke-width="3"${dashed ? ' stroke-dasharray="6 5"' : ''}/>` +
      '</svg>',
  );
}
