import '@vostok/ui-kit/styles.css';
import '@vostok/plates/plates.css';
import '@vostok/fonts/fonts.css';
import './style.css';

import {
  appShell,
  buildLoop,
  FILAMENTS,
  busyChip,
  button,
  buttonRow,
  dialog,
  dropZone,
  el,
  filamentRow,
  fontChooser,
  galleryCard,
  galleryPage,
  generatorHeader,
  ICONS,
  licenseAfterExport,
  markProject,
  openSvgImport,
  paletteRow,
  panelCredit,
  previewBar,
  readProjectFile,
  section,
  segmentedControl,
  settingsRail,
  sidebarFooter,
  skeleton,
  sliderRow,
  stageHandle,
  stageRow,
  stageStatus,
  stageTools,
  syncControls,
  textField,
  themeColor,
  themeColorHex,
  themeToggleButton,
  toast,
  toggleSwitch,
  topbarLinks,
  workerClient,
  type Diagnostic,
  type GalleryCardHandle,
  type ProjectShape,
  type SvgImportChoice,
  type SvgImportTrace,
} from '@vostok/ui-kit';
import { patternRow } from '@vostok/patterns/ui';
import { createViewer, type ViewerPart } from '@vostok/viewer';
import { mountPlatePicker, plateSize, loadPlateChoice } from '@vostok/plates';
import { downloadThreeMF, downloadFile, pauseForPocket, type ExportPart } from '@vostok/export';
import { FONTS, FALLBACK_FONT_ID, getFont, toPickerFont, fontSupportsText, importFontFiles } from '@vostok/fonts';
import { symbolShapes } from '@vostok/symbols';
import { describeSvg, parseSvg, type SvgPartChoice } from '@vostok/trace/svg';
import { qrShapes } from '@vostok/qr';
import { bboxOf, islandsFromContours, mapShapes, type Shapes } from '@vostok/shapes';
import * as THREE from 'three';
import { CUSTOM_COLOURS, DEFAULT_SETTINGS, coerceSettings, raiseOf, type CardSettings, type IconStyle, type Logo, type QrStyleChoice } from './state';
import { qrContent } from './design/qr';
import { buildDesign, ICON_IDS, NFC_TAGS, QR_LEFT_OUT, QR_MOVED, QR_TAKES_BACK, type Assets, type IconFamily } from './design/build';
import { TEMPLATES, TEMPLATE_GROUPS, templateById } from './design/templates';
import { designSvg, pairSvg } from './design/svg';
import { BORDER, CARD_SIZES } from './design/layout';
import { CONTACT_ROLES, DETAIL_FLOOR, NAME_FLOOR } from './design/lockup';
import type { Template } from './design/build';
import type { Design, Role } from './design/types';
import type { SolidRequest } from './geometry/worker';
import type { SolidResult } from './geometry/solid';
import { CHANGELOG } from './changelog';

/*
  Business Card Generator: pick a template, type your details, download a card in two or more
  colours for a Bambu Lab printer.

  Two screens and a hash: `#/` is the template menu (every template drawn with the customer's own
  details; pointing at one shows its front and back), `#/t/<template>` the editor:

    LEFT    All templates, the template's name, and the settings rail: Card, Font, Lettering,
            Icons, Pattern (templates with one), Logo, QR, NFC, Colors. Reset at its foot.
    STAGE   the card in 3D on the plate; 3D · Front · Back · 2D (both faces side by side) over it,
            and the NFC tag's place, a dotted circle with a label that drags it.
    RIGHT   what the customer types: the details. Download at the foot.

  The design (design/) is flat geometry built here, where the fonts are; the worker
  (geometry/worker.ts) makes it solid. The screen is held to .claude/rules/ui-ux-dogma.md.
*/

// ---------------------------------------------------------------------------
// 1. STATE — see state.ts. Save/Load serialise this object.
// ---------------------------------------------------------------------------
let settings: CardSettings = { ...DEFAULT_SETTINGS, colors: {} };

const PROJECT_FILE: ProjectShape = {
  app: 'business-card',
  keys: ['template', 'name'] satisfies (keyof CardSettings)[],
};

/** How deep colour is laid into a face, and how deep carving goes, mm: three layers, enough to hide
 *  the card's colour under a light one. */
const INLAY = 0.6;

let assetsLoading: Promise<Omit<Assets, 'faces'>> | null = null;
/** The contact icons of both families and the tap mark, loaded once from the symbol library. */
const loadSymbols = () =>
  (assetsLoading ??= (async () => {
    const families = Object.keys(ICON_IDS) as IconFamily[];
    const icons = {} as Assets['icons'];
    for (const family of families) {
      const pairs = await Promise.all(CONTACT_ROLES.map(async (role) => [role, await symbolShapes(ICON_IDS[family][role], 1)] as const));
      icons[family] = Object.fromEntries(pairs);
    }
    return { icons, tap: await symbolShapes('material:contactless', 1) };
  })());

/** The faces and symbols a build draws with: loaded here, where the font library lives. */
async function loadAssets(font: string): Promise<Assets> {
  const [main, fallback, symbols] = await Promise.all([getFont(font), getFont(FALLBACK_FONT_ID).catch(() => null), loadSymbols()]);
  return { faces: { main, fallback }, ...symbols };
}

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

// ---------------------------------------------------------------------------
// 2. REBUILD — the design here, the solids in the worker, one build at a time.
// ---------------------------------------------------------------------------
interface Built {
  s: CardSettings;
  design: Design;
  solid: SolidResult;
}

const worker = workerClient<SolidRequest, SolidResult>(
  () => new Worker(new URL('./geometry/worker.ts', import.meta.url), { type: 'module' }),
);

/** What will not print or will not scan: every one is shown, and any of them stops the export. */
const problemsOf = (b: Built) => [...b.design.warnings, ...b.solid.warnings];

const ROLE_NAMES: Record<Role, string> = {
  card: 'Card', shapes: 'Shapes', name: 'Name', details: 'Details', icons: 'Icons', rule: 'Rule', logo: 'Logo', qr: 'QR code', pattern: 'Pattern',
};
/** A part's name in the slicer: what it holds, the card first. */
const partName = (roles: Role[]) => (roles.includes('card') ? 'Card' : roles.map((r) => ROLE_NAMES[r]).join(', '));

let refitNext = false;
let lastBuilt: Built | null = null;
const loop = buildLoop<Built>({
  run: async () => {
    const s = { ...settings, colors: { ...settings.colors } };
    const design = await buildDesign(s, await loadAssets(s.font), templateById(s.template));
    const solid = await worker.call({
      design,
      params: { thickness: s.thickness, raise: raiseOf(s), inlay: INLAY, pocketDepth: (NFC_TAGS[s.nfcTag] ?? NFC_TAGS['25']!).depth },
    });
    return { s, design, solid };
  },
  debounceMs: 60,
  onStart: () => busy.show(),
  onIdle: () => busy.hide(),
  onResult: (built) => {
    lastBuilt = built;
    viewer.setParts(viewerParts(built), refitNext);
    if (nfcPart >= 0 && !showNfc) viewer.setPartVisible(nfcPart, false);
    droppedAt = null;
    refitNext = false;
    describe(built);
    showFlat(built);
    showQrPreview(built);
    showPresent(built.design);
    showLogoHint(built);
  },
  onError: (err) => status.set(`Could not build the card: ${err.message}`, 'error'),
  diagnose: (built) => problemsOf(built).map((message): Diagnostic => ({ level: 'error', message })),
});

function triggerRebuild(refit = false) {
  if (refit) refitNext = true;
  loop.request();
}

/** The index of the NFC tag's dotted circle among the stage's parts, or -1. */
let nfcPart = -1;
/** Just over the face the tag is seen through: the card's top, or the top of raised lettering. */
const faceTop = (b: Built) => b.solid.thickness + raiseOf(b.s) + 0.05;

