import { bboxOf, placeShapes, roundedRectRing, type Shapes } from '@vostok/laser';
import type { CutRing } from '@vostok/export';
import { slotHoleRing, slotRing, slotWidth, tabRing, tabWidth } from '../engine/slots';
import { symbolLayer } from '../engine/text';
import type { BuildInput, DesignLayer, PartInput, Pose } from '../engine/types';
import { readSymbols } from '../symbols/model';
import { keyringFrom } from './keyring';
import { SAMPLE_SITE } from './shared';
import { clamp, composeFace, plateWarnings, qrCodeFields, qrContentFields, qrFontField, qrLetteringFields, qrPlateFields, qrTextFields, readPlate, type FaceSpec } from './qr-shared';
import { str, type Field, type TemplateDef, type Values } from './types';

const styles = ['leaning', 'foot', 'signin', 'double', 'corner'];
const styleOf = (v: Values) => styles.includes(str(v, 'standStyle')) ? str(v, 'standStyle') : 'leaning';
const leaning = (v: Values) => ['leaning', 'signin'].includes(styleOf(v));
const dual = (v: Values) => styleOf(v) === 'double';
const raised = (v: Values) => ['leaning', 'signin', 'corner'].includes(styleOf(v));
const shiftRing = (ring: CutRing, y: number): CutRing => ring.map(([x, yy]) => [x, yy + y]);
const rect = (w: number, h: number, y = 0): Shapes => [[shiftRing(roundedRectRing(w, h, 0), y)]];
const move = (layer: DesignLayer, x: number, y: number): DesignLayer => ({
  ...layer, shapes: placeShapes(layer.shapes, x, y, 0),
  ...(layer.minus ? { minus: placeShapes(layer.minus, x, y, 0) } : {}),
});

