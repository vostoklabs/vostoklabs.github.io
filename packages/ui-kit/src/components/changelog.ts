import { el } from '../dom';
import { ICONS } from '../icons';
import { button, type ButtonHandle } from './button';
import { drawer, type DrawerHandle } from './drawer';

/*
  The update timeline: what changed in this generator, newest first, with the date.

  Distinct from `whats-new.ts`, and the difference is who started it. `showWhatsNew` is an
  interruptive modal that fires ON LOAD and has a "don't show again" on it — a release note
  pushed at someone. This is the opposite: a button the user presses when they want to know
  whether the thing they reported has been fixed, in a panel that does not take the screen
  away from the model. That question comes in by email constantly and the honest answer has
  always lived in a commit log the user cannot see.

  It is a drawer rather than a dialog for the reason `drawer.ts` exists: nothing behind it
  goes inert, so the box on the stage stays there while you read.

  Changes are GROUPED BY KIND rather than listed in the order they were written — all the
  new things, then all the fixes — because the two are read for different reasons, and a
  reader scanning for "is my bug fixed" should not have to filter features out of the list
  as they go. Keep each line to a few words: this is a scan, not a release note.
*/

export type ChangeKind = 'added' | 'fixed' | 'changed';

export interface ChangelogChange {
  kind: ChangeKind;
  /** A few words, in the user's language. What changed, not which function changed. */
  text: string;
}

export interface ChangelogEntry {
  /** ISO `YYYY-MM-DD`. Shown in the reader's own locale. */
  date: string;
  /** Optional headline. Usually unnecessary — the bullets are the headline. */
  title?: string;
  changes: ChangelogChange[];
}

export interface ChangelogOptions {
  entries: ChangelogEntry[];
  /** Drawer heading. Defaults to 'Updates'. */
  title?: string;
}

/** Group order, and the words. Additions first: it is the answer to "what can it do now",
 *  which is the question someone opening this on purpose is most often asking. */
const KINDS: { kind: ChangeKind; label: string }[] = [
  { kind: 'added', label: 'New' },
  { kind: 'fixed', label: 'Fixed' },
  { kind: 'changed', label: 'Changed' },
];

/** `2026-08-27` -> `27 August 2026`, in the reader's locale.
 *
 *  Built from the parts rather than handed to `new Date(iso)`, which parses a bare date as
 *  UTC midnight — so west of Greenwich every entry would render a day early. Falls back to
 *  the raw string, because a date nobody can parse is still better shown than dropped. */
function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Newest first, whatever order the app wrote them in. An app appending to the bottom of
 *  its own array is the obvious thing to do and it should not be able to invert the
 *  timeline by doing it. */
function newestFirst(entries: ChangelogEntry[]): ChangelogEntry[] {
  return [...entries].sort((a, b) => b.date.localeCompare(a.date));
}

/** The timeline itself, as an element — for a caller that wants it somewhere other than
 *  in a drawer (a help dialog, a release page). */
export function changelogList(entries: ChangelogEntry[]): HTMLElement {
  const root = el('div', { className: 'vl-changelog' });
  if (!entries.length) {
    root.append(el('p', { className: 'vl-changelog__empty', text: 'No updates listed yet.' }));
    return root;
  }

  for (const entry of newestFirst(entries)) {
    const parts: HTMLElement[] = [
      el('time', {
        className: 'vl-changelog__date',
        text: formatDate(entry.date),
        attrs: { datetime: entry.date },
      }),
    ];
    if (entry.title) parts.push(el('h3', { className: 'vl-changelog__title', text: entry.title }));

    for (const { kind, label } of KINDS) {
      const items = entry.changes.filter((c) => c.kind === kind);
      if (!items.length) continue;
      const list = el('ul', { className: 'vl-changelog__list' });
      for (const item of items) {
        list.append(el('li', { className: 'vl-changelog__item', text: item.text }));
      }
      parts.push(
        el('div', { className: 'vl-changelog__group' }, [
          el('span', { className: `vl-changelog__kind vl-changelog__kind--${kind}`, text: label }),
          list,
        ]),
      );
    }

    root.append(el('div', { className: 'vl-changelog__entry' }, parts));
  }
  return root;
}

/** Open the update timeline in an edge drawer. One at a time — `drawer()` closes any
 *  other before it opens this one. */
export function openChangelog(opts: ChangelogOptions): DrawerHandle {
  return drawer({
    title: opts.title ?? 'Updates',
    content: el('div', { className: 'vl-changelog-panel' }, [changelogList(opts.entries)]),
  });
}

export interface ChangelogButtonOptions extends ChangelogOptions {
  /** Button caption. Defaults to 'Updates'. */
  label?: string;
  /** Full-width, the sidebar shape. Default true. */
  block?: boolean;
}

/**
 * The button that opens it.
 *
 * A component rather than a slot on `projectActions`, because where it belongs is a layout
 * decision the app owns: foldbox puts it at the bottom of the settings column, under the
 * last section, where it reads as "and here is what changed" rather than competing with
 * Export for the sticky footer.
 */
export function changelogButton(opts: ChangelogButtonOptions): ButtonHandle {
  return button({
    label: opts.label ?? 'Updates',
    /* Secondary, not ghost. A ghost button is transparent on a transparent panel with muted
       text, which reads as a caption rather than a control — reported as "the Updates button
       is not visible". Ghost is right beside something louder that draws the eye first; this
       one stands alone at the foot of a settings column with nothing to be quiet next to. */
    emphasis: 'secondary',
    icon: ICONS.history,
    block: opts.block ?? true,
    onClick: () => openChangelog(opts),
  });
}
