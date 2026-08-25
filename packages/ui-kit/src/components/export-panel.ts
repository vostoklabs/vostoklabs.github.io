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
export function exportPanel(opts: ExportPanelOptions): HTMLElement {
  const buttons: HTMLButtonElement[] = [];
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
    row.append(btn);
  }

  const root = el('div', { className: 'vl-export' }, [row]);
  if (opts.note) root.append(el('p', { className: 'vl-hint', text: opts.note }));
  return root;
}

/**
 * The verb on the button, decided by where the generator is running.
 *
 * "Download" is a browser word. Inside a desktop host the file is not downloaded — it is
 * written where the host keeps things and indexed there, which is what the toast that
 * follows already says ("Exported to your library"). A button and its own result
 * disagreeing is a small thing that makes an app feel like a web page in a window.
 *
 * Decided here rather than at each call site for the same reason `isDesktop()` decides the
 * topbar: four generators passing a different label per host is four chances to forget, and
 * the answer is a property of the host rather than of any one generator.
 */
function exportLabel(label: string): string {
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
