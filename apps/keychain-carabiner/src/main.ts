import '@vostok/ui-kit/styles.css';
import '@vostok/plates/plates.css';
import '@vostok/fonts/fonts.css';
import './style.css';

import {
  appShell,
  topbarLinks,
  generatorHeader,
  qualityCallout,
  sidebarFooter,
  section,
  collapsibleSection,
  stageStatus,
  modeBar,
  sliderRow,
  stepperRow,
  segmentedControl,
  selectField,
  toggleSwitch,
  button,
  buttonGrid,
  historyControls,
  thumbTile,
  thumbGrid,
  drawer,
  symbolPickerButton,
  paletteRow,
  panelCredit,
  busyChip,
  readParamsFromHash,
  toast,
  dialog,
  openLicenseModal,
  licenseReminderToast,
  ICONS,
  el,
  type ThumbTileHandle,
} from '@vostok/ui-kit';
import { BRAND } from '@vostok/brand';
import { createViewer } from '@vostok/viewer';
import { mountPlatePicker, plateSize, loadPlateChoice } from '@vostok/plates';
import { downloadThreeMF, type ExportPart } from '@vostok/export';
import {
  iconById,
  type IconChoice,
  getFont,
  FALLBACK_FONT_ID,
  fontFamilyFor,
  pathCommandsToPolygons,
} from '@vostok/fonts';
import {
  DEFAULT_SETTINGS, coerceSettings, hexToRgb, rgbToHex, SHAPE_ICON_PREFIX, PIP_ASPECT,
  type SetSettings, type RGB, type Attach, type CharmMount, type GateFit, type CharmFill, type CharmIconStyle, type EdgeStyle,
  type ChainMode, type PipAspect, type PipRoot,
} from './state';
import { PIP_Z_GAP, pipGeometry, pipLevels } from './geometry/pipChain';
import { geomOf, shapeById, shapeGroups, thumbOf, loadSvgShapes, type ShapeDef } from './shapes';
import { usableSymbols, PREFERRED_IDS, type UsableSymbols } from './usableSymbols';
import { centroid, frameAt, radialAt, tAtAngle } from './shapes/ring';
import { SWIVEL_MIN_THICK } from './geometry/buildSet';
import { SYMBOL_GROUPS, searchGroup } from './symbols';
import { CHANGELOG } from './changelog';
import type { ChainInfo, GeometryResponse, HookFrame, PartMesh } from './types';

/*
  Keychain Carabiner Set.

  What it is for: a hook and a chain to hang something on — a clicker, keys, a bag. The
  charm is an extra. So the panel reads in that order: hook, the symbol on it, the chain, and
  only then a charm you can switch on. Each section carries its own colour, next to the thing
  it colours, and the numbers nobody changes twice live under a "Fine tune" fold.

  Layout, chrome and export are the house pattern (see apps/generator-template). What is
  specific here:

    - every shape is a silhouette the geometry turns into a band, so the tiles are drawn
      from the same points the model is built from;
    - symbols are either the shape library's own silhouettes (the clean ones) or Font
      Awesome glyphs, traced on THIS thread and handed to the worker as contours;
    - the symbol on the hook is placed by dragging it on the model. While the pointer is
      down the mesh slides; the rebuild happens once, on release;
    - two views of the same parts: the set hanging as worn, and the print layout;
    - the geometry (`src/geometry/`, `src/shapes/`) imports nothing from this file, so it can
      be lifted into another host as a unit.
*/

// ---------------------------------------------------------------------------
// 1. STATE
// ---------------------------------------------------------------------------
let settings: SetSettings = { ...DEFAULT_SETTINGS };
const shared = readParamsFromHash();
if (shared) settings = coerceSettings({ ...settings, ...shared });

type View = 'assembled' | 'print';
// Typed wide on purpose: it is reassigned from the mode bar's callback, which control flow
// cannot see, and a literal here narrows every later comparison to "always false".
let view = 'assembled' as View;

/** The print layout — what exports. */
let parts: ExportPart[] = [];
/** The assembled layout — preview only. */
let assembled: ExportPart[] = [];
let hookFrame: HookFrame | null = null;
/** How the chain hangs in the assembled layout; what the dangle animates. */
let chain: ChainInfo | null = null;
let downloads = 0;

const shown = () => (view === 'print' ? parts : assembled);

/**
 * The model point the viewer holds still: the hook's centre. Without it the viewer centres
 * the bounding box on every rebuild, so adding a link shifted the hook — the one thing the
 * user is looking at — and in the hanging view a longer chain pushed it up the screen.
 */
function anchor(): [number, number, number] | undefined {
  if (!hookFrame) return undefined;
  const c = centroid(hookFrame.ring);
  return view === 'print'
    ? [c[0] + hookFrame.printOffset[0], c[1] + hookFrame.printOffset[1], 0]
    : [c[0] + hookFrame.assembledOffset[0], -hookFrame.thick / 2, c[1] + hookFrame.assembledOffset[1]];
}

// ---------------------------------------------------------------------------
// 2. WORKER — every boolean happens over there.
// ---------------------------------------------------------------------------
const worker = new Worker(new URL('./workers/geometry.worker.ts', import.meta.url), { type: 'module' });

let workerBusy = false;
let dirty = false;
let firstBuild = true;
let rebuildTimer: ReturnType<typeof setTimeout> | undefined;

/** Resolves once no build is running or queued — so an export never ships the previous
 *  build because the click came a beat after the slider. */
const settleWaiters: (() => void)[] = [];
function settled(): Promise<void> {
  return workerBusy || dirty ? new Promise((r) => settleWaiters.push(r)) : Promise.resolve();
}
function releaseWaiters() {
  for (const r of settleWaiters.splice(0)) r();
}

function triggerRebuild() {
  // Every geometry change comes through here, which makes it the one place undo has to hook.
  commitHistory();
  dirty = true;
  if (workerBusy) return;
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(runRebuild, 90);
}

/** A symbol's outline: one of the shape library's silhouettes, or a glyph traced from the
 *  icon font. Both arrive as plain polygons; the worker fits them to a size. */
function symbolContours(font: any, id: string): number[][][] {
  if (!id) return [];
  if (id.startsWith(SHAPE_ICON_PREFIX)) {
    const shape = shapeById(id.slice(SHAPE_ICON_PREFIX.length));
    return [shape.ring.map(([x, y]) => [x * 100, y * 100])];
  }
  const icon = iconById(id);
  if (!icon || !font) return [];
  const glyph = font.charToGlyph(icon.char);
  if (!glyph) return [];
  return pathCommandsToPolygons(glyph.getPath(0, 0, 100).commands);
}

async function runRebuild() {
  if (!dirty) return;
  dirty = false;
  workerBusy = true;
  // The preview is the last frame until the worker answers, and a still picture looks like
  // a stall. The chip says work is happening; it goes away with the parts.
  busy.show('generating…');
  try {
    const font = await getFont(FALLBACK_FONT_ID);
    worker.postMessage({
      type: 'build',
      params: {
        ...settings,
        hookGeom: geomOf(settings.hookShape),
        linkGeom: geomOf(settings.linkShape),
        charmGeom: geomOf(settings.charmShape),
        iconContours: symbolContours(font, settings.icon),
        charmIconContours: symbolContours(font, settings.charmIcon),
        plate: plateSize(loadPlateChoice()),
      },
    });
  } catch (err) {
    workerBusy = false;
    busy.hide();
    status.set(err instanceof Error ? err.message : 'Could not prepare the build', 'error');
  }
}

worker.onmessage = (e: MessageEvent<GeometryResponse>) => {
  const msg = e.data;
  if (msg.type === 'ready') {
    workerBusy = false;
    triggerRebuild();
    return;
  }
  if (msg.type === 'parts') {
    workerBusy = false;
    if (!dirty) busy.hide(); // another build is queued: keep the chip up rather than blink it
    if (!dirty) releaseWaiters();
    parts = msg.parts as PartMesh[] as ExportPart[];
    assembled = msg.assembled as PartMesh[] as ExportPart[];
    hookFrame = msg.hookFrame;
    chain = msg.chain;
    // The worker paints by part; "one colour" is applied here, so it never rebuilds.
    for (const list of [parts, assembled]) for (const part of list) part.color = effectiveColor(part.name);
    viewer.setParts(shown(), firstBuild, anchor());
    firstBuild = false;
    simReset();
    const [w, d, h] = msg.stats.size;
    const warn = msg.warnings[0];
    status.set(warn ?? `${w.toFixed(0)} × ${d.toFixed(0)} × ${h.toFixed(1)} mm on the plate`, warn ? 'warn' : 'idle');
    if (dirty) runRebuild();
    return;
  }
  if (msg.type === 'error') {
    workerBusy = false;
    busy.hide();
    releaseWaiters();
    console.error(msg.message);
    status.set('Could not build the model — see the console.', 'error');
  }
};

// ---------------------------------------------------------------------------
// 3. SETTINGS (left panel)
// ---------------------------------------------------------------------------

/** The shape's silhouette as an inline SVG string, for a button icon. */
function shapeIcon(s: ShapeDef): string {
  // Sized in the markup: an inline SVG with only a viewBox fills whatever it is put in, and
  // the first cut of this was a shape the height of the panel with the name pushed off the end.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="20" height="20" aria-hidden="true"><path d="${thumbOf(s)}" fill="currentColor"/></svg>`;
}

