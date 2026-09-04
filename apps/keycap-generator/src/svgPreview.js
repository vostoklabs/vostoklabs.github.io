/**
 * The SVG import preview.
 *
 * The clicker's, ported. "SVG import doesn't work" is the same report here, and it is the same
 * cause: the file has no fills (an outline drawing from Illustrator or an icon site), or has
 * parts that will not print — an invisible artboard rectangle, a white shape — and the app
 * decided for you and said nothing. `parseSvg` guessed well most of the time, which is exactly
 * why the misses were baffling: nothing in the UI said a decision had been made at all.
 *
 * So this window shows the file beside what the tracer got from it, and gives one decision per
 * part: Fill, Outline or Off. A keycap legend is one colour, so there is no swatch.
 *
 * What comes out is a NEW SVG with the choices written into it as fill/stroke styles (see
 * `applySvgChoices`). That is deliberate: the single cap, the paid dual legend and the paid
 * keyboard set all read an uploaded tile's markup and call `parseSvg` on it themselves, and the
 * set stores the markup by content id. Baking the choice into the file means all three inherit
 * it with no new plumbing, the tile's thumbnail shows what will print, and a saved board
 * carries the decision inside the artwork it already keeps.
 *
 * Built from kit components; the two previews are inline SVG we generate.
 */
import { dialog, segmentedControl } from '@vostok/ui-kit';
import { applySvgChoices, describeSvg, parseSvg } from './logo.js';

const NS = 'http://www.w3.org/2000/svg';

const el = (tag, className, text) => {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
};

/**
 * Draw a `parseSvg` result as inline SVG: the contours the carve will extrude and the ribbon
 * triangles a stroke becomes. All contours go into ONE path so a hole is a hole — painted as
 * separate paths every hole fills solid, which is the bug the clicker's first preview had.
 */
