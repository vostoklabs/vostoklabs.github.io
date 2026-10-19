/*
  The parts of the render studio that decide *what* gets produced, as opposed to what it looks
  like.

  The pixels are not testable without a GPU, and a snapshot of a headless render would only ever
  assert that the software rasteriser has not changed. What *is* worth pinning is the batch plan:
  this is the code that turns three ticked angles and six colourways into eighteen files, and
  every failure mode there is silent. A collision overwrites an image the user thinks they have;
  a bad slug writes outside the folder they chose.
*/
import { describe, expect, it } from './support/spec';
import {
  AUTO_FINISH, BACKDROPS, CUSTOM_BACKDROP, DEFAULT_CUSTOM, STUDIO_FILAMENTS, FINISHES,
  LIGHT_PRESETS, PRESET_SHOTS, STILL_SIZES,
  applyLightPreset, backdropById, clamp, defaultShots, effectiveFinish, fileStem, finishById, isStood,
  lightPresetById, nextColourwayId, nextShotId, planRenders, renderFileName, resolveBackdrop, resolveFinish,
  safeSlug, shotById, stillSizeById, type Shot,
} from '../src/studio';
import { AS_PRINTED, groupByRegion, regionColour } from '../src/regions';
import { canRender } from '../src/load';
import { materialFor } from '../src/scene';
import { haltonPair } from '../src/still';

const byName = (name: string) => STUDIO_FILAMENTS.find((f) => f.name === name)!;
const shots = (...ids: string[]) => ids.map((id) => shotById(PRESET_SHOTS, id));
/** A colourway named after a filament. */
const way = (name: string) => ({ id: name.toLowerCase(), name, colours: {} });

describe('safeSlug', () => {
  it('lowercases and joins on single dashes', () => {
    expect(safeSlug('Dragon   Keychain')).toBe('dragon-keychain');
  });

  it('strips accents rather than dropping the letters', () => {
    expect(safeSlug('Kříž Držák')).toBe('kriz-drzak');
  });

  it('removes path separators, so a name cannot escape the output folder', () => {
    expect(safeSlug('../../etc/passwd')).toBe('etc-passwd');
    expect(safeSlug('C:\\Windows\\System32')).toBe('c-windows-system32');
  });

  it('never leaves a leading or trailing dash', () => {
    expect(safeSlug('  !!! hello !!!  ')).toBe('hello');
  });

  it('returns empty for a name with nothing usable in it', () => {
    expect(safeSlug('***')).toBe('');
    expect(safeSlug('日本語')).toBe('');
  });

  it('caps length, so a pathological name cannot blow the path limit', () => {
    expect(safeSlug('a'.repeat(200))).toHaveLength(48);
  });
});

describe('renderFileName', () => {
  it('reads as model, shot, colourway', () => {
    expect(renderFileName('Dragon Keychain', 'hero', 'Gold on black'))
      .toBe('dragon-keychain-hero-gold-on-black.png');
  });

  it('leaves the colourway out when there is only one', () => {
    expect(renderFileName('clicker', 'top', null)).toBe('clicker-top.png');
  });

  it('falls back to a usable stem when the model name slugs to nothing', () => {
    expect(renderFileName('***', 'hero', null)).toBe('render-hero.png');
  });
});

describe('planRenders', () => {
  it('multiplies shots by colourways', () => {
    const plan = planRenders('clicker', shots('hero', 'front', 'top'), [way('Red'), way('Blue')]);
    expect(plan).toHaveLength(6);
    expect(plan.map((j) => j.fileName)).toEqual([
      'clicker-hero-red.png', 'clicker-hero-blue.png',
      'clicker-front-red.png', 'clicker-front-blue.png',
      'clicker-top-red.png', 'clicker-top-blue.png',
    ]);
  });

  it('leaves the colourway out of the name when there is only one', () => {
    const plan = planRenders('clicker', shots('hero', 'side'), [AS_PRINTED]);
    expect(plan).toHaveLength(2);
    expect(plan.map((j) => j.fileName)).toEqual(['clicker-hero.png', 'clicker-side.png']);
  });

  it('with no colourway at all, renders each shot once as printed', () => {
    const plan = planRenders('clicker', shots('hero', 'side'), []);
    expect(plan).toHaveLength(2);
    expect(plan.every((j) => j.colourway.id === AS_PRINTED.id)).toBe(true);
  });

  it('falls back to the hero shot rather than planning nothing', () => {
    const plan = planRenders('clicker', [], []);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.shot.id).toBe('hero');
  });

  it('takes a shot no lookup table knows about', () => {
    const shot: Shot = { id: 'shot-1', name: 'Shot 1', dir: [0.3, 0.9, -0.4], zoom: 0.8, on: true };
    const plan = planRenders('clicker', [shot], [way('Red'), way('Blue')]);
    expect(plan[0]!.fileName).toBe('clicker-shot-1-red.png');
    expect(plan[0]!.shot.zoom).toBe(0.8);
  });

  it('never returns two jobs that would write the same file', () => {
    // Two distinct colourways whose names slug identically is the realistic version of this: one
    // called "Matte Black" next to one called "matte black".
    const plan = planRenders('part', shots('hero'), [way('matte black'), way('Matte Black')]);
    const names = plan.map((j) => j.fileName);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(['part-hero-matte-black.png', 'part-hero-matte-black-2.png']);
  });

  it('keeps every filename ending in .png after de-duplicating', () => {
    const dup = way('Red');
    const plan = planRenders('m', shots('hero'), [dup, dup, dup]);
    expect(plan.map((j) => j.fileName).every((n) => n.endsWith('.png'))).toBe(true);
  });

  it('pairs each job with the colourway it was planned for', () => {
    const plan = planRenders('m', shots('hero'), [way('Gold'), way('Silver')]);
    expect(plan.map((j) => j.colourway.name)).toEqual(['Gold', 'Silver']);
  });
});

