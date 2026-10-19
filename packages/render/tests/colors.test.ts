/*
  The 3MF colour join (src/threemf/colors.ts): which slot each object and part prints on, what
  colour each slot holds, the model document's own material tables, and the lookups that resolve
  an object or a part to a colour without ever guessing one.
*/
import { describe, expect, it } from './support/spec';
import {
  normaliseHex, parseObjectSlots, parseSlotColors, buildPaint, colorForObject,
  parseProjectFilamentColors, parseMaterialColors, paintWithMaterials, colorForPart, colorForSlot,
} from '../src/threemf/colors';

/** The shape Bambu Studio writes. */
const MODEL_SETTINGS = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="1">
    <metadata key="name" value="Body.stl"/>
    <metadata key="extruder" value="1"/>
    <part id="1" subtype="normal_part">
      <metadata key="name" value="Body.stl"/>
      <metadata key="extruder" value="1"/>
    </part>
  </object>
  <object id="2">
    <metadata key="name" value="Eyes.stl"/>
    <metadata key="extruder" value="3"/>
  </object>
</config>`;

const SLICE_INFO = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <plate>
    <metadata key="index" value="1"/>
    <filament id="1" tray_info_idx="GFA00" type="PLA" color="#FF6A13" used_m="4.2" used_g="12.5"/>
    <filament id="3" tray_info_idx="GFA01" type="PLA" color="#161616" used_m="0.3" used_g="0.9"/>
  </plate>
  <plate>
    <metadata key="index" value="2"/>
    <filament id="1" type="PLA" color="#FF6A13" used_m="1.0" used_g="3.0"/>
  </plate>
</config>`;

describe('normaliseHex', () => {
  it('accepts the forms slicers write', () => {
    expect(normaliseHex('#FF6A13')).toBe('#ff6a13');
    expect(normaliseHex('ff6a13')).toBe('#ff6a13');
    expect(normaliseHex('#F60')).toBe('#ff6600');
  });

  it('drops the alpha, which a print does not have', () => {
    expect(normaliseHex('#FF6A13FF')).toBe('#ff6a13');
  });

  it('returns null rather than a wrong colour', () => {
    expect(normaliseHex(undefined)).toBeNull();
    expect(normaliseHex('')).toBeNull();
    expect(normaliseHex('orange')).toBeNull();
    expect(normaliseHex('#12345')).toBeNull();
  });
});

