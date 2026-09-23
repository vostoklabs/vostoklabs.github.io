/**
 * The SVG import wizard.
 *
 * "SVG import doesn't work" is the same report on every generator that takes an SVG, and it is
 * almost never a broken tracer. It is one of these, all invisible until the model comes out
 * wrong:
 *
 *  1. **The file has no fills.** A tracer traces fills; a stroke becomes ribbon geometry, so a
 *     2-unit stroke on a 100-unit artboard is a fraction of a millimetre at print scale — one
 *     or two extrusion widths, which either vanishes into the base colour or prints as fuzz.
 *     Outline drawings are the normal export from Illustrator and from most icon sites.
 *  2. **Parts with no paint at all**, which contribute nothing and were never mentioned. Most
 *     often the invisible artboard rectangle icon sites wrap their art in.
 *  3. **A white shape**, which is a shape, and prints as one.
 *  4. **More colours than a printer has filaments** — only where colour is a thing the app has.
 *
 * None of that was reported. Each app traced whatever it found, showed a model, and left the
 * user to guess. So this window does two things and no more: it SHOWS the file beside what the
 * tracer got from it, and it gives one decision per part — Fill, Outline or Off, plus a colour
 * where the app has colours — so what prints is what the user chose, not what the file's
 * author happened to export.
 *
 * ## Why it lives in the kit
 *
 * It existed twice, in the clicker and in the keycap generator, and the two drifted: the
 * keycap's grew the two-pane layout, the "why" reasons and the sizing fixes below; the
 * clicker's kept the single column and the colour swatches. Same window, same bugs to fix
 * twice. The layout, the checkerboard, the rows, the note and the dialog wiring are the same
 * everywhere — so they are here, once.
 *
 * What is NOT here is anything that has to know what an SVG is. The kit has no `three`
 * dependency and should not grow one: the caller describes the file (`parts`, `issues`) and
 * traces it (`trace`), and this window arranges the argument between them.
 *
 * ## The layout, and why it is two panes
 *
 * Stacked — previews, note, then a parts list with its own scrollbar inside a dialog that had
 * one too — the window came out about 820px tall inside a 760px box, so it scrolled, and the
 * scroll hid the very thing it exists to show. Side by side the same content is ~360px: the
 * file, the trace, the reason and every decision are all on screen at once, which is the whole
 * premise of the window.
 */
import { el } from '../dom';
import { colorSwatch, segmentedControl } from './controls';
import { splitDialog } from './split-dialog';

const NS = 'http://www.w3.org/2000/svg';

/** How one part will be drawn. */
export type SvgImportMode = 'fill' | 'outline' | 'off';

/** One drawable element in the file, as the caller's own describe step found it. */
export interface SvgImportPart {
  /** Position in the file's path list — the handle a choice is keyed on. Stable per file. */
  index: number;
  /** How the file paints it. `none` is the one that surprises people: a path with neither a
   *  fill nor a stroke contributes nothing, and the app used to say nothing about it. */
  kind: 'fill' | 'stroke' | 'none';
  /** Stroke width in the file's own units, when `kind === 'stroke'`. Wording only. */
  strokeWidth?: number;
  /**
   * Colour as authored, `#rrggbb`. **Present means the row gets a colour swatch** — so a
   * multi-filament app passes it and a one-colour legend does not, with no second flag.
   */
  hex?: string;
  /**
   * Why the tracer would have dropped this part on its own. Reported so the window can show it
   * as an "Off" the user can flip, rather than a model that came out blank for no visible
   * reason.
   */
  why?: 'white' | 'artboard';
}

/** What the window decided for one part. */
export interface SvgImportChoice {
  mode: SvgImportMode;
  /** `#rrggbb`, only where the caller gave the part a `hex` to begin with. */
  hex?: string;
}

/** One painted shape in the "what will print" panel. */
export interface SvgImportPath {
  /**
   * The path data.
   *
   * **All of one component's rings belong in ONE `d`.** A tracer winds outers one way and
   * holes the other and unions them non-zero, so a hole is only a hole when it is painted
   * together with its outer. Painting each ring as its own path — what both apps did first —
   * fills every hole solid: an SD-card icon that is a thick outline in the file previewed as a
   * black slab, and nothing in the window could change it, because the model was already right.
   */
  d: string;
  fill: string;
  /** Ribbon triangles share edges; a hairline stroke in the fill colour hides the seams. */
  stroke?: string;
  strokeWidth?: number;
}