/**
 * A shape field: the current shape as a button, and a drawer of every shape, grouped, when it
 * is pressed. The clicker's picker, simplified — with twenty-odd shapes, three inline grids
 * were most of the panel.
 *
 * The drawer opens at the right edge, OVER the right panel, which is the point: the model
 * stays in view and keeps rebuilding while the grid is up. An inline version of this — the
 * grid expanding under the field — was tried and rejected: it pushes the rest of the panel
 * down by four hundred pixels and buries the controls you were about to use.
 */
function shapeField(label: string, get: () => string, set: (id: string) => void) {
  const holder = el('div', { className: 'kc-shape-field' });
  const root = el('div', { className: 'vl-field' }, [el('label', { text: label }), holder]);
  const render = () => {
    const s = shapeById(get());
    holder.replaceChildren(button({ label: s.name, icon: shapeIcon(s), emphasis: 'secondary', block: true, onClick: open }));
  };
  const open = () => {
    const content = el('div', { className: 'kc-shape-drawer' });
    let handle: { close(): void } | null = null;
    for (const g of shapeGroups()) {
      content.append(thumbGrid({
        heading: g.label,
        minPx: 56,
        tiles: g.shapes.map((s) => thumbTile({
          svgPath: thumbOf(s),
          label: s.name,
          selected: s.id === get(),
          onClick: () => {
            set(s.id);
            handle?.close();
            render();
            triggerRebuild();
          },
        })),
      }));
    }
    handle = drawer({ title: label, content });
  };
  render();
  return { root, render, sync: render };
}

/** The silhouettes offered as symbols before any glyph: the clean ones. */
// Four that read as four at 40 px: the flower looked like a second star.
const SHAPE_SYMBOLS = ['heart', 'star', 'diamond', 'skull'];

/** The glyphs that make a symbol — filled in once the font is parsed. Until then, none: the
 *  shape library's silhouettes are the first row anyway. */
let usable: UsableSymbols = { list: [], has: () => false };
const usableList: IconChoice[] = [];
const quickGlyphs = (): IconChoice[] => {
  const out: IconChoice[] = [];
  // A glyph that is also one of the silhouettes above (the star, the heart) is not offered
  // twice; the silhouette is the cleaner of the two.
  const shown = new Set(SHAPE_SYMBOLS);
  const take = (icon: IconChoice | null) => {
    if (icon && !out.includes(icon) && !shown.has(icon.id) && !shown.has(icon.label.toLowerCase())) out.push(icon);
  };
  for (const id of PREFERRED_IDS) { if (out.length >= 7) break; take(usable.has(id) ? (iconById(id) ?? null) : null); }
  for (const icon of usable.list) { if (out.length >= 7) break; take(icon); }
  return out;
};
const quickRows: (() => void)[] = [];

/** What the symbol is called, whichever library it came from. */
function symbolLabel(id: string): string {
  if (!id) return 'No symbol';
  if (id.startsWith(SHAPE_ICON_PREFIX)) return shapeById(id.slice(SHAPE_ICON_PREFIX.length)).name;
  return iconById(id)?.label ?? id;
}

/**
 * Pick a symbol: the shape library's silhouettes first, then the dozen glyphs people
 * actually want, then the way into the whole set. Nothing here places it — that is the drag.
 */
function symbolChooser(get: () => string, set: (id: string) => void) {
  const nameEl = el('span', { className: 'kc-icon-current__name' });
  const current = el('div', { className: 'kc-icon-current' }, [nameEl]);

  const quick = el('div', { className: 'kc-quick' });
  const tiles = new Map<string, ThumbTileHandle>();
  const glyphButtons = new Map<string, HTMLButtonElement>();
  const renderQuick = () => {
    quick.replaceChildren();
    tiles.clear();
    glyphButtons.clear();

    for (const id of SHAPE_SYMBOLS) {
      const shape = shapeById(id);
      const full = SHAPE_ICON_PREFIX + id;
      const tile = thumbTile({
        svgPath: thumbOf(shape),
        label: shape.name,
        selected: get() === full,
        className: 'kc-quick__tile',
        onClick: () => {
          set(full);
          sync();
          triggerRebuild();
        },
      });
      tiles.set(full, tile);
      quick.append(tile);
    }
    for (const icon of quickGlyphs()) {
      const btn = button({
        label: icon.char,
        className: 'kc-quick__btn',
        title: icon.label,
        onClick: () => {
          set(icon.id);
          sync();
          triggerRebuild();
        },
      });
      btn.setAttribute('aria-label', icon.label);
      btn.setAttribute('aria-pressed', String(icon.id === get()));
      glyphButtons.set(icon.id, btn);
      quick.append(btn);
    }
  };
  renderQuick();
  quickRows.push(renderQuick);

  // A font that failed once gets another go when someone reaches for the glyphs.
  const more = symbolPickerButton({
    items: usableList,
    categories: SYMBOL_GROUPS.map((g) => ({ id: g.id, label: g.id === 'all' ? 'Everything' : g.label })),
    defaultCategory: 'popular',
    fontFamily: fontFamilyFor(FALLBACK_FONT_ID),
    search: (q, cat) => searchGroup(q, cat).filter((i) => usable.has(i.id)),
    onPick: (item) => {
      set(item.id);
      sync();
      triggerRebuild();
    },
    label: 'More symbols…',
    className: 'vl-btn vl-btn--secondary vl-btn--block',
    title: 'Choose a symbol',
    hint: 'Only the symbols that are one solid shape — the ones that print as a symbol.',
  });

  more.addEventListener('pointerdown', () => { void loadGlyphs(); }, true);

  const sync = () => {
    nameEl.textContent = symbolLabel(get());
    for (const [id, t] of tiles) t.setSelected(id === get());
    for (const [id, b] of glyphButtons) b.setAttribute('aria-pressed', String(id === get()));
  };
  sync();
  return { root: el('div', {}, [current, quick, more]), sync };
}

const hookShapes = shapeField('Hook shape', () => settings.hookShape, (id) => (settings.hookShape = id));
const linkShapes = shapeField('Link shape', () => settings.linkShape, (id) => (settings.linkShape = id));
const charmShapes = shapeField('Charm shape', () => settings.charmShape, (id) => (settings.charmShape = id));
const hookSymbol = symbolChooser(() => settings.icon, (id) => { settings.icon = id; if (id) lastIcon = id; syncVisibility(); });
const charmSymbol = symbolChooser(() => settings.charmIcon, (id) => (settings.charmIcon = id));

type ColorKey = 'hookColor' | 'iconColor' | 'linkColor' | 'charmColor';

/** Which colour a built part wears, by its name. The swivel's ring is part of the hook. */
function colorKeyOf(name: string): ColorKey {
  if (name === 'Symbol' || name === 'Charm symbol') return 'iconColor';
  if (name.startsWith('Link') || name.startsWith('Connector')) return 'linkColor';
  if (name === 'Charm') return 'charmColor';
  return 'hookColor';
}

/** Every colour row, by the colour it sets. The link colour has two rows — one in each
 *  chain section — so a change in one has to reach the other. */
const colorRows: Record<ColorKey, ReturnType<typeof paletteRow>[]> = { hookColor: [], iconColor: [], linkColor: [], charmColor: [] };

/** The colour a built part wears once the rules are applied: its own, or the hook's when
 *  everything is one colour. */
function effectiveColor(name: string): RGB {
  return settings.oneColor ? settings.hookColor : settings[colorKeyOf(name)];
}

/** Repaint every part in both layouts and on the stage — no geometry rebuild. */
function applyColors() {
  // A colour is a setting like any other, and it is the one change that never reaches
  // `triggerRebuild` — so undo has to be told about it here or the palette is outside history.
  commitHistory();
  for (const list of [parts, assembled]) for (const part of list) part.color = effectiveColor(part.name);
  shown().forEach((part, i) => viewer.setPartColor(i, part.color as RGB));
}

/** A colour row on the right panel. Recolours in place — no geometry rebuild — and both
 *  layouts carry the change so the export has it too. */
function colorRow(label: string, key: ColorKey) {
  const row = paletteRow({
    label,
    value: rgbToHex(settings[key]),
    onChange: (hex) => {
      settings[key] = hexToRgb(hex);
      for (const other of colorRows[key]) if (other !== row) other.setValue(hex);
      applyColors();
    },
  });
  colorRows[key].push(row);
  return row;
}

const colors = {
  hookColor: colorRow('Hook', 'hookColor'),
  iconColor: colorRow('Symbol', 'iconColor'),
  linkColor: colorRow('Chain', 'linkColor'),
  charmColor: colorRow('Charm', 'charmColor'),
};
const oneColorToggle = toggleSwitch({
  label: 'One colour for everything',
  checked: settings.oneColor,
  onChange: (on) => { settings.oneColor = on; syncVisibility(); applyColors(); },
});

