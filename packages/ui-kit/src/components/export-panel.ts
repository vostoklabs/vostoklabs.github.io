import { el } from '../dom';
import { toast } from './toast';

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

/** Format buttons with busy-state handling. The app owns the actual export logic
 *  (kept behind one function per app, see CLAUDE.md invariant 8). */
export function exportPanel(opts: ExportPanelOptions): HTMLElement {
  const buttons: HTMLButtonElement[] = [];
  const setBusy = (busy: boolean) => {
    for (const b of buttons) b.disabled = busy;
  };

  const row = el('div', { className: 'vl-export__buttons' });
  for (const format of opts.formats) {
    const btn = el('button', {
      className: 'vl-btn vl-btn--primary',
      text: `Export ${format.label}`,
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