/** The model on the stage: the parts, and the NFC tag's place drawn over the face as a dotted
 *  circle in the interface's own accent, so it reads as a guide and never as part of the print. */
function viewerParts(b: Built): ViewerPart[] {
  const parts: ViewerPart[] = b.solid.parts.map((p) => ({ name: partName(p.roles), positions: p.vertProperties, indices: p.triVerts, color: rgb(p.colour) }));
  const pocket = b.design.pocket;
  nfcPart = -1;
  if (pocket && b.solid.pocketCeiling !== null) {
    nfcPart = parts.length;
    const accent = themeColorHex('--accent', 0x4f8cff);
    parts.push({ name: 'NFC tag', ...dottedCircle(pocket.at[0], pocket.at[1], pocket.r, faceTop(b)), color: [(accent >> 16) & 255, (accent >> 8) & 255, accent & 255] });
  }
  return parts;
}

/** A ring of round dots about 2 mm apart at height `z`, as triangle fans. */
function dottedCircle(cx: number, cy: number, r: number, z: number): { positions: Float32Array; indices: Uint32Array } {
  const dots = Math.max(12, Math.round((2 * Math.PI * r) / 2.1));
  const n = 10;
  const dot = 0.55;
  const positions = new Float32Array(dots * (n + 1) * 3);
  const indices = new Uint32Array(dots * n * 3);
  for (let d = 0; d < dots; d++) {
    const a = (2 * Math.PI * d) / dots;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    const v0 = d * (n + 1);
    positions.set([x, y, z], v0 * 3);
    for (let i = 0; i < n; i++) positions.set([x + dot * Math.cos((2 * Math.PI * i) / n), y + dot * Math.sin((2 * Math.PI * i) / n), z], (v0 + i + 1) * 3);
    for (let i = 0; i < n; i++) indices.set([v0, v0 + i + 1, v0 + ((i + 1) % n) + 1], (d * n + i) * 3);
  }
  return { positions, indices };
}

/** The status line: the card's size, its colours and what the build decided, or every reason it
 *  will not print. */
function describe(b: Built) {
  const problems = problemsOf(b);
  if (problems.length) {
    status.set(problems.join(' '), 'error');
    return;
  }
  const top = b.solid.thickness + raiseOf(b.s);
  const colours = b.solid.parts.length;
  const clauses = [`${b.design.w} × ${b.design.h} × ${top.toFixed(1)} mm`, `${colours} ${colours === 1 ? 'colour' : 'colours'}`];
  if (b.solid.pocketCeiling !== null) clauses.push(`The print pauses at ${b.solid.pocketCeiling.toFixed(1)} mm for the NFC tag`);
  clauses.push(...b.design.notes.filter((n) => n === QR_MOVED || n.startsWith(QR_LEFT_OUT)));
  clauses.push(...b.solid.notes);
  status.set(clauses.join(' · '));
}

// ---------------------------------------------------------------------------
// 3. SETTINGS (left panel) — the controls, then the rail that sorts them into categories.
// ---------------------------------------------------------------------------
const sizeOptions = Object.entries(CARD_SIZES).map(([value, s]) => ({ value, label: `${s.label} mm` }));
const ICON_STYLES: { value: IconStyle; label: string }[] = [
  { value: 'classic', label: 'Classic' },
  { value: 'classic-circle', label: 'In circles' },
  { value: 'modern', label: 'Modern' },
  { value: 'modern-square', label: 'In squares' },
  { value: 'none', label: 'No icons' },
];
const QR_STYLES: { value: QrStyleChoice; label: string }[] = [
  { value: 'square', label: 'Square' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'dots', label: 'Dots' },
  { value: 'finder', label: 'Round corners' },
];