describe('parseObjectSlots', () => {
  it('reads the extruder each object prints on', () => {
    const slots = parseObjectSlots(MODEL_SETTINGS);
    expect(slots.get('Body.stl')).toBe(1);
    expect(slots.get('Eyes.stl')).toBe(3);
  });

  it('indexes by object id as well as by name', () => {
    const slots = parseObjectSlots(MODEL_SETTINGS);
    expect(slots.get('#1')).toBe(1);
    expect(slots.get('#2')).toBe(3);
  });

  it('lets a part override the object it sits in', () => {
    // Every real multi-material file does this: the object declares slot 1 and its parts declare
    // what they actually print on.
    const xml = `<config><object id="7">
        <metadata key="name" value="Whole.stl"/>
        <metadata key="extruder" value="1"/>
        <part id="1"><metadata key="name" value="Shell"/><metadata key="extruder" value="2"/></part>
        <part id="2"><metadata key="name" value="Logo"/><metadata key="extruder" value="4"/></part>
      </object></config>`;
    const slots = parseObjectSlots(xml);
    expect(slots.get('Shell')).toBe(2);
    expect(slots.get('Logo')).toBe(4);
  });

  it('keeps every part of an assembly, rather than only the last one', () => {
    // Blocks on extruder 1 and a cap on 3, inside one object. A single `#1` key would keep only
    // the cap, and the whole assembly would render in the cap's colour.
    const xml = `<config><object id="1">
        <metadata key="name" value="clicker"/>
        <metadata key="extruder" value="1"/>
        <part id="9" subtype="normal_part">
          <metadata key="name" value="body"/><metadata key="extruder" value="1"/>
        </part>
        <part id="12" subtype="normal_part">
          <metadata key="name" value="cap"/><metadata key="extruder" value="3"/>
        </part>
      </object></config>`;
    const slots = parseObjectSlots(xml);
    expect(slots.get('#1/9')).toBe(1);
    expect(slots.get('#1/12')).toBe(3);
    // The object's own key keeps the header's answer: the parts disagree, so there is no one slot
    // the whole object prints on, and claiming the cap's would be wrong.
    expect(slots.get('#1')).toBe(1);
  });

  it('lets the parts speak for the object when they agree', () => {
    // The common shape by far: the object header is a leftover slot 1 (or absent) and the single
    // part carries the truth.
    const xml = `<config><object id="4">
        <metadata key="name" value="Lid.stl"/>
        <metadata key="extruder" value="1"/>
        <part id="4"><metadata key="extruder" value="2"/></part>
      </object></config>`;
    const slots = parseObjectSlots(xml);
    expect(slots.get('#4')).toBe(2);
    expect(slots.get('#4/4')).toBe(2);
    expect(slots.get('Lid.stl')).toBe(2);
  });

  it('does not let a modifier or a negative part cast a vote', () => {
    // Modifiers, negatives and the support painters are written as ordinary <part> blocks with
    // their own extruder metadata. None of them is printed geometry, so one of them parked on a
    // spare slot must not break the agreement between the parts that are.
    const xml = `<config><object id="4">
        <metadata key="name" value="Lid.stl"/>
        <metadata key="extruder" value="1"/>
        <part id="4" subtype="normal_part"><metadata key="extruder" value="2"/></part>
        <part id="5" subtype="modifier_part">
          <metadata key="name" value="Denser infill"/><metadata key="extruder" value="5"/>
        </part>
        <part id="6" subtype="negative_part"><metadata key="extruder" value="7"/></part>
      </object></config>`;
    const slots = parseObjectSlots(xml);
    expect(slots.get('#4')).toBe(2);
    expect(slots.get('Lid.stl')).toBe(2);
    // And the modifier gets no keys of its own: its slot is a setting, not a colour.
    expect(slots.has('#4/5')).toBe(false);
    expect(slots.has('Denser infill')).toBe(false);
    expect(slots.has('#4/6')).toBe(false);
  });

  it('reads the subtype whether it is an attribute or a metadata child', () => {
    const xml = `<config><object id="4">
        <metadata key="extruder" value="1"/>
        <part id="4"><metadata key="extruder" value="2"/></part>
        <part id="5"><metadata key="key" value="ignored"/>
          <metadata key="subtype" value="MODIFIER_PART"/><metadata key="extruder" value="5"/>
        </part>
      </object></config>`;
    expect(parseObjectSlots(xml).get('#4')).toBe(2);
  });

  it('keeps objects apart rather than letting one bleed into the next', () => {
    const slots = parseObjectSlots(MODEL_SETTINGS);
    expect(slots.get('Body.stl')).not.toBe(slots.get('Eyes.stl'));
  });

  it('ignores an object with no extruder rather than inventing slot 0', () => {
    const xml = `<config><object id="1"><metadata key="name" value="Plain.stl"/></object></config>`;
    expect(parseObjectSlots(xml).size).toBe(0);
  });

  it('survives an empty or unrelated file', () => {
    expect(parseObjectSlots('').size).toBe(0);
    expect(parseObjectSlots('<config/>').size).toBe(0);
  });
});

