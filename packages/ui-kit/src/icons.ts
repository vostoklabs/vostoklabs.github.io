// Inline SVG icons (lucide-style strokes, taken from the clicker's shipped markup).
// No icon font, no external requests.
// Drawn from Lucide (ISC) and Feather (MIT); `github` is the Octicons mark (MIT). Their licences
// sit beside this file and scripts/third-party-notices.mjs puts them in every app's notices: an
// icon from any other source needs its licence added in both places.

const stroke = (inner: string, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const ICONS = {
  github:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>',
  license: stroke(
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10"/><path d="M7 12h6"/><circle cx="16.5" cy="14.5" r="2.5"/><path d="m15 17-1 4 2.5-1.5L19 21l-1-4"/>',
  ),
  zap: stroke('<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>'),
  // The same bolt with a slash through it — the animation toggle's "off" state.
  zapOff: stroke(
    '<path d="M10.5 4.9 13.1 2.2a.5.5 0 0 1 .86.46L12.6 7"/><path d="M15.7 10H20a1 1 0 0 1 .78 1.63l-1.72 1.77"/>' +
      '<path d="M16.3 16.3 10.9 21.8a.5.5 0 0 1-.86-.46l1.25-3.9"/><path d="M8.1 8.1 4 12.9A1 1 0 0 0 5 14h5.5"/>' +
      '<line x1="2" y1="2" x2="22" y2="22"/>',
  ),
  coffee: stroke(
    '<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4Z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>',
  ),
  check:
    '<svg class="vl-whatsnew-check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
  // A plain X — a docked panel's title-row close needs an `iconButton`, and `drawer()`'s own
  // close is a bare `×` glyph rather than an icon, so nothing in the kit had one until now.
  close: stroke('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),

  // Directional pad + transport (arrows are heavier so they read at a glance).
  /* Chevrons, for a pad where the arrows are a nudge rather than a jump. Lighter than the
     full arrows above at the same size, which is what keeps a 30px cell from reading as a
     block of ink. */
  chevronUp: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg>',
  chevronDown: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>',
  chevronLeft: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>',
  chevronRight: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>',
  /* "Back to the middle": a plain dot, not a crosshair. The centre of a nudge pad is a
     destination, and a target reticle reads as an instruction to aim at something. */
  dot: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/></svg>',
  arrowUp: stroke('<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>', 22),
  arrowDown: stroke('<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>', 22),
  arrowLeft: stroke('<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>', 22),
  arrowRight: stroke('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>', 22),
  rotateLeft: stroke('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>'),
  rotateRight: stroke('<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>'),
  target: stroke('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),

  // Share / download actions.
  link: stroke(
    '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  ),
  download: stroke('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  upload: stroke('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v13"/>'),

  // Search + theme toggle.
  search: stroke('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>'),
  sun: stroke('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>'),
  moon: stroke('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'),

  // Generator chrome: info callout, help, save, load.
  info: stroke('<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'),
  help: stroke('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
  // A clock winding back — the update timeline's button. Lucide's `history`.
  history: stroke('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'),
  save: stroke('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>'),
  load: stroke('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),

  // History controls (same paths the clicker's sidebar footer ships).
  // Import-source icons, matching the markup the shipped generators inline in
  // their own source cards — so a generator built from the template gets the
  // same row of cards rather than a bare-label imitation of it.
  image: stroke(
    '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    18,
  ),
  svg: stroke(
    '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
    18,
  ),
  text: stroke(
    '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>',
    18,
  ),
  undo: stroke('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>', 18),
  redo: stroke('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>', 18),
  trash: stroke('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6v14h12V6"/><path d="M10 11v5"/><path d="M14 11v5"/>', 18),
  plus: stroke('<path d="M12 5v14"/><path d="M5 12h14"/>', 18),

  // A preview viewport's own transport: the clicker's image wizard needed zoom in/out and a
  // "fit to view" reset for inspecting thin lines and small text in a traced result, and no
  // generator had asked for any of the three before.
  zoomIn: stroke('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>', 18),
  zoomOut: stroke('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><line x1="8" y1="11" x2="14" y2="11"/>', 18),
  maximize: stroke('<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>', 18),

  /* The aspect lock that sits between a Width and a Height row — pressed means the two move
     together. A padlock rather than a chain link because the control is a toggle with a state
     to read at a glance, and the two padlock silhouettes differ at 16px in a way two chain
     links do not: the shackle is closed on one and open on the other. */
  lock: stroke('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
  unlock: stroke('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>'),
  // Align one object to its frame (lucide align-*-justify-*): a rule, and a bar pulled to it.
  alignLeft: stroke('<path d="M3 3v18"/><rect x="7" y="7" width="12" height="10" rx="2"/>'),
  alignCenter: stroke('<path d="M12 3v4"/><path d="M12 17v4"/><rect x="5" y="7" width="14" height="10" rx="2"/>'),
  alignRight: stroke('<path d="M21 3v18"/><rect x="5" y="7" width="12" height="10" rx="2"/>'),
  alignTop: stroke('<path d="M3 3h18"/><rect x="7" y="7" width="10" height="12" rx="2"/>'),
  alignMiddle: stroke('<path d="M3 12h4"/><path d="M17 12h4"/><rect x="7" y="5" width="10" height="14" rx="2"/>'),
  alignBottom: stroke('<path d="M3 21h18"/><rect x="7" y="5" width="10" height="12" rx="2"/>'),
  // Mirror across an axis (lucide flip-horizontal-2 / flip-vertical-2).
  flipH: stroke('<path d="m3 7 5 5-5 5V7"/><path d="m21 7-5 5 5 5V7"/><path d="M12 20v2"/><path d="M12 14v2"/><path d="M12 8v2"/><path d="M12 2v2"/>'),
  flipV: stroke('<path d="m17 3-5 5-5-5h10"/><path d="m17 21-5-5-5 5h10"/><path d="M4 12H2"/><path d="M10 12H8"/><path d="M16 12h-2"/><path d="M22 12h-2"/>'),
  // Back to where it started (lucide corner-up-left).
  resetPosition: stroke('<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>'),
  // The overflow of a toolbar group (lucide more-horizontal).
  more: stroke('<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>'),

  /* Settings-rail icons for the laser templates (2026-09-20): a rail names its categories
     by what they set, and a category the kit had no glyph for wore `maximize` by default,
     so five rails in a row looked like one. Drawn in the same lucide-style stroke. */
  // Stacked sheets — a design cut in layers.
  layers: stroke('<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/><path d="m3 17 9 5 9-5"/>', 18),
  // A 2 × 2 grid — tiles, a crossword, a puzzle tray.
  grid: stroke('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>', 18),
  // A QR code: three finders and a scatter of modules.
  qr: stroke('<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><path d="M15 15h2v2h-2z"/><path d="M19 15h2"/><path d="M15 19h2"/><path d="M19 19h2v2"/>', 18),
  // A plate leaning on a base — stands, feet, stakes, posts.
  stand: stroke('<path d="M8 20h8"/><path d="M12 20v-4"/><path d="m6 4 12 2v10L6 14z"/>', 18),
  // A list with bullets — names, guests, lines.
  // Three bars — the menu button a narrow page folds its navigation into.
  menu: stroke('<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>', 18),
  list: stroke('<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>', 18),
  // Two sliders — a category of plain settings.
  sliders: stroke('<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>', 18),
  // A box seen from a corner — a box's own settings.
  box: stroke('<path d="M12 3 3 7.5v9L12 21l9-4.5v-9L12 3z"/><path d="m3 7.5 9 4.5 9-4.5"/><path d="M12 12v9"/>', 18),
  // A ruler — a sheet's thickness, a material.
  ruler: stroke('<rect x="2" y="8" width="20" height="8" rx="1.5"/><path d="M6 8v3"/><path d="M10 8v4"/><path d="M14 8v3"/><path d="M18 8v4"/>', 18),
  // Fingers meeting a straight edge — joints.
  joint: stroke('<path d="M2 11h4V7h4v4h4V7h4v4h4"/><path d="M2 15h20"/>', 18),
  // Three cells of a honeycomb — a repeating pattern.
  pattern: stroke('<path d="M7.5 4.5 11.4 6.75v4.5L7.5 13.5 3.6 11.25v-4.5z"/><path d="M16.5 4.5l3.9 2.25v4.5L16.5 13.5l-3.9-2.25v-4.5z"/><path d="M12 12.3l3.9 2.25v4.5L12 21.3l-3.9-2.25v-4.5z"/>', 18),
  // A heart — a shape something is cut inside.
  heart: stroke('<path d="M12 20 4.6 12.6a4.2 4.2 0 0 1 7.4-5.4 4.2 4.2 0 0 1 7.4 5.4z"/>', 18),
  // A drop of ink: colours, the filaments a model prints in.
  droplet: stroke('<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>', 18),
} as const;

/** Parse a raw SVG string into an element. */
export function svgEl(raw: string): SVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = raw.trim();
  return tpl.content.firstElementChild as unknown as SVGElement;
}

/**
 * A filled path in a `box`×`box` viewBox, inheriting the caller's colour.
 *
 * Built with the DOM rather than `innerHTML` so a path string — which may have come from a
 * user-supplied SVG, or from a generator — can never carry markup into the page.
 *
 * Shared rather than local because two things now draw a picture that is a path rather than a
 * named icon: the symbol picker's tiles and `thumbTile`'s shape thumbnails. A second copy is
 * how the two would drift, and it is the smaller version of the mistake CLAUDE.md's working
 * notes describe — a style with no function behind it.
 */
export function svgPathEl(d: string, box = 40): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${box} ${box}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}
