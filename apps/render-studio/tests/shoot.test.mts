/*
  The shoot's decisions, without a browser: the default photos, which way up, the backdrop from
  one colour, the batch and its file names, the download's words.

    pnpm --filter render-studio test
*/
import { AUTO_FINISH, backdropById, type PaintRegion } from '@vostok/render';
import {
  ANGLES, DEFAULT_LOOK, MAX_PHOTOS, PHOTO_SHAPES, SIDE_MAX, SIDE_MIN, aspectOf, clampSide, photoSize, backdropOf, coerceColourways, coerceLook, coercePhotos, defaultPhotos, downloadName,
  generateWords, renderLabel, finishShown, firstColourway, isDefaultSet, lighten, lightingOf, nextPhotoId,
  orientationOf, photoAt, planShoot, regionsBySize, shotOf, showsFileColours, sizeText,
} from '../src/shoot';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
};

/* ---- the default photos ---- */

const flat = defaultPhotos([120, 6, 60]);
check('a flat model gets Angled, Top and Low: from the front it is a sliver', flat.map((p) => p.angle).join() === 'angled,top,low');
const tall = defaultPhotos([40, 80, 40]);
check('a tall one gets Angled, Front, Side and Low', tall.map((p) => p.angle).join() === 'angled,front,side,low');
check('the default set is recognised as untouched', isDefaultSet(flat) && isDefaultSet(tall));
const dragged = tall.map((p, i) => (i === 1 ? { ...p, angle: 'view' as const, dir: [0.3, 0.2, 1] as [number, number, number] } : p));
check('a dragged photo makes the set the customer\'s own', !isDefaultSet(dragged));
check('a removed photo does too', !isDefaultSet(flat.slice(0, 2)) && !isDefaultSet(tall.slice(0, 3)));
const panned = flat.map((p, i) => (i === 0 ? { ...p, offset: [0.3, 0, 0] as [number, number, number] } : p));
check('so does a panned one', !isDefaultSet(panned));
check('a preset angle looks at the middle', ANGLES.every((a) => photoAt('x', a.id).offset.every((v) => v === 0)));
check('the shot carries the pan to the engine', JSON.stringify(shotOf(panned[0]!).offset) === JSON.stringify([0.3, 0, 0]));
check('each angle points where the engine says', ANGLES.every((a) => photoAt('x', a.id).dir.length === 3));
check('a new photo id is never one in use', nextPhotoId(tall) === 'photo-5' && nextPhotoId([...tall, { ...tall[0]!, id: 'photo-5' }]) === 'photo-6');

/* ---- which way up ---- */

check('As loaded is no turn at all', JSON.stringify(orientationOf('as-loaded', 0)) === JSON.stringify({ tip: 0, turn: 0, roll: 0, tipFine: 0, turnFine: 0, rollFine: 0 }));
check('On front tips it a quarter', orientationOf('front', 0).tip === 1 && orientationOf('front', 0).roll === 0);
check('On left rolls it a quarter', orientationOf('left', 0).roll === 1 && orientationOf('left', 0).tip === 0);
check('Turn wraps to 0-3', orientationOf('flipped', 5).turn === 1 && orientationOf('flipped', -1).turn === 3);
check('an unknown side is As loaded', orientationOf('sideways', 0).tip === 0);

/* ---- the look ---- */

check('the custom background is built from one colour', (() => {
  const b = backdropOf({ ...DEFAULT_LOOK, backdropId: 'custom', custom: '#336699' });
  return b.sky?.[1] === '#336699' && b.sky?.[0] !== '#336699' && b.floor !== '#336699';
})());
check('lighter means lighter', lighten('#336699', 12) > '#336699' && lighten('#ffffff', 20) === '#ffffff' && lighten('#000000', -5) === '#000000');
check('a built-in background is the engine\'s own', JSON.stringify(backdropOf(DEFAULT_LOOK)) === JSON.stringify(backdropById('studio-light')));
check('brightness scales the rig\'s exposure, and the light follows the camera', (() => {
  const a = lightingOf({ ...DEFAULT_LOOK, brightness: 100 });
  const b = lightingOf({ ...DEFAULT_LOOK, brightness: 150 });
  return Math.abs(b.exposure - a.exposure * 1.5) < 1e-9 && !a.lockToModel && a.presetId === 'softbox';
})());
check('a stored look comes back clamped and checked', (() => {
  const l = coerceLook({ backdropId: 'gradient', custom: 'red', lightId: 'dramatic', brightness: 999, sizeId: 'portrait', extra: 1 });
  return l.backdropId === DEFAULT_LOOK.backdropId && l.custom === DEFAULT_LOOK.custom && l.lightId === 'dramatic' && l.brightness === 150 && l.sizeId === 'portrait' && !('extra' in l);
})());
check('rubbish is the default look', JSON.stringify(coerceLook('nope')) === JSON.stringify(DEFAULT_LOOK));
/* ---- sizes ---- */

