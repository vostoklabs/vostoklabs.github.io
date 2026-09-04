/**
 * The SVG import preview.
 *
 * "SVG import doesn't work" is the most reported problem on the listing, and it is almost never
 * a broken tracer. It is one of four things, all invisible until the model comes out wrong:
 *
 *  1. **The file has no fills.** `parseSvg` traces fills; a stroke becomes ribbon geometry, so a
 *     2-unit stroke on a 100-unit artboard is 0.8 mm wide on a 40 mm clicker — one or two
 *     extrusion widths, which either vanishes into the base colour or prints as fuzz. Outline
 *     drawings are the normal export from Illustrator and from most icon sites.
 *  2. **Parts with no paint at all**, which contribute nothing and were never mentioned. Most
 *     often the invisible artboard rectangle icon sites wrap their art in.
 *  3. **Too many colours** — more than a printer has filaments.
 *  4. **A colour that is not the colour the author wrote.** (Fixed in `logo.ts`: three's
 *     ColorManagement was turning every imported colour linear-light, so #c8102e arrived as
 *     #930107. Named here because it was part of the same complaint.)
 *
 * None of that was reported. The app traced whatever it found and showed a model, and the user
 * was left to guess. So this window does two things and no more: it SHOWS the file beside what
 * the tracer got from it, and it gives the user one decision per part — Fill, Outline or Off,
 * and a colour — so what prints is what they chose, not what the file's author happened to
 * export.
 *
 * The first version had a global "Fill the outlines" switch plus a per-part on/off box whose
 * label just named what the file had done ("Filled shape", "No colour"). Neither let anyone
 * say "this one filled, that one not", the switch also filled the invisible artboard rectangle
 * into a black square over everything, and the right-hand preview painted every hole solid.
 * Ian's words: "makes no sense".
 *
 * Built from kit components; the two previews are inline SVG we generate, which is the one
 * thing the kit has no component for and should not.
 */
import { colorSwatch, dialog, segmentedControl, type DialogHandle } from '@vostok/ui-kit';
import { describeSvg, parseSvg, type SvgOptions, type SvgPart, type SvgPartChoice } from '../image/logo';
import type { RegionSet } from '../types';

const NS = 'http://www.w3.org/2000/svg';

const el = (tag: string, className?: string, text?: string): HTMLElement => {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
};

const hex = (rgb: [number, number, number]): string =>
  `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

/**
 * Draw a traced `RegionSet` as inline SVG.
 *
 * This is the half that matters: it renders the RINGS the geometry will actually extrude, not
 * the source file. When the two panels disagree, that difference IS the bug the user is
 * reporting, and now they can see it instead of describing it.
 *
 * All of a component's rings go into ONE path. `parseSvg` winds outers one way and holes the
 * other, and the geometry unions them non-zero — so a hole is only a hole when it is painted
 * together with its outer. Painting each ring as its own path (the first version) filled every
 * hole solid: an SD-card icon that is a thick outline in the file previewed as a black slab,
 * and nothing in the window could change it, because the model was already right.
 */
function renderTrace(set: RegionSet, size = 220): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `${-size / 2} ${-size / 2} ${size} ${size}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  const k = size * 0.44;
  // Biggest first, so small details paint on top rather than under.
  const ordered = [...set.regions].sort((a, b) => (b.coverage ?? 0) - (a.coverage ?? 0));
  for (const region of ordered) {
    for (const comp of region.components) {
      const d = comp.rings
        .filter((ring) => ring.length >= 3)
        // Y is flipped: rings are Y-up, SVG is Y-down.
        .map((ring) => `M${ring.map(([x, y]) => `${(x * k).toFixed(2)},${(-y * k).toFixed(2)}`).join('L')}Z`)
        .join('');
      if (!d) continue;
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', hex(region.quantRgb));
      path.setAttribute('fill-rule', 'nonzero');
      svg.appendChild(path);
    }
  }
  return svg;
}

export interface SvgPreviewResult {
  /** The options to trace with. Handed straight to `parseSvg`. */
  options: SvgOptions;
}

/**
 * How a part starts out: as the file painted it — except that a file with no fills at all is
 * an outline drawing, and the useful reading of one is "fill these". An unpainted path is off;
 * the user can turn it on, and the preview will show them the square.
 */
function initialMode(part: SvgPart, anyFilled: boolean): SvgPartChoice['mode'] {
  if (part.kind === 'fill') return 'fill';
  if (part.kind === 'stroke') return anyFilled ? 'outline' : 'fill';
  return 'off';
}

/**
 * Show the file, show what the tracer made of it, and let the user fix the difference.
 *
 * Resolves with the chosen options when the user accepts, or null if they cancel — the same
 * shape as the image wizard, so `mount` treats both imports the same way.
 */