const controls = {
  // Card.
  twoSided: toggleSwitch({
    label: 'Print the back too',
    checked: settings.twoSided,
    help: 'A back printed in the same go, for the logo, a name and the QR code.',
    onChange: (on) => { settings.twoSided = on; applyVisibility(); triggerRebuild(); },
  }),
  backText: segmentedControl<CardSettings['backText']>({
    label: 'Name on the back',
    variant: 'cards',
    columns: 1,
    options: [{ value: 'company', label: 'Company name' }, { value: 'name', label: 'Your name' }, { value: 'none', label: 'Nothing' }],
    value: settings.backText,
    onChange: (v) => { settings.backText = v; triggerRebuild(); },
  }),
  size: segmentedControl({
    label: 'Size',
    help: '85 × 55 is the European size, 89 × 51 the US one, 91 × 55 the Japanese one.',
    variant: 'cards',
    columns: 2,
    options: sizeOptions,
    value: settings.size,
    onChange: (v) => { settings.size = v; triggerRebuild(true); },
  }),
  corner: sliderRow({
    label: 'Corner radius', min: 0, max: 6, step: 0.5, value: settings.corner, unit: 'mm',
    onInput: (v) => { settings.corner = v; triggerRebuild(); },
  }),
  thickness: sliderRow({
    label: 'Thickness', min: 0.8, max: 3, step: 0.2, value: settings.thickness, unit: 'mm',
    help: 'Without raised lettering. An NFC pocket makes it thicker if it needs to.',
    onInput: (v) => { settings.thickness = v; triggerRebuild(); },
  }),
  // Lettering.
  raised: toggleSwitch({
    label: 'Raised lettering',
    checked: settings.raised,
    help: 'The letters stand up from the card. Off, they lie flat in its face, printed against the plate.',
    onChange: (on) => { settings.raised = on; applyVisibility(); triggerRebuild(); },
  }),
  raise: sliderRow({
    label: 'Raised by', min: 0.2, max: 1.2, step: 0.2, value: settings.raise, unit: 'mm',
    onInput: (v) => { settings.raise = v; triggerRebuild(); },
  }),
  nameSize: sliderRow({
    label: 'Name size', min: NAME_FLOOR, max: 8, step: 0.2, value: settings.nameSize, unit: 'mm',
    help: 'Capital height. A long name is made smaller to fit, never smaller than prints.',
    onInput: (v) => { settings.nameSize = v; triggerRebuild(); },
  }),
  detailSize: sliderRow({
    label: 'Details size', min: DETAIL_FLOOR, max: 5, step: 0.1, value: settings.detailSize, unit: 'mm',
    help: 'Capital height of the title and contact lines, never smaller than a 0.4 mm nozzle prints.',
    onInput: (v) => { settings.detailSize = v; triggerRebuild(); },
  }),
  nameCase: segmentedControl<CardSettings['nameCase']>({
    label: 'Name',
    variant: 'cards',
    columns: 1,
    options: [{ value: 'as-typed', label: 'As typed' }, { value: 'upper', label: 'CAPITALS' }, { value: 'title', label: 'Title Case' }],
    value: settings.nameCase,
    onChange: (v) => { settings.nameCase = v; triggerRebuild(); },
  }),
  letterSpacing: sliderRow({
    label: 'Letter spacing', min: -5, max: 25, step: 1, value: settings.letterSpacing, unit: '%',
    onInput: (v) => { settings.letterSpacing = v; triggerRebuild(); },
  }),
  // Icons.
  iconStyle: segmentedControl<IconStyle>({
    variant: 'tiles',
    columns: 2,
    size: 'compact',
    options: ICON_STYLES,
    value: settings.iconStyle,
    onChange: (v) => { settings.iconStyle = v; triggerRebuild(); },
  }),
  // Pattern.
  patternZoom: sliderRow({
    label: 'Zoom', min: 50, max: 200, step: 5, value: settings.patternZoom, unit: '%',
    onInput: (v) => { settings.patternZoom = v; triggerRebuild(); },
  }),
  patternAngle: sliderRow({
    label: 'Angle', min: 0, max: 180, step: 5, value: settings.patternAngle, unit: '°',
    onInput: (v) => { settings.patternAngle = v; triggerRebuild(); },
  }),
  patternMode: segmentedControl<CardSettings['patternMode']>({
    label: 'Pattern is',
    help: 'Carved goes into the card; cut through leaves holes.',
    options: [{ value: 'colour', label: 'In colour' }, { value: 'carved', label: 'Carved' }, { value: 'cut', label: 'Cut through' }],
    value: settings.patternMode,
    onChange: (v) => { settings.patternMode = v; triggerRebuild(); },
  }),
  // QR.
  qrStyle: segmentedControl<QrStyleChoice>({
    variant: 'tiles',
    columns: 2,
    size: 'compact',
    options: QR_STYLES,
    value: settings.qrStyle,
    onChange: (v) => { settings.qrStyle = v; triggerRebuild(); },
  }),
  qrSize: segmentedControl<CardSettings['qrSize']>({
    label: 'Size',
    help: 'A larger code scans from further away. It takes the room the card has.',
    options: [{ value: 'standard', label: 'Standard' }, { value: 'large', label: 'Large' }],
    value: settings.qrSize,
    onChange: (v) => { settings.qrSize = v; triggerRebuild(); },
  }),
  qrLogo: toggleSwitch({
    label: 'Logo in the middle',
    checked: settings.qrLogo,
    help: 'Your logo (or initials) in the centre of the code. The code grows a little to stay readable.',
    onChange: (on) => { settings.qrLogo = on; triggerRebuild(); },
  }),
  // NFC.
  nfc: toggleSwitch({
    label: 'NFC tag pocket',
    checked: settings.nfc,
    help: 'A pocket inside the card. The print pauses so you can drop the tag in.',
    onChange: (on) => { settings.nfc = on; applyVisibility(); triggerRebuild(); },
  }),
  nfcTag: segmentedControl({
    label: 'Tag',
    variant: 'cards',
    columns: 1,
    options: Object.entries(NFC_TAGS).map(([value, t]) => ({ value, label: t.label })),
    value: settings.nfcTag,
    onChange: (v) => { settings.nfcTag = v; triggerRebuild(); },
  }),
  nfcMark: toggleSwitch({
    label: 'Show where to tap',
    checked: settings.nfcMark,
    help: 'A small tap mark printed over the tag.',
    onChange: (on) => { settings.nfcMark = on; triggerRebuild(); },
  }),
  // Colors: the three filaments.
  cardColor: filamentRow({ label: 'Card', value: settings.cardColor, extra: ownSwatches(), onChange: (hex) => { settings.cardColor = hex; mixed(hex); showColours(); triggerRebuild(); } }),
  inkColor: filamentRow({ label: 'Lettering', value: settings.inkColor, extra: ownSwatches(), onChange: (hex) => { settings.inkColor = hex; mixed(hex); showColours(); triggerRebuild(); } }),
  accentColor: filamentRow({ label: 'Accent', value: settings.accentColor, extra: ownSwatches(), onChange: (hex) => { settings.accentColor = hex; mixed(hex); showColours(); triggerRebuild(); } }),
  // The right panel's fields (section 4), held here with the rest so they sync with them.
  name: textField({ label: 'Name', value: settings.name, placeholder: 'Your name', onInput: (v) => { settings.name = v; showSample(); triggerRebuild(); } }),
  title: textField({ label: 'Title', value: settings.title, placeholder: 'Job title', onInput: (v) => { settings.title = v; triggerRebuild(); } }),
  company: textField({ label: 'Company', value: settings.company, placeholder: 'Company', onInput: (v) => { settings.company = v; triggerRebuild(); } }),
  phone: textField({ label: 'Phone', value: settings.phone, placeholder: 'Phone number', onInput: (v) => { settings.phone = v; triggerRebuild(); } }),
  email: textField({ label: 'Email', value: settings.email, placeholder: 'Email', onInput: (v) => { settings.email = v; triggerRebuild(); } }),
  website: textField({ label: 'Website', value: settings.website, placeholder: 'yoursite.com', onInput: (v) => { settings.website = v; showOpens(); triggerRebuild(); } }),
  qr: toggleSwitch({ label: 'QR code', checked: settings.qr, onChange: (on) => { settings.qr = on; applyVisibility(); triggerRebuild(); } }),
  qrPlace: segmentedControl<CardSettings['qrPlace']>({
    label: 'Side',
    options: [{ value: 'back', label: 'Back' }, { value: 'front', label: 'Front' }],
    value: settings.qrPlace,
    onChange: (v) => { settings.qrPlace = v; triggerRebuild(); },
  }),
  qrKind: segmentedControl<CardSettings['qrKind']>({
    label: 'Opens',
    help: 'Your contact card saves your name, phone and email straight into a phone. It makes a bigger code.',
    variant: 'cards',
    columns: 1,
    options: [{ value: 'website', label: 'Website' }, { value: 'contact', label: 'Contact card' }, { value: 'link', label: 'Other link' }],
    value: settings.qrKind,
    onChange: (v) => { settings.qrKind = v; applyVisibility(); showOpens(); triggerRebuild(); },
  }),
  qrLink: textField({ label: 'Link', value: settings.qrLink, placeholder: 'https://…', onInput: (v) => { settings.qrLink = v; showOpens(); triggerRebuild(); } }),
  logoMode: segmentedControl<CardSettings['logoMode']>({
    label: 'Show',
    options: [{ value: 'logo', label: 'Logo' }, { value: 'initials', label: 'Initials' }, { value: 'none', label: 'Nothing' }],
    value: settings.logoMode,
    onChange: (v) => { settings.logoMode = v; applyVisibility(); triggerRebuild(); },
  }),
  logoPlace: segmentedControl<CardSettings['logoPlace']>({
    label: 'Side',
    options: [{ value: 'back', label: 'Back' }, { value: 'front', label: 'Front' }],
    value: settings.logoPlace,
    onChange: (v) => { settings.logoPlace = v; triggerRebuild(); },
  }),
};

/** The pattern picker: the shelf's card with "Choose pattern" and "Surprise me". Not in
 *  `controls` (it is not a value row); `showSettings()` syncs it by hand. */
const pattern = patternRow({
  value: settings.pattern,
  onPick: (id) => { settings.pattern = id; triggerRebuild(); },
});

/**
 * Each part in a colour of its own: a row per part, its chip showing the colour it prints in. The
 * popover offers the three filaments first, so most changes add no colour; the wheel picks any.
 */
const PART_ROWS: { role: Role; label: string }[] = [
  { role: 'name', label: 'Name' },
  { role: 'details', label: 'Details' },
  { role: 'icons', label: 'Icons' },
  { role: 'rule', label: 'Rule' },
  { role: 'logo', label: 'Logo' },
  { role: 'qr', label: 'QR code' },
  { role: 'shapes', label: 'Shapes' },
  { role: 'pattern', label: 'Pattern' },
];
/** The colour a part prints in when it was not given its own (the QR's is decided by contrast). */
function familyColour(role: Role): string {
  if (role === 'name' || role === 'details') return settings.inkColor;
  if (role === 'qr') return lastQrColour ?? settings.inkColor;
  if (role === 'card') return settings.cardColor;
  return settings.accentColor;
}
let lastQrColour: string | null = null;
const partRows = new Map<Role, ReturnType<typeof paletteRow>>();
/** What a part's colour picker offers: the three filaments first (no new colour), then the
 *  customer's own mixes, then the common filament shelf, each colour once. */