/** What the caller's tracer got from the file, ready to paint. */
export interface SvgImportTrace {
  /** viewBox for the preview panel, in whatever space `paths` are drawn in. */
  viewBox: string;
  paths: SvgImportPath[];
  /**
   * Replaces the default "3 parts." sentence at the head of the note, for an app that can say
   * something more useful — the clicker counts colours, because colours are filaments.
   */
  summary?: string;
}

export interface SvgImportOptions {
  /** The file, as text. Shown as-is in the left panel; never parsed here. */
  svgText: string;
  /** Shown in the title: "Import <name>". */
  name: string;
  /** One entry per drawable element, biggest first. */
  parts: SvgImportPart[];
  /** Whole-file problems the per-part rows cannot say for themselves. */
  issues: string[];
  /** Trace with the current choices. Return null when nothing is drawable. */
  trace: (choices: Record<number, SvgImportChoice>) => SvgImportTrace | null;
  /**
   * How the outline warning names the print scale — `'keycap size'`, `'clicker size'`. The
   * warning exists because an outline that reads fine on screen is one extrusion width on the
   * part, so the noun has to be the thing being printed.
   */
  thinAt?: string;
}

/**
 * How a part starts out: as the file painted it, with the two exceptions a tracer has always
 * made on its own (white shapes, artboard rectangles) — now visible as "Off" rows instead of
 * silent — plus one: a file with no fills at all is an outline drawing, and the useful reading
 * of one is "fill these".
 */
function initialMode(part: SvgImportPart, anyFilled: boolean): SvgImportMode {
  if (part.why) return 'off';
  if (part.kind === 'fill') return 'fill';
  if (part.kind === 'stroke') return anyFilled ? 'outline' : 'fill';
  return 'off';
}

/**
 * The choices this window would have STARTED on, without opening it.
 *
 * For a caller that has somewhere better to fix a trace than a modal in front of the upload —
 * Laser Studio's area picker asks the same question beside the artwork it affects — the window
 * on import is a question asked before the user has seen anything. This is the half of it worth
 * keeping: the same defaults, applied silently, so "no window" and "the window, accepted
 * unchanged" are the same file. Exported from here rather than re-derived so the two cannot
 * drift (Ian, 2026-09-22: "drop the svg wizard on upload").
 */
export function svgImportDefaults(parts: SvgImportPart[]): Record<number, SvgImportChoice> {
  const anyFilled = parts.some((p) => p.kind === 'fill' && !p.why);
  const out: Record<number, SvgImportChoice> = {};
  for (const part of parts) out[part.index] = { mode: initialMode(part, anyFilled), ...(part.hex ? { hex: part.hex } : {}) };
  return out;
}

/** What a part IS, in the window's own words — for a caller that lists the parts itself. */
export function svgPartLabel(part: SvgImportPart): string {
  return whatItIs(part);
}

function whatItIs(part: SvgImportPart): string {
  if (part.why === 'artboard') return 'Artboard rectangle';
  if (part.why === 'white') return part.kind === 'stroke' ? 'White outline in the file' : 'White in the file';
  if (part.kind === 'fill') return 'Filled in the file';
  if (part.kind === 'stroke') return `Outline in the file · ${part.strokeWidth ?? 1} wide`;
  return 'Invisible in the file';
}

function renderTrace(traced: SvgImportTrace): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', traced.viewBox);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  for (const p of traced.paths) {
    if (!p.d) continue;
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', p.d);
    path.setAttribute('fill', p.fill);
    path.setAttribute('fill-rule', 'nonzero');
    if (p.stroke) {
      path.setAttribute('stroke', p.stroke);
      path.setAttribute('stroke-width', String(p.strokeWidth ?? 0));
    }
    svg.appendChild(path);
  }
  return svg;
}

/**
 * Show the file, show what the tracer made of it, and let the user fix the difference.
 *
 * Resolves with the choices, keyed on `SvgImportPart.index`, or null if the user cancelled.
 * Esc and the backdrop are a cancel, not a silent accept: the whole point is that the user has
 * seen and agreed to what will print.
 */