// All five reference designs share the QR editor; only the construction and composition vary.
export const qrDisplayStand: TemplateDef = {
  id: 'qr-display-stand', name: 'QR display stand',
  blurb: 'Five countertop stands, with your QR codes, lettering and logo.',
  tags: ['qr', 'sign', 'engrave + cut'],
  fields: [
    { kind: 'thumbs', key: 'standStyle', label: 'Stand style', section: 'Stand', value: 'leaning', columns: 2, options: [
      { value: 'leaning', label: 'Leaning plaque', svgPath: 'M10 3H31L26 35H5ZM13 7L11 22H25L27 7ZM8 29H23V31H8ZM27 35H38L29 24Z' },
      { value: 'foot', label: 'Curved foot', svgPath: 'M7 3H33V33H7ZM12 9V23H28V9ZM17 37Q17 22 21 26Q28 30 29 37Z' },
      { value: 'signin', label: 'Sign-in plaque', svgPath: 'M10 2H32L27 36H5ZM14 6V8H28V6ZM13 11V13H27V11ZM12 17L10 29H25L27 17ZM28 36H38L30 25Z' },
      { value: 'double', label: 'Double QR', svgPath: 'M9 2H31V35H9ZM13 7V17H27V7ZM13 21V31H27V21ZM4 36H36V39H4Z' },
      { value: 'corner', label: 'Rounded corner', svgPath: 'M8 2H22Q33 2 33 15V35H8ZM12 12V26H28V12ZM3 36H38V39H3Z' },
    ] },
    ...qrContentFields(),
    { kind: 'text', key: 'secondLink', label: 'Second QR link', panel: 'right', section: 'Content', value: `${SAMPLE_SITE}/contact`, symbols: false, visibleWhen: dual },
    { kind: 'symbol', key: 'secondSymbol', label: 'Second QR symbol', panel: 'right', section: 'Content', value: '', visibleWhen: dual },
    ...qrTextFields('YOUR BUSINESS', 'Scan to connect'),
    { kind: 'symbol', key: 'brandLogo', label: 'Logo on the stand', panel: 'right', section: 'Text', value: '', help: 'Choose a symbol or import your own SVG logo.' },
    ...qrCodeFields({ key: 'qrSize', value: 48, min: 20, max: 120 }),
    qrFontField(), ...qrLetteringFields(),
    ...qrPlateFields({ arch: false, leanHelp: 'Tilts the plaque back from vertical.' }).map((f): Field => {
      if (f.key === 'faceW') return { ...f, value: 110 } as Field;
      if (f.key === 'faceH') return { ...f, value: 180 } as Field;
      if (f.key === 'faceCorner') return { ...f, value: 4, visibleWhen: (v) => styleOf(v) !== 'corner' } as Field;
      if (f.key === 'lean') return { ...f, value: 12, min: 6, max: 20, visibleWhen: leaning } as Field;
      return f;
    }),
  ],
  fileName: (v) => `qr-display-${styleOf(v)}`,
  exportNote: (v) => styleOf(v) === 'foot'
    ? 'Slide the curved foot into the bottom notch; test the fit on scrap first.'
    : leaning(v)
      ? 'Insert the base tongue through the face slot, glue the joint at the chosen lean, and glue the QR plaque onto the face.'
      : `Seat the face tongue in the base slot and glue.${raised(v) ? ' Glue the QR plaque onto the face.' : ''}`,
  async build(v) {
    const style = styleOf(v);
    const p = readPlate({ ...v, lean: leaning(v) ? v.lean : 0 }, { arch: false });
    const { w, h, thickness: t, kerf, clearance } = p;
    let ring = p.ring;
    if (style === 'corner') {
      const r = Math.min(w * 0.42, h * 0.28);
      ring = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2 - r]];
      for (let i = 1; i <= 32; i++) {
        const a = i * Math.PI / 64;
        ring.push([w / 2 - r + r * Math.cos(a), h / 2 - r + r * Math.sin(a)]);
      }
      ring.push([-w / 2, h / 2]);
    }
    const parts: PartInput[] = [];
    const layers: DesignLayer[] = [];
    const warnings = plateWarnings(p, { lean: false });
    const blank: BuildInput['blank'] = { kind: 'shape', shapes: [[ring]] };
    let pose: Pose;
    let bottom = -h / 2 + 10;
    const addPart = (part: PartInput) => parts.push(part);
    if (leaning(v)) {
      // A tongue through the inclined face; its rear edge rests on the table.
      const jointY = -h / 2 + Math.max(14, t * 3);
      const neck = w * 0.42;
      const depth = Math.max(50, h * 0.48), tongue = Math.max(12, t * 3);
      const z0 = t / 2 * Math.sin(p.theta);
      const jointZ = (jointY + h / 2) * Math.cos(p.theta) + z0;
      const beta = Math.asin(jointZ / Math.hypot(depth, t / 2)) - Math.atan2(t / 2, depth);
      const crossing = Math.PI / 2 - p.theta + beta;
      const opening = t / Math.sin(crossing) + t * Math.abs(1 / Math.tan(crossing));
      layers.push({ id: 'base-slot', label: 'Base slot', op: 'cut', stencil: false,
        shapes: [[slotHoleRing(0, jointY, slotWidth(opening, kerf, clearance), slotWidth(neck, kerf, clearance), 'x')]] });
      const bw = w * 0.86;
      const shoulder = t / (2 * Math.sin(crossing)) + 0.5;
      const baseRing: CutRing = [[-bw / 2, shoulder], [-tabWidth(neck, kerf) / 2, shoulder],
        [-tabWidth(neck, kerf) / 2, -tongue], [tabWidth(neck, kerf) / 2, -tongue],
        [tabWidth(neck, kerf) / 2, shoulder], [bw / 2, shoulder], [bw / 2, depth], [-bw / 2, depth]];
      pose = { x: 0, y: h / 2 * Math.sin(p.theta), z: h / 2 * Math.cos(p.theta) + z0, rx: 90 - p.lean };
      const jointWorldY = (jointY + h / 2) * Math.sin(p.theta);
      addPart({ id: 'base', label: 'Rear base', blank: { kind: 'shape', shapes: [[baseRing]] }, layers: [],
        pose: { x: 0, y: jointWorldY + (depth - tongue) / 2 * Math.cos(beta),
          z: jointZ - (depth - tongue) / 2 * Math.sin(beta), rx: -beta * 180 / Math.PI },
        assembledAt: { x: 0, y: -h / 2 - depth / 2 - 8 }, material: 'dark' });
      bottom = jointY + opening / 2 + 8;
    } else if (style === 'foot') {
      const fh = clamp(h * 0.2, 24, 42), depth = Math.max(55, h * 0.42), lap = fh / 2;
      const foot: CutRing = [[-depth / 2, -fh / 2], [depth / 2, -fh / 2]];
      for (let i = 0; i <= 48; i++) {
        const a = i * Math.PI / 48;
        foot.push([depth / 2 * Math.cos(a), -fh / 2 + fh * Math.sin(a)]);
      }
      layers.push({ id: 'foot-slot', label: 'Foot notch', op: 'cut', stencil: false, shapes: [[slotRing(0, -h / 2, p.slot, lap, 'bottom', { nodes: true })]] });
      addPart({ id: 'foot', label: 'Curved foot', blank: { kind: 'shape', shapes: [[foot]] },
        layers: [{ id: 'lap', label: 'Face notch', op: 'cut', stencil: false, shapes: [[slotRing(0, fh / 2, p.slot, lap, 'top', { nodes: true })]] }],
        pose: { x: 0, y: 0, z: fh / 2, rx: 90, rz: 90 }, assembledAt: { x: 0, y: -h / 2 - fh / 2 - 8 } });
      pose = { x: 0, y: 0, z: h / 2, rx: 90 };
      bottom = -h / 2 + fh + 6;
    } else {
      const neck = w * 0.65, depth = Math.max(42, h * 0.28);
      blank.shapes.push([tabRing(0, -h / 2, tabWidth(neck, kerf), t, 'bottom')]);
      addPart({ id: 'base', label: 'Slotted base', blank: { kind: 'shape', shapes: [[roundedRectRing(w + 18, depth, 3)]] },
        layers: [{ id: 'mortise', label: 'Face slot', op: 'cut', stencil: false, shapes: [[slotHoleRing(0, 0, p.slot, slotWidth(neck, kerf, clearance), 'x')]] }],
        pose: { x: 0, y: 0, z: t / 2 }, assembledAt: { x: 0, y: -h / 2 - depth / 2 - 8 }, material: 'dark' });
      pose = { x: 0, y: 0, z: (h + t) / 2, rx: 90 };
    }
    const logo = str(v, 'brandLogo');
    const logoSize = Math.min(22, w * 0.22);
    const logoY = bottom + logoSize / 2;
    if (logo) bottom += logoSize + 7;
    const top = h / 2 - (style === 'corner' ? Math.min(w * 0.42, h * 0.28) * 0.36 + 5 : 9);
    const spec = (hi: number, lo: number): FaceSpec => ({ ring, sizeKey: 'qrSize', inset: 5,
      frameTop: hi, frameBottom: lo, bareTop: hi, bareBottom: lo, bareMargin: raised(v) ? 10 : 7 });
    const sections = dual(v)
      ? [{ values: { ...v, caption: '' }, hi: top, lo: (top + bottom) / 2 + 3, suffix: '' },
        { values: { ...v, kind: 'link', link: v.secondLink, symbol: v.secondSymbol, title: '' }, hi: (top + bottom) / 2 - 3, lo: bottom, suffix: '-second' }]
      : [{ values: v, hi: top, lo: bottom, suffix: '' }];
    for (const section of sections) {
      const content = await composeFace({ ...section.values, border: 'none' }, spec(section.hi, section.lo));
      warnings.push(...content.warnings.map((warning) => section.suffix ? `Second QR: ${warning}` : warning));
      // The first reference puts the business name below the code. Move the existing
      // title to the bottom of the same stack, preserving its font and size controls.
      const title = content.layers.find((l) => l.id === 'title');
      const code = content.layers.find((l) => l.id === 'code');
      if (style === 'leaning' && title && code && content.qr) {
        const tb = bboxOf(title.shapes), cb = bboxOf(code.shapes);
        const quiet = v.invert ? 0 : 4 * content.qr.cell;
        const caption = content.layers.find((l) => l.id === 'caption');
        const stackBottom = caption ? bboxOf(caption.shapes).minY : cb.minY - quiet;
        const delta = tb.maxY - cb.maxY - quiet;
        content.layers = content.layers.map((l) => move(l, 0, l.id === 'title' ? stackBottom - tb.minY : delta));
      }
      const codeLayers = content.layers.filter((l) => l.id.startsWith('code'));
      if (raised(v) && content.qr && codeLayers.length) {
        const b = bboxOf(codeLayers[0]!.shapes);
        const cy = (b.minY + b.maxY) / 2;
        const side = content.qrSize + 8 * content.qr.cell + 2;
        const plateCy = leaning(v) ? 0 : -t / 2;
        const localY = cy - plateCy;
        const angle = (pose.rx ?? 0) * Math.PI / 180;
        addPart({ id: 'qr-plaque', label: 'QR plaque (glue on face)', blank: { kind: 'shape', shapes: [[roundedRectRing(side, side, 1.5)]] },
          layers: codeLayers.map((l) => move(l, 0, -cy)), assembledAt: { x: 0, y: cy }, z: 1,
          pose: { x: 0, y: pose.y + localY * Math.cos(angle) - t * Math.sin(angle),
            z: pose.z + localY * Math.sin(angle) + t * Math.cos(angle), rx: pose.rx } });
        layers.push(...content.layers.filter((l) => !l.id.startsWith('code')));
      } else layers.push(...content.layers.map((l) => ({ ...l, id: l.id + section.suffix })));
    }
    if (logo) layers.push(...await symbolLayer(logo, logoSize, 'engrave', { symbols: readSymbols(v), y: logoY }, 'brand-logo'));
    return { label: 'Face', blank, pose, material: raised(v) ? 'dark' : 'light',
      keyring: { ...keyringFrom(v), enabled: false }, layers, parts, layout: { flow: 'row', gap: 8 },
      warnings, status: `${parts.length + 1} pieces` };
  },
};