const paletteOptions = () => {
  const offered = [
    { hex: settings.cardColor, name: 'Card' },
    { hex: settings.inkColor, name: 'Lettering' },
    { hex: settings.accentColor, name: 'Accent' },
    ...settings.customColors.map((hex) => ({ hex, name: 'Your colour' })),
    ...FILAMENTS.map(([name, hex]) => ({ hex, name })),
  ];
  return offered.filter((o, i) => offered.findIndex((x) => x.hex.toLowerCase() === o.hex.toLowerCase()) === i);
};
/** The customer's own colours as the filament rows' first swatches. */
function ownSwatches(): [string, string][] {
  return settings.customColors.map((hex) => ['Your colour', hex]);
}
/** A colour the customer mixed, kept (newest first) for every picker to offer; a shelf colour is
 *  already offered. */
function rememberColour(hex: string) {
  const c = hex.toLowerCase();
  if (FILAMENTS.some(([, f]) => f.toLowerCase() === c)) return;
  settings.customColors = [c, ...settings.customColors.filter((x) => x !== c)].slice(0, CUSTOM_COLOURS);
  for (const row of [controls.cardColor, controls.inkColor, controls.accentColor]) row.setExtra(ownSwatches());
  showColours();
}
/** A filament row's wheel reports every step of a drag: the colour is remembered once it rests. */
let mixedTimer = 0;
function mixed(hex: string) {
  window.clearTimeout(mixedTimer);
  mixedTimer = window.setTimeout(() => rememberColour(hex), 800);
}
const partsBody = el('div', { className: 'bc-parts' });
/** Rebuild the part rows' chips: their colours and the filaments they offer. */
function showColours() {
  partsBody.replaceChildren();
  for (const { role, label } of PART_ROWS) {
    const row = paletteRow({
      label,
      value: settings.colors[role] ?? familyColour(role),
      options: paletteOptions(),
      onChange: (hex) => {
        settings.colors[role] = hex;
        triggerRebuild();
      },
      onCustom: rememberColour,
    });
    row.hidden = role === 'qr' ? !settings.qr : !present.has(role);
    partRows.set(role, row);
    partsBody.append(row);
  }
}
/** The parts the current design has: a row for a part the card does not carry is hidden. */
let present = new Set<Role>(['name', 'details', 'icons', 'rule', 'logo', 'qr', 'shapes']);
function showPresent(d: Design) {
  const roles = new Set<Role>();
  for (const face of [d.front, d.back]) {
    if (!face) continue;
    for (const ink of face.ink) roles.add(ink.role);
    if (face.fields.length) roles.add('shapes');
    if (face.pattern && face.pattern.mode === 'colour') roles.add('pattern');
    const qr = face.ink.find((i) => i.role === 'qr');
    if (qr) lastQrColour = qr.colour;
  }
  const changed = roles.size !== present.size || [...roles].some((r) => !present.has(r));
  present = roles;
  if (changed) showColours();
  else for (const [role, row] of partRows) if (!settings.colors[role]) row.setValue(familyColour(role));
  partRows.get('qr')?.toggleAttribute('hidden', !settings.qr);
}

const sampleOf = (text: string) => text.trim().slice(0, 12) || 'John';

/** Faces that suit a card: sturdy sans for the details, a few with character for the name. Any face
 *  prints: the engine thickens the strokes a nozzle could not. */
const FONT_CARDS = [
  'inter', 'roboto', 'poppins', 'montserrat', 'manrope', 'outfit', 'figtree', 'work-sans', 'rubik', 'lexend', 'sora', 'kanit',
  'archivo', 'archivo-black', 'russo-one', 'oswald', 'anton', 'bebas-neue', 'staatliches', 'teko',
  'bree-serif', 'roboto-slab', 'zilla-slab', 'arvo', 'libre-baskerville', 'playfair-display', 'lora', 'cinzel',
  'jetbrains-mono', 'space-mono', 'quicksand', 'comfortaa',
];

const fonts = fontChooser({
  fonts: FONTS.map(toPickerFont),
  curated: FONT_CARDS,
  featuredLabel: 'Good on a card',
  value: settings.font,
  sample: sampleOf(settings.name),
  checkText: [settings.name, settings.title, settings.company, settings.email].join(' '),
  fill: true,
  supports: (f, text) => fontSupportsText(f.id, text),
  onChange: (id) => { settings.font = id; triggerRebuild(); },
  onImport: async (file) => {
    const { fonts: imported, failed } = await importFontFiles(file);
    return { fonts: imported.map(toPickerFont), failed };
  },
});

function showSample() {
  fonts.setSample(sampleOf(settings.name), [settings.name, settings.title, settings.company, settings.email].join(' '));
}

/** Under "Opens": the link the code opens, exactly as encoded, or what a contact card saves. */
const qrOpens = el('p', { className: 'vl-hint' });

/** The logo's drop zone (into the SVG import window), and under its side the word when the
 *  template has no room for it on the face asked for. */
const logoDrop = el('div', { className: 'bc-logo' });
const logoHint = el('p', { className: 'vl-hint', attrs: { hidden: '' } });

/** The QR code as it prints, in its colours, at the top of the QR category. */
const qrPreview = el('div', { className: 'bc-qr-preview' });
const qrCaption = el('p', { className: 'vl-hint' });

/*
  The rail, in the order the customer thinks about a card: the card itself, the letters, the
  icons, the pattern where there is one, the logo, the QR, the NFC tag, and the colours. Every
  setting sits in the category it changes; the template is chosen from the menu (section 8).
*/
const rail = settingsRail({
  label: 'Card settings',
  flush: true,
  onChange: (id) => {
    if (id === 'icons') void drawIconTiles();
    if (id === 'qr') drawQrTiles();
  },
  items: [
    { id: 'card', label: 'Card', title: 'The card', icon: ICONS.card, body: [controls.twoSided, controls.backText, controls.size, controls.corner, controls.thickness] },
    { id: 'font', label: 'Font', icon: ICONS.text, fill: true, body: [fonts] },
    {
      id: 'lettering', label: 'Lettering', icon: ICONS.lettering,
      body: [controls.raised, controls.raise, controls.nameSize, controls.detailSize, controls.nameCase, controls.letterSpacing],
    },
    { id: 'icons', label: 'Icons', title: 'Contact icons', icon: ICONS.phone, body: [controls.iconStyle] },
    { id: 'pattern', label: 'Pattern', icon: ICONS.pattern, body: [pattern.root, controls.patternZoom, controls.patternAngle, controls.patternMode] },
    { id: 'logo', label: 'Logo', icon: ICONS.image, body: [controls.logoMode, logoDrop, controls.logoPlace, logoHint] },
    {
      id: 'qr', label: 'QR', title: 'QR code', icon: ICONS.qr,
      body: [controls.qr, controls.qrPlace, controls.qrKind, controls.qrLink, qrOpens, qrPreview, qrCaption, controls.qrStyle, controls.qrSize, controls.qrLogo],
    },
    { id: 'nfc', label: 'NFC', title: 'NFC tag', icon: ICONS.nfc, body: [controls.nfc, controls.nfcTag, controls.nfcMark] },
    {
      id: 'colors', label: 'Colors', icon: ICONS.droplet,
      body: [controls.cardColor, controls.inkColor, controls.accentColor, section({ title: 'Each part', body: [partsBody] })],
    },
  ],
});

/** Hide what does not apply, never grey it. */
function applyVisibility() {
  const t = templateById(settings.template);
  controls.nfcTag.hidden = !settings.nfc && !t.nfc;
  controls.nfcMark.hidden = !settings.nfc || !!t.nfc;
  controls.nfc.hidden = !!t.nfc;
  controls.raise.hidden = !settings.raised;
  controls.backText.hidden = !settings.twoSided;
  for (const c of [controls.qrKind, controls.qrStyle, controls.qrSize, qrOpens, qrPreview, qrCaption]) c.hidden = !settings.qr;
  controls.qrPlace.hidden = !settings.qr || !settings.twoSided || !!t.qrSide;
  controls.qrLink.hidden = !settings.qr || settings.qrKind !== 'link';
  controls.qrLogo.hidden = !settings.qr || settings.logoMode === 'none';
  logoDrop.hidden = settings.logoMode !== 'logo';
  controls.logoPlace.hidden = settings.logoMode === 'none' || !settings.twoSided || !!t.markFixed;
  rail.setVisible('pattern', !!t.pattern);
  viewBar.setToggleVisible('nfc', settings.nfc || !!t.nfc);
  rail.refresh();
}