const controls = {
  // Hook
  hookSize: sliderRow({
    label: 'Size', min: 25, max: 70, step: 1, value: settings.hookSize, defaultValue: DEFAULT_SETTINGS.hookSize, unit: 'mm',
    help: 'The long side. Shop-bought clips are 35–46 mm.',
    onInput: (v) => { settings.hookSize = v; triggerRebuild(); },
  }),
  attach: selectField({
    label: 'Hangs the chain by',
    options: [
      // Short enough to fit the field. The long versions ("A swivel — prints in place, turns",
      // "Nothing — just the hook; a connector ring goes through it") ran past the caret and
      // ellipsised, which is what "the right side of the panel is cut off" looked like on a
      // narrow window. What they explained is in the help tip below, where there is room.
      { value: 'swivel', label: 'A swivel — it turns' },
      { value: 'loop', label: 'A plain loop' },
      { value: 'none', label: 'Nothing — a ring through the hook' },
    ],
    value: settings.attach,
    help: `The swivel needs the hook at least ${SWIVEL_MIN_THICK} mm thick. If your printer fuses it, choose the loop.`,
    onChange: (v) => setAttach(v as Attach),
  }),
  swivelStem: sliderRow({
    label: 'Swivel stem', min: 2.4, max: 6, step: 0.2, value: settings.swivelStem, defaultValue: DEFAULT_SETTINGS.swivelStem, unit: 'mm',
    help: 'The pin the chain hangs from — the one thing holding all of it. Thicker is stronger and needs a thicker hook: about 2 mm more than the stem.',
    onInput: (v) => { settings.swivelStem = v; triggerRebuild(); },
  }),
  hookBar: sliderRow({
    label: 'Bar width', min: 2.5, max: 6, step: 0.1, value: settings.hookBar, defaultValue: DEFAULT_SETTINGS.hookBar, unit: 'mm',
    onInput: (v) => { settings.hookBar = v; triggerRebuild(); },
  }),
  hookThick: sliderRow({
    label: 'Thickness', min: 3, max: 8, step: 0.5, value: settings.hookThick, defaultValue: DEFAULT_SETTINGS.hookThick, unit: 'mm',
    onInput: (v) => { settings.hookThick = v; triggerRebuild(); },
  }),
  gateFit: segmentedControl<GateFit>({
    label: 'Gate',
    options: [
      { value: 'soft', label: 'Soft' },
      { value: 'normal', label: 'Normal' },
      { value: 'firm', label: 'Firm' },
    ],
    value: settings.gateFit,
    help: 'How wide the gate cut is. Firm is the snappiest and the first to fuse on an over-extruding printer.',
    onChange: (v) => { settings.gateFit = v; triggerRebuild(); },
  }),
  loopBar: sliderRow({
    label: 'Loop bar', min: 1.5, max: 4, step: 0.1, value: settings.loopBar, defaultValue: DEFAULT_SETTINGS.loopBar, unit: 'mm',
    help: 'Bar of every loop — the hook’s, the charm’s and the swivel ring’s. Each loop’s opening is sized automatically to what passes through it.',
    onInput: (v) => { settings.loopBar = v; triggerRebuild(); },
  }),

  // Symbol
  iconRotate: sliderRow({
    label: 'Turn', min: -180, max: 180, step: 5, value: settings.iconRotate, defaultValue: DEFAULT_SETTINGS.iconRotate, unit: '°',
    onInput: (v) => { settings.iconRotate = v; triggerRebuild(); },
  }),
  iconRaise: sliderRow({
    label: 'Raise the symbol', min: 0, max: 4, step: 0.2, value: settings.iconRaise, defaultValue: DEFAULT_SETTINGS.iconRaise, unit: 'mm',
    help: 'How far the symbol stands above the hook’s face. 0 is a flush inlay.',
    onInput: (v) => { settings.iconRaise = v; triggerRebuild(); },
  }),
  iconSize: sliderRow({
    label: 'Size', min: 4, max: 20, step: 0.5, value: settings.iconSize, defaultValue: DEFAULT_SETTINGS.iconSize, unit: 'mm',
    onInput: (v) => { settings.iconSize = v; triggerRebuild(); },
  }),
  iconAngle: sliderRow({
    label: 'Around the hook', min: 0, max: 360, step: 1, value: settings.iconAngle, defaultValue: DEFAULT_SETTINGS.iconAngle, unit: '°',
    onInput: (v) => { settings.iconAngle = v; triggerRebuild(); },
  }),
  iconOffset: sliderRow({
    label: 'In / out', min: -6, max: 6, step: 0.5, value: settings.iconOffset, defaultValue: DEFAULT_SETTINGS.iconOffset, unit: 'mm',
    onInput: (v) => { settings.iconOffset = v; triggerRebuild(); },
  }),

  // Chain
  linkCount: stepperRow({
    label: 'Links', min: 0, max: 12, step: 1, value: settings.linkCount, defaultValue: DEFAULT_SETTINGS.linkCount,
    onInput: (v) => { settings.linkCount = v; triggerRebuild(); },
  }),
  linkSize: sliderRow({
    label: 'Link size', min: 8, max: 40, step: 1, value: settings.linkSize, defaultValue: DEFAULT_SETTINGS.linkSize, unit: 'mm',
    onInput: (v) => { settings.linkSize = v; triggerRebuild(); },
  }),
  linkBar: sliderRow({
    label: 'Bar width', min: 2, max: 5, step: 0.1, value: settings.linkBar, defaultValue: DEFAULT_SETTINGS.linkBar, unit: 'mm',
    onInput: (v) => { settings.linkBar = v; triggerRebuild(); },
  }),
  linkThick: sliderRow({
    label: 'Thickness', min: 3, max: 7, step: 0.5, value: settings.linkThick, defaultValue: DEFAULT_SETTINGS.linkThick, unit: 'mm',
    onInput: (v) => { settings.linkThick = v; triggerRebuild(); },
  }),
  connectorExtra: sliderRow({
    label: 'Connector ring room', min: 0, max: 8, step: 0.5, value: settings.connectorExtra, defaultValue: DEFAULT_SETTINGS.connectorExtra, unit: 'mm',
    help: 'Extra opening in the connector rings beyond what has to pass through them, so they swing freely.',
    onInput: (v) => { settings.connectorExtra = v; pipControls.connectorExtra.setValue(v); triggerRebuild(); },
  }),
  connectorRings: stepperRow({
    label: 'Connector rings', min: 0, max: 4, step: 1, value: settings.connectorRings, defaultValue: DEFAULT_SETTINGS.connectorRings,
    help: 'Plain round split rings at the ends of the chain, so any link shape hooks onto the hook and whatever hangs on the end.',
    onInput: (v) => { settings.connectorRings = v; triggerRebuild(); },
  }),

  // Charm
  charm: toggleSwitch({
    label: 'Add a charm',
    checked: settings.charm,
    onChange: (on) => { settings.charm = on; syncVisibility(); triggerRebuild(); },
  }),
  charmMount: selectField({
    label: 'Where it hangs',
    options: [
      { value: 'chain', label: 'On the end of the chain' },
      { value: 'swivel', label: 'Straight on the swivel — no chain' },
    ],
    value: settings.charmMount,
    onChange: (v) => { settings.charmMount = v as CharmMount; syncVisibility(); triggerRebuild(); },
  }),
  charmSize: sliderRow({
    label: 'Size', min: 12, max: 50, step: 1, value: settings.charmSize, defaultValue: DEFAULT_SETTINGS.charmSize, unit: 'mm',
    onInput: (v) => { settings.charmSize = v; triggerRebuild(); },
  }),
  charmIconStyle: selectField({
    label: 'Symbol style',
    options: [
      { value: 'cut', label: 'Cut through the charm' },
      { value: 'engrave', label: 'Engraved into the face' },
      { value: 'raise', label: 'Raised, in the symbol colour' },
    ],
    value: settings.charmIconStyle,
    help: 'Cut through fills the symbol’s own holes so nothing floats. Engraved keeps them.',
    onChange: (v) => { settings.charmIconStyle = v as CharmIconStyle; triggerRebuild(); },
  }),
  charmIconSize: sliderRow({
    label: 'Symbol size', min: 4, max: 30, step: 0.5, value: settings.charmIconSize, defaultValue: DEFAULT_SETTINGS.charmIconSize, unit: 'mm',
    onInput: (v) => { settings.charmIconSize = v; triggerRebuild(); },
  }),
  charmFill: segmentedControl<CharmFill>({
    label: 'Body',
    options: [
      { value: 'solid', label: 'Filled' },
      { value: 'frame', label: 'Frame' },
    ],
    value: settings.charmFill,
    onChange: (v) => { settings.charmFill = v; syncVisibility(); triggerRebuild(); },
  }),
  charmBar: sliderRow({
    label: 'Frame width', min: 2, max: 6, step: 0.1, value: settings.charmBar, defaultValue: DEFAULT_SETTINGS.charmBar, unit: 'mm',
    onInput: (v) => { settings.charmBar = v; triggerRebuild(); },
  }),
  charmThick: sliderRow({
    label: 'Thickness', min: 3, max: 8, step: 0.5, value: settings.charmThick, defaultValue: DEFAULT_SETTINGS.charmThick, unit: 'mm',
    help: 'On the swivel the charm is printed as thick as the hook instead.',
    onInput: (v) => { settings.charmThick = v; triggerRebuild(); },
  }),

  // Finish
  edge: segmentedControl<EdgeStyle>({
    label: 'Edges',
    options: [
      { value: 'chamfer', label: 'Flat bevel' },
      { value: 'round', label: 'Rounded' },
    ],
    value: settings.edge,
    onChange: (v) => { settings.edge = v; triggerRebuild(); },
  }),
  edgeSize: sliderRow({
    label: 'Edge size', min: 0.2, max: 1.5, step: 0.1, value: settings.edgeSize, defaultValue: DEFAULT_SETTINGS.edgeSize, unit: 'mm',
    onInput: (v) => { settings.edgeSize = v; triggerRebuild(); },
  }),
};

