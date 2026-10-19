import { el } from '../dom';
import { toast } from './toast';
import { isDesktop } from '../host-env';

export interface ExportFormat {
  id: string;
  label: string;
}

export interface ExportPanelOptions {
  formats: ExportFormat[];
  /** Perform the export. Buttons are disabled while the returned promise is pending. */
  onExport: (formatId: string) => Promise<void> | void;
  note?: string;
}

/** Format buttons with busy-state handling. The app owns the actual export logic,
 *  kept behind one function so future export targets (e.g. a host SDK) are a drop-in swap.
 *
 *  Busy is greyed AND spinning. Disabling alone is enough for an export that takes a moment,
 *  but not for one that takes minutes: a keycap set carves sixty-one caps, and a button that
 *  is merely grey reads as refused rather than working. The spinner is a `::before` on the
 *  button so `.textContent = 'Generate set'` — how every generator relabels this button per
 *  mode — cannot wipe it. */
/** Each panel's buttons by format id, for `setExportLabel`. Kept here rather than as an attribute
 *  on the buttons, so a panel nobody relabels is built exactly as it always was. */
const buttonsByFormat = new WeakMap<HTMLElement, Map<string, HTMLButtonElement>>();

/** The export panel inside a wrapper (`sidebarFooter`), remembered when the wrapper is built:
 *  on a phone `appShell` moves the panel out of the footer into its pinned bar, where a search
 *  of the footer no longer finds it. */
const panelOf = new WeakMap<HTMLElement, HTMLElement>();

/** Tell `setExportNote` and `setExportLabel` which export panel a wrapper holds. */
export function ownExportPanel(wrapper: HTMLElement, panel: HTMLElement): void {
  panelOf.set(wrapper, panel);
}

/** The export panel itself, given the panel or a wrapper of it, wherever it now sits. */
function exportHost(panel: HTMLElement): HTMLElement | null {
  if (panel.classList.contains('vl-export')) return panel;
  return panelOf.get(panel) ?? panel.querySelector<HTMLElement>('.vl-export');
}

export function exportPanel(opts: ExportPanelOptions): HTMLElement {
  const buttons: HTMLButtonElement[] = [];
  const byFormat = new Map<string, HTMLButtonElement>();
  const setBusy = (busy: boolean) => {
    for (const b of buttons) {
      b.disabled = busy;
      b.classList.toggle('vl-btn--busy', busy);
      if (busy) b.setAttribute('aria-busy', 'true');
      else b.removeAttribute('aria-busy');
    }
  };

  const row = el('div', { className: 'vl-export__buttons' });
  for (const format of opts.formats) {
    const btn = el('button', {
      className: 'vl-btn vl-btn--primary',
      text: exportLabel(format.label),
      on: {
        click: async () => {
          setBusy(true);
          try {
            await opts.onExport(format.id);
          } catch (err) {
            toast(err instanceof Error ? err.message : 'Export failed', { kind: 'error' });
          } finally {
            setBusy(false);
          }
        },
      },
    });
    buttons.push(btn);
    byFormat.set(format.id, btn as HTMLButtonElement);
    row.append(btn);
  }

  const root = el('div', { className: 'vl-export' }, [row]);
  if (opts.note) root.append(el('p', { className: 'vl-hint', text: opts.note }));
  buttonsByFormat.set(root, byFormat);
  return root;
}

/**
 * Relabel one export button after the panel is built: a count in the words ("Download photo",
 * "Download 8 photos"). Through the same host rule as the first label, so a desktop host still
 * says Export. Pass the panel or the `sidebarFooter` that wraps it, as `setExportNote` takes.
 */
export function setExportLabel(panel: HTMLElement, formatId: string, label: string): void {
  const host = exportHost(panel);
  const btn = host ? buttonsByFormat.get(host)?.get(formatId) : undefined;
  if (btn) btn.textContent = exportLabel(label);
}

/**
 * Replace the note under the export buttons.
 *
 * Here rather than in the app for the reason `setFieldOptions` is here: the note is the
 * panel's own node, and an app that reaches in for `.vl-hint` itself is an app that has to
 * re-derive the kit's class names — the class ladder problem one level down. Pass either the
 * panel or the `sidebarFooter` that wraps it. An empty note removes the line.
 */
export function setExportNote(panel: HTMLElement, note: string): void {
  const host = exportHost(panel);
  if (!host) return;
  let p = host.querySelector<HTMLElement>(':scope > .vl-hint');
  if (!note) {
    p?.remove();
    return;
  }
  if (!p) {
    p = el('p', { className: 'vl-hint' });
    host.append(p);
  }
  p.textContent = note;
}

/**
 * The verb on the button, decided by where the generator is running.
 *
 * "Download" is a browser word. Inside a host the file is not downloaded — it goes to the
 * host's own export path, which is what the status that follows already says. A button and
 * its own result disagreeing is a small thing that makes an app feel like a web page in a
 * window.
 *
 * Decided here rather than at each call site for the same reason `isDesktop()` decides the
 * topbar: four generators passing a different label per host is four chances to forget, and
 * the answer is a property of the host rather than of any one generator.
 */
function exportLabel(label: string): string {
  // A label that is an action of its own ("Generate 6 renders": things to look at before
  // saving any) keeps its verb on every host.
  if (label.startsWith('Generate')) return label;
  if (label.startsWith('Download') || label.startsWith('Export')) {
    return isDesktop() ? label.replace(/^Download/, 'Export') : label;
  }
  return isDesktop() ? `Export ${label}` : `Download ${label}`;
}

/** Standard export-metadata JSON (params + provenance) shared by every generator. */
export function buildExportMetadata(input: {
  generator: string;
  version: string;
  params: Record<string, unknown>;
  extra?: Record<string, unknown>;
}): string {
  return JSON.stringify({
    generator: input.generator,
    version: input.version,
    exportedAt: new Date().toISOString(),
    params: input.params,
    ...input.extra,
  });
}
