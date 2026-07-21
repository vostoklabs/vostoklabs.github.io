// Feature test: "Remove background" now also applies to SVG imports.
//
// Raster imports strip a flat background by edge flood-fill; SVG imports bypassed that
// entirely, so a `<rect>` behind the art came through as a colour region. parseSvg now
// takes { removeBg }: when on, a filled shape that spans the whole artboard AND fills
// its own bbox (i.e. a rectangle behind the art) is dropped, leaving only the logo —
// but never the last region, and never a spanning shape that isn't rectangle-like (a
// big round logo must survive).
//
// parseSvg needs a browser DOMParser; polyfill it with @xmldom/xmldom.
import { DOMParser } from '@xmldom/xmldom';
(globalThis as any).DOMParser = DOMParser;
const { parseSvg } = await import('../src/image/logo.ts');

// Build an N-gon path approximating a circle (matches svg-coverage.test.ts style).
function circle(cx: number, cy: number, r: number, n = 48): string {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    d += (i === 0 ? 'M' : 'L') + (cx + r * Math.cos(a)).toFixed(3) + ' ' + (cy + r * Math.sin(a)).toFixed(3) + ' ';
  }
  return d + 'Z';
}
const wrap = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${inner}</svg>`;
const has = (rs: any, rgb: string) => rs.regions.some((r: any) => r.quantRgb.join() === rgb);
const region = (rs: any, rgb: string) => rs.regions.find((r: any) => r.quantRgb.join() === rgb);

// full-canvas WHITE background rectangle + small BLACK circle logo
const bgPlusLogo = wrap(`<path fill="#ffffff" d="M0 0 H100 V100 H0 Z"/><path fill="#000000" d="${circle(50, 50, 6)}"/>`);
// only a full-canvas rectangle (no logo) — the background IS the whole design
const rectOnly = wrap(`<path fill="#000000" d="M0 0 H100 V100 H0 Z"/>`);
// a big BLACK circle spanning the canvas (fills only ~78% of its bbox) + white logo
const bigCirclePlusLogo = wrap(`<path fill="#000000" d="${circle(50, 50, 49)}"/><path fill="#ffffff" d="${circle(50, 50, 6)}"/>`);

const checks: [string, boolean][] = [];

// 1. removeBg drops the white background rect, keeps only the logo
{
  const rs = parseSvg(bgPlusLogo, { removeBg: true });
  checks.push(['removeBg drops the white background rect', !has(rs, '255,255,255')]);
  checks.push(['removeBg keeps the black logo', has(rs, '0,0,0')]);
  checks.push(['logo coverage ≈ 1 after bg removed', has(rs, '0,0,0') && region(rs, '0,0,0').coverage > 0.95]);
}
// 2. default (no opts) keeps every colour — unchanged behavior
{
  const rs = parseSvg(bgPlusLogo);
  checks.push(['default keeps both colours', rs.regions.length === 2]);
}
// 3. never strip the only region (a lone full-canvas rect stays)
{
  const rs = parseSvg(rectOnly, { removeBg: true });
  checks.push(['never strips the only region', rs.regions.length === 1]);
}
// 4. a spanning but non-rectangular shape (big round logo) is NOT treated as background
{
  const rs = parseSvg(bigCirclePlusLogo, { removeBg: true });
  checks.push(['spanning non-rectangle (circle) survives removeBg', has(rs, '0,0,0')]);
}

let ok = true;
for (const [label, pass] of checks) {
  console.log((pass ? 'PASS ' : 'FAIL ') + label);
  if (!pass) ok = false;
}
console.log(ok ? '\nALL SVG BG-REMOVAL CHECKS PASSED' : '\nSVG BG-REMOVAL CHECKS FAILED');
process.exit(ok ? 0 : 1);