// The folds: what nobody changes twice.
const hookTune = collapsibleSection({ title: 'Fine tune', open: false, body: [controls.hookBar, controls.hookThick, controls.gateFit] });
const symbolTune = collapsibleSection({ title: 'Fine tune', open: false, body: [controls.iconAngle, controls.iconOffset] });
const chainTune = collapsibleSection({ title: 'Fine tune', open: false, body: [controls.linkBar, controls.linkThick, controls.connectorRings] });
const charmTune = collapsibleSection({ title: 'Fine tune', open: false, body: [controls.charmFill, controls.charmBar, controls.charmThick] });

const charmSymbolBlock = el('div', { className: 'kc-stack' }, [charmSymbol.root, controls.charmIconStyle, controls.charmIconSize]);
const charmBody = el('div', { className: 'kc-stack' }, [
  charmShapes.root, controls.charmMount, controls.charmSize, charmSymbolBlock, charmTune,
]);
const chainBody = el('div', { className: 'kc-stack' }, [linkShapes.root, controls.linkCount, controls.linkSize, controls.connectorExtra, chainTune]);
const noChainNote = el('p', {
  className: 'vl-hint',
  text: 'The charm hangs straight on the swivel, so there is no chain. Change where the charm hangs to bring the chain back.',
});

/** What the hook hangs the chain by — shared by both chain styles. */
function setAttach(v: Attach) {
  settings.attach = v;
  // A charm set to ride the swivel has nowhere to ride without one; put it back on the
  // chain now rather than have it vanish the day the swivel comes back.
  if (v !== 'swivel' && settings.charmMount === 'swivel') {
    settings.charmMount = 'chain';
    controls.charmMount.setValue('chain');
  }
  controls.attach.setValue(v);
  if (v === 'none' && settings.mode === 'pip' && settings.pipAttached) {
    settings.pipAttached = false;
    pipControls.attached.setValue('ring');
    toast('Just the hook: the chain joins it with a connector ring', { kind: 'ok' });
  }
  syncVisibility();
  triggerRebuild();
}

// ---------------------------------------------------------------------------
// 3b. THE PRINT-IN-PLACE CHAIN — its own tab. Fewer choices, no assembly: oval links that
//     come off the bed already through one another, grown out of the hook's loop. Nothing
//     here touches the open chain's settings; switching back finds them as they were.
// ---------------------------------------------------------------------------
const modeControl = segmentedControl<ChainMode>({
  options: [
    { value: 'open', label: 'Open links' },
    { value: 'pip', label: 'Print in place' },
  ],
  value: settings.mode,
  onChange: (v) => {
    settings.mode = v;
    syncVisibility();
    triggerRebuild();
  },
});
const modeHint = el('p', { className: 'vl-hint' });
const MODE_HINT: Record<ChainMode, string> = {
  open: 'Flat links in any shape, each with a slit. You thread them together.',
  pip: 'Cuban-style links that come off the bed already linked. Nothing to assemble.',
};
/* No section of its own. It was one — titled "Chain", sitting directly above a section titled
   "3 · Chain" — which read as a mistake and cost 164 px at the top of a panel that was already
   three screens tall. It is a setting OF the chain, so it lives in the chain's section. */


/** The smallest link of this shape whose 45° slopes and bridges fit, at the current bar and
 *  hook thickness — the same solve the worker runs, on this thread, so a shape change can
 *  grow the link instead of building one that warns. */
function pipMinSize(aspect: PipAspect): number {
  const levels = pipLevels(settings.pipLinkThick);
  for (let size = PIP_SIZE_MIN; size <= PIP_SIZE_MAX; size++) {
    if (pipGeometry({ length: size, width: size / PIP_ASPECT[aspect], bar: settings.pipLinkBar }, levels).feasible) return size;
  }
  return PIP_SIZE_MAX;
}
const PIP_SIZE_MIN = 14;
const PIP_SIZE_MAX = 40;

/** The widest bar a link of this size and shape can carry and still keep its tips and
 *  crossings clear, to 0.1 mm; null if none does. */
function pipMaxBar(size: number, aspect: PipAspect): number | null {
  const levels = pipLevels(settings.pipLinkThick);
  for (let bar = 4.5; bar >= 2; bar = Math.round((bar - 0.1) * 10) / 10) {
    if (pipGeometry({ length: size, width: size / PIP_ASPECT[aspect], bar }, levels).feasible) return bar;
  }
  return null;
}

const pipControls = {
  linkCount: stepperRow({
    label: 'Links', min: 0, max: 16, step: 1, value: settings.pipLinkCount, defaultValue: DEFAULT_SETTINGS.pipLinkCount,
    help: 'After the hook’s own loop. Zero leaves just the loop.',
    onInput: (v) => { settings.pipLinkCount = v; triggerRebuild(); },
  }),
  linkSize: sliderRow({
    label: 'Link size', min: PIP_SIZE_MIN, max: PIP_SIZE_MAX, step: 1, value: settings.pipLinkSize, defaultValue: DEFAULT_SETTINGS.pipLinkSize, unit: 'mm',
    help: 'The long side of each link. Links are as thick as the hook. Smaller links need a thinner bar to keep their crossings and tips clear — the bar follows the size down on its own, and the Fine tune fold has it if you want it thinner still.',
    onInput: (v) => { settings.pipLinkSize = v; triggerRebuild(); },
    // On release, not on every tick of the drag: the bar follows the size down to whatever
    // still prints. A 20 mm oval at the standard 3.2 bar leaves its tips 0.23 mm apart and the
    // status line said so — correctly — but the chain IS makeable at 3.0, and refusing to make
    // something you could make while naming a knob the user has to go and find is not a
    // warning, it is a dead end. Cuban links have picked their own bar since they shipped;
    // this is that, for every shape.
    onCommit: () => announceFit(fitPip()),
  }),
  aspect: segmentedControl<PipAspect>({
    label: 'Link shape',
    options: [
      { value: 'round', label: 'Round' },
      { value: 'oval', label: 'Oval' },
      { value: 'long', label: 'Long' },
      { value: 'cuban', label: 'Cuban' },
    ],
    columns: 2,
    value: settings.pipLinkAspect,
    onChange: (v) => {
      settings.pipLinkAspect = v;
      // Cuban is the chunky one: it takes the widest bar the crossings can still clear at this
      // size, and a shape that cannot fit its slopes grows to the first size that can. Both
      // are `fitPip`; what belongs here is only saying so.
      announceFit(fitPip());
      triggerRebuild();
    },
  }),
  thick: sliderRow({
    label: 'Link thickness', min: 4, max: 10, step: 0.5, value: settings.pipLinkThick, defaultValue: DEFAULT_SETTINGS.pipLinkThick, unit: 'mm',
    help: 'The chain’s height. Where a link bridges over its neighbour, the bridge is half of this less the gap — so this is what makes the overhangs chunkier. Under the swivel it has to be tall enough to wrap the stem.',
    onInput: (v) => { settings.pipLinkThick = v; triggerRebuild(); },
  }),
  bar: sliderRow({
    label: 'Bar width', min: 2, max: 4.5, step: 0.1, value: settings.pipLinkBar, defaultValue: DEFAULT_SETTINGS.pipLinkBar, unit: 'mm',
    onInput: (v) => { settings.pipLinkBar = v; triggerRebuild(); },
  }),
  attached: segmentedControl<'grown' | 'ring'>({
    label: 'Joins the hook',
    options: [
      { value: 'grown', label: 'Grown on' },
      { value: 'ring', label: 'With a ring' },
    ],
    value: settings.pipAttached ? 'grown' : 'ring',
    help: 'Grown on: the chain comes out of the hook in one piece. With a ring: the chain is its own part — another colour, another plate — and a connector ring joins it to the hook’s loop.',
    onChange: (v) => {
      settings.pipAttached = v === 'grown';
      if (settings.pipAttached && settings.attach === 'none') {
        settings.attach = 'loop';
        controls.attach.setValue('loop');
        toast('Grown on needs something to grow from: the hook gets a plain loop', { kind: 'ok' });
      }
      syncVisibility();
      triggerRebuild();
    },
  }),
  root: segmentedControl<PipRoot>({
    label: 'First link',
    options: [
      { value: 'link', label: 'Like the others' },
      { value: 'loop', label: 'Small loop' },
    ],
    value: settings.pipRoot,
    help: 'What grows out of the hook: one more chain link, or a small teardrop loop the chain hangs from.',
    onChange: (v) => { settings.pipRoot = v; triggerRebuild(); },
  }),
  connectorRings: stepperRow({
    label: 'Connector rings', min: 0, max: 2, step: 1, value: settings.pipConnectorRings, defaultValue: DEFAULT_SETTINGS.pipConnectorRings,
    help: 'Plain round split rings on the end of the chain, for whatever you hang there. The chain itself needs none.',
    onInput: (v) => { settings.pipConnectorRings = v; triggerRebuild(); },
  }),
  connectorExtra: sliderRow({
    label: 'Connector ring room', min: 0, max: 8, step: 0.5, value: settings.connectorExtra, defaultValue: DEFAULT_SETTINGS.connectorExtra, unit: 'mm',
    help: 'Extra opening in the connector rings beyond what has to pass through them, so they swing freely.',
    onInput: (v) => { settings.connectorExtra = v; controls.connectorExtra.setValue(v); triggerRebuild(); },
  }),
};
const pipTune = collapsibleSection({ title: 'Fine tune', open: false, body: [pipControls.bar, pipControls.connectorRings, pipControls.connectorExtra] });
const pipChainBody = el('div', { className: 'kc-stack' }, [
  pipControls.linkCount,
  pipControls.aspect,
  pipControls.linkSize,
  pipControls.thick,
  pipControls.attached,
  pipControls.root,
  pipTune,
]);