describe('shots', () => {
  it('defaultShots copies, so editing one model does not edit the presets', () => {
    const a = defaultShots();
    a[0]!.name = 'Changed';
    expect(defaultShots()[0]!.name).toBe('Hero');
    expect(PRESET_SHOTS[0]!.name).toBe('Hero');
  });

  it('starts with exactly one shot ticked, so a batch never offers nothing', () => {
    expect(defaultShots().filter((s) => s.on)).toHaveLength(1);
  });

  it('nextShotId never collides with a preset or an existing shot', () => {
    const list = [...defaultShots(), { ...PRESET_SHOTS[0]!, id: 'shot-6' }];
    expect(list.some((s) => s.id === nextShotId(list))).toBe(false);
  });

  it('nextColourwayId never collides with an existing colourway', () => {
    const list = [{ id: 'way-2' }, { id: 'way-3' }];
    expect(nextColourwayId(list)).toBe('way-4');
    expect(nextColourwayId([])).toBe('way-1');
  });

  it('gives every preset shot and backdrop a unique id', () => {
    expect(new Set(PRESET_SHOTS.map((s) => s.id)).size).toBe(PRESET_SHOTS.length);
    expect(new Set(BACKDROPS.map((b) => b.id)).size).toBe(BACKDROPS.length);
  });
});

describe('standing the model up', () => {
  const flat = { tip: 0, turn: 0, roll: 0, tipFine: 0, turnFine: 0, rollFine: 0 };

  it('a fresh orientation offers no reset', () => {
    expect(isStood(flat)).toBe(false);
  });

  it('notices a quarter turn on any of the three axes', () => {
    expect(isStood({ ...flat, tip: 1 })).toBe(true);
    expect(isStood({ ...flat, turn: 3 })).toBe(true);
    expect(isStood({ ...flat, roll: 1 })).toBe(true);
  });

  it('notices a fine offset on its own, so Reset is offered after a nudge', () => {
    expect(isStood({ ...flat, rollFine: -3 })).toBe(true);
  });
});

describe('grouping a soup into regions', () => {
  const tri = (n: number) => [n, 0, 0, n + 1, 0, 0, n, 1, 0];

  it('passes a single region through without reordering anything', () => {
    const p = new Float32Array([...tri(0), ...tri(10)]);
    const out = groupByRegion(p, ['a', 'a']);
    expect(out.positions).toBe(p);
    expect(out.groups).toEqual([{ key: 'a', start: 0, count: 6 }]);
  });

  it('sorts triangles so each region is one contiguous run', () => {
    // Region b sits in the middle, so leaving the order alone would give two runs of a, and a
    // mesh cannot draw one material across two groups without a second draw call.
    const p = new Float32Array([...tri(0), ...tri(10), ...tri(20)]);
    const out = groupByRegion(p, ['a', 'b', 'a']);
    expect(out.groups).toEqual([
      { key: 'a', start: 0, count: 6 },
      { key: 'b', start: 6, count: 3 },
    ]);
    // The second triangle of run "a" is the third source triangle, moved up.
    expect(out.positions[9]).toBe(20);
  });

  it('keeps every triangle, so the sort never drops geometry', () => {
    const p = new Float32Array([...tri(0), ...tri(10), ...tri(20), ...tri(30)]);
    const out = groupByRegion(p, ['b', 'a', 'b', 'a']);
    expect(out.positions).toHaveLength(p.length);
    expect(out.groups.reduce((n, g) => n + g.count, 0)).toBe(p.length / 3);
  });
});