describe('parseSlotColors', () => {
  it('reads the colour loaded in each slot', () => {
    expect(parseSlotColors(SLICE_INFO)).toEqual([
      { slot: 1, color: '#ff6a13' },
      { slot: 3, color: '#161616' },
    ]);
  });

  it('does not let a later plate change a slot already known', () => {
    // The same spool is in the same slot; a second definition is a repeat, not an update.
    const xml = `<config>
      <plate><filament id="1" color="#FF0000"/></plate>
      <plate><filament id="1" color="#00FF00"/></plate>
    </config>`;
    expect(parseSlotColors(xml)).toEqual([{ slot: 1, color: '#ff0000' }]);
  });

  it('skips a filament with no usable colour', () => {
    const xml = `<config><plate>
      <filament id="1" type="PLA"/>
      <filament id="2" type="PLA" color="#00FF00"/>
    </plate></config>`;
    expect(parseSlotColors(xml)).toEqual([{ slot: 2, color: '#00ff00' }]);
  });

  it('returns nothing for a file that was never sliced', () => {
    expect(parseSlotColors('')).toEqual([]);
  });
});

describe('buildPaint', () => {
  it('joins object to slot to colour', () => {
    const paint = buildPaint(MODEL_SETTINGS, SLICE_INFO);
    expect(paint.byName.get('Body.stl')).toBe('#ff6a13');
    expect(paint.byName.get('Eyes.stl')).toBe('#161616');
    expect(paint.byId.get('1')).toBe('#ff6a13');
    expect(paint.palette).toEqual(['#ff6a13', '#161616']);
  });

  it('paints nothing when the file was never sliced', () => {
    // The case where inventing a colour would be worst: a plain exported 3MF has no slot
    // assignment at all.
    const paint = buildPaint(MODEL_SETTINGS, '');
    expect(paint.byName.size).toBe(0);
    expect(paint.palette).toEqual([]);
  });

  it('paints nothing when an object references a slot with no colour', () => {
    const settings = `<config><object id="1">
      <metadata key="name" value="X.stl"/><metadata key="extruder" value="9"/>
    </object></config>`;
    expect(buildPaint(settings, SLICE_INFO).byName.size).toBe(0);
  });

  it('handles both halves being absent', () => {
    const paint = buildPaint('', '');
    expect(paint.byName.size).toBe(0);
    expect(paint.byId.size).toBe(0);
    expect(paint.palette).toEqual([]);
  });
});

describe('colorForObject', () => {
  const paint = buildPaint(MODEL_SETTINGS, SLICE_INFO);

  it('matches the name the slicer wrote', () => {
    expect(colorForObject(paint, 'Body.stl')).toBe('#ff6a13');
  });

  it('matches when the name dropped the extension', () => {
    expect(colorForObject(paint, 'Body')).toBe('#ff6a13');
  });

  it('prefers an id when there is one', () => {
    expect(colorForObject(paint, 'something else entirely', 2)).toBe('#161616');
  });

  it('returns null for an object it does not know', () => {
    // The important negative: an unmatched object keeps its placeholder rather than being
    // painted a colour nobody chose.
    expect(colorForObject(paint, 'Mystery.stl')).toBeNull();
    expect(colorForObject(paint, undefined)).toBeNull();
  });
});

describe('parseProjectFilamentColors', () => {
  it("reads the plater's filament list, indexed from slot 1", () => {
    // The shape of a project saved but never sliced.
    const json = `{
      "filament_type": ["PLA", "PETG", "PLA", "PLA"],
      "filament_colour": ["#F72323", "#515151", "#000000", "#FFFFFF"]
    }`;
    expect(parseProjectFilamentColors(json)).toEqual([
      { slot: 1, color: '#f72323' },
      { slot: 2, color: '#515151' },
      { slot: 3, color: '#000000' },
      { slot: 4, color: '#ffffff' },
    ]);
  });

  it('does not match default_filament_colour', () => {
    expect(parseProjectFilamentColors('{"default_filament_colour": ["#FF0000"]}')).toEqual([]);
  });

  it('returns nothing for an absent or empty field', () => {
    expect(parseProjectFilamentColors('')).toEqual([]);
    expect(parseProjectFilamentColors('{"other": 1}')).toEqual([]);
  });
});