/**
 * Make the print-in-place numbers buildable for the link shape that is now chosen.
 *
 * Two rules, and both of them are the geometry's, not a preference: a Cuban link takes the
 * widest bar its crossings can still clear, and every shape has a size below which its 45°
 * slopes do not fit at all. Returns what it moved so a caller can say so — the segmented
 * control toasts, a preset does not.
 */
function fitPip(): { bar?: number; size?: number } {
  const moved: { bar?: number; size?: number } = {};
  const widest = pipMaxBar(settings.pipLinkSize, settings.pipLinkAspect);
  if (widest !== null) {
    // Cuban takes the fattest bar going — that is the look. Every other shape keeps the bar it
    // has, and only comes down when the bar it has does not fit.
    const wanted = settings.pipLinkAspect === 'cuban' ? widest : Math.min(settings.pipLinkBar, widest);
    if (Math.abs(wanted - settings.pipLinkBar) > 1e-6) {
      settings.pipLinkBar = wanted;
      moved.bar = wanted;
    }
  }
  // No bar at all fits at this size: the size itself has to come up.
  const min = pipMinSize(settings.pipLinkAspect);
  if (settings.pipLinkSize < min) {
    settings.pipLinkSize = min;
    moved.size = min;
  }
  return moved;
}

/** Push whatever `fitPip` moved back into the controls, and say so. Silent when it moved
 *  nothing, which is the common case. */
function announceFit(moved: { bar?: number; size?: number }) {
  if (moved.bar !== undefined) {
    pipControls.bar.setValue(moved.bar);
    toast(`Bar set to ${moved.bar} mm — the widest that prints at ${settings.pipLinkSize} mm`, { kind: 'ok' });
  }
  if (moved.size !== undefined) {
    pipControls.linkSize.setValue(moved.size);
    toast(`These links start at ${moved.size} mm — size raised`, { kind: 'ok' });
  }
  if (moved.bar !== undefined || moved.size !== undefined) triggerRebuild();
}

// ---------------------------------------------------------------------------
// 3c. UNDO — the whole settings object, snapshotted.
//
// "I changed the bar width and now I don't know what it was" is the report this answers, and
// it has two halves. The per-slider default marks (`defaultValue` on every sliderRow and
// stepperRow) are the other half: they say what the advised number WAS, without pressing
// anything. This half is for everything else — a shape, a mode, a colour, a charm switched on
// and off again.
//
// Snapshots rather than a command log because `settings` is one flat JSON object with no
// references in it: a snapshot is `JSON.stringify` and a restore is `coerceSettings`, which is
// already the Load-project path and therefore already tested. The clicker does the same thing
// against a much larger store (`apps/clicker-generator/src/mount.ts`).
// ---------------------------------------------------------------------------
const HISTORY_MAX = 60;
let history: string[] = [JSON.stringify(settings)];
let histIndex = 0;
/** True while a snapshot is being applied, so restoring does not record itself as a step. */
let restoringHistory = false;
let historyTimer: ReturnType<typeof setTimeout> | undefined;

/* The kit's row — the same three icon buttons in the same place the clicker puts them: the
   foot of the settings panel, directly above the byline. Refresh goes back to snapshot zero:
   where this session started, which is the defaults unless a share link opened it elsewhere. */
const historyBar = historyControls({
  onUndo: () => undo(),
  onRedo: () => redo(),
  onRefresh: () => refresh(),
});

function paintHistory() {
  historyBar.setState({
    canUndo: histIndex > 0,
    canRedo: histIndex < history.length - 1,
    canRefresh: history.length > 1,
  });
}

/** Record the current settings as a step, now. */
function flushHistory() {
  clearTimeout(historyTimer);
  if (restoringHistory) return;
  const snap = JSON.stringify(settings);
  if (snap === history[histIndex]) return;
  history = history.slice(0, histIndex + 1);
  history.push(snap);
  if (history.length > HISTORY_MAX) history = history.slice(history.length - HISTORY_MAX);
  histIndex = history.length - 1;
  paintHistory();
}

/** Record a step once the user stops, so one slider drag is one undo rather than forty. */
function commitHistory() {
  if (restoringHistory) return;
  clearTimeout(historyTimer);
  historyTimer = setTimeout(flushHistory, 350);
}

function restoreHistory(snap: string) {
  restoringHistory = true;
  settings = coerceSettings(JSON.parse(snap));
  syncControls();
  // The old parts are still on screen and will be for a beat: repaint them now rather than
  // leave the model wearing the colours of a state that has been undone.
  applyColors();
  triggerRebuild();
  restoringHistory = false;
  paintHistory();
}

function undo() {
  // A change made less than 350 ms ago has not been recorded yet, and undoing past it would
  // silently throw it away. Record it first, then step back off it.
  flushHistory();
  if (histIndex <= 0) return;
  histIndex -= 1;
  restoreHistory(history[histIndex]!);
}

function redo() {
  flushHistory();
  if (histIndex >= history.length - 1) return;
  histIndex += 1;
  restoreHistory(history[histIndex]!);
}

/** Back to where this session started — and recorded as a step, so it is itself undoable. */
function refresh() {
  flushHistory();
  if (history.length < 2 || histIndex === 0) return;
  histIndex = 0;
  restoreHistory(history[0]!);
  commitHistory();
}

// Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z or Ctrl+Y redoes. Never while a value box has focus —
// there Ctrl+Z is the browser undoing the typing, which is what the user means.
window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement | null;
  const tag = target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = e.key.toLowerCase();
  if (key === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
  } else if (key === 'y') {
    e.preventDefault();
    redo();
  }
});

// ---------------------------------------------------------------------------
// 3d. STARTER PRESETS — a whole set, not a starting point to be edited into one.
//
// Each is a patch over the DEFAULTS rather than over whatever is on screen, so a preset always
// lands on the same set whichever one preceded it. That is the point of them: they are also
// the fastest way to find out what this generator can make, which a panel of forty controls is
// not. Undo covers the click, so trying one costs nothing.
// ---------------------------------------------------------------------------
interface Preset {
  name: string;
  /** The shape whose silhouette stands for it on the button. */
  icon: string;
  hint: string;
  patch: Partial<SetSettings>;
}

const PRESETS: Preset[] = [
  {
    name: 'Classic clip',
    icon: 'oval',
    hint: 'An oval hook on a swivel, three round links, a heart on the face. Amber, pink and aqua.',
    patch: {},
  },
  {
    name: 'Charm dangle',
    icon: 'squircle',
    hint: 'A rounded-square hook with a crown, four links, and a heart charm with a paw cut through it. Mint, plum and cream.',
    // A heart charm rather than a flower: a flower's petals are too narrow to keep a wall round
    // a cut symbol at ANY size — measured, every ratio from 22/9 to 28/13 warned.
    patch: {
      hookShape: 'squircle', icon: 'crown', iconSize: 10,
      linkCount: 4, linkShape: 'circle',
      charm: true, charmMount: 'chain', charmShape: 'heart', charmSize: 26,
      charmIcon: 'paw', charmIconSize: 10, charmIconStyle: 'cut',
      hookColor: [126, 214, 169], iconColor: [74, 52, 96], linkColor: [255, 238, 190], charmColor: [255, 122, 109],
    },
  },
  {
    name: 'Print in place',
    icon: 'teardrop',
    hint: 'A teardrop hook on a fat swivel, and 20 mm oval links that come off the bed already joined. No symbol.',
    // Ian's numbers. The hook is 6 mm thick because a 3.4 mm stem needs it — below that the
    // builder thins the stem and says so, which is a warning on arrival. The bar is not set
    // here: `fitPip` takes it down to the widest that prints at 20 mm (3.0).
    patch: {
      mode: 'pip', pipLinkAspect: 'oval', pipLinkSize: 20, pipLinkThick: 6,
      hookShape: 'teardrop', icon: '', attach: 'swivel', swivelStem: 3.4, hookThick: 6,
      hookColor: [82, 92, 112], linkColor: [206, 214, 228],
    },
  },
  {
    name: 'Just the hook',
    icon: 'dring',
    hint: 'A carabiner and one connector ring — no chain, no charm. Red and cream.',
    patch: {
      hookShape: 'dring', attach: 'loop', linkCount: 0, connectorRings: 1,
      icon: 'bolt', iconSize: 13,
      hookColor: [232, 93, 74], iconColor: [255, 240, 214], linkColor: [206, 214, 228],
    },
  },
];