function renderTrace(legend) {
  const { min, max } = legend.box;
  const w = max.x - min.x || 1;
  const h = max.y - min.y || 1;
  const pad = Math.max(w, h) * 0.08;
  const svg = document.createElementNS(NS, 'svg');
  // Square, centred on the art, so it sits in the panel the way the source <img> does.
  const side = Math.max(w, h) + 2 * pad;
  svg.setAttribute('viewBox', `${(min.x + max.x) / 2 - side / 2} ${(min.y + max.y) / 2 - side / 2} ${side} ${side}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  // The file's own colours do not matter to a one-colour legend, so the trace is drawn in the
  // same ink as a black-on-transparent icon: what most uploads are, and what the checkerboard
  // under it was chosen for.
  const ink = '#111';

  const d = (legend.contours ?? [])
    .filter((c) => c.length >= 3)
    .map((c) => `M${c.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join('L')}Z`)
    .join('');
  if (d) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', ink);
    path.setAttribute('fill-rule', 'nonzero');
    svg.appendChild(path);
  }
  for (const g of legend.strokeGeoms ?? []) {
    const pos = g.getAttribute('position');
    const idx = g.getIndex();
    const count = idx ? idx.count : pos.count;
    let tri = '';
    for (let i = 0; i < count; i += 3) {
      const a = idx ? idx.getX(i) : i;
      const b = idx ? idx.getX(i + 1) : i + 1;
      const c = idx ? idx.getX(i + 2) : i + 2;
      tri += `M${pos.getX(a).toFixed(3)},${pos.getY(a).toFixed(3)}`
        + `L${pos.getX(b).toFixed(3)},${pos.getY(b).toFixed(3)}`
        + `L${pos.getX(c).toFixed(3)},${pos.getY(c).toFixed(3)}Z`;
    }
    if (!tri) continue;
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', tri);
    path.setAttribute('fill', ink);
    // Ribbon triangles share edges; a hairline stroke hides the seams between them.
    path.setAttribute('stroke', ink);
    path.setAttribute('stroke-width', `${side / 400}`);
    svg.appendChild(path);
  }
  return svg;
}

/** How a part starts out: as the file painted it, with the same two exceptions the tracer
 *  has always made on its own (white shapes, artboard rectangles) — now visible as "Off"
 *  rows instead of silent — plus one: a file with no fills at all is an outline drawing, and
 *  the useful reading of one is "fill these". */
function initialMode(part, anyFilled) {
  if (part.why) return 'off';
  if (part.kind === 'fill') return 'fill';
  if (part.kind === 'stroke') return anyFilled ? 'outline' : 'fill';
  return 'off';
}

function whatItIs(part) {
  if (part.why === 'artboard') return 'Artboard rectangle';
  if (part.why === 'white') return part.kind === 'stroke' ? 'White outline in the file' : 'White in the file';
  if (part.kind === 'fill') return 'Filled in the file';
  if (part.kind === 'stroke') return `Outline in the file · ${part.strokeWidth ?? 1} wide`;
  return 'Invisible in the file';
}

/**
 * Show the file, show what the tracer made of it, and let the user fix the difference.
 *
 * Resolves with the SVG markup to use — the file with the choices written in — or null if
 * the user cancelled. Esc and the backdrop are a cancel, not a silent accept: the whole point
 * is that the user has seen and agreed to what will print.
 *
 * @param {string} svgText
 * @param {string} name
 * @returns {Promise<string|null>}
 */
export function openSvgPreview(svgText, name) {
  return new Promise((resolve) => {
    let settled = false;
    const { parts, issues } = describeSvg(svgText);
    const anyFilled = parts.some((p) => p.kind === 'fill' && !p.why);
    /** @type {Record<number, 'fill'|'outline'|'off'>} */
    const choices = {};
    for (const part of parts) choices[part.index] = initialMode(part, anyFilled);

    const body = el('div', 'kc-svgprev');

    const panels = el('div', 'kc-svgprev__panels');
    const srcPanel = el('div', 'kc-svgprev__panel');
    srcPanel.append(el('span', 'kc-svgprev__caption', 'Your file'));
    const srcHolder = el('div', 'kc-svgprev__art');
    // The file itself, as a data URI. Never inlined into the DOM: an uploaded SVG is untrusted
    // input and can carry script; an <img> renders it inert.
    const img = document.createElement('img');
    img.alt = name;
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgText)))}`;
    srcHolder.append(img);
    srcPanel.append(srcHolder);

    const outPanel = el('div', 'kc-svgprev__panel');
    outPanel.append(el('span', 'kc-svgprev__caption', 'What will print'));
    const outHolder = el('div', 'kc-svgprev__art');
    outPanel.append(outHolder);
    panels.append(srcPanel, outPanel);
    body.append(panels);

    const note = el('p', 'kc-svgprev__note');
    body.append(note);

    const list = el('div', 'kc-svgprev__parts');
    body.append(el('span', 'kc-svgprev__caption', 'Parts'), list);
    for (const part of parts) {
      const row = el('div', 'kc-svgprev__part');
      const mode = segmentedControl({
        options: [
          { value: 'fill', label: 'Fill' },
          { value: 'outline', label: 'Outline' },
          { value: 'off', label: 'Off' },
        ],
        value: choices[part.index],
        onChange: (m) => { choices[part.index] = m; repaint(); },
      });
      mode.classList.add('kc-svgprev__mode');
      row.append(el('span', 'kc-svgprev__what', whatItIs(part)), mode);
      list.append(row);
    }

    let chosenText = svgText;

    function repaint() {
      outHolder.replaceChildren();
      chosenText = applySvgChoices(svgText, choices);
      let legend = null;
      try {
        legend = parseSvg(chosenText);
      } catch (err) {
        // "No drawable paths" is the expected result of switching every part off.
        if (!/No drawable/.test(err?.message ?? '')) console.error('[svg] preview trace failed', err);
      }
      const modes = Object.values(choices);
      const outlines = modes.filter((m) => m === 'outline').length;
      const off = modes.filter((m) => m === 'off').length;
      if (legend) {
        outHolder.append(renderTrace(legend));
        for (const g of legend.strokeGeoms) g.dispose();
        const on = modes.length - off;
        const bits = [`${on} ${on === 1 ? 'part' : 'parts'}.`];
        if (outlines) {
          bits.push(`${outlines} ${outlines === 1 ? 'prints' : 'print'} as an outline, which is thin at keycap size — set it to Fill for a solid shape.`);
        }
        if (off) bits.push(`${off} off.`);
        note.textContent = [...issues, ...bits].join(' ');
        note.classList.toggle('kc-svgprev__note--warn', issues.length > 0 || outlines > 0);
      } else {
        outHolder.append(el('p', 'kc-svgprev__empty', 'Nothing to print from this file yet.'));
        note.textContent = issues[0] ?? 'Every part is off. Set at least one to Fill or Outline.';
        note.classList.add('kc-svgprev__note--warn');
      }
    }

    repaint();

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    dialog({
      title: `Import ${name}`,
      content: body,
      wide: true,
      onClose: () => finish(null),
      actions: [
        { label: 'Cancel', onClick: () => { finish(null); } },
        { label: 'Use this', primary: true, onClick: () => { finish(chosenText); } },
      ],
    });
  });
}