export function openSvgPreview(
  svgText: string,
  name: string,
  removeBg: boolean,
): Promise<SvgPreviewResult | null> {
  return new Promise((resolve) => {
    let settled = false;

    const { parts, issues } = describeSvg(svgText);
    const anyFilled = parts.some((p) => p.kind === 'fill');
    const choices: Record<number, SvgPartChoice> = {};
    for (const part of parts) choices[part.index] = { mode: initialMode(part, anyFilled), hex: part.hex };

    const body = el('div', 'cg-svgprev');

    // ---- the two panels
    const panels = el('div', 'cg-svgprev__panels');
    const srcPanel = el('div', 'cg-svgprev__panel');
    srcPanel.append(el('span', 'cg-svgprev__caption', 'Your file'));
    const srcHolder = el('div', 'cg-svgprev__art');
    // The file itself, as a data URI. Never inlined into the DOM: an uploaded SVG is untrusted
    // input and can carry script; an <img> renders it inert.
    const img = document.createElement('img');
    img.alt = name;
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgText)))}`;
    srcHolder.append(img);
    srcPanel.append(srcHolder);

    const outPanel = el('div', 'cg-svgprev__panel');
    outPanel.append(el('span', 'cg-svgprev__caption', 'What will print'));
    const outHolder = el('div', 'cg-svgprev__art');
    outPanel.append(outHolder);
    panels.append(srcPanel, outPanel);
    body.append(panels);

    const note = el('p', 'cg-svgprev__note');
    body.append(note);

    // ---- one row per part: colour, what it is in the file, and how to draw it.
    // Built once. The rows hold the state; only the preview and the note repaint.
    const list = el('div', 'cg-svgprev__parts');
    body.append(el('span', 'cg-svgprev__caption', 'Parts'), list);
    for (const part of parts) {
      const choice = choices[part.index];
      const row = el('div', 'cg-svgprev__part');
      const swatch = colorSwatch({
        value: part.hex,
        label: `Color of shape ${part.index + 1}`,
        onChange: (v) => { choice.hex = v; repaint(); },
      });
      const what = part.kind === 'fill'
        ? 'Filled in the file'
        : part.kind === 'stroke'
          ? `Outline in the file · ${part.strokeWidth ?? 1} wide`
          : 'Invisible in the file';
      const mode = segmentedControl<SvgPartChoice['mode']>({
        options: [
          { value: 'fill', label: 'Fill' },
          { value: 'outline', label: 'Outline' },
          { value: 'off', label: 'Off' },
        ],
        value: choice.mode,
        onChange: (m) => { choice.mode = m; repaint(); },
      });
      mode.classList.add('cg-svgprev__mode');
      row.append(swatch, el('span', 'cg-svgprev__what', what), mode);
      list.append(row);
    }

    function currentOptions(): SvgOptions {
      const overrides: Record<number, SvgPartChoice> = {};
      for (const [k, c] of Object.entries(choices)) overrides[Number(k)] = { ...c };
      return { removeBg, overrides };
    }

    /** What the current choices mean at print scale — computed from the choices, not the
     *  file, so it stays true as they change. */
    function describeChoices(traced: RegionSet): { text: string; warn: boolean } {
      const modes = Object.values(choices).map((c) => c.mode);
      const outlines = modes.filter((m) => m === 'outline').length;
      const off = modes.filter((m) => m === 'off').length;
      const colors = new Set(traced.regions.map((r) => hex(r.quantRgb)));
      const bits = [
        `${traced.regions.length} ${traced.regions.length === 1 ? 'part' : 'parts'}, `
          + `${colors.size} ${colors.size === 1 ? 'color' : 'colors'}.`,
      ];
      if (outlines) {
        bits.push(`${outlines} ${outlines === 1 ? 'prints' : 'print'} as an outline, which is thin at clicker size — set it to Fill for a solid shape.`);
      }
      if (off) bits.push(`${off} off.`);
      return { text: [...issues, ...bits].join(' '), warn: issues.length > 0 || outlines > 0 };
    }

    function repaint(): void {
      outHolder.replaceChildren();
      let traced: RegionSet | null = null;
      try {
        traced = parseSvg(svgText, currentOptions());
      } catch (err) {
        // "No drawable paths" is the expected result of switching every part off, not a fault.
        if (!(err instanceof Error && err.message.startsWith('No drawable'))) {
          console.error('[svg] preview trace failed', err);
        }
      }
      if (traced && traced.regions.length) {
        outHolder.append(renderTrace(traced));
        const d = describeChoices(traced);
        note.textContent = d.text;
        note.classList.toggle('cg-svgprev__note--warn', d.warn);
      } else {
        outHolder.append(el('p', 'cg-svgprev__empty', 'Nothing to print from this file yet.'));
        note.textContent = issues[0] ?? 'Every part is off. Set at least one to Fill or Outline.';
        note.classList.add('cg-svgprev__note--warn');
      }
    }

    repaint();

    let handle: DialogHandle | null = null;
    const finish = (result: SvgPreviewResult | null) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    handle = dialog({
      title: `Import ${name}`,
      content: body,
      wide: true,
      // Closing by Esc or the backdrop is a cancel, not a silent accept — the whole point is
      // that the user has seen and agreed to what will print.
      onClose: () => finish(null),
      actions: [
        { label: 'Cancel', onClick: () => { finish(null); } },
        { label: 'Use this', primary: true, onClick: () => { finish({ options: currentOptions() }); } },
      ],
    });
    void handle;
  });
}