function applyPreset(preset: Preset) {
  settings = coerceSettings({ ...DEFAULT_SETTINGS, ...preset.patch });
  fitPip();
  syncControls();
  applyColors();
  triggerRebuild();
  toast(`${preset.name}`, { kind: 'ok' });
}

/* On the RIGHT, with the colours — because a preset IS a colourway as much as a shape, and
   because the left panel is already the tallest thing in the app. Two columns: five names at
   this width read on one line each. */
const presetSection = section({
  title: 'Start from',
  body: [
    buttonGrid({
      columns: 2,
      buttons: PRESETS.map((p) => button({
        label: p.name,
        emphasis: 'secondary',
        icon: shapeIcon(shapeById(p.icon)),
        title: p.hint,
        onClick: () => applyPreset(p),
      })),
    }),
  ],
});

function syncVisibility() {
  const one = settings.oneColor;
  colors.iconColor.classList.toggle('hidden', one || (!settings.icon && !(settings.charm && settings.charmIconStyle === 'raise')));
  colors.linkColor.classList.toggle('hidden', one);
  colors.charmColor.classList.toggle('hidden', one || !settings.charm);
  const frame = settings.charmFill === 'frame';
  controls.charmBar.classList.toggle('hidden', !frame);
  charmSymbolBlock.classList.toggle('hidden', frame);
  charmBody.classList.toggle('hidden', !settings.charm);
  const swivel = settings.attach === 'swivel';
  controls.charmMount.classList.toggle('hidden', !swivel);
  const noChain = settings.charm && swivel && settings.charmMount === 'swivel';
  const pip = settings.mode === 'pip';
  chainBody.classList.toggle('hidden', noChain || pip);
  pipChainBody.classList.toggle('hidden', noChain || !pip);
  noChainNote.classList.toggle('hidden', !noChain);
  pipControls.root.classList.toggle('hidden', !settings.pipAttached);
  controls.swivelStem.classList.toggle('hidden', settings.attach !== 'swivel');
  symbolBody.classList.toggle('hidden', !settings.icon);
  modeHint.textContent = MODE_HINT[settings.mode];
}

/** Push `settings` back into every control — used after Load project and Reset. */
function syncControls() {
  modeControl.setValue(settings.mode);
  controls.hookSize.setValue(settings.hookSize);
  controls.attach.setValue(settings.attach);
  controls.swivelStem.setValue(settings.swivelStem);
  pipControls.linkCount.setValue(settings.pipLinkCount);
  pipControls.linkSize.setValue(settings.pipLinkSize);
  pipControls.aspect.setValue(settings.pipLinkAspect);
  pipControls.bar.setValue(settings.pipLinkBar);
  pipControls.thick.setValue(settings.pipLinkThick);
  pipControls.connectorRings.setValue(settings.pipConnectorRings);
  pipControls.attached.setValue(settings.pipAttached ? 'grown' : 'ring');
  pipControls.root.setValue(settings.pipRoot);
  pipControls.connectorExtra.setValue(settings.connectorExtra);
  controls.hookBar.setValue(settings.hookBar);
  controls.hookThick.setValue(settings.hookThick);
  controls.gateFit.setValue(settings.gateFit);
  controls.loopBar.setValue(settings.loopBar);
  controls.iconRotate.setValue(settings.iconRotate);
  symbolToggle.setValue(!!settings.icon);
  controls.iconRaise.setValue(settings.iconRaise);
  oneColorToggle.setValue(settings.oneColor);
  controls.iconSize.setValue(settings.iconSize);
  controls.iconAngle.setValue(settings.iconAngle);
  controls.iconOffset.setValue(settings.iconOffset);
  controls.linkCount.setValue(settings.linkCount);
  controls.linkSize.setValue(settings.linkSize);
  controls.linkBar.setValue(settings.linkBar);
  controls.linkThick.setValue(settings.linkThick);
  controls.connectorRings.setValue(settings.connectorRings);
  controls.connectorExtra.setValue(settings.connectorExtra);
  controls.charm.setValue(settings.charm);
  controls.charmMount.setValue(settings.charmMount);
  controls.charmSize.setValue(settings.charmSize);
  controls.charmIconStyle.setValue(settings.charmIconStyle);
  controls.charmIconSize.setValue(settings.charmIconSize);
  controls.charmFill.setValue(settings.charmFill);
  controls.charmBar.setValue(settings.charmBar);
  controls.charmThick.setValue(settings.charmThick);
  controls.edge.setValue(settings.edge);
  controls.edgeSize.setValue(settings.edgeSize);
  hookShapes.sync();
  linkShapes.sync();
  charmShapes.sync();
  hookSymbol.sync();
  charmSymbol.sync();
  for (const key of Object.keys(colorRows) as ColorKey[]) for (const row of colorRows[key]) row.setValue(rgbToHex(settings[key]));
  syncVisibility();
}

const resetButton = button({
  label: 'Reset to defaults',
  emphasis: 'secondary',
  icon: ICONS.rotateLeft,
  block: true,
  onClick: () => {
    settings = { ...DEFAULT_SETTINGS };
    syncControls();
    applyColors();
    triggerRebuild();
    toast('Every setting back to the defaults', { kind: 'ok' });
  },
});

/* Every numbered step starts CLOSED.
   With them all open the panel needed 2374 px in a 694 px column, so the five steps could not
   be seen at once and the two at the bottom were three screens down. Closed, the whole list
   fits the column exactly and opening one is a click. The starting point is the presets on the
   right panel, not a wall of sliders on the left. */
const hookSection = collapsibleSection({
  title: '1 · Hook',
  open: false,
  body: [hookShapes.root, controls.hookSize, controls.attach, controls.swivelStem, controls.loopBar, hookTune],
});
/** The symbol last chosen, so switching the symbol off and on brings the same one back. */
let lastIcon = settings.icon || DEFAULT_SETTINGS.icon || 'shape:heart';
const symbolToggle = toggleSwitch({
  label: 'Add a symbol',
  checked: !!settings.icon,
  onChange: (on) => {
    if (settings.icon) lastIcon = settings.icon;
    settings.icon = on ? lastIcon : '';
    hookSymbol.sync();
    syncVisibility();
    triggerRebuild();
  },
});
const symbolBody = el('div', { className: 'kc-stack' }, [
  hookSymbol.root,
  el('p', { className: 'vl-hint', text: 'Drag it on the model to put it where you want.' }),
  controls.iconSize,
  controls.iconRaise,
  controls.iconRotate,
  symbolTune,
]);
const symbolSection = collapsibleSection({
  title: '2 · Symbol on the hook',
  open: false,
  body: [symbolToggle, symbolBody],
});
const chainSection = collapsibleSection({
  title: '3 · Chain',
  open: false,
  body: [modeControl, modeHint, noChainNote, chainBody, pipChainBody],
});
const charmSection = collapsibleSection({
  title: '4 · Charm — optional',
  open: false,
  body: [controls.charm, charmBody],
});
/** The dangle is a view preference, not part of the model — it lives in the browser, not in
 *  the project file. */
let dangle = true;
try { dangle = localStorage.getItem('keychain-carabiner-dangle') !== 'off'; } catch { /* no storage */ }
const dangleToggle = toggleSwitch({
  label: 'Enable physics in preview',
  checked: dangle,
  onChange: (on) => {
    dangle = on;
    try { localStorage.setItem('keychain-carabiner-dangle', on ? 'on' : 'off'); } catch { /* no storage */ }
    if (on) simReset();
    else viewer.setParts(shown(), false, anchor());
  },
});

const finishSection = collapsibleSection({
  title: '5 · Finish',
  open: false,
  body: [controls.edge, controls.edgeSize, resetButton],
});

const previewSection = section({ title: 'Preview', body: [dangleToggle] });

// ---------------------------------------------------------------------------
// 4. RIGHT PANEL — the colours, and the preview's physics.
// ---------------------------------------------------------------------------
const colorsSection = section({ title: 'Colours', body: [oneColorToggle, colors.hookColor, colors.iconColor, colors.linkColor, colors.charmColor] });

// ---------------------------------------------------------------------------
// 5. CHROME — callout + the export/save/load/help footer.
// ---------------------------------------------------------------------------
const quality = qualityCallout({
  html: 'Print everything flat as it lands on the plate. PETG makes a springier gate than PLA.',
  storageKey: 'keychain-carabiner-quality-callout',
});

