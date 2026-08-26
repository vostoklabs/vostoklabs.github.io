// Sidebar sections. Every generator groups its controls the same way, so the
// markup lives here instead of being re-typed (and re-styled) per app.
import { el } from '../dom';

export interface SectionOptions {
  /** Heading. Numbered steps read best as `1 · Shape`, `2 · Colours`. */
  title: string;
  /** Rows inside the section. */
  body: (Node | string)[];
  /** Collapsible sections start open unless told otherwise. */
  open?: boolean;
}

/** A plain, always-open section: heading + rows. */
export function section(opts: SectionOptions): HTMLElement {
  return el('div', { className: 'vl-section' }, [
    el('p', { className: 'vl-label', text: opts.title }),
    el('div', { className: 'vl-section__body' }, opts.body),
  ]);
}

/** A collapsible section. Built on <details>, so it toggles without JS. */
export function collapsibleSection(opts: SectionOptions): HTMLDetailsElement {
  const summary = el('summary', { text: opts.title });
  const body = el('div', { className: 'vl-section__body' }, opts.body);
  /* The grid wrapper is what animates; `<details>` itself cannot. See `.vl-collapse` in
     patterns.css for why it is `1fr -> 0fr` and not `interpolate-size`. */
  const collapse = el('div', { className: 'vl-collapse' }, [body]);

  const details = el('details', { className: 'vl-section vl-section--collapsible' }, [
    summary,
    collapse,
  ]) as HTMLDetailsElement;

  details.open = opts.open !== false;
  makeCollapsible(details);
  return details;
}

/**
 * Give an existing `<details>` the kit's open/close animation.
 *
 * Exists because not every collapsible section is built by `collapsibleSection()`: the
 * clicker writes its three into an `innerHTML` template, so the component could never reach
 * them and they stayed the one part of the sidebar that snapped open in a single frame while
 * everything around it eased. Rather than have that app re-derive the animation, the kit
 * hands the behaviour out.
 *
 * Idempotent — calling it twice on the same element does nothing the second time.
 */
export function makeCollapsible(details: HTMLDetailsElement): void {
  if (details.dataset.vlCollapsible) return;
  details.dataset.vlCollapsible = '1';

  const summary = details.querySelector('summary');
  if (!summary) return;

  /* Wrap everything after the summary, unless a wrapper is already there (the path
     `collapsibleSection()` takes, which builds one itself). */
  let collapse = details.querySelector<HTMLElement>(':scope > .vl-collapse');
  if (!collapse) {
    collapse = el('div', { className: 'vl-collapse' });
    const body = [...details.childNodes].filter((n) => n !== summary);
    collapse.append(...body);
    details.append(collapse);
  }

  if (!details.open) collapse.setAttribute('data-closed', '');

  /*
    `<details>` flips `open` in one frame, which is why the body used to appear and vanish
    instantly while the chevron eased. Both directions are driven by hand instead:

      opening  set `open` first so the content is laid out, force a reflow so the browser
               has a 0fr starting point to animate FROM, then release to 1fr.
      closing  animate to 0fr first and only drop `open` once the transition has run.

    The reflow read is deliberate and not a frame callback: `requestAnimationFrame` does not
    fire in a background tab, and a section that will not open until the tab is focused is a
    worse bug than one that opens without its animation.
  */
  let closing: ReturnType<typeof setTimeout> | undefined;
  summary.addEventListener('click', (e) => {
    e.preventDefault();
    clearTimeout(closing);

    if (details.open) {
      collapse.setAttribute('data-closed', '');
      const ms = readDurationMs(collapse);
      closing = setTimeout(() => { details.open = false; }, ms);
    } else {
      details.open = true;
      void collapse.offsetHeight; // flush: gives the transition a 0fr start
      collapse.removeAttribute('data-closed');
    }
  });
}

/** The element's own transition duration in ms, so reduced motion shortens the close too. */
function readDurationMs(node: HTMLElement): number {
  const raw = getComputedStyle(node).transitionDuration.split(',')[0]?.trim() ?? '0s';
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return 0;
  return raw.endsWith('ms') ? n : n * 1000;
}
