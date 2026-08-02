// First-run magnet setup. Two quick questions — how it sticks, then which magnet
// — so the model is right before the user touches a single slider. Skippable at
// every step, and re-openable from the Magnet section (same flow both times).
import { dialog, el, segmentedControl, svgEl } from '@vostok/ui-kit';
import { MAGNET_PRESETS, type MagnetMode, type MagnetPreset, type MagnetShapeKind, type ProductType, type SliderLayout } from '../types';

export interface WizardResult {
  productType: ProductType;
  sliderLayout?: SliderLayout;
  mode: MagnetMode;
  /** Absent when the user picked the magnetic-sheet route. */
  shape?: MagnetShapeKind;
  /** Absent when the user chose to type their own dimensions. */
  preset?: MagnetPreset;
}

const SHEET_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/></svg>';
const GLUE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="10" rx="2"/><circle cx="12" cy="17.5" r="3.5"/></svg>';
const EMBED_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="3.5"/></svg>';
const MAGNET_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v6a6 6 0 0 0 12 0V3"/><line x1="6" y1="3" x2="6" y2="7"/><line x1="18" y1="3" x2="18" y2="7"/><line x1="6" y1="3" x2="10" y2="3"/><line x1="14" y1="3" x2="18" y2="3"/></svg>';
const SLIDER_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="18" height="7" rx="1.5"/><rect x="4" y="13" width="18" height="7" rx="1.5"/><circle cx="7" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="16.5" r="1" fill="currentColor" stroke="none"/><circle cx="17" cy="16.5" r="1" fill="currentColor" stroke="none"/></svg>';
const DICE4_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="8" cy="16" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.5" fill="currentColor" stroke="none"/></svg>';
const DICE6_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="7" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="7" r="1.5" fill="currentColor" stroke="none"/><circle cx="8" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="8" cy="17" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="17" r="1.5" fill="currentColor" stroke="none"/></svg>';

function choiceCard(icon: string, title: string, detail: string, onPick: () => void): HTMLElement {
  return el('button', { className: 'mg-choice', attrs: { type: 'button' }, on: { click: onPick } }, [
    el('span', { className: 'mg-choice__icon' }, [svgEl(icon)]),
    el('span', { className: 'mg-choice__text' }, [
      el('span', { className: 'mg-choice__title', text: title }),
      el('span', { className: 'mg-choice__detail', text: detail }),
    ]),
  ]);
}

/** Runs the flow. Resolves with the answers, or null if the user skipped out of
 *  the first question (in which case nothing should change). */