const footer = sidebarFooter({
  formats: [{ id: '3mf', label: '3MF' }],
  onExport: async (format) => {
    if (parts.length === 0) return toast('Nothing to export yet', { kind: 'warn' });
    if (format !== '3mf') throw new Error('Unknown format: ' + format);
    // Never the previous build: if the click came a beat after a slider, wait for the parts.
    await settled();
    // The thumbnail is the preview as it stands — the assembled set, hanging — which is the
    // picture a person recognises in a file list. Missing is not worth failing an export.
    const cover = await captureCover();
    // Always the print layout, whichever view is on screen.
    downloadThreeMF(parts, {
      title: exportTitle(),
      generator: 'keychain-carabiner',
      application: 'Vostok Labs Keychain Carabiner Set',
      buildId: import.meta.env.VITE_BUILD_ID,
      cover,
    }, `${exportSlug()}.3mf`);

    // Full modal on the first download, corner reminder after — the shipped flow.
    downloads += 1;
    if (downloads === 1) openLicenseModal();
    else licenseReminderToast();
  },
  onSave: () => downloadJSON(`${exportSlug()}.json`, settings),
  onLoad: (file?: File) =>
    file && loadJSON(file, (data) => {
      settings = coerceSettings(data);
      syncControls();
      triggerRebuild();
      toast('Project loaded', { kind: 'ok' });
    }),
  onHelp: () =>
    dialog({
      title: 'Keychain Carabiner Set help',
      content: el('div', {}, [
        el('p', { text: 'A hook and a chain to hang something on. Pick a shape for each, drag the symbol onto the hook, add a charm if you want one. Every part prints flat, face up, exactly where it lands on the plate — no supports.' }),
        el('p', { text: '"Assembled" shows the set hanging as worn; "Print layout" shows what you download.' }),
        el('p', { text: 'The gate is the wavy cut in the hook. The whole ring is the spring: push the two halves apart to clip on. Firm is snappier, Soft is safer on a printer that over-extrudes.' }),
        el('p', { text: 'Open links and connector rings have one slit each. Flex one open, thread the next through, let it spring shut.' }),
        el('p', { text: `"Print in place" grows the chain out of the hook instead: Cuban-style links — straight sides, 45° ends — that come off the bed already through one another. Each is solid to the bed; where it passes over its neighbour it bridges straight across with a ${PIP_Z_GAP} mm gap, and where it passes under, its top drops to half height. Print it flat as it lands and flex the links free; a first layer squished too wide is what fuses them, so if they stick, lower the first-layer flow a little.` }),
        el('p', { text: `The swivel prints in place — a barrel in a window, turning on a stem. The hook needs to be at least ${SWIVEL_MIN_THICK} mm thick for it; below that you get a plain loop and the status line says so.` }),
      ]),
      actions: [{ label: 'Got it', primary: true }],
    }),
  themeStorageKey: 'keychain-carabiner-theme',
});

// ---------------------------------------------------------------------------
// 6. ASSEMBLE
// ---------------------------------------------------------------------------
const status = stageStatus('Starting the geometry worker…');
const busy = busyChip({ defaultText: 'generating…' });

const views = modeBar<View>({
  modes: [
    { value: 'assembled', label: 'Assembled' },
    { value: 'print', label: 'Print layout' },
  ],
  value: view,
  onChange: (v) => {
    view = v;
    viewer.setPlateVisible(view === 'print');
    platePicker.root.hidden = view !== 'print';
    viewer.setParts(shown(), true, anchor());
    simReset();
  },
});

const stageCanvas = el('div', { className: 'kc-stage-canvas' });
const hint = el('p', {
  className: 'vl-stage__hint',
  text: 'Drag the symbol to place it · drag to orbit · scroll to zoom',
});

const shell = appShell({
  topbar: topbarLinks({ githubUrl: BRAND.urls.github, themeToggle: false }),
  left: {
    scroll: [
      generatorHeader({
        title: 'Keychain Carabiner Set',
        description: 'A snap-hook clip and a chain to hang anything on — in any shape, with a symbol on the clip. Prints flat in one job.',
        // The byline lives in the credit strip pinned at the foot of this panel.
        hideCredit: true,
      }),
      ...(quality ? [quality] : []),
      hookSection,
      symbolSection,
      chainSection,
      charmSection,
      finishSection,
      historyBar,
    ],
    // Pinned under the scroll: who made this, and what changed. A signature, not a step.
    credit: panelCredit({ title: 'Keychain Carabiner', updates: { entries: CHANGELOG, title: 'Keychain updates' } }),
  },
  stage: [
    stageCanvas,
    el('p', { className: 'vl-stage__label', text: 'Live 3D Preview' }),
    views.root,
    busy,
    status.root,
    hint,
  ],
  right: {
    scroll: [presetSection, colorsSection, previewSection],
    footer: [footer],
  },
});

document.getElementById('app')!.append(shell.root);

// A tighter frame than the kit's default: the set is tall and thin and hangs in empty space,
// and at the default distance it read as a small thing in the middle of a large stage.
const viewer = createViewer(stageCanvas, { frameMul: 1.6 });
const platePicker = mountPlatePicker(shell.stage, viewer, () => triggerRebuild());
viewer.setPlateVisible(view === 'print');
platePicker.root.hidden = view !== 'print';

// ---------------------------------------------------------------------------
// 7. DRAGGING THE SYMBOL — pointer down on it takes the orbit away from the viewer. While
//    the pointer is down the mesh SLIDES to where the symbol will be built, so the drag is
//    instant; the rebuild happens once, on release. Listeners run in the capture phase on
//    the stage, so they see the event before the viewer's own handlers do.
// ---------------------------------------------------------------------------
let dragging = false;
let dragIndex: number | null = null;
let dragMoved = false;

function iconIndex(): number | null {
  const i = shown().findIndex((p) => p.name === 'Symbol');
  return i >= 0 ? i : null;
}

/** Pointer → hook-local point on the hook's top face, in whichever view is showing. */
function hookLocalAt(clientX: number, clientY: number): [number, number] | null {
  if (!hookFrame) return null;
  if (view === 'print') {
    const hit = viewer.pickOnPlane(clientX, clientY, hookFrame.thick, 'z');
    return hit ? [hit[0] - hookFrame.printOffset[0], hit[1] - hookFrame.printOffset[1]] : null;
  }
  const hit = viewer.pickOnPlane(clientX, clientY, -hookFrame.thick, 'y');
  return hit ? [hit[0] - hookFrame.assembledOffset[0], hit[2] - hookFrame.assembledOffset[1]] : null;
}

/** Hook-local displacement → world displacement, in whichever view is showing. */
function worldDelta(dx: number, dy: number): [number, number, number] {
  return view === 'print' ? [dx, dy, 0] : [dx, 0, dy];
}

function moveIconTo(clientX: number, clientY: number) {
  if (!hookFrame || dragIndex === null) return;
  const local = hookLocalAt(clientX, clientY);
  if (!local) return;
  const [lx, ly] = local;
  const ring = hookFrame.ring;
  const c = centroid(ring);
  const angle = ((Math.atan2(ly - c[1], lx - c[0]) * 180) / Math.PI + 360) % 360;
  const t = tAtAngle(ring, angle);
  const edge = frameAt(ring, t).p;
  const offset = Math.max(-6, Math.min(6, Math.hypot(lx - c[0], ly - c[1]) - Math.hypot(edge[0] - c[0], edge[1] - c[1])));
  const nextAngle = Math.round(angle);
  const nextOffset = Math.round(offset * 2) / 2;
  if (nextAngle !== settings.iconAngle || nextOffset !== settings.iconOffset) dragMoved = true;
  settings.iconAngle = nextAngle;
  settings.iconOffset = nextOffset;
  controls.iconAngle.setValue(settings.iconAngle);
  controls.iconOffset.setValue(settings.iconOffset);
  // Slide the built mesh to where the symbol will be rebuilt.
  if (hookFrame.iconCentre) {
    const rad = radialAt(ring, t);
    const target: [number, number] = [edge[0] + rad[0] * settings.iconOffset, edge[1] + rad[1] * settings.iconOffset];
    viewer.setPartOffset(dragIndex, worldDelta(target[0] - hookFrame.iconCentre[0], target[1] - hookFrame.iconCentre[1]));
  }
}

stageCanvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !settings.icon) return;
  const idx = viewer.pickPart(e.clientX, e.clientY);
  if (idx === null || idx !== iconIndex()) return;
  dragging = true;
  dragIndex = idx;
  dragMoved = false;
  viewer.setOrbitEnabled(false);
  (e.target as Element).setPointerCapture?.(e.pointerId);
  e.stopPropagation();
  e.preventDefault();
  status.set('Drag to place the symbol; let go to keep it.');
}, true);

stageCanvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  e.stopPropagation();
  moveIconTo(e.clientX, e.clientY);
}, true);

const endDrag = (e: PointerEvent) => {
  if (!dragging) return;
  dragging = false;
  dragIndex = null;
  viewer.setOrbitEnabled(true);
  e.stopPropagation();
  // A click on the symbol that never moved it is not a change.
  if (dragMoved) triggerRebuild();
};
stageCanvas.addEventListener('pointerup', endDrag, true);
stageCanvas.addEventListener('pointercancel', endDrag, true);

// ---------------------------------------------------------------------------
// 8. THE DANGLE — a chain of point masses hung from the hook's pivot, one per chain element,
//    stepped with Verlet integration and stiff distance constraints. Each element is then
//    posed to point from its node to the next. Moving the camera shakes it; when it comes
//    to rest the loop stops, so an idle tab costs nothing. Preview only — nothing here
//    touches the geometry or the export.
// ---------------------------------------------------------------------------
interface SimNode { x: number; z: number; px: number; pz: number }
const sim = {
  nodes: [] as SimNode[],
  /** Where each node hangs at rest, for carrying motion across a rebuild. */
  rest: [] as [number, number][],
  lens: [] as number[],
  raf: 0,
  /** The camera's angle round the vertical axis last frame; orbiting is what shakes the chain. */
  lastAzimuth: null as number | null,
};
/** Gravity in mm per frame², slowed well below real so a 15 mm link swings like a keychain
 *  in a film rather than a blur. */