describe('regionColour', () => {
  const region = {
    key: 'slot-1', label: 'Filament 1', source: 'slot' as const,
    fileHex: '#F330F9', triangles: 10,
  };

  it('keeps the colour the file states when the colourway says nothing', () => {
    expect(regionColour(region, AS_PRINTED).hex).toBe('#F330F9');
  });

  it('lets a colourway override it', () => {
    const gold = {
      id: 'w', name: 'Gold', colours: { 'slot-1': { hex: '#c9a227', finishId: 'silk' } },
    };
    expect(regionColour(region, gold)).toEqual({ hex: '#c9a227', finishId: 'silk' });
  });

  it('falls back to stock only where the file said nothing at all', () => {
    expect(regionColour({ ...region, fileHex: null }, AS_PRINTED).hex).toBe('#b9a8f5');
  });

  it('leaves a region the colourway does not name alone', () => {
    const other = {
      id: 'w', name: 'x', colours: { 'slot-9': { hex: '#000000', finishId: 'matte' } },
    };
    expect(regionColour(region, other).hex).toBe('#F330F9');
  });
});

describe('fileStem', () => {
  it('drops the folder and the extension', () => {
    expect(fileStem('C:\\models\\packs\\dragon_v2.3mf')).toBe('dragon_v2');
    expect(fileStem('/home/user/thing.stl')).toBe('thing');
    expect(fileStem('Dragon Keychain.3mf')).toBe('Dragon Keychain');
  });

  it('keeps a dotfile whole rather than returning nothing', () => {
    expect(fileStem('.hidden')).toBe('.hidden');
  });
});

describe('canRender', () => {
  it('accepts the three mesh formats the studio loads', () => {
    expect(canRender('a.stl')).toBe(true);
    expect(canRender('a.OBJ')).toBe(true);
    expect(canRender('a.3mf')).toBe(true);
  });

  it('rejects STEP, which the studio does not tessellate', () => {
    expect(canRender('a.step')).toBe(false);
    expect(canRender('a.stp')).toBe(false);
  });

  it('rejects things that are not models at all', () => {
    expect(canRender('a.gcode')).toBe(false);
    expect(canRender('noextension')).toBe(false);
  });
});

describe('lookups fall back rather than returning undefined', () => {
  it('shotById', () => {
    expect(shotById(PRESET_SHOTS, 'hero').id).toBe('hero');
    expect(shotById(PRESET_SHOTS, 'nonsense')).toBe(PRESET_SHOTS[0]);
    expect(shotById([], 'nonsense').id).toBe('hero');
  });

  it('backdropById', () => {
    expect(backdropById('transparent').sky).toBeNull();
    expect(backdropById('nonsense')).toBe(BACKDROPS[0]);
  });

  it('stillSizeById', () => {
    expect(stillSizeById('story').height).toBe(1350);
    expect(stillSizeById('nonsense')).toBe(STILL_SIZES[0]);
  });
});

describe('clamp', () => {
  it('holds the range', () => {
    expect(clamp(5, 1, 4)).toBe(4);
    expect(clamp(0, 1, 4)).toBe(1);
    expect(clamp(2, 1, 4)).toBe(2);
  });

  it('treats NaN as the floor, so a blank number field cannot produce a zero-pixel render', () => {
    expect(clamp(NaN, 1, 4)).toBe(1);
    expect(clamp(Infinity, 1, 4)).toBe(4);
  });
});

describe('haltonPair', () => {
  it('stays inside the unit square, which is what keeps jitter sub-pixel', () => {
    for (let i = 1; i <= 64; i++) {
      const [x, y] = haltonPair(i);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(1);
    }
  });

  it('covers the square evenly, which Math.random would not', () => {
    // Four quadrants, sixteen samples. A clumped sequence fails this most of the time.
    const quadrants = new Set<string>();
    for (let i = 1; i <= 16; i++) {
      const [x, y] = haltonPair(i);
      quadrants.add(`${x < 0.5 ? 0 : 1}${y < 0.5 ? 0 : 1}`);
    }
    expect(quadrants.size).toBe(4);
  });

  it('never repeats a point, so extra samples always add information', () => {
    const seen = new Set(Array.from({ length: 48 }, (_, i) => haltonPair(i + 1).join(',')));
    expect(seen.size).toBe(48);
  });
});