/** A template opens as it was designed: its own pattern and the way it makes it. */
function openTemplate() {
  const t = templateById(settings.template);
  // A tag dragged on one template would land anywhere on the next: it starts where this one puts it.
  settings.nfcAt = null;
  if (t.pattern) {
    settings.pattern = t.pattern.value;
    settings.patternMode = t.pattern.mode ?? 'colour';
    pattern.set(settings.pattern);
    controls.patternMode.setValue(settings.patternMode);
  }
  applyVisibility();
}

/**
 * Put `settings` into every control and keep only what the controls can show: after Load and
 * Reset. The font chooser, the pattern card and the part colours are done by hand.
 */
function showSettings() {
  syncControls(settings, controls);
  fonts.setValue(settings.font);
  settings.font = fonts.getValue();
  pattern.set(settings.pattern);
  showSample();
  for (const row of [controls.cardColor, controls.inkColor, controls.accentColor]) row.setExtra(ownSwatches());
  showColours();
  showLogo();
  showOpens();
  applyVisibility();
}

// ---------------------------------------------------------------------------
// Pictures in the pickers: the icon styles drawn with the real icons, the QR styles drawn with the
// real code. (The templates' pictures are the menu's, section 8.)
// ---------------------------------------------------------------------------

/** Shapes as one SVG path, Y flipped, in a box `w` × `h` centred on the origin. */
function shapesSvg(shapes: Shapes, fill: string, w: number, h: number, bg?: string, minus?: Shapes): string {
  const d = (s: Shapes) => s.flat().map((r) => `M${r.map(([x, y]) => `${x.toFixed(3)} ${(-y).toFixed(3)}`).join('L')}Z`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-w / 2} ${-h / 2} ${w} ${h}">${bg ? `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" fill="${bg}"/>` : ''}<path fill="${fill}" fill-rule="evenodd" d="${d(shapes)}${minus ? d(minus) : ''}"/></svg>`;
}

async function drawIconTiles() {
  const { icons } = await loadSymbols();
  const bg = settings.cardColor;
  const fg = settings.colors.icons ?? settings.accentColor;
  for (const { value } of ICON_STYLES) {
    if (value === 'none') {
      controls.iconStyle.setOptionImage(value, svgUrl(shapesSvg([], fg, 6, 5, bg)));
      continue;
    }
    const set = icons[value.startsWith('modern') ? 'modern' : 'classic'];
    const badge = value.endsWith('-circle') ? 'circle' : value.endsWith('-square') ? 'square' : null;
    const shapes: Shapes = [];
    const minus: Shapes = [];
    CONTACT_ROLES.forEach((role, i) => {
      const glyph = set[role] ?? [];
      const cx = (i - 1) * 1.7;
      if (badge) {
        const ring: [number, number][] = badge === 'circle'
          ? Array.from({ length: 40 }, (_, k): [number, number] => [cx + 0.62 * Math.cos((2 * Math.PI * k) / 40), 0.62 * Math.sin((2 * Math.PI * k) / 40)])
          : [[cx - 0.6, -0.6], [cx + 0.6, -0.6], [cx + 0.6, 0.6], [cx - 0.6, 0.6]];
        shapes.push([ring]);
        minus.push(...mapShapes(glyph, ([x, y]) => [cx + x * 0.72, y * 0.72]));
      } else {
        shapes.push(...mapShapes(glyph, ([x, y]) => [cx + x * 1.1, y * 1.1]));
      }
    });
    controls.iconStyle.setOptionImage(value, svgUrl(shapesSvg(shapes, fg, 6, 5, bg, minus)));
  }
}

function drawQrTiles() {
  const content = settings.website.trim() || 'smithstudio.com';
  for (const { value } of QR_STYLES) {
    const code = qrShapes(`https://${content.replace(/^https?:\/\//, '')}`, 3.6, 'M', { style: value });
    controls.qrStyle.setOptionImage(value, svgUrl(shapesSvg(code.shapes, '#16181d', 6, 5, '#f4f4f2')));
  }
}

/** A logo asked for on a face that has no room for it: said under the side it was asked for. */
function showLogoHint(b: Built) {
  const asked = b.s.logoMode !== 'none' && b.s.twoSided ? b.s.logoPlace : null;
  const face = asked === 'front' ? b.design.front : asked === 'back' ? b.design.back : null;
  const missing = !!face && !templateById(b.s.template).markFixed && !face.ink.some((i) => i.role === 'logo');
  logoHint.hidden = !missing;
  logoHint.textContent = missing ? `This template has no room for the logo on the ${asked}. Try the other side.` : '';
}

/** The QR as the card carries it: its ink cropped from the design, on what it sits on. */
function showQrPreview(b: Built) {
  const face = [b.design.front, b.design.back].find((f) => f?.ink.some((i) => i.role === 'qr'));
  const ink = face?.ink.find((i) => i.role === 'qr');
  if (!ink) {
    qrPreview.replaceChildren();
    qrCaption.textContent = settings.qr ? (b.design.notes.find((n) => n.startsWith(QR_LEFT_OUT)) ?? 'No QR code on this card: see the status line.') : '';
    showOpens(b);
    return;
  }
  const box = bboxOf(ink.shapes);
  const pad = 1;
  const w = box.maxX - box.minX + 2 * pad;
  const h = box.maxY - box.minY + 2 * pad;
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const centred = (s: Shapes) => mapShapes(s, ([x, y]) => [x - cx, y - cy]);
  const img = el('img', { attrs: { alt: 'The QR code as it prints', src: svgUrl(shapesSvg(centred(ink.shapes), ink.colour, w, h, b.design.card, ink.minus ? centred(ink.minus) : undefined)) } });
  qrPreview.replaceChildren(img);
  const module = b.design.notes.find((n) => /^QR [0-9.]+ mm modules$/.test(n))?.replace(/^QR /, '');
  // What the engine gave up so the code fits, and where it put it, in the panel's own words.
  const said = b.design.notes.filter((n) => /^The code (is in square|has no logo|stands on a tile)/.test(n) || n === QR_MOVED || n === QR_TAKES_BACK || n.startsWith('No room for a larger QR'));
  qrCaption.textContent = [module, ...said].filter(Boolean).join(' · ');
  showOpens(b);
}

/** What the code opens, as encoded (https:// and all), or what a contact card saves to a phone. */
function showOpens(b: Built | null = lastBuilt) {
  if (settings.qrKind === 'contact') {
    const saves = b?.s.qrKind === 'contact' ? b.design.notes.find((n) => n.startsWith('QR saves '))?.replace(/^QR saves/, 'Saves') : undefined;
    qrOpens.textContent = saves ? `${saves}.` : 'Saves your name, phone and email to a phone, and as much else as fits.';
    return;
  }
  const typed = settings.qrKind === 'link' ? settings.qrLink : settings.website;
  qrOpens.textContent = typed.trim()
    ? `Opens ${qrContent(typed)}`
    : settings.qrKind === 'link' ? 'Type the link the code opens.' : 'Opens your website: type it under Your details.';
}

