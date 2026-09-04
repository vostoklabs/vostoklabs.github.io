/* Reading a design token from JavaScript.

   The kit owns the palette, so anything that needs a token's *value* — as opposed to just
   referencing it in CSS — asks here rather than copying the hex.

   This exists because five files had `new THREE.Color(theme === 'light' ? 0xf3f4f6 : 0x15171c)`
   written out by hand: the shared viewer plus four forked copies of it. Those two literals are
   `--bg` in each theme, so the 3D viewport matched the chrome behind it only by coincidence,
   and the coincidence held only for as long as nobody edited the palette. Changing `--bg`
   would have put a visible seam around every generator's viewport, in every app, with nothing
   reporting it. */

/**
 * Read a CSS custom property off `<html>` as a 24-bit number, for three.js.
 *
 * Resolves the *current* theme automatically: `--bg` is redeclared under
 * `[data-theme='light']`, so a caller re-reading after a theme change gets the new value
 * without having to know which theme it is.
 *
 * @param token    property name, e.g. `'--bg'`
 * @param fallback used when the property is missing or unparseable — a stylesheet that has
 *                 not loaded yet must not turn the scene black.
 */
export function themeColorHex(token: string, fallback: number): number {
  if (typeof document === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return parseColor(raw) ?? fallback;
}

/**
 * The same read, as the CSS colour STRING — for a 2D canvas.
 *
 * `themeColorHex` returns a 24-bit number because its caller is three.js. A canvas context
 * wants `ctx.fillStyle = '#8ab4ff'`; handing it the number 9089791 sets nothing at all and
 * throws nothing either — the assignment is silently ignored and the shape paints in whatever
 * colour was set last. So a canvas that reached for `themeColorHex` would look like it worked
 * on the first fill and be wrong on every one after it.
 *
 * Two functions rather than one that guesses, because the two callers genuinely want two types.
 * Both read the live computed value, so both follow a theme change without being told.
 *
 * @param token    property name, e.g. `'--accent'`
 * @param fallback a CSS colour used when the property is missing — a canvas drawn before the
 *                 stylesheet loads must not paint in `''`, which is also silently ignored.
 */
export function themeColor(token: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return raw || fallback;
}

/** `#abc`, `#aabbcc`, and `rgb()/rgba()` — the three forms the tokens actually use. */
function parseColor(value: string): number | null {
  if (!value) return null;

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)?.[1];
  if (hex) {
    // `#abc` -> `#aabbcc`
    const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
    return parseInt(full, 16);
  }

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(value);
  if (rgb) {
    const channel = (n: string | undefined) => Math.max(0, Math.min(255, Math.round(Number(n))));
    return (channel(rgb[1]) << 16) | (channel(rgb[2]) << 8) | channel(rgb[3]);
  }

  return null;
}
