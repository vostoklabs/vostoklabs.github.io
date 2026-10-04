// Model mode's controls: the upload on the right (what the user brings), the cut on the left
// (how it becomes a clicker). Every control is a kit component — `pnpm check:ui` holds that line.
//
// The left rail opens on ONE decision, shown as three pictures of the user's own model already
// cut each way, and under it the one control that makes the chosen result. Everything else waits
// under "More settings" or in a closed section (Ian's rules: pick one, give it your input, export;
// hide what does not apply rather than greying it; one short "?" per control, never a paragraph).
import {
  button,
  buttonGrid,
  collapsibleSection,
  dpad,
  dropZone,
  el,
  filamentRow,
  ICONS,
  inlineDisclosure,
  section,
  segmentedControl,
  sliderRow,
  thumbGrid,
  thumbTile,
  toggleSwitch,
  uploadCta,
  type ThumbTileHandle,
} from '@vostok/ui-kit';
import type { UiState } from './ui';
import type { ButtonShape, CutterKind, ModelCutParams, PlateShape } from '../model/types';
import { MODEL_SAMPLES, sampleById, samplePicture, type SampleId } from '../model/samples';
import { BUTTON_MIN } from '../model/cutButton';
import { assetUrl } from '../assets';

export interface ModelPanelDeps {
  initial: UiState;
  /** A file the user picked or dropped. */
  onFile(file: File): void;
  onSample(id: SampleId): void;
  /** A new set of cut settings. `live` while a slider is still moving. */
  setCut(next: ModelCutParams, live?: boolean): void;
}

export interface ModelPanel {
  /** The upload and the samples, for the right panel. */
  right: HTMLElement;
  /** How it clicks, its one control, More, then Model and Colours — for the left rail. */
  left: HTMLElement;
  /** `sample` is the sample that is loaded, or null for the user's own file (or nothing). */
  update(state: UiState, sample: SampleId | null): void;
  /** A result card's picture, or null while it is being made. */
  setPicture(cutter: CutterKind, src: string | null): void;
}