// ---------------------------------------------------------------------------
// 4. WHAT THE CUSTOMER TYPES OR BRINGS IN (right panel) — the details, the QR, the logo.
// ---------------------------------------------------------------------------
/** The logo the import window made, as shapes in the symbol frame (centred, longest side 1). */
function logoOf(svgText: string, choices: Record<number, SvgImportChoice>): Shapes {
  const overrides: Record<number, SvgPartChoice> = {};
  for (const [index, c] of Object.entries(choices)) overrides[Number(index)] = { ...c };
  const set = parseSvg(svgText, { overrides, asPainted: true });
  const rings = set.regions.flatMap((r) => r.components.flatMap((c) => c.rings));
  const islands = islandsFromContours(rings);
  if (!islands.length) return [];
  const b = bboxOf(islands);
  const k = 1 / Math.max(b.maxX - b.minX, b.maxY - b.minY, 1e-9);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return mapShapes(islands, ([x, y]) => [(x - cx) * k, (y - cy) * k]);
}

/** The import window: the file, what will print, and the parts to keep. */
async function importLogo(file: File) {
  const svgText = await file.text();
  const { parts, issues } = describeSvg(svgText);
  const trace = (choices: Record<number, SvgImportChoice>): SvgImportTrace | null => {
    try {
      const shapes = logoOf(svgText, choices);
      if (!shapes.length) return null;
      const d = shapes.flat().map((r) => `M${r.map(([x, y]) => `${(x * 96).toFixed(2)},${(-y * 96).toFixed(2)}`).join('L')}Z`).join('');
      // The ink from the theme, so the preview reads in both themes.
      const ink = themeColor('--text', '#e6ebf2');
      return { viewBox: '-55 -55 110 110', paths: [{ d, fill: ink }], summary: 'Prints in one colour, the logo\'s.' };
    } catch {
      return null;
    }
  };
  const choices = await openSvgImport({ svgText, name: file.name, parts, issues, thinAt: 'business card size', trace });
  if (!choices) return;
  const shapes = logoOf(svgText, choices);
  if (!shapes.length) {
    toast('Nothing in that file prints as a shape. Try another SVG.', { kind: 'error' });
    return;
  }
  settings.logo = { id: `svg:${file.name}`, label: file.name.replace(/\.svg$/i, ''), shapes: shapes as Logo['shapes'] };
  settings.logoMode = 'logo';
  showSettings();
  triggerRebuild();
}

function showLogo() {
  const zone = dropZone({
    title: settings.logo ? settings.logo.label : 'Drop your logo here',
    text: settings.logo ? 'Drop or click to replace it' : 'or click to choose an SVG file',
    note: settings.logo ? undefined : 'Until then the card shows a placeholder',
    accept: '.svg,image/svg+xml',
    onFiles: (files) => { const f = files[0]; if (f) void importLogo(f); },
  });
  logoDrop.replaceChildren(zone);
}

const detailsSection = section({
  title: 'Your details',
  body: [controls.name, controls.title, controls.company, controls.phone, controls.email, controls.website],
});


// ---------------------------------------------------------------------------
// 5. CHROME — the header, Reset, the credit strip, and the export/save/load/help footer.
// ---------------------------------------------------------------------------
const back = button({ label: 'All templates', icon: ICONS.arrowLeft, emphasis: 'ghost', onClick: () => { location.hash = '#/'; } });
/** The open template's name and its line, under the way back. */
const titleSlot = el('div');

// Resets the settings and keeps what was typed and brought in: those are the customer's.
const reset = button({
  label: 'Reset all settings',
  icon: ICONS.rotateLeft,
  emphasis: 'ghost',
  onClick: () => {
    const { name, title, company, phone, email, website, qr, qrKind, qrLink, logo, logoMode, template, customColors } = settings;
    settings = { ...DEFAULT_SETTINGS, colors: {}, name, title, company, phone, email, website, qr, qrKind, qrLink, logo, logoMode, template, customColors };
    openTemplate();
    showSettings();
    triggerRebuild(true);
    toast('Settings reset', { kind: 'ok' });
  },
});

/** The parts as the plate takes them: a flush card turned face down (a half turn about the long
 *  axis, so nothing is mirrored and every triangle keeps its winding). */
function exportParts(b: Built): ExportPart[] {
  const flip = raiseOf(b.s) <= 0;
  const T = b.solid.thickness;
  return b.solid.parts.map((p) => {
    let positions = p.vertProperties;
    if (flip) {
      positions = new Float32Array(p.vertProperties.length);
      for (let i = 0; i < positions.length; i += 3) {
        positions[i] = -p.vertProperties[i]!;
        positions[i + 1] = p.vertProperties[i + 1]!;
        positions[i + 2] = T - p.vertProperties[i + 2]!;
      }
    }
    return { name: partName(p.roles), positions, indices: p.triVerts, color: rgb(p.colour) };
  });
}

const fileStem = (s: CardSettings) => (s.name.trim().toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'business-card');

const footer = sidebarFooter({
  // 3MF only: STL carries neither the colours nor the parts, the whole point of this card.
  formats: [{ id: '3mf', label: '3MF' }],
  onExport: async (format) => {
    if (format !== '3mf') throw new Error('Unknown format: ' + format);
    // The build that matches the screen; it refuses, with the reason, when the card will not print.
    const built = await loop.settled();
    const pause = built.solid.pocketCeiling !== null ? [pauseForPocket(built.solid.pocketCeiling)] : null;
    downloadThreeMF(exportParts(built), {
      title: 'Business card',
      generator: 'business-card',
      application: 'Vostok Labs Business Card Generator',
      buildId: import.meta.env.VITE_BUILD_ID,
      plateSize: plateSize(loadPlateChoice()),
      // The lettering is drawn near the nozzle's own width, and Arachne's walls print a stroke that
      // thin as one even bead where the classic walls drop it.
      process: { wall_generator: 'arachne' },
      ...(pause ? { pauseAt: pause } : {}),
    }, `${fileStem(built.s)}.3mf`);
    licenseAfterExport();
  },
  onSave: () => downloadFile(JSON.stringify(markProject(PROJECT_FILE, settings), null, 2), `${fileStem(settings)}-card.json`, 'application/json'),
  onLoad: (file?: File) =>
    file &&
    readProjectFile(file, (data) => {
      settings = coerceSettings(data);
      // The project's own template, as it was saved: its pattern and its tag's place are kept.
      if (location.hash !== `#/t/${settings.template}`) history.replaceState(null, '', `#/t/${settings.template}`);
      showTemplate(templateById(settings.template));
      showSettings();
      triggerRebuild(true);
      toast('Project loaded', { kind: 'ok' });
    }, PROJECT_FILE),
  onHelp: () =>
    dialog({
      title: 'Business Card Generator help',
      content: 'Pick a template from All templates and type your details on the right. Every other setting is on the left, one category at a time, the logo and the QR code among them; hover a "?" for what a control does. 2D over the preview shows both faces side by side. With an NFC tag, the dotted circle is where it goes: drag its label to move it. Download 3MF gives a file for Bambu Studio with each colour on its own filament.',
      actions: [{ label: 'Got it', primary: true }],
    }),
  themeStorageKey: 'business-card-theme',
});

// ---------------------------------------------------------------------------
// 6. STAGE — the 3D preview, both faces flat, and the overlays.
// ---------------------------------------------------------------------------
const status = stageStatus('Building…');
/** Says a build is under way: one takes a second or so, and until then the picture is the last one. */
const busy = busyChip({ defaultText: 'Building…', delay: 180 });
const stageCanvas = el('div', { className: 'bc-stage-canvas' });
/** Both faces side by side, flat: the 2D view. */
const flat = el('div', { className: 'bc-flat', attrs: { hidden: '' } });