describe('buildPaint with the project-settings fallback', () => {
  const modelSettings = `
    <object id="17"><metadata key="extruder" value="2"/></object>
  `;

  it('paints from project_settings when slice_info has no filaments', () => {
    // Most saved projects have a slice_info holding nothing but a header.
    const sliceInfo = `<config><header X-BBL-Client-Version="02.07.01.62"/></config>`;
    const project = `{"filament_colour": ["#F72323", "#515151"]}`;
    const paint = buildPaint(modelSettings, sliceInfo, project);
    expect(paint.palette).toEqual(['#f72323', '#515151']);
    expect(paint.byId.get('17')).toBe('#515151');
  });

  it('lets slice_info win where it exists, because it records what was really loaded', () => {
    const sliceInfo = `<filament id="2" color="#00FF00"/>`;
    const project = `{"filament_colour": ["#F72323", "#515151"]}`;
    const paint = buildPaint(modelSettings, sliceInfo, project);
    expect(paint.byId.get('17')).toBe('#00ff00');
    // Slot 1 is still known from the plater, so the palette keeps both.
    expect(paint.palette).toEqual(['#f72323', '#00ff00']);
  });

  it('still returns nothing when no source knows any colour', () => {
    expect(buildPaint(modelSettings, '', '').palette).toEqual([]);
  });
});

/**
 * The standard colour channel, in the shape a spec writer uses: a `<basematerials>` table
 * addressed by `pid`/`pindex` per leaf object, a wrapper object assembling them, and an
 * `<m:colorgroup>` for the readers that read that instead.
 */
const SPEC_MODEL = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
  <metadata name="Title">Clicker</metadata>
  <resources>
    <basematerials id="1">
      <base name="Shell" displaycolor="#DE4343FF"/>
      <base name="Cap" displaycolor="#161616FF"/>
    </basematerials>
    <object id="2" type="model" pid="1" pindex="0" name="Shell"><mesh/></object>
    <object id="3" type="model" pid="1" pindex="1" name="Cap"><mesh/></object>
    <object id="4" type="model"><components>
      <component objectid="2"/><component objectid="3"/>
    </components></object>
    <m:colorgroup id="5"><m:color color="#DE4343FF"/><m:color color="#FFFFFFFF"/></m:colorgroup>
  </resources>
  <build><item objectid="4"/></build>
