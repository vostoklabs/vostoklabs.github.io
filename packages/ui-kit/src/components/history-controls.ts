import { ICONS } from '../icons';
import { iconButton, buttonRow, type ButtonHandle } from './button';

/*
  Undo · Refresh · Redo.

  The clicker has had this row since it grew a history, and it is the shape the product means
  by "undo": three icon buttons, secondary, disabled until there is something to do. The
  carabiner then grew its own — labelled `button()`s reading "Undo / Redo / Reset" — and that
  is the whole failure mode CLAUDE.md describes one level down: two apps, two answers, and
  nothing to keep them in step. So the control is here and both apps call it.

  What it deliberately does NOT own is the history itself. A snapshot stack is a handful of
  lines and every app keeps its own state differently (the clicker snapshots a store, the
  carabiner `JSON.stringify`s one settings object); a kit component that tried to hold both
  would have to know what a "setting" is. This is the row of buttons and the enabled state,
  which is the part that was being re-derived.
*/

export interface HistoryControlsOptions {
  onUndo(): void;
  onRedo(): void;
  /**
   * Back to where the session started. Omit it and the middle button is not built at all —
   * an app whose starting point is simply "the defaults" already has a Reset somewhere and
   * does not need the same action twice under two names.
   */
  onRefresh?(): void;
  /** Overrides for the tooltips, e.g. when the shortcut differs. */
  labels?: { undo?: string; redo?: string; refresh?: string };
}

export type HistoryControlsHandle = HTMLElement & {
  /** Drive the three enabled states from wherever the history lives. */
  setState(state: { canUndo: boolean; canRedo: boolean; canRefresh?: boolean }): void;
};

export function historyControls(opts: HistoryControlsOptions): HistoryControlsHandle {
  const undo = iconButton({
    icon: ICONS.undo,
    label: opts.labels?.undo ?? 'Undo (Ctrl+Z)',
    emphasis: 'secondary',
    disabled: true,
    onClick: () => opts.onUndo(),
  });
  const redo = iconButton({
    icon: ICONS.redo,
    label: opts.labels?.redo ?? 'Redo (Ctrl+Shift+Z)',
    emphasis: 'secondary',
    disabled: true,
    onClick: () => opts.onRedo(),
  });
  let refresh: ButtonHandle | null = null;
  if (opts.onRefresh) {
    refresh = iconButton({
      icon: ICONS.rotateRight,
      label: opts.labels?.refresh ?? 'Refresh to original',
      emphasis: 'secondary',
      disabled: true,
      onClick: () => opts.onRefresh!(),
    });
  }

  const row = (refresh ? buttonRow(undo, refresh, redo) : buttonRow(undo, redo)) as HistoryControlsHandle;
  row.setState = ({ canUndo, canRedo, canRefresh }) => {
    undo.setDisabled(!canUndo);
    redo.setDisabled(!canRedo);
    refresh?.setDisabled(!canRefresh);
  };
  return row;
}