type View = '3d' | 'front' | 'back' | '2d';
let view: View = '3d';
/** The NFC tag's place on the stage: shown until switched off over the preview. */
let showNfc = true;
const viewBar = previewBar<View>({
  label: 'View',
  modes: {
    label: 'View',
    options: [{ value: '3d', label: '3D' }, { value: 'front', label: 'Front' }, { value: 'back', label: 'Back' }, { value: '2d', label: '2D' }],
    value: '3d',
    onChange: (v) => showView(v),
  },
  toggles: [{
    id: 'nfc',
    label: 'NFC tag',
    pressed: true,
    title: 'Show where the NFC tag goes: a dotted circle, its label drags it.',
    onToggle: (on) => {
      showNfc = on;
      if (nfcPart >= 0) viewer.setPartVisible(nfcPart, on);
      if (lastBuilt) showFlat(lastBuilt);
    },
  }],
});

/*
  The NFC tag's place. In 3D a dotted circle on the face with a label hung off it; the label, or the
  circle itself, drags it across the card (on the face's plane, kept inside the card's border as
  the build keeps it). In 2D a dashed ring over the front with the same label. Dropped, the place
  is the customer's (`nfcAt`) until another template opens; the build still moves it off holes
  and, with the tap mark, off the lettering, to the nearest place that will print.
*/
const nfcHandle = stageHandle({ label: 'NFC tag', title: 'The NFC tag goes here, inside the card. Drag to move it.', icon: ICONS.move });
/** Where the tag is while it is dragged, and where it was dropped until the next build shows it. */
let draggedAt: [number, number] | null = null;
let droppedAt: [number, number] | null = null;
let dragFrom: { hit: [number, number]; at: [number, number] } | null = null;

/** A place for the tag inside the card's border, as the build keeps it. */
function clampTag(b: Built, at: [number, number]): [number, number] {
  const r = b.design.pocket!.r;
  const mx = Math.max(0, b.design.w / 2 - r - BORDER / 2);
  const my = Math.max(0, b.design.h / 2 - r - BORDER / 2);
  return [Math.max(-mx, Math.min(mx, at[0])), Math.max(-my, Math.min(my, at[1]))];
}
const tenth = (at: [number, number]): [number, number] => [Math.round(at[0] * 10) / 10, Math.round(at[1] * 10) / 10];
/** A tag the customer may move: on a card with a pocket, not one whose design is the tag. */
const tagMovable = (b: Built | null): b is Built => !!b?.design.pocket && !templateById(b.s.template).nfc;

/** A model point as pixels from the stage's top-left corner, or null behind the camera. */
function stagePoint(x: number, y: number, z: number): { x: number; y: number } | null {
  const v = viewer.root.localToWorld(new THREE.Vector3(x, y, z)).project(viewer.camera);
  if (v.z > 1) return null;
  const canvas = viewer.renderer.domElement.getBoundingClientRect();
  const stage = shell.stage.getBoundingClientRect();
  return { x: canvas.left - stage.left + ((v.x + 1) / 2) * canvas.width, y: canvas.top - stage.top + ((1 - v.y) / 2) * canvas.height };
}

/** The circle is drawn on the front face: the views that look at it (3D and Front) carry its label. */
const tagInView = () => view === '3d' || view === 'front';

/** The label hung off the circle's right edge, every frame (the camera moves). */
function placeNfcHandle() {
  const b = lastBuilt;
  if (!showNfc || !tagInView() || nfcPart < 0 || !tagMovable(b)) {
    nfcHandle.place(null);
    return;
  }
  const p = b.design.pocket!;
  const at = draggedAt ?? droppedAt ?? p.at;
  nfcHandle.place(stagePoint(at[0] + p.r, at[1], faceTop(b)));
}

function startTagDrag(e: PointerEvent): boolean {
  const b = lastBuilt;
  if (!tagMovable(b)) return false;
  const hit = viewer.pickOnPlane(e.clientX, e.clientY, faceTop(b));
  if (!hit) return false;
  dragFrom = { hit: [hit[0], hit[1]], at: droppedAt ?? b.design.pocket!.at };
  viewer.setOrbitEnabled(false);
  window.addEventListener('pointermove', moveTagDrag);
  window.addEventListener('pointerup', endTagDrag, { once: true });
  return true;
}
function moveTagDrag(e: PointerEvent) {
  const b = lastBuilt;
  if (!dragFrom || !tagMovable(b)) return;
  const hit = viewer.pickOnPlane(e.clientX, e.clientY, faceTop(b));
  if (!hit) return;
  draggedAt = clampTag(b, [dragFrom.at[0] + hit[0] - dragFrom.hit[0], dragFrom.at[1] + hit[1] - dragFrom.hit[1]]);
  const p = b.design.pocket!;
  if (nfcPart >= 0) viewer.setPartOffset(nfcPart, [draggedAt[0] - p.at[0], draggedAt[1] - p.at[1], 0]);
}
function endTagDrag() {
  window.removeEventListener('pointermove', moveTagDrag);
  viewer.setOrbitEnabled(true);
  dragFrom = null;
  if (!draggedAt) return;
  droppedAt = draggedAt;
  draggedAt = null;
  settings.nfcAt = tenth(droppedAt);
  triggerRebuild();
}
nfcHandle.addEventListener('pointerdown', (e) => {
  if (startTagDrag(e)) e.preventDefault();
});
/** Over the dotted circle, as the build last placed it (or as it is being dragged). */
function overTag(e: PointerEvent): boolean {
  const b = lastBuilt;
  if (!showNfc || !tagInView() || !tagMovable(b)) return false;
  const p = b.design.pocket!;
  const at = droppedAt ?? p.at;
  const hit = viewer.pickOnPlane(e.clientX, e.clientY, faceTop(b));
  return !!hit && Math.hypot(hit[0] - at[0], hit[1] - at[1]) <= p.r + 1;
}
// The circle itself drags too: the press is caught on its way down, before the orbit controls
// on the canvas would turn it into a rotation.
stageCanvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !overTag(e)) return;
  if (startTagDrag(e)) {
    e.stopPropagation();
    e.preventDefault();
  }
}, { capture: true });
stageCanvas.addEventListener('pointermove', (e) => {
  if (e.buttons === 0) stageCanvas.classList.toggle('is-over-tag', overTag(e));
});

/** The back is seen from underneath with the plate out of the way; 2D lays both faces out flat. */
function showView(v: View) {
  view = v;
  flat.hidden = v !== '2d';
  if (v === '2d') {
    if (lastBuilt) showFlat(lastBuilt);
    return;
  }
  viewer.setPlateVisible(v !== 'back');
  viewer.setView(v === 'front' ? 'top' : v === 'back' ? 'bottom' : 'iso');
}

function showFlat(b: Built) {
  if (view !== '2d') return;
  const figure = (side: 'front' | 'back', label: string) => {
    // The front's tag is drawn over the picture, where it drags; the back's is in the picture.
    const tagOver = side === 'front' && showNfc && !!b.design.pocket;
    const img = el('img', { attrs: { alt: label, src: svgUrl(designSvg(b.design, side, { width: 600, pocket: side === 'back' && showNfc })) } });
    const card = el('div', { className: 'bc-flat__card' }, [img, ...(tagOver ? [flatTag(b)] : [])]);
    return el('figure', { className: 'bc-flat__face' }, [card, el('figcaption', { className: 'bc-flat__label', text: label })]);
  };
  flat.replaceChildren(figure('front', 'Front'), ...(b.design.back ? [figure('back', 'Back')] : [el('p', { className: 'vl-hint', text: 'One-sided: the back is plain.' })]));
}

/** The NFC tag's place over the front's flat picture: a dashed ring and its label, dragged to move
 *  it. In the picture's own frame (the card and 0.6 mm round it), so it needs no measuring. */
