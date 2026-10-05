import { el } from '../dom';
import type { Diagnostic } from '../diagnostics';

export interface DiagnosticsList {
  root: HTMLElement;
  /** Show these, every one, in the order given. An empty list hides the block. */
  set(list: readonly Diagnostic[]): void;
}

/**
 * Every diagnostic a build found, one quiet card each: what is wrong, then what to do about it.
 *
 * The status line carries the worst one (`stageStatus().setDiagnostics`); this carries all of
 * them, so none is ever hidden behind the first. It sits in the product panel, under the readout
 * it explains. A list, so a screen reader says how many there are before reading them.
 */
export function diagnosticsList(): DiagnosticsList {
  // `role="list"` because `list-style: none` makes Safari drop a <ul>'s list semantics.
  const root = el('ul', { className: 'vl-diagnostics', attrs: { role: 'list' } });
  root.hidden = true;
  return {
    root,
    set(list) {
      root.replaceChildren(
        ...list.map((d) =>
          el('li', { className: `vl-diag vl-diag--${d.level}` }, [
            el('div', { className: 'vl-diag__msg', text: d.message }),
            ...(d.fix ? [el('div', { className: 'vl-diag__fix', text: d.fix })] : []),
          ]),
        ),
      );
      root.hidden = list.length === 0;
    },
  };
}
