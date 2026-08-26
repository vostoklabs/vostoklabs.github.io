// Inline SVG icons (lucide-style strokes, taken from the clicker's shipped markup).
// No icon font, no external requests.

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

  // Directional pad + transport (arrows are heavier so they read at a glance).
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

  // Search + theme toggle.
  search: stroke('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>'),
  sun: stroke('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>'),
  moon: stroke('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'),

  // Generator chrome: info callout, help, save, load.
  info: stroke('<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'),
  help: stroke('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
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
} as const;

/** Parse a raw SVG string into an element. */
export function svgEl(raw: string): SVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = raw.trim();
  return tpl.content.firstElementChild as unknown as SVGElement;
}
