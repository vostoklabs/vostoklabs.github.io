import { el } from '../dom';
import { exportPanel, type ExportFormat } from './export-panel';
import { projectActions } from './generator-chrome';

/* Standard right-sidebar sticky footer used by every Vostok generator.
   Combines an export panel (Download 3MF etc.) with project actions
   (Save / Load / Help / Light-mode) in a single sticky block that
   pins to the bottom of the scrolling sidebar. */

export interface SidebarFooterOptions {
  /** Export formats forwarded to `exportPanel()`. */
  formats: ExportFormat[];
  /** Export handler forwarded to `exportPanel()`. */
  onExport: (formatId: string) => Promise<void> | void;
  /** Optional note below the export buttons. */
  exportNote?: string;

  /** Serialize + download the current project. */
  onSave: () => void;
  /** Load a project file the user picked. */
  onLoad: (file: File) => void;
  /** Show help / intro dialog. Omit to hide the Help button. */
  onHelp?: () => void;
  /** Include the light/dark toggle (default true). */
  theme?: boolean;
  /** localStorage key for the theme toggle. */
  themeStorageKey?: string;

  /** Extra elements to append after the project actions (e.g. a share button). */
  extra?: HTMLElement[];
}

/**
 * The standard sticky footer for the right sidebar: export button(s) on top,
 * then Save / Load / Help / Light-mode buttons underneath. Drop this at the
 * bottom of any generator's right sidebar.
 */
export function sidebarFooter(opts: SidebarFooterOptions): HTMLElement {
  const ep = exportPanel({
    formats: opts.formats,
    onExport: opts.onExport,
    note: opts.exportNote,
  });

  const pa = projectActions({
    onSave: opts.onSave,
    onLoad: opts.onLoad,
    onHelp: opts.onHelp,
    theme: opts.theme,
    themeStorageKey: opts.themeStorageKey,
  });

  const children: (HTMLElement | Node)[] = [ep, pa];
  if (opts.extra) children.push(...opts.extra);

  return el('div', { className: 'vl-sidebar-footer' }, children);
}