</model>`;

describe('parseMaterialColors', () => {
  it('reads a basematerials table and the objects that point into it', () => {
    const materials = parseMaterialColors(SPEC_MODEL);
    expect(materials.byObject.get('2')).toBe('#de4343');
    expect(materials.byObject.get('3')).toBe('#161616');
    // The wrapper points at nothing, and must not inherit a colour it never claimed.
    expect(materials.byObject.has('4')).toBe(false);
  });

  it("reads the materials extension's colour group too, whatever its prefix", () => {
    // Both tables share one map, because `pindex` is a position in whichever `pid` names.
    expect(parseMaterialColors(SPEC_MODEL).palette).toEqual(['#de4343', '#161616', '#ffffff']);
    const unprefixed = SPEC_MODEL.replace(/m:colorgroup/g, 'colorgroup').replace(/m:color /g, 'color ');
    expect(parseMaterialColors(unprefixed).palette).toContain('#ffffff');
  });

  it("lets a component's own pid override the object it places", () => {
    // How the spec lets one shared mesh be placed twice in two colours.
    const xml = SPEC_MODEL.replace('<component objectid="3"/>', '<component objectid="3" pid="5" pindex="1"/>');
    expect(parseMaterialColors(xml).byObject.get('3')).toBe('#ffffff');
  });

  it('collapses one mesh placed twice in two colours to the last placement', () => {
    // Pinned rather than left implied. `byObject` is keyed by the object being placed, so a file
    // that uses the spec's shared-mesh trick gets one answer out of this, the later placement's.
    const xml = SPEC_MODEL.replace(
      '<component objectid="2"/><component objectid="3"/>',
      '<component objectid="3" pid="1" pindex="0"/><component objectid="3" pid="5" pindex="1"/>',
    );
    const materials = parseMaterialColors(xml);
    expect(materials.byObject.get('3')).toBe('#ffffff');
    // Objects 2 and 3, and no third key for the second placement of 3.
    expect(materials.byObject.size).toBe(2);
  });

  it("colours an object from a component's pid when the object itself has none", () => {
    const xml = `<model><resources>
      <basematerials id="1"><base name="A" displaycolor="#00FF00"/></basematerials>
      <object id="2" type="model"><mesh/></object>
      <object id="9"><components><component objectid="2" pid="1" pindex="0"/></components></object>
    </resources><build><item objectid="9"/></build></model>`;
    expect(parseMaterialColors(xml).byObject.get('2')).toBe('#00ff00');
  });

  it('says nothing for a file with no colour tables, or a document cut in half', () => {
    // A table cut mid-way has to read as absent rather than as half a palette.
    expect(parseMaterialColors('').palette).toEqual([]);
    expect(parseMaterialColors('<model><resources><object id="1"/></resources></model>').palette).toEqual([]);
    const truncated = SPEC_MODEL.slice(0, SPEC_MODEL.indexOf('<base name=') + 20);
    expect(parseMaterialColors(truncated).palette).toEqual([]);
  });

  it('keeps an unparseable colour in its place, so pindex still counts right', () => {
    const xml = `<model><resources>
      <basematerials id="1">
        <base name="A" displaycolor="not a colour"/><base name="B" displaycolor="#123456"/>
      </basematerials>
      <object id="2" type="model" pid="1" pindex="1"><mesh/></object>
    </resources></model>`;
    const materials = parseMaterialColors(xml);
    expect(materials.byObject.get('2')).toBe('#123456');
    expect(materials.palette).toEqual(['#123456']);
  });
});

describe('buildPaint from the model document itself', () => {
  it('paints a file that carries no slicer config at all', () => {
    // No model_settings.config, so every slicer source returns nothing and the document's own
    // table is the only colour there is.
    const paint = buildPaint('', '', '', SPEC_MODEL);
    expect(paint.byId.get('2')).toBe('#de4343');
    expect(paint.byId.get('3')).toBe('#161616');
    expect(paint.materials).toEqual(['#de4343', '#161616', '#ffffff']);
  });

  it("keeps the document's own colours out of the filament palette", () => {
    // A `displaycolor` is not a filament the file was sliced with: it is what the document wants
    // a surface to look like, and the slicer may never have seen it. The two answers are held
    // apart so nothing can state something the file never said.
    const paint = buildPaint('', '', '', SPEC_MODEL);
    expect(paint.palette).toEqual([]);

    const both = buildPaint(MODEL_SETTINGS, SLICE_INFO, '', SPEC_MODEL);
    expect(both.palette).toEqual(['#ff6a13', '#161616']);
    expect(both.materials).toEqual(['#de4343', '#161616', '#ffffff']);
  });

  it("lets the slicer's extruder assignment win, because that is what actually prints", () => {
    const settings = `<config><object id="2"><metadata key="extruder" value="1"/></object></config>`;
    const slice = `<config><plate><filament id="1" color="#00FF00"/></plate></config>`;
    const paint = buildPaint(settings, slice, '', SPEC_MODEL);
    expect(paint.byId.get('2')).toBe('#00ff00');
    // Object 3 was left to the model's own table.
    expect(paint.byId.get('3')).toBe('#161616');
  });

  it('does not let a material colour answer for a filament slot', () => {
    // Per-face paint asks for slots by number. A file that never loaded slot 2 must not be told
    // slot 2 is whatever colour happens to sit second.
    const paint = buildPaint('', '', '{"filament_colour": ["#F72323"]}', SPEC_MODEL);
    expect(colorForSlot(paint, 1)).toBe('#f72323');
    expect(colorForSlot(paint, 2)).toBeNull();
  });

  it('falls back to palette positions for a paint that recorded no slots', () => {
    const legacy = {
      byName: new Map<string, string>(), byId: new Map<string, string>(),
      palette: ['#aabbcc', '#ddeeff'], materials: [], bySlot: new Map<number, string>(),
    };
    expect(colorForSlot(legacy, 2)).toBe('#ddeeff');
    expect(colorForSlot(legacy, 0)).toBeNull();
  });
});

describe('paintWithMaterials', () => {
  it('completes a paint built from the configs alone', () => {
    const row = buildPaint('', '', '');
    expect(row.palette).toEqual([]);
    const full = paintWithMaterials(row, SPEC_MODEL)!;
    expect(full.byId.get('3')).toBe('#161616');
    expect(full.materials).toEqual(['#de4343', '#161616', '#ffffff']);
    expect(full.palette).toEqual([]);
  });

  it("scopes each part's colours to the entry they came from", () => {
    // Object ids are only unique within one `.model` of a Production-extension archive, so
    // merging two parts under the bare id is first-writer-wins between objects that were never
    // the same object. The loader joins one part at a time, naming each.
    const partOf = (color: string) => `<model><resources>
      <basematerials id="1"><base name="A" displaycolor="${color}"/></basematerials>
      <object id="1" type="model" pid="1" pindex="0"><mesh/></object>
    </resources></model>`;

    let paint = paintWithMaterials(null, partOf('#DE4343FF'), '3D/Objects/object_3.model');
    paint = paintWithMaterials(paint, partOf('#161616FF'), '3D/Objects/object_7.model');

    expect(colorForPart(paint!, '9', '1', null, '3D/Objects/object_3.model')).toBe('#de4343');
    expect(colorForPart(paint!, '9', '1', null, '3D/Objects/object_7.model')).toBe('#161616');
    // The bare key still answers, for a caller with no entry to hand: it is the first part's
    // colour, which is the best a key that cannot tell them apart can do.
    expect(colorForPart(paint!, '9', '1')).toBe('#de4343');
  });

  it('builds a paint out of nothing when there was none', () => {
    expect(paintWithMaterials(null, SPEC_MODEL)!.byId.get('2')).toBe('#de4343');
  });

  it('hands a slicer-coloured file straight back, having found no materials to add', () => {
    const row = buildPaint(MODEL_SETTINGS, SLICE_INFO);
    expect(paintWithMaterials(row, '<model><resources/></model>')).toBe(row);
    expect(paintWithMaterials(null, '<model/>')).toBeNull();
  });

  it('never overwrites what the slicer said', () => {
    const settings = `<config><object id="2"><metadata key="extruder" value="1"/></object></config>`;
    const slice = `<config><plate><filament id="1" color="#00FF00"/></plate></config>`;
    const full = paintWithMaterials(buildPaint(settings, slice), SPEC_MODEL)!;
    expect(full.byId.get('2')).toBe('#00ff00');
  });
});

describe('colorForPart', () => {
  const bambu = buildPaint(`<config><object id="1">
      <metadata key="name" value="clicker"/>
      <metadata key="extruder" value="1"/>
      <part id="9"><metadata key="name" value="body"/><metadata key="extruder" value="1"/></part>
      <part id="12"><metadata key="name" value="cap"/><metadata key="extruder" value="3"/></part>
    </object></config>`, SLICE_INFO);

  it('gives each part of an assembly its own filament', () => {
    expect(colorForPart(bambu, '1', '9')).toBe('#ff6a13');
    expect(colorForPart(bambu, '1', '12')).toBe('#161616');
  });

  it("falls back to the part's own object id, which is what a spec file states", () => {
    const spec = buildPaint('', '', '', SPEC_MODEL);
    // The build item is the wrapper, id 4; the colour is on each leaf it places.
    expect(colorForPart(spec, '4', '2')).toBe('#de4343');
    expect(colorForPart(spec, '4', '3')).toBe('#161616');
  });

  it("falls back to the part's name", () => {
    expect(colorForPart(bambu, '7', '99', 'cap')).toBe('#161616');
  });

  it('returns null for a part the file said nothing about', () => {
    expect(colorForPart(bambu, '1', '44')).toBeNull();
    expect(colorForPart(bambu, '1', '44', 'nobody')).toBeNull();
  });
});