describe('materialFor', () => {
  it('gives silk some metalness and matte none', () => {
    expect(materialFor('#c9a227', 'silk').metalness).toBeGreaterThan(0);
    expect(materialFor('#1c1c1e', 'matte').metalness).toBe(0);
  });

  it('makes matte rougher than satin, which is the whole difference on camera', () => {
    expect(materialFor('#ffffff', 'matte').roughness)
      .toBeGreaterThan(materialFor('#ffffff', 'satin').roughness);
  });

  it('carries the colour through', () => {
    expect(materialFor('#3f9b52', 'satin').color.getHexString()).toBe('3f9b52');
  });
});

describe('the palette itself', () => {
  it('has no two filaments with the same name, which planRenders relies on', () => {
    expect(new Set(STUDIO_FILAMENTS.map((f) => f.name)).size).toBe(STUDIO_FILAMENTS.length);
  });

  it('is all valid six-digit hex, because a bad one renders black and looks deliberate', () => {
    for (const f of STUDIO_FILAMENTS) expect(f.hex).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('finishes', () => {
  it("leaves the filament's own finish alone on auto, which is where a panel starts", () => {
    expect(effectiveFinish(byName('Gold'), AUTO_FINISH)).toBe('silk');
    expect(effectiveFinish(byName('Black'), AUTO_FINISH)).toBe('matte');
  });

  it('overrides every filament once one is chosen', () => {
    expect(effectiveFinish(byName('Gold'), 'matte')).toBe('matte');
    expect(effectiveFinish(byName('Black'), 'resin')).toBe('resin');
  });

  it('on auto, matches a colour to the shelf by hex and calls anything else satin', () => {
    expect(resolveFinish('#C9A227', AUTO_FINISH)).toBe('silk');
    expect(resolveFinish('#123456', AUTO_FINISH)).toBe('satin');
    expect(resolveFinish('#123456', 'glossy')).toBe('glossy');
  });

  it('falls back rather than returning undefined', () => {
    expect(finishById('nonsense')).toBe(FINISHES[0]);
  });

  it('is the only place transmission is switched on, and it brings a thickness with it', () => {
    // Zero thickness with transmission renders as an invisible shell rather than a part.
    const clear = materialFor('#ffffff', 'translucent');
    expect(clear.transmission).toBeGreaterThan(0);
    expect(clear.thickness).toBeGreaterThan(0);
    expect(materialFor('#ffffff', 'matte').transmission).toBe(0);
  });

  it('passes ambience through, because that is how the lighting dims reflections', () => {
    expect(materialFor('#ffffff', 'matte', 0.25).envMapIntensity).toBe(0.25);
  });

  it('gives every finish a unique id', () => {
    expect(new Set(FINISHES.map((f) => f.id)).size).toBe(FINISHES.length);
  });
});

describe('resolveBackdrop', () => {
  it('hands back the listed backdrop untouched', () => {
    expect(resolveBackdrop('studio-dark', DEFAULT_CUSTOM)).toBe(backdropById('studio-dark'));
  });

  it("folds the panel's colours into the custom one", () => {
    const custom = { top: '#101010', bottom: '#202020', floor: '#303030' };
    const b = resolveBackdrop(CUSTOM_BACKDROP, custom);
    expect(b.sky).toEqual(['#101010', '#202020']);
    expect(b.floor).toBe('#303030');
  });

  it("keeps every listed backdrop's colours valid hex, or null for the transparent one", () => {
    for (const b of BACKDROPS) {
      if (b.sky === null) { expect(b.floor).toBeNull(); continue; }
      for (const hex of [...b.sky, b.floor!]) expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('light presets', () => {
  it('writes every slider, so re-picking one is a reset', () => {
    const start = { ...lightPresetById('softbox').values, presetId: 'softbox', lockToModel: false };
    const nudged = { ...applyLightPreset(start, 'dramatic'), key: 0.1 };
    const reset = applyLightPreset(nudged, 'dramatic');
    expect(reset.key).toBe(lightPresetById('dramatic').values.key);
  });

  it('leaves the lock alone, because that is a rig choice and not a look', () => {
    const locked = { ...lightPresetById('softbox').values, presetId: 'softbox', lockToModel: true };
    expect(applyLightPreset(locked, 'flat').lockToModel).toBe(true);
  });

  it('gives every preset a unique id and a non-negative key', () => {
    expect(new Set(LIGHT_PRESETS.map((p) => p.id)).size).toBe(LIGHT_PRESETS.length);
    for (const p of LIGHT_PRESETS) {
      expect(p.values.key).toBeGreaterThan(0);
      expect(p.values.softness).toBeGreaterThanOrEqual(0);
    }
  });
});