check('every ratio is 2000 on the long side', PHOTO_SHAPES.every((s) => Math.max(s.width, s.height) === 2000));
check('and the shape its ratio says', PHOTO_SHAPES.every((s) => {
  const [a, b] = s.ratio.split(':').map(Number);
  return Math.abs(s.width / s.height - a! / b!) < 1e-9;
}));
check('a ratio gives its own size', JSON.stringify(photoSize({ ...DEFAULT_LOOK, sizeId: 'wide' })) === JSON.stringify({ width: 2000, height: 1125 }) && aspectOf({ ...DEFAULT_LOOK, sizeId: 'landscape' }) === 4 / 3);
check('Custom gives the typed size', JSON.stringify(photoSize({ ...DEFAULT_LOOK, sizeId: 'custom', customWidth: 1080, customHeight: 1350 })) === JSON.stringify({ width: 1080, height: 1350 }));
check('a custom side is held to 200-6000 and whole', JSON.stringify(photoSize({ ...DEFAULT_LOOK, sizeId: 'custom', customWidth: 12, customHeight: 9000.6 })) === JSON.stringify({ width: SIDE_MIN, height: SIDE_MAX }) && clampSide(1234.4) === 1234);
check('a ratio ignores the custom size', JSON.stringify(photoSize({ ...DEFAULT_LOOK, sizeId: 'square', customWidth: 300, customHeight: 900 })) === JSON.stringify({ width: 2000, height: 2000 }));
check('a stored custom size comes back clamped', (() => {
  const l = coerceLook({ sizeId: 'custom', customWidth: 99999, customHeight: 'x' });
  return l.sizeId === 'custom' && l.customWidth === SIDE_MAX && l.customHeight === DEFAULT_LOOK.customHeight;
})());
check('an unknown size is the default', coerceLook({ sizeId: 'huge' }).sizeId === 'square');

/* ---- colours ---- */

const regions: PaintRegion[] = [
  { key: 'a', label: 'Icon', source: 'part', fileHex: '#e0619a', triangles: 10 },
  { key: 'b', label: 'Chain', source: 'part', fileHex: '#2fa4a0', triangles: 50 },
  { key: 'c', label: 'Part 3', source: 'part', fileHex: null, triangles: 5 },
];
const first = firstColourway(regions);
check('the first colorway keeps the file\'s colours and grays the rest', !first.colours.a && !first.colours.b && first.colours.c?.hex === '#8a8d93');
check('and shows the file\'s colours', showsFileColours(first, regions));
check('a changed colour no longer does', !showsFileColours({ ...first, colours: { ...first.colours, a: { hex: '#000000', finishId: AUTO_FINISH } } }, regions));
check('regions are listed biggest first', regionsBySize(regions).map((r) => r.label).join() === 'Chain,Icon,Part 3');
check('a filament\'s own finish shows until one is picked', finishShown('#c9a227', AUTO_FINISH) === 'silk' && finishShown('#1c1c1e', AUTO_FINISH) === 'matte' && finishShown('#123456', AUTO_FINISH) === 'satin' && finishShown('#c9a227', 'glossy') === 'glossy');

/* ---- the batch ---- */

