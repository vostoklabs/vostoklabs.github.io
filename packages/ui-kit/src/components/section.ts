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
  const details = el('details', { className: 'vl-section vl-section--collapsible' }, [
    el('summary', { text: opts.title }),
    el('div', { className: 'vl-section__body' }, opts.body),
  ]) as HTMLDetailsElement;
  details.open = opts.open !== false;
  return details;
}