function flatTag(b: Built): HTMLElement {
  const p = b.design.pocket!;
  const W = b.design.w + 1.2;
  const H = b.design.h + 1.2;
  const ring = el('div', { className: 'bc-flat__tag' }, [el('span', { className: 'bc-flat__tag-label', text: 'NFC tag' })]);
  const put = (at: [number, number]) => {
    ring.style.left = `${((W / 2 + at[0] - p.r) / W) * 100}%`;
    ring.style.top = `${((H / 2 - at[1] - p.r) / H) * 100}%`;
    ring.style.width = `${((2 * p.r) / W) * 100}%`;
    ring.style.height = `${((2 * p.r) / H) * 100}%`;
  };
  put(droppedAt ?? p.at);
  if (!tagMovable(b)) return ring;
  ring.classList.add('is-draggable');
  ring.title = 'The NFC tag goes here, inside the card. Drag to move it.';
  ring.addEventListener('pointerdown', (e) => {
    const k = W / ring.parentElement!.getBoundingClientRect().width;
    const from = droppedAt ?? p.at;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let at = from;
    ring.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      at = clampTag(b, [from[0] + (ev.clientX - x0) * k, from[1] - (ev.clientY - y0) * k]);
      put(at);
    };
    ring.addEventListener('pointermove', move);
    ring.addEventListener('pointerup', () => {
      ring.removeEventListener('pointermove', move);
      if (at === from) return;
      droppedAt = at;
      settings.nfcAt = tenth(at);
      triggerRebuild();
    }, { once: true });
    e.preventDefault();
  });
  return ring;
}

const hint = el('p', { className: 'vl-stage__hint', text: 'Hold left click to rotate, right click to pan, scroll to zoom.' });

// ---------------------------------------------------------------------------
// 7. ASSEMBLE
// ---------------------------------------------------------------------------
const shell = appShell({
  topbar: topbarLinks({ themeToggle: false }),
  phone: true,
  left: {
    compact: true,
    header: [back, titleSlot],
    scroll: [rail],
    footer: [buttonRow(reset)],
    credit: panelCredit({ title: 'Business Card Generator', updates: { entries: CHANGELOG, title: 'Updates' } }),
  },
  stage: [stageCanvas, flat, stageTools([stageRow([viewBar.root])]), status.root, busy, nfcHandle, hint],
  right: {
    scroll: [detailsSection],
    footer: [footer],
  },
});

const editorRoot = shell.root;

const viewer = createViewer(stageCanvas, { frame: { fill: 0.72 } });
mountPlatePicker(shell.stage, viewer);
viewer.onFrame(placeNfcHandle);

// ---------------------------------------------------------------------------
// 8. TWO SCREENS: the template menu at #/, the editor at #/t/<template>.
// ---------------------------------------------------------------------------
/** The pictures' shape in the menu: a card on its side, with room round it. */
const MENU_ASPECT = 3 / 2;
/** Room round the card in its picture, mm: the menu's cards sit inside their tiles, not edge to edge. */
const MENU_MARGIN = 7;
/** The cards' edge in the menu: a grey that shows on either theme's tiles. */
const MENU_EDGE = '#8b93a180';

const menuCards = new Map<string, GalleryCardHandle>();
/** The settings the menu's pictures were last drawn with, and the generation drawing them. */
let drawnFor = '';
let drawnWith: CardSettings = settings;
let drawGen = 0;
const toDraw: string[] = [];
let drawing = false;

/** A template as it opens: the customer's settings, with the template's own pattern. */
const openedAs = (s: CardSettings, t: Template): CardSettings => ({
  ...s,
  template: t.id,
  nfcAt: null,
  ...(t.pattern ? { pattern: t.pattern.value, patternMode: t.pattern.mode ?? 'colour' } : {}),
});

/** Draw the templates waiting for a picture, one at a time, the newest settings only. */
async function drawMenu() {
  if (drawing) return;
  drawing = true;
  try {
    const gen = drawGen;
    const s = drawnWith;
    const assets = await loadAssets(s.font);
    while (toDraw.length && gen === drawGen) {
      const t = templateById(toDraw.shift()!);
      const d = await buildDesign(openedAs(s, t), assets, t);
      if (gen !== drawGen) break;
      const card = menuCards.get(t.id)!;
      card.setThumb(svgUrl(designSvg(d, 'front', { width: 360, aspect: MENU_ASPECT, margin: MENU_MARGIN, edge: MENU_EDGE })));
      // Pointed at, both faces side by side, as 2D shows them; a one-sided card has only its front.
      if (d.back) card.setHover(svgUrl(pairSvg(d, { width: 360, aspect: MENU_ASPECT, margin: MENU_MARGIN / 2, edge: MENU_EDGE })));
      // A turn for painting between pictures: eighteen of them in one go held the page.
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    drawing = false;
  }
  if (toDraw.length) void drawMenu();
}

/* A card's picture is drawn once it comes near the screen, so the cards in view come first. */
const nearScreen =
  typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            nearScreen!.unobserve(e.target);
            toDraw.push((e.target as HTMLElement).dataset.template!);
          }
          void drawMenu();
        },
        { rootMargin: '300px 0px' },
      )
    : null;

/** Draw the menu again when the settings changed since it was drawn: the old pictures stay up
 *  until their new ones are ready. */
function refreshMenu() {
  const key = JSON.stringify({ ...settings, template: '', nfcAt: null });
  if (key === drawnFor) return;
  drawnFor = key;
  drawnWith = { ...settings, colors: { ...settings.colors } };
  drawGen++;
  toDraw.length = 0;
  for (const [id, card] of menuCards) {
    if (!nearScreen) toDraw.push(id);
    else {
      nearScreen.unobserve(card);
      nearScreen.observe(card);
    }
  }
  if (!nearScreen) void drawMenu();
}

const menu = galleryPage({
  title: 'Business Card Generator',
  description: 'Pick a template, type your details, download a 3MF.',
  topbar: topbarLinks({ themeToggle: false }),
  railFoot: [themeToggleButton({ storageKey: 'business-card-theme', variant: 'action' })],
  allLabel: 'All templates',
  groups: TEMPLATE_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    cards: TEMPLATES.filter((t) => t.group === g.id).map((t) => {
      const card = galleryCard({
        name: t.name,
        blurb: t.line,
        compact: true,
        thumb: skeleton({ width: '100%', height: '100%' }),
        onClick: () => { location.hash = `#/t/${t.id}`; },
      });
      card.dataset.template = t.id;
      menuCards.set(t.id, card);
      return card;
    }),
  })),
  grid: { dense: true, minPx: 240, aspect: '3 / 2' },
});

/** The template the editor holds, or null before one is opened. Into the same template again finds
 *  it as it was left; another opens as it was designed, with the customer's details and colours. */
let editing: string | null = null;

function showTemplate(t: Template) {
  editing = t.id;
  titleSlot.replaceChildren(generatorHeader({ title: t.name, description: t.line, hideCredit: true, compact: true }));
  document.title = `${t.name} · Business Card Generator · Vostok Labs`;
}

const app = document.getElementById('app')!;
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
let menuScroll = 0;

function show(node: HTMLElement, scrollY = 0) {
  if (app.firstElementChild === node) return;
  if (app.firstElementChild === menu.root) menuScroll = window.scrollY;
  app.replaceChildren(node);
  window.scrollTo(0, scrollY);
}

function route() {
  const m = /^#\/t\/([\w-]+)/.exec(location.hash);
  const t = m ? TEMPLATES.find((x) => x.id === m[1]) : undefined;
  if (!t) {
    if (location.hash && location.hash !== '#/') history.replaceState(null, '', '#/');
    document.title = 'Business Card Generator · Vostok Labs';
    show(menu.root, menuScroll);
    refreshMenu();
    return;
  }
  show(editorRoot);
  if (editing === t.id) return showTemplate(t);
  settings.template = t.id;
  showTemplate(t);
  openTemplate();
  triggerRebuild(true);
}

showSettings();
window.addEventListener('hashchange', route);
route();