const two = [first, { id: 'way-2', name: 'Colorway 2', colours: {} }];
const jobs = planShoot('Keychain Carabiner', flat, two);
check('every photo in every colorway', jobs.length === 6);
check('named by place, angle and colorway', jobs[0]!.fileName === 'keychain-carabiner-1-angled-colorway-1.png' && jobs[5]!.fileName === 'keychain-carabiner-3-low-colorway-2.png');
check('one colorway leaves the colorway out', planShoot('Keychain Carabiner', flat, [first])[1]!.fileName === 'keychain-carabiner-2-top.png');
check('one photo is the stem and the angle', planShoot('Keychain Carabiner', [flat[0]!], [first])[0]!.fileName === 'keychain-carabiner-angled.png');
check('a dragged photo is a view', planShoot('x', dragged, [first])[1]!.fileName === 'x-2-view.png');
check('names never collide', new Set(jobs.map((j) => j.fileName)).size === jobs.length);
check('an empty stem still names the file', planShoot('', [flat[0]!], [first])[0]!.fileName === 'render-angled.png');
check('several make a ZIP named for the model, one a PNG', downloadName('Keychain Carabiner', jobs) === 'keychain-carabiner-renders.zip' && downloadName('k', planShoot('k', [flat[0]!], [first])) === 'k-angled.png');

/* ---- the words ---- */

check('one render', JSON.stringify(generateWords(1, 1, { width: 2000, height: 2000 })) === JSON.stringify({ label: 'Generate render', note: '2000 × 2000 px' }));
check('four renders', JSON.stringify(generateWords(4, 1, { width: 2000, height: 1500 })) === JSON.stringify({ label: 'Generate 4 renders', note: '2000 × 1500 px each' }));
check('four angles in two colorways', JSON.stringify(generateWords(4, 2, { width: 2000, height: 2000 })) === JSON.stringify({ label: 'Generate 8 renders', note: '4 angles × 2 colorways · 2000 × 2000 px' }));
check('a render is named for its photo, angle and colorway', renderLabel(jobs[1]!, 2) === 'Photo 1 · Angled · Colorway 2' && renderLabel(planShoot('x', dragged, [first])[1]!, 1) === 'Photo 2 · Your angle');
check('the size reads width × depth × height', sizeText([123.1, 6, 59.4]) === '123 × 59 × 6 mm' && sizeText([9.44, 2, 30]) === '9.4 × 30 × 2 mm');

/* ---- a saved shoot ---- */

const photosBack = coercePhotos([...flat, { angle: 'sideways', dir: [1, 0, 0], zoom: 1 }, { angle: 'view', dir: [0, 0, 0], zoom: 1 }, { angle: 'front', dir: [0, 1, 0], zoom: -2 }, 'junk']);
check('saved photos come back, the bad ones dropped', photosBack?.length === 3 && photosBack.map((p) => p.angle).join() === 'angled,top,low');
check('with fresh ids', new Set(photosBack!.map((p) => p.id)).size === 3);
const pansBack = coercePhotos([
  { angle: 'view', dir: [1, 1, 1], zoom: 1, offset: [0.4, -0.2, 0.1] },
  { angle: 'view', dir: [1, 1, 1], zoom: 1 },
  { angle: 'view', dir: [1, 1, 1], zoom: 1, offset: [50, 0, 0] },
]);
check('a saved pan comes back; none, or one that lost the model, is the middle', JSON.stringify(pansBack!.map((p) => p.offset)) === JSON.stringify([[0.4, -0.2, 0.1], [0, 0, 0], [0, 0, 0]]));
check('never more than the strip holds', coercePhotos(Array.from({ length: 12 }, () => flat[0]))!.length === MAX_PHOTOS);
check('nothing usable is null', coercePhotos([]) === null && coercePhotos('x') === null);
const waysBack = coerceColourways([{ colours: { a: { hex: '#ABCDEF', finishId: 'silk' }, b: { hex: 'red' }, c: { hex: '#000000', finishId: 'resin' } } }, 7]);
check('saved colorways come back checked', waysBack?.length === 1 && waysBack[0]!.colours.a?.hex === '#abcdef' && waysBack[0]!.colours.a?.finishId === 'silk' && !waysBack[0]!.colours.b && waysBack[0]!.colours.c?.finishId === AUTO_FINISH);

console.log(`\nshoot: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