export function createModelPanel(deps: ModelPanelDeps): ModelPanel {
  let state = deps.initial;
  const cut = () => state.modelCut;
  const set = (patch: Partial<ModelCutParams>, live = false) => deps.setCut({ ...cut(), ...patch }, live);

  // ---- Right: the upload ----
  // The big target while there is nothing of the user's own here (nothing yet, or a sample);
  // once their file is in, the slim row that replaces it, so the samples move up.
  const accept = '.stl,.3mf,.obj,model/stl,model/3mf';
  const onFiles = (files: File[]) => {
    if (files[0]) deps.onFile(files[0]);
  };
  const drop = dropZone({
    title: 'Upload a 3D model',
    text: 'Drop an STL, 3MF or OBJ, or click to browse',
    note: 'Any model — it is cut to fit a switch',
    accept,
    onFiles,
  });
  const replace = uploadCta({ label: 'Replace model', icon: ICONS.upload, accept, onFiles });
  const fileLine = el('p', { className: 'vl-hint' });
  const sampleTiles = new Map<SampleId, ThumbTileHandle>();
  const samples = thumbGrid({
    heading: 'Or try a sample',
    // Three across in the right panel: the pictures are the point, and five fit two rows.
    minPx: 84,
    tiles: MODEL_SAMPLES.map((s) => {
      const tile = thumbTile({
        src: assetUrl(samplePicture(s.id)),
        label: s.label,
        selected: false,
        onClick: () => deps.onSample(s.id),
      });
      sampleTiles.set(s.id, tile);
      return tile;
    }),
  });
  const right = el('div', {}, [drop, replace, fileLine, samples]);

  // ---- Left: how it clicks ----
  // Named for what you get, not for the technique ("Slice" asked a first-timer to already know
  // what slicing a model means), and shown as the thing itself: each card is the user's own
  // model cut that way, drawn by modelMode as the builds land.
  const cutterCards = segmentedControl<CutterKind>({
    variant: 'pictures',
    label: 'How it clicks',
    help: 'Your model, made into a clicker three ways. Pick one.',
    options: [
      { value: 'slice', label: 'Split in two', description: 'The top comes off as the button.' },
      { value: 'stand', label: 'On a stand', description: 'The whole model is the button.' },
      { value: 'button', label: 'Button on top', description: 'A button cut into its top.' },
    ],
    value: deps.initial.modelCut.cutter,
    onChange: (v) => set({ cutter: v }),
  });

  // Split: where it splits. The plane on the model has a grip for the same number.
  const heightRow = sliderRow({
    label: 'Where it splits',
    help: 'Everything above this height is the button.',
    min: 0, max: 100, step: 0.5, unit: 'mm',
    value: deps.initial.modelCut.slice.heightMm ?? 50,
    onInput: (v) => set({ slice: { ...cut().slice, heightMm: v } }, true),
  });
  // On by default, and right under the cut it changes (Ian, 2026-10-01): a gap that shows the
  // switch is the first thing anyone notices about a split clicker. Hidden — not greyed — at a
  // cut the collar does not fit, where the build makes a plain gap.
  const seamToggle = toggleSwitch({
    label: 'Hide the gap',
    help: 'The top sits in a collar, so the switch never shows.',
    checked: deps.initial.modelCut.slice.hideSeam,
    onChange: (on) => set({ slice: { ...cut().slice, hideSeam: on } }),
  });
  const autoHeight = button({
    label: 'Choose the height for me',
    block: true,
    onClick: () => set({ slice: { ...cut().slice, heightMm: null }, switchNudge: { x: 0, y: 0, rotation: cut().switchNudge.rotation } }),
  });
  const seamRow = el('div', { className: 'prow-stacked' }, [seamToggle]);
  const sliceKnob = el('div', {}, [el('div', { className: 'prow-stacked' }, [heightRow]), seamRow, autoHeight]);

  // Stand: what it stands on.
  const plateTabs = segmentedControl<PlateShape>({
    label: 'Plate',
    help: 'What the model stands on. Outline follows its footprint.',
    options: [
      { value: 'circle', label: 'Circle' },
      { value: 'square', label: 'Square' },
      { value: 'outline', label: 'Outline' },
    ],
    value: deps.initial.modelCut.stand.shape,
    onChange: (v) => set({ stand: { ...cut().stand, shape: v } }),
  });
  const standKnob = el('div', { className: 'field' }, [plateTabs]);

  // Button: where it goes (a click on the model) and how big it is.
  const buttonSizeRow = sliderRow({
    label: 'Size',
    help: 'Across the button. The switch goes in through its hole, so it cannot be smaller.',
    min: BUTTON_MIN.square, max: 45, step: 0.5, unit: 'mm',
    value: deps.initial.modelCut.button.sizeMm,
    onInput: (v) => {
      const b = cut().button;
      set({ button: { ...b, sizeMm: Math.max(BUTTON_MIN[b.shape], v) } }, true);
    },
  });
  // Flush or raised is the one look a button has, so it sits with Size rather than under More
  // (Ian, 2026-10-01). `raiseMm` stays the only state — 0 is flush — so a saved project means the
  // same thing as before; Raised remembers its amount for a flip back and forth.
  let lastRaise = deps.initial.modelCut.button.raiseMm > 0 ? deps.initial.modelCut.button.raiseMm : 2;
  const buttonTopTabs = segmentedControl<'flush' | 'raised'>({
    label: 'Button top',
    help: 'Flush sits level with the model. Raised sticks out, easy to feel.',
    options: [
      { value: 'flush', label: 'Flush' },
      { value: 'raised', label: 'Raised' },
    ],
    value: deps.initial.modelCut.button.raiseMm > 0 ? 'raised' : 'flush',
    onChange: (v) => set({ button: { ...cut().button, raiseMm: v === 'flush' ? 0 : lastRaise } }),
  });
  const raiseRow = sliderRow({
    label: 'Sticks out by',
    help: 'How far the button stands above the model at rest.',
    min: 0.5, max: 4, step: 0.25, unit: 'mm',
    value: lastRaise,
    onInput: (v) => {
      lastRaise = v;
      set({ button: { ...cut().button, raiseMm: v } }, true);
    },
  });
  const raiseWrap = el('div', { className: 'prow-stacked' }, [raiseRow]);
  const buttonKnob = el('div', {}, [
    el('p', { className: 'switch-pad-hint', text: 'Click the model where the button goes.' }),
    el('div', { className: 'prow-stacked' }, [buttonSizeRow]),
    el('div', { className: 'field' }, [buttonTopTabs]),
    raiseWrap,
  ]);

  // ---- Left: More, per result ----
  const nudge = (dx: number, dy: number) => {
    const n = cut().switchNudge;
    set({ switchNudge: { ...n, x: n.x + dx, y: n.y + dy } });
  };
  const switchPad = dpad({
    onMove: (d) => nudge(d === 'left' ? -1 : d === 'right' ? 1 : 0, d === 'up' ? 1 : d === 'down' ? -1 : 0),
    onRotate: (deg) => set({ switchNudge: { ...cut().switchNudge, rotation: cut().switchNudge.rotation + deg } }),
    onReset: () => set({ switchNudge: { x: 0, y: 0, rotation: 0 } }),
    rotateStep: 15,
    readout: 'Automatic',
  });
  const sliceMore = el('div', {}, [
    el('p', { className: 'switch-pad-hint', text: 'Move the switch' }),
    switchPad.root,
  ]);

  const marginRow = sliderRow({
    label: 'Margin',
    help: 'How far the plate reaches past the model.',
    min: 0, max: 12, step: 0.5, unit: 'mm',
    value: deps.initial.modelCut.stand.marginMm,
    onInput: (v) => set({ stand: { ...cut().stand, marginMm: v } }, true),
  });
  const standMore = el('div', {}, [el('div', { className: 'prow-stacked' }, [marginRow])]);

  const buttonShapeTabs = segmentedControl<ButtonShape>({
    label: 'Shape',
    options: [
      { value: 'round', label: 'Round' },
      { value: 'square', label: 'Square' },
    ],
    value: deps.initial.modelCut.button.shape,
    onChange: (v) => {
      const b = cut().button;
      set({ button: { ...b, shape: v, sizeMm: Math.max(BUTTON_MIN[v], b.sizeMm) } });
    },
  });
  const buttonNudge = (dx: number, dy: number) => {
    const b = cut().button;
    const at = state.modelMeta?.buttonAt ?? { x: 0, y: 0 };
    set({ button: { ...b, x: (b.x ?? at.x) + dx, y: (b.y ?? at.y) + dy } });
  };
  const buttonPad = dpad({
    onMove: (d) => buttonNudge(d === 'left' ? -1 : d === 'right' ? 1 : 0, d === 'up' ? 1 : d === 'down' ? -1 : 0),
    onRotate: (deg) => set({ switchNudge: { ...cut().switchNudge, rotation: cut().switchNudge.rotation + deg } }),
    onReset: () => set({ button: { ...cut().button, x: null, y: null }, switchNudge: { x: 0, y: 0, rotation: 0 } }),
    rotateStep: 15,
    readout: 'On top',
  });
  const buttonMore = el('div', {}, [
    el('div', { className: 'field' }, [buttonShapeTabs]),
    el('p', { className: 'switch-pad-hint', text: 'Move or turn the button' }),
    buttonPad.root,
  ]);

  const more = inlineDisclosure({
    openLabel: 'More settings',
    closeLabel: 'Fewer settings',
    body: [sliceMore, standMore, buttonMore],
  });

  const cutSection = section({
    title: '',
    body: [el('div', { className: 'field' }, [cutterCards]), sliceKnob, standKnob, buttonKnob, more],
  });

  // ---- Left: the model's size and turn — closed; a model that arrives the right size and
  // the right way up never needs it ----
  const sizeRow = sliderRow({
    label: 'Size',
    help: 'Length of the model’s longest side.',
    min: 20, max: 150, step: 1, unit: 'mm',
    value: deps.initial.modelCut.sizeMm,
    onInput: (v) => {
      // The button's spot is in millimetres, so it scales with the model rather than sliding
      // off it; a nudge of the switch is small enough to leave alone.
      const c = cut();
      const k = v / Math.max(1, c.sizeMm);
      const b = c.button;
      set({
        sizeMm: v,
        button: { ...b, x: b.x === null ? null : b.x * k, y: b.y === null ? null : b.y * k },
        slice: { ...c.slice, heightMm: c.slice.heightMm === null ? null : c.slice.heightMm * k },
      }, true);
    },
  });
  // Turning the model invalidates every position picked on it, so those go back to automatic.
  const turn = (axis: 0 | 1 | 2) => {
    const c = cut();
    const rotation = [...c.rotation] as [number, number, number];
    rotation[axis] = (rotation[axis] + 90) % 360;
    set({
      rotation,
      slice: { ...c.slice, heightMm: null },
      button: { ...c.button, x: null, y: null },
      switchNudge: { x: 0, y: 0, rotation: 0 },
    });
  };
  const turnGrid = buttonGrid({
    columns: 2,
    buttons: [
      button({ label: 'Tip forward', title: 'Turn 90° about X', onClick: () => turn(0) }),
      button({ label: 'Tip sideways', title: 'Turn 90° about Y', onClick: () => turn(1) }),
      button({ label: 'Spin', title: 'Turn 90° about Z', onClick: () => turn(2) }),
      button({
        label: 'Reset',
        title: 'Back to the way the file was saved',
        onClick: () => {
          const c = cut();
          set({
            rotation: [0, 0, 0],
            slice: { ...c.slice, heightMm: null },
            button: { ...c.button, x: null, y: null },
            switchNudge: { x: 0, y: 0, rotation: 0 },
          });
        },
      }),
    ],
  });
  const flattenRow = sliderRow({
    label: 'Flatten bottom',
    help: 'Shave the bottom flat so the clicker stands and prints without support.',
    min: 0, max: 20, step: 0.25, unit: 'mm',
    value: deps.initial.modelCut.flattenMm ?? 0,
    onInput: (v) => set({ flattenMm: v, slice: { ...cut().slice, heightMm: null } }, true),
  });
  const autoFlatten = button({
    label: 'Flatten automatically',
    block: true,
    onClick: () => set({ flattenMm: null }),
  });
  const modelSection = collapsibleSection({
    title: 'Model',
    open: false,
    body: [
      el('div', { className: 'prow-stacked' }, [sizeRow]),
      el('div', { className: 'prow-stacked' }, [flattenRow]),
      autoFlatten,
      turnGrid,
    ],
  });

  // ---- Left: colours ----
  const hex = (rgb: [number, number, number]) =>
    '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const rgb = (h: string): [number, number, number] => [
    parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16),
  ];
  const topColour = filamentRow({
    label: 'Button',
    value: hex(deps.initial.modelCut.colors.top),
    onChange: (h) => set({ colors: { ...cut().colors, top: rgb(h) } }),
  });
  const modelColour = filamentRow({
    label: 'Model',
    value: hex(deps.initial.modelCut.colors.model),
    onChange: (h) => set({ colors: { ...cut().colors, model: rgb(h) } }),
  });
  const bodyColour = filamentRow({
    label: 'Base',
    value: hex(deps.initial.modelCut.colors.body),
    onChange: (h) => set({ colors: { ...cut().colors, body: rgb(h) } }),
  });
  const colourSection = collapsibleSection({
    title: 'Colours',
    open: false,
    body: [topColour, modelColour, bodyColour],
  });

  const left = el('div', {}, [cutSection, modelSection, colourSection]);

  function update(next: UiState, sample: SampleId | null) {
    state = next;
    const c = next.modelCut;
    const meta = next.modelMeta;
    const info = next.modelInfo;

    // The file line: what is loaded, how big, and anything the import had to do to it.
    if (info) {
      const [w, d, h] = meta?.sizeMm ?? info.sizeMm;
      const bits = [
        info.name,
        `${info.triangles.toLocaleString('en')} triangles`,
        `${w.toFixed(0)} × ${d.toFixed(0)} × ${h.toFixed(0)} mm`,
      ];
      fileLine.textContent = bits.join(' · ') + (info.notes.length ? ` — ${info.notes.join(' ')}` : '');
    } else {
      fileLine.textContent = '';
    }
    fileLine.hidden = !info;
    const own = !!info && !sample;
    drop.hidden = own;
    replace.hidden = !own;
    for (const [id, tile] of sampleTiles) tile.setSelected(id === sample);

    cutterCards.setValue(c.cutter);
    sliceKnob.hidden = sliceMore.hidden = c.cutter !== 'slice';
    standKnob.hidden = standMore.hidden = c.cutter !== 'stand';
    buttonKnob.hidden = buttonMore.hidden = c.cutter !== 'button';

    const height = meta?.sizeMm[2] ?? 100;
    // Only the heights the switch fits at: a cut above them has no room for the pocket.
    const range = meta?.cutRangeMm ?? [0, height];
    heightRow.setBounds(Math.ceil(range[0] * 2) / 2, Math.max(Math.ceil(range[0] * 2) / 2 + 0.5, Math.floor(range[1] * 2) / 2));
    heightRow.setValue(c.slice.heightMm ?? meta?.cutHeightMm ?? height / 2);
    // Not for a sample's own height: that cut is the design, and "for me" would only undo it.
    autoHeight.hidden = c.slice.heightMm === null || (!!sample && c.slice.heightMm === sampleById(sample)?.preset.slice?.heightMm);
    seamToggle.setValue(c.slice.hideSeam);
    // Hidden, not greyed, at a cut the collar does not fit: the build makes a plain gap there
    // whichever way the toggle is set, so it would be a switch that does nothing.
    seamRow.hidden = !meta?.canHideSeam;
    {
      const n = c.switchNudge;
      const moved = Math.abs(n.x) >= 0.05 || Math.abs(n.y) >= 0.05;
      const bits: string[] = [];
      if (moved) bits.push(`X ${n.x > 0 ? '+' : ''}${n.x.toFixed(0)} · Y ${n.y > 0 ? '+' : ''}${n.y.toFixed(0)} mm`);
      if (Math.abs(n.rotation) >= 0.5) bits.push(`${n.rotation}°`);
      switchPad.setReadout(bits.length ? bits.join('  ·  ') : 'Automatic');
    }

    plateTabs.setValue(c.stand.shape);
    marginRow.setValue(c.stand.marginMm);
    flattenRow.setValue(c.flattenMm ?? meta?.flattenMm ?? 0);
    autoFlatten.hidden = c.flattenMm === null;

    buttonShapeTabs.setValue(c.button.shape);
    buttonSizeRow.setValue(c.button.sizeMm);
    const raised = c.button.raiseMm > 0;
    buttonTopTabs.setValue(raised ? 'raised' : 'flush');
    raiseWrap.hidden = !raised;
    if (raised) raiseRow.setValue(c.button.raiseMm);
    buttonPad.setReadout(c.button.x === null ? 'On top' : 'Where you clicked');

    sizeRow.setValue(c.sizeMm);
    topColour.setValue(hex(c.colors.top));
    modelColour.setValue(hex(c.colors.model));
    bodyColour.setValue(hex(c.colors.body));
    // The model only has a colour of its own when it stands on a plate; cut, it IS the parts.
    modelColour.hidden = c.cutter !== 'stand';
  }

  return {
    right,
    left,
    update,
    setPicture: (cutter, src) => cutterCards.setOptionImage(cutter, src),
  };
}
