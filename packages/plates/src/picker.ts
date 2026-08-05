// The build-plate dropdown that floats in the corner of a generator's preview.
// Plain DOM on the ui-kit's CSS variables — no framework, no ui-kit import, so
// dropping it into a generator is one `append`.
import { PLATES, plateLabel, loadPlateChoice, savePlateChoice, type PlateChoice } from './registry';

export interface PlatePickerOptions {
  /** Selection to show on mount. */
  value: PlateChoice;
  /** Fired on pick (not on mount). */
  onChange: (choice: PlateChoice) => void;
}

export interface PlatePicker {
  /** Append this to the stage. */
  readonly root: HTMLElement;
  /** Reflect a choice made elsewhere. Does not fire `onChange`. */
  setValue(choice: PlateChoice): void;
  destroy(): void;
}

const PLATE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="3" y="4.5" width="18" height="13" rx="1.5"/><path d="M9 20.5h6"/><path d="M3 9h18"/><path d="M9 4.5v13"/></svg>';

export function platePicker(opts: PlatePickerOptions): PlatePicker {
  let value = opts.value;

  const label = document.createElement('span');
  label.className = 'vl-plate-picker__label';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'vl-plate-picker__btn';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.title = 'Build plate shown under the model';
  button.innerHTML = PLATE_ICON;
  button.append(label);
  const caret = document.createElement('span');
  caret.className = 'vl-plate-picker__caret';
  caret.setAttribute('aria-hidden', 'true');
  button.append(caret);

  const menu = document.createElement('div');
  menu.className = 'vl-plate-picker__menu';
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;

  const root = document.createElement('div');
  root.className = 'vl-plate-picker';
  root.append(button, menu);

  const options: { choice: PlateChoice; el: HTMLButtonElement }[] = [];

  function addOption(choice: PlateChoice, title: string, sub: string) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'vl-plate-picker__item';
    item.setAttribute('role', 'option');
    const t = document.createElement('span');
    t.className = 'vl-plate-picker__item-title';
    t.textContent = title;
    const s = document.createElement('span');
    s.className = 'vl-plate-picker__item-sub';
    s.textContent = sub;
    item.append(t, s);
    item.addEventListener('click', () => {
      close();
      if (choice === value) return;
      setValue(choice);
      opts.onChange(choice);
    });
    options.push({ choice, el: item });
    menu.append(item);
  }

  for (const p of PLATES) addOption(p.id, p.name, p.details);
  addOption('grid', 'No plate', 'Plain reference grid');

  function syncSelection() {
    label.textContent = plateLabel(value);
    for (const o of options) {
      const on = o.choice === value;
      o.el.classList.toggle('is-selected', on);
      o.el.setAttribute('aria-selected', String(on));
    }
  }

  function open() {
    menu.hidden = false;
    root.classList.add('is-open');
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey);
  }

  function close() {
    menu.hidden = true;
    root.classList.remove('is-open');
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey);
  }

  const onOutside = (e: Event) => {
    if (!root.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
      button.focus();
    }
  };

  button.addEventListener('click', () => (menu.hidden ? open() : close()));

  function setValue(choice: PlateChoice) {
    value = choice;
    syncSelection();
  }
  syncSelection();

  return {
    root,
    setValue,
    destroy() {
      close();
      root.remove();
    },
  };
}

/** Anything that can swap its floor — every generator's viewer. */
export interface PlateAwareViewer {
  setPlate(choice: PlateChoice): void;
}

/** The whole app-side wiring in one call: mount the picker on the stage, start
 *  from the shared preference, and persist every pick.
 *
 *  `stage` must be a positioned element (the ui-kit's `.vl-stage` is), since the
 *  picker floats in its top-right corner. */
export function mountPlatePicker(stage: HTMLElement, viewer: PlateAwareViewer): PlatePicker {
  const picker = platePicker({
    value: loadPlateChoice(),
    onChange: (choice) => {
      savePlateChoice(choice);
      viewer.setPlate(choice);
    },
  });
  stage.append(picker.root);
  return picker;
}