export function openSvgImport(
  opts: SvgImportOptions,
): Promise<Record<number, SvgImportChoice> | null> {
  return new Promise((resolve) => {
    let settled = false;
    const { parts, issues } = opts;
    const choices: Record<number, SvgImportChoice> = svgImportDefaults(parts);

    // The two panes are the split dialog's own now — the grid that used to hold them is
    // `.vl-split`. Everything INSIDE them is untouched, which is the point: three apps ship
    // this window, and promoting the shell must not move a pixel of the content.
    const left = el('div', { className: 'vl-svgprev__pane' });
    const right = el('div', { className: 'vl-svgprev__pane' });

    const panels = el('div', { className: 'vl-svgprev__panels' });
    const srcPanel = el('div', { className: 'vl-svgprev__panel' });
    srcPanel.append(el('span', { className: 'vl-svgprev__caption', text: 'Your file' }));
    const srcHolder = el('div', { className: 'vl-svgprev__art' });
    // The file itself, as a data URI. Never inlined into the DOM: an uploaded SVG is untrusted
    // input and can carry script; an <img> renders it inert.
    const img = el('img', { attrs: { alt: opts.name } });
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(opts.svgText)))}`;
    srcHolder.append(img);
    srcPanel.append(srcHolder);

    const outPanel = el('div', { className: 'vl-svgprev__panel' });
    outPanel.append(el('span', { className: 'vl-svgprev__caption', text: 'What will print' }));
    const outHolder = el('div', { className: 'vl-svgprev__art' });
    outPanel.append(outHolder);
    panels.append(srcPanel, outPanel);
    left.append(panels);

    const note = el('p', { className: 'vl-svgprev__note' });
    left.append(note);

    const list = el('div', { className: 'vl-svgprev__parts' });
    // Counted in the heading: the list is the one part of this window that can still need
    // scrolling, so it says up front how much is down there.
    right.append(
      el('span', {
        className: 'vl-svgprev__caption',
        text: parts.length === 1 ? 'Parts · 1' : `Parts · ${parts.length}`,
      }),
      list,
    );

    // One pass: seed the part's choice and build the row that owns it. The rows hold the
    // state; only the preview and the note repaint.
    for (const part of parts) {
      const choice = choices[part.index]!;
      const row = el('div', { className: 'vl-svgprev__part' });
      if (part.hex) {
        row.append(colorSwatch({
          value: part.hex,
          label: `Color of shape ${part.index + 1}`,
          onChange: (v) => { choice.hex = v; repaint(); },
        }));
      }
      // Titled as well as written: the description ellipsises in a half-width pane, and a
      // truncated one still has to say which part the picker beside it belongs to.
      const what = el('span', { className: 'vl-svgprev__what', text: whatItIs(part) });
      what.title = what.textContent ?? '';
      const mode = segmentedControl<SvgImportMode>({
        options: [
          { value: 'fill', label: 'Fill' },
          { value: 'outline', label: 'Outline' },
          { value: 'off', label: 'Off' },
        ],
        value: choice.mode,
        onChange: (m) => { choice.mode = m; repaint(); },
      });
      mode.classList.add('vl-svgprev__mode');
      row.append(what, mode);
      list.append(row);
    }

    function repaint(): void {
      outHolder.replaceChildren();
      const traced = opts.trace(choices);
      const modes = Object.values(choices).map((c) => c.mode);
      const outlines = modes.filter((m) => m === 'outline').length;
      const off = modes.filter((m) => m === 'off').length;
      if (traced && traced.paths.length) {
        outHolder.append(renderTrace(traced));
        const on = modes.length - off;
        const bits = [traced.summary ?? `${on} ${on === 1 ? 'part' : 'parts'}.`];
        if (outlines) {
          bits.push(
            `${outlines} ${outlines === 1 ? 'prints' : 'print'} as an outline, which is thin at `
            + `${opts.thinAt ?? 'print size'} — set it to Fill for a solid shape.`,
          );
        }
        if (off) bits.push(`${off} off.`);
        note.textContent = [...issues, ...bits].join(' ');
        note.classList.toggle('vl-svgprev__note--warn', issues.length > 0 || outlines > 0);
      } else {
        outHolder.append(el('p', {
          className: 'vl-svgprev__empty',
          text: 'Nothing to print from this file yet.',
        }));
        note.textContent = issues[0] ?? 'Every part is off. Set at least one to Fill or Outline.';
        note.classList.add('vl-svgprev__note--warn');
      }
    }

    repaint();

    const finish = (result: Record<number, SvgImportChoice> | null) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    splitDialog({
      title: `Import ${opts.name}`,
      stage: left,
      controls: right,
      // A working surface rather than a form — see the note on `size` in dialog.ts. `wide`
      // (760px) is sized for a grid beside a preview; this is two panes of decisions.
      size: 'xl',
      // The numbers that keep this window exactly the width it was: the parts list is a
      // column of decisions, not a sidebar of sliders, and its three-option picker alone is
      // 230px. The preview panels set their own height, so the stage needs no floor.
      controlsWidth: 490,
      stageMinHeight: 0,
      onClose: () => finish(null),
      actions: [
        { label: 'Cancel', onClick: () => { finish(null); } },
        { label: 'Use this', primary: true, onClick: () => { finish(choices); } },
      ],
    });
  });
}