export function openMagnetWizard(current: { shape: MagnetShapeKind }): Promise<WizardResult | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: WizardResult | null) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    // --- Step 3: custom dimensions ---
    const askCustomDimensions = (mode: MagnetMode, shape: MagnetShapeKind, pt: ProductType = 'magnet', sl?: SliderLayout) => {
      let submit = false;
      const xInput = el('input', { attrs: { type: 'number', step: '0.1', value: shape === 'disc' ? '10' : '20' } }) as HTMLInputElement;
      const yInput = el('input', { attrs: { type: 'number', step: '0.1', value: '10' } }) as HTMLInputElement;
      const zInput = el('input', { attrs: { type: 'number', step: '0.1', value: '2' } }) as HTMLInputElement;

      const buildField = (label: string, input: HTMLInputElement) => {
        return el('div', { className: 'vl-field mg-num' }, [
          el('label', { text: label }),
          el('div', { className: 'mg-num__input' }, [
            input,
            el('span', { className: 'mg-num__unit', text: 'mm' })
          ]),
        ]);
      };

      const inputs = el('div', { className: 'mg-wizard' }, [
        el('p', { className: 'vl-hint', text: 'Enter the exact dimensions of your magnet in millimeters.' }),
        el('div', { className: 'mg-dims' }, [
          buildField(shape === 'disc' ? 'Diameter' : 'Width', xInput),
          shape === 'block' ? buildField('Length', yInput) : '',
          buildField('Thickness', zInput),
        ])
      ]);

      dialog({
        title: 'Custom dimensions',
        content: inputs,
        onClose: () => {
          if (!submit) finish({ productType: pt, sliderLayout: sl, mode, shape });
        },
        actions: [
          {
            label: 'Confirm',
            primary: true,
            onClick: () => {
              submit = true;
              finish({
                productType: pt,
                sliderLayout: sl,
                mode,
                shape,
                preset: {
                  id: 'custom',
                  shape: shape as any,
                  label: 'Custom size',
                  height: Number(zInput.value) || 2,
                  diameter: shape === 'disc' ? Number(xInput.value) || 10 : undefined,
                  x: shape === 'block' ? Number(xInput.value) || 20 : undefined,
                  y: shape === 'block' ? Number(yInput.value) || 10 : undefined,
                }
              });
            },
          },
        ],
      });
    };

    // --- Step 2: which magnet ---
    const askSize = (mode: MagnetMode, pt: ProductType = 'magnet', sl?: SliderLayout) => {
      let shape: MagnetShapeKind = current.shape;
      let picked = false;
      const grid = el('div', { className: 'mg-preset-grid' });

      const renderPresets = () => {
        grid.replaceChildren(
          ...MAGNET_PRESETS.filter((p) => p.shape === shape).map((p) =>
            el('button', {
              className: 'mg-preset',
              text: p.label,
              attrs: { type: 'button' },
              on: {
                click: () => {
                  picked = true;
                  sizeDialog.close();
                  finish({ productType: pt, sliderLayout: sl, mode, shape, preset: p });
                },
              },
            }),
          ),
        );
      };
      renderPresets();

      const sizeDialog = dialog({
        title: 'Which magnet do you have?',
        content: el('div', { className: 'mg-wizard' }, [
          el('p', {
            className: 'vl-hint',
            text: 'Pick the size you bought — the pocket is cut to match, plus a press-fit gap. Exact dimensions are editable afterwards.',
          }),
          segmentedControl<MagnetShapeKind>({
            options: [
              { value: 'disc', label: 'Disc' },
              { value: 'block', label: 'Block' },
            ],
            value: shape,
            onChange: (v) => {
              shape = v;
              renderPresets();
            },
          }),
          grid,
        ]),
        // Escaping / backdrop still applies the attachment choice they just made.
        onClose: () => {
          if (!picked) finish({ productType: pt, sliderLayout: sl, mode, shape });
        },
        actions: [
          { 
            label: "I'll type my own size",
            onClick: () => {
              picked = true;
              askCustomDimensions(mode, shape, pt, sl);
            }
          }
        ],
      });
    };

    // --- Step 1: how it sticks ---
    const askHowItSticks = () => {
      let advancing = false;
      const pick = (fn: () => void) => {
        advancing = true;
        sticksDialog.close();
        fn();
      };

      const sticksDialog = dialog({
        title: 'How should this magnet stick?',
        content: el('div', { className: 'mg-wizard' }, [
          el('p', {
            className: 'vl-hint',
            text: 'The one thing worth settling before you design. Change it any time in the Magnet section.',
          }),
          el('div', { className: 'mg-wizard-options' }, [
            choiceCard(
              SHEET_ICON,
              'Magnetic sheet',
              'Flat back, no pocket. Stick the print onto adhesive magnetic sheet.',
              () => pick(() => finish({ productType: 'magnet', mode: 'none' })),
            ),
            choiceCard(
              GLUE_ICON,
              'Glue-on magnet',
              'A pocket opens at the back — drop the magnet in and glue it. Strongest hold.',
              () => pick(() => askSize('glue-on', 'magnet')),
            ),
            choiceCard(
              EMBED_ICON,
              'Embedded magnet',
              'Sealed inside. The print pauses once, you drop the magnet in, and it closes over.',
              () => pick(() => askSize('embedded', 'magnet')),
            ),
          ]),
        ]),
        onClose: () => {
          if (!advancing) finish(null);
        },
        actions: [{ label: 'Skip for now' }],
      });
    };

    const askSliderLayout = () => {
      let picked = false;
      const layoutDialog = dialog({
        title: 'How many magnets per side?',
        content: el('div', { className: 'mg-wizard' }, [
          el('p', {
            className: 'vl-hint',
            text: 'Magnets are placed in a dice pattern. Pick 4 (corners) or 6 (two columns of three).',
          }),
          el('div', { className: 'mg-wizard-options' }, [
            choiceCard(
              DICE4_ICON,
              '4 magnets',
              'Placed at the four corners — like a 4 on a die.',
              () => {
                picked = true;
                layoutDialog.close();
                askSize('glue-on', 'slider', 4);
              },
            ),
            choiceCard(
              DICE6_ICON,
              '6 magnets',
              'Two columns of three — like a 6 on a die.',
              () => {
                picked = true;
                layoutDialog.close();
                askSize('glue-on', 'slider', 6);
              },
            ),
          ]),
        ]),
        onClose: () => {
          if (!picked) finish(null);
        },
        actions: [{ label: 'Skip for now' }],
      });
    };

    // --- Step 0: Product type ---
    let advancing = false;
    const pick = (fn: () => void) => {
      advancing = true;
      first.close();
      fn();
    };

    const first = dialog({
      title: 'What do you want to make?',
      content: el('div', { className: 'mg-wizard' }, [
        el('p', {
          className: 'vl-hint',
          text: 'Pick your product — you can change it any time.',
        }),
        el('div', { className: 'mg-wizard-options' }, [
          choiceCard(
            MAGNET_ICON,
            'Fridge magnet',
            'A single piece that sticks to the fridge with a magnet or magnetic sheet.',
            () => pick(() => askHowItSticks()),
          ),
          choiceCard(
            SLIDER_ICON,
            'Magnetic slider',
            'Two sliding pieces held together by magnets — a satisfying fidget widget.',
            () => pick(() => askSliderLayout()),
          ),
        ]),
      ]),
      onClose: () => {
        if (!advancing) finish(null);
      },
      actions: [{ label: 'Skip for now' }],
    });
  });
}