const SIM_G = 0.35;
const SIM_DAMP = 0.975;

function simReset() {
  cancelAnimationFrame(sim.raf);
  sim.raf = 0;
  const oldNodes = sim.nodes;
  const oldRest = sim.rest;
  sim.nodes = [];
  sim.rest = [];
  sim.lens = [];
  sim.lastAzimuth = null;
  if (!chain || !dangle || view !== 'assembled') return;
  // Node 0 is where the first element actually hangs — the contact point under the hook's
  // ring — not the ring's centre, or every pose carries the difference as a resting offset.
  const pts = [chain.elements[0]!.top, ...chain.elements.map((e) => e.bottom)];
  sim.rest = pts.map((p) => [p[0], p[2]]);
  for (let i = 1; i < pts.length; i++) sim.lens.push(Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![2] - pts[i - 1]![2]));
  const sameChain = oldNodes.length === pts.length;
  if (sameChain) {
    // The same chain, rebuilt for a slider: carry each node's swing over to its new rest
    // point instead of dropping the whole thing in again — a chain that re-jumped on every
    // tick of a slider drag read as a fault, not a feature.
    sim.nodes = pts.map((p, i) => {
      const o = oldNodes[i]!, r = oldRest[i]!;
      return { x: p[0] + (o.x - r[0]), z: p[2] + (o.z - r[1]), px: p[0] + (o.px - r[0]), pz: p[2] + (o.pz - r[1]) };
    });
  } else {
    sim.nodes = pts.map((p) => ({ x: p[0], z: p[2], px: p[0], pz: p[2] }));
    // A new chain drops in with a little swing, so the dangle announces itself.
    for (let i = 1; i < sim.nodes.length; i++) sim.nodes[i]!.px -= 0.4 * i;
  }
  simWake();
}

function simWake() {
  if (sim.raf || !dangle || view !== 'assembled' || !chain || sim.nodes.length < 2) return;
  sim.raf = requestAnimationFrame(simStep);
}

function simStep() {
  sim.raf = 0;
  if (!chain || view !== 'assembled' || !dangle || sim.nodes.length < 2) return;

  // Orbiting shakes the holder: a sideways kick from how far the camera swung round the
  // vertical axis since last frame. Angle, not position, so zooming in does not kick it.
  const cam = viewer.camera.position;
  const azimuth = Math.atan2(cam.y, cam.x);
  let kick = 0;
  if (sim.lastAzimuth !== null) {
    let d = azimuth - sim.lastAzimuth;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    kick = Math.max(-1.2, Math.min(1.2, -d * 12));
  }
  sim.lastAzimuth = azimuth;

  let energy = 0;
  for (let i = 1; i < sim.nodes.length; i++) {
    const n = sim.nodes[i]!;
    const vx = (n.x - n.px) * SIM_DAMP + kick;
    const vz = (n.z - n.pz) * SIM_DAMP;
    n.px = n.x;
    n.pz = n.z;
    n.x += vx;
    n.z += vz - SIM_G;
    energy += vx * vx + vz * vz;
  }
  const root = sim.nodes[0]!;
  root.x = chain.elements[0]!.top[0];
  root.z = chain.elements[0]!.top[2];
  for (let iter = 0; iter < 6; iter++) {
    for (let i = 1; i < sim.nodes.length; i++) {
      const a = sim.nodes[i - 1]!, b = sim.nodes[i]!;
      const L = sim.lens[i - 1]!;
      const dx = b.x - a.x, dz = b.z - a.z;
      const d = Math.hypot(dx, dz) || 1e-6;
      const diff = (d - L) / d;
      if (i === 1) {
        b.x -= dx * diff;
        b.z -= dz * diff;
      } else {
        a.x += dx * diff * 0.5;
        a.z += dz * diff * 0.5;
        b.x -= dx * diff * 0.5;
        b.z -= dz * diff * 0.5;
      }
    }
  }

  // Pose every element from its node to the next: a rotation about Y through its top, so
  // its rest top lands on the node above it.
  chain.elements.forEach((e, i) => {
    const a = sim.nodes[i]!, b = sim.nodes[i + 1]!;
    const angle = Math.atan2(-(b.x - a.x), -(b.z - a.z));
    const c = Math.cos(angle), s = Math.sin(angle);
    const tx = e.top[0], tz = e.top[2];
    const rx = tx * c + tz * s;
    const rz = -tx * s + tz * c;
    for (const idx of e.parts) viewer.setPartPose(idx, [a.x - rx, 0, a.z - rz], angle);
  });

  // At rest means still AND hanging straight. Velocity alone is also zero at the top of
  // every swing, and sleeping there left the chain frozen at a lean.
  let lean = 0;
  for (let i = 1; i < sim.nodes.length; i++) lean = Math.max(lean, Math.abs(sim.nodes[i]!.x - root.x));
  if (energy < 2e-5 && Math.abs(kick) < 1e-4 && lean < 0.05) return;
  sim.raf = requestAnimationFrame(simStep);
}

// Anything that moves the camera wakes the dangle; it puts itself back to sleep.
stageCanvas.addEventListener('pointermove', () => simWake());
stageCanvas.addEventListener('wheel', () => simWake(), { passive: true });

viewer.onPartPick((index) => {
  if (index === null) return;
  status.set(`Selected: ${shown()[index]?.name ?? 'part'}`);
});

syncControls();
paintHistory();
worker.postMessage({ type: 'init' });

// Which glyphs make a symbol is measured from the font, so it waits for the font. The quick
// rows and the picker's list fill in when it lands; the shape silhouettes are there from the
// first paint.
let glyphsLoading: Promise<void> | null = null;
function loadGlyphs(): Promise<void> {
  if (usable.list.length) return Promise.resolve();
  glyphsLoading ??= getFont(FALLBACK_FONT_ID).then((font) => {
    usable = usableSymbols(font);
    usableList.splice(0, usableList.length, ...usable.list);
    for (const redraw of quickRows) redraw();
  }).catch((err) => {
    // The silhouettes remain; the glyph rows stay empty. Ian hit exactly this — a session
    // where the font never arrived and the picker offered "0 symbols" with no explanation.
    console.warn('[symbols] glyph font did not load:', err);
    glyphsLoading = null;
    toast('The symbol font did not load — only the silhouettes are available. Reload to try again.', { kind: 'warn' });
  });
  return glyphsLoading;
}
loadGlyphs();

// Dev only: what the headless harness drives. Not in the production bundle.
if (import.meta.env.DEV) {
  (window as unknown as { __kc: unknown }).__kc = {
    get settings() { return settings; },
    get parts() { return shown(); },
    pickPart: (x: number, y: number) => viewer.pickPart(x, y),
    iconIndex,
    canvas: stageCanvas,
    get chain() { return chain; },
    get sim() { return sim; },
    get usable() { return usable.list.map((i) => i.id); },
    viewer,
  };
}

// Ian's SVG silhouettes, if the folder has any. They join the grids when they arrive; the
// built-ins are already there, so nothing waits on this.
loadSvgShapes(`${import.meta.env.BASE_URL}assets/shapes/`).then(({ added, issues }) => {
  for (const issue of issues) console.warn(`[shapes] ${issue}`);
  if (issues.length) toast('Some shapes did not load — the Seasonal ones are missing. Reload to try again.', { kind: 'warn' });
  if (!added.length) return;
  hookShapes.render();
  linkShapes.render();
  charmShapes.render();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** What the file is, in the slicer's model list: "Oval hook · 3 circle links · flower charm". */
function exportTitle(): string {
  const s = settings;
  const bits = [`${shapeById(s.hookShape).name} hook`];
  const noChain = s.charm && s.attach === 'swivel' && s.charmMount === 'swivel';
  if (!noChain && s.mode === 'pip') bits.push(s.pipLinkCount > 0 ? `${s.pipLinkCount} print-in-place ${s.pipLinkAspect} link${s.pipLinkCount === 1 ? '' : 's'}` : 'print-in-place loop');
  else if (!noChain && s.linkCount > 0) bits.push(`${s.linkCount} ${shapeById(s.linkShape).name.toLowerCase()} link${s.linkCount === 1 ? '' : 's'}`);
  if (s.charm) bits.push(`${shapeById(s.charmShape).name.toLowerCase()} charm`);
  return bits.join(' · ');
}

/** The file name, from the same facts: "oval-hook-3-circle-links-flower-charm-keychain". */
function exportSlug(): string {
  return exportTitle()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .concat('-keychain');
}

/** A PNG of the preview for the 3MF's thumbnail, or undefined — a missing thumbnail is not
 *  worth failing an export over. */
async function captureCover(): Promise<Uint8Array | undefined> {
  try {
    const blob = await viewer.renderToPng();
    return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined;
  } catch {
    return undefined;
  }
}

function downloadJSON(name: string, data: unknown) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function loadJSON(file: File, apply: (data: unknown) => void) {
  const r = new FileReader();
  r.onload = () => {
    try {
      apply(JSON.parse(r.result as string));
    } catch {
      toast('Invalid project file', { kind: 'error' });
    }
  };
  r.readAsText(file);
}
