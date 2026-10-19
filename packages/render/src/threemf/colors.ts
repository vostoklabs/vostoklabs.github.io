/**
 * The colours a 3MF was printed in, from whichever of its sources the file carries.
 *
 * A general-purpose 3MF loader reads the spec's `<basematerials>`, and Bambu Studio does not
 * record colour there. It records the assignment its own way: `Metadata/model_settings.config`
 * says which **extruder slot** each object prints on, and `Metadata/slice_info.config` (or, for
 * a project never sliced, `Metadata/project_settings.config`) says what **colour of filament**
 * is loaded in each slot. Neither file is part of the 3MF core spec.
 *
 * Joining those two is the whole trick:
 *
 * ```
 *   model_settings.config      slice_info.config
 *   object "Body" → slot 2     slot 2 → #FF6A13
 *                        ↓
 *                  Body is orange
 * ```
 *
 * **The third source is the model document's own colours.** The core spec puts colour in
 * `<basematerials>` and the materials extension puts it in `<m:colorgroup>`, both inside the
 * `.model` entries, addressed by a `pid`/`pindex` pair on the object or the component that
 * places it. Plenty of 3MFs carry no `model_settings.config` at all, and for every one of them
 * that table is the only colour there is. See `parseMaterialColors`, including for the one form
 * of that channel this does not read, a colour index per `<triangle>`.
 *
 * The fourth source, per-face painting, is decoded in `paint.ts` and resolved through
 * `colorForSlot`.
 *
 * **Nothing here invents a colour.** A file with no assignment produces empty maps and the caller
 * keeps its own placeholder, because a guessed colour on someone's model is worse than an honest
 * grey: it looks like information and is not.
 */

/** A slot number as the slicer counts them, and the colour loaded in it. */
export interface SlotColor {
  slot: number;
  /** `#rrggbb`. */
  color: string;
}

export interface ThreeMfPaint {
  /** Object name, exactly as the slicer wrote it, to the colour it prints in. */
  byName: Map<string, string>;
  /**
   * 3MF object id to the colour it prints in.
   *
   * Also keyed `objectId/partId` for a part of an assembly (see `parseObjectSlots`), and
   * `entry::objectId` for a colour the model document declared, where `entry` is the `.model`
   * the object was read from. That third form exists because an object id is only unique
   * *within* one `.model` part of a Production-extension archive, which is why `mesh.ts` keys its
   * own object map the same way; a bare id lets object 1 of `object_3.model` answer for object 1
   * of `object_7.model`. See `colorForPart` for the lookup order. The three key forms cannot
   * collide (see `materialKey`), so they share one map.
   */
  byId: Map<string, string>;
  /** Every distinct **filament** colour, in slot order. */
  palette: string[];
  /**
   * Every distinct colour the model document declares for itself, in resource order.
   *
   * Held apart from `palette` because it is not the same claim. `palette` is what was loaded in
   * the printer; this is what a `<basematerials>` or `<m:colorgroup>` entry says a surface
   * should look like, which the slicer may well have ignored. Merging them would state
   * something about the print that the file never said, and `colorForSlot`'s positional
   * fallback reads `palette` for the same reason.
   */
  materials: string[];
  /**
   * Slot number to colour, kept unflattened.
   *
   * `palette` is a list, and a file that leaves slot 2 empty makes its positions lie about which
   * slot is which. Per-face paint names slots by number (`paint.ts`), so it needs the map rather
   * than the list.
   */
  bySlot: Map<number, string>;
}

/** `#RGB` and `#RRGGBBAA` both appear in the wild; normalise to `#rrggbb`. */
export function normaliseHex(raw: string | undefined): string | null {
  if (!raw) return null;
  const hex = raw.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`.toLowerCase();
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex.toLowerCase()}`;
  // 8 digits is RGBA; the alpha is not something a print has.
  if (/^[0-9a-f]{8}$/i.test(hex)) return `#${hex.slice(0, 6).toLowerCase()}`;
  return null;
}

/**
 * The `<part>` subtypes that are not printed geometry.
 *
 * A modifier changes settings inside a volume, a negative cuts one away, and the two support
 * painters mark where support may and may not go. All four are written into
 * `model_settings.config` as ordinary `<part>` blocks carrying their own `extruder` metadata, so
 * one modifier parked on a spare slot would otherwise outvote every real part in the agreement
 * test below, and the object would fall back to whatever its stale header said.
 */
const NON_PRINTING_SUBTYPES = new Set([
  'modifier_part', 'negative_part', 'support_enforcer', 'support_blocker',
]);

/** The `subtype` of a `<part>`, written as an attribute or as a metadata child. */
function partSubtype(part: string): string | undefined {
  return (/^[^>]*\bsubtype="([^"]*)"/i.exec(part)?.[1]
    ?? /<metadata[^>]*\bkey="subtype"[^>]*\bvalue="([^"]*)"/i.exec(part)?.[1])?.toLowerCase();
}

/**
 * Reads which extruder slot each object prints on.
 *
 * Matched with a regex rather than an XML parser, deliberately and for the same reason the rest
 * of the 3MF reading is: these are flat, machine-written config files, this needs two attributes
 * off them, and a DOM parser is unavailable in a worker anyway.
 *
 * A `<part>` inside an `<object>` may override the object's own slot, and does in every
 * multi-material file, so parts are read after objects and win.
 *
 * Parts are keyed **`#objectId/partId`**, not `#objectId`. A `<part id="9">` *is* the object's
 * `<component objectid="9">`, so an assembly of six blocks on extruder 1 and one cap on extruder
 * 3 has seven answers; a single key per object would keep only the last of them and colour the
 * whole assembly like the cap.
 */
export function parseObjectSlots(modelSettingsXml: string): Map<string, number> {
  const slots = new Map<string, number>();
  if (!modelSettingsXml) return slots;

  // Each <object …> … </object> block, so a part is attributed to its own object.
  for (const block of modelSettingsXml.split(/<object\b/i).slice(1)) {
    const id = /^[^>]*\bid="([^"]+)"/i.exec(block)?.[1];

    const nameOf = (chunk: string): string | undefined =>
      /<metadata[^>]*\bkey="name"[^>]*\bvalue="([^"]*)"/i.exec(chunk)?.[1];
    const slotOf = (chunk: string): number | undefined => {
      const raw = /<metadata[^>]*\bkey="extruder"[^>]*\bvalue="(\d+)"/i.exec(chunk)?.[1];
      const n = raw ? Number(raw) : NaN;
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };

    // The object's own header, up to its first part.
    const head = block.split(/<part\b/i)[0] ?? '';
    const objectName = nameOf(head);
    const objectSlot = slotOf(head);
    if (objectSlot !== undefined) {
      if (objectName) slots.set(objectName, objectSlot);
      if (id) slots.set(`#${id}`, objectSlot);
    }

    // Parts override, and carry their own names. A part that is not printed geometry is skipped
    // outright rather than only kept out of the agreement test: its slot is a setting, not a
    // colour, and letting its name into `byName` would paint a real object that happens to share
    // the name.
    const partSlots: number[] = [];
    for (const part of block.split(/<part\b/i).slice(1)) {
      const subtype = partSubtype(part);
      if (subtype && NON_PRINTING_SUBTYPES.has(subtype)) continue;
      const partId = /^[^>]*\bid="([^"]+)"/i.exec(part)?.[1];
      const partName = nameOf(part);
      const partSlot = slotOf(part);
      if (partSlot === undefined) continue;
      partSlots.push(partSlot);
      if (partName) slots.set(partName, partSlot);
      if (id && partId) slots.set(`#${id}/${partId}`, partSlot);
    }

    // The object's own key still has to answer, because a caller that cannot split an object
    // into parts asks for it, and because most files state the extruder only on the part. Parts
    // win where they agree: the object header is very often a leftover slot 1 while the parts say
    // what actually prints. Where they disagree there is no one colour for the object, so the
    // header's own value stands and the per-part keys above are what a part is coloured from.
    const first = partSlots[0];
    if (first !== undefined && partSlots.every((s) => s === first)) {
      if (id) slots.set(`#${id}`, first);
      if (objectName) slots.set(objectName, first);
    }
  }

  return slots;
}

/**
 * Reads the colour loaded in each extruder slot.
 *
 * `slice_info.config` lists a `<filament id="1" … color="#RRGGBB">` per slot, repeated per plate.
 * The same spool is in the same slot on every plate, so the first definition of a slot wins and
 * later plates cannot flip a colour that is already known.
 */
export function parseSlotColors(sliceInfoXml: string): SlotColor[] {
  const found = new Map<number, string>();
  if (!sliceInfoXml) return [];

  for (const tag of sliceInfoXml.matchAll(/<filament\b[^>]*>/gi)) {
    const el = tag[0];
    const idRaw = /\bid="(\d+)"/i.exec(el)?.[1];
    const colorRaw = /\bcolor="([^"]*)"/i.exec(el)?.[1];
    const slot = idRaw ? Number(idRaw) : NaN;
    const color = normaliseHex(colorRaw);
    if (!Number.isFinite(slot) || slot <= 0 || !color) continue;
    if (!found.has(slot)) found.set(slot, color);
  }

  return [...found.entries()]
    .map(([slot, color]) => ({ slot, color }))
    .sort((a, b) => a.slot - b.slot);
}

/**
 * The colour in each slot as the *plater* recorded it.
 *
 * `slice_info.config` only lists filaments for a project that was actually sliced; otherwise it
 * holds nothing but a `<header>`, and that is the state almost every saved project is in. Reading
 * `slice_info` alone would leave most files uncoloured.
 *
 * `project_settings.config` carries the plater's own list as a JSON array, index 0 being slot 1,
 * and it is present whether or not the project was ever sliced.
 *
 * Split and indexed by position, never filtered: an unloaded slot has to keep its place or every
 * slot after it is attributed the wrong colour.
 */
export function parseProjectFilamentColors(projectSettingsJson: string): SlotColor[] {
  if (!projectSettingsJson) return [];
  // Anchored to a line start, `{` or `,` so `default_filament_colour` cannot match.
  const raw = /(?:^|[{,])\s*"?filament_colour"?\s*[=:]\s*\[([^\]]*)\]/im
    .exec(projectSettingsJson)?.[1];
  if (!raw) return [];

  const out: SlotColor[] = [];
  raw.split(',').forEach((token, i) => {
    const color = normaliseHex(token.trim().replace(/^"|"$/g, ''));
    if (color) out.push({ slot: i + 1, color });
  });
  return out;
}

/** The colours a model document declares for itself, and which object wears which. */
export interface ThreeMfMaterials {
  /** Object id to the colour its `pid`/`pindex` names. */
  byObject: Map<string, string>;
  /** Every distinct colour the document declares, in resource order. */
  palette: string[];
}

/**
 * The colours the model document itself declares: the standard 3MF colour channel.
 *
 * Two tables carry them and they are read identically, because `pindex` is a position in
 * whichever one `pid` points at:
 *
 * ```xml
 * <basematerials id="1"><base name="Shell" displaycolor="#DE4343FF"/>…</basematerials>
 * <m:colorgroup id="7"><m:color color="#DE4343FF"/>…</m:colorgroup>
 * <object id="2" type="model" pid="1" pindex="0">…</object>
 * <object id="9"><components><component objectid="2" pid="7" pindex="3"/></components></object>
 * ```
 *
 * A component's own pair wins over the object's, so components are read second and overwrite.
 *
 * **The map is keyed by the object being placed, not by the placement.** So the spec's other use
 * of that rule, one shared mesh placed twice in two colours, is not answered here: two components
 * naming the same `objectid` with different pairs collapse to whichever the document lists last.
 * That is a deliberate stop. A per-placement key would have nowhere to land, because a mesh's
 * identity downstream is its object id (`mesh.ts` buckets by it), so the second colour could not
 * be painted even if it were recorded.
 *
 * **What this does not read: `pid` with `p1`/`p2`/`p3` on a `<triangle>`.** The core spec also
 * lets a single mesh carry a colour index per face, with the object's `pindex` as the default,
 * which is how several exporters write a multi-coloured single object. Such a file resolves to
 * one flat colour here, the object's default. Reading it means carrying a per-triangle index
 * through the mesh build the way `paint.ts` carries painted slots: a channel of its own rather
 * than a line in this function.
 *
 * Regex rather than a DOM, for the reason the rest of this file gives. A table that was cut in
 * half (a truncated document) simply does not match, which is the right answer for one.
 */
export function parseMaterialColors(modelXml: string): ThreeMfMaterials {
  const byObject = new Map<string, string>();
  const palette: string[] = [];
  if (!modelXml) return { byObject, palette };

  // Resource id to its colours, by index. An entry that does not parse keeps its position as an
  // empty string, because `pindex` counts positions and a hole would shift every colour after it
  // onto the wrong object.
  const groups = new Map<string, string[]>();
  const addGroup = (id: string | undefined, colors: string[]) => {
    if (!id || colors.every((c) => !c)) return;
    groups.set(id, colors);
    for (const c of colors) if (c && !palette.includes(c)) palette.push(c);
  };

  for (const table of modelXml.matchAll(/<basematerials\b([^>]*)>([\s\S]*?)<\/basematerials\s*>/gi)) {
    const colors = [...(table[2] ?? '').matchAll(/<base\b[^>]*>/gi)]
      .map((b) => normaliseHex(/\bdisplaycolor="([^"]*)"/i.exec(b[0])?.[1]) ?? '');
    addGroup(/\bid="([^"]+)"/i.exec(table[1] ?? '')?.[1], colors);
  }

  // The materials extension is namespaced, and writers disagree about the prefix: some write
  // `m:`, others the default namespace. Match either.
  const GROUP = /<(?:[\w.-]+:)?colorgroup\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?colorgroup\s*>/gi;
  for (const table of modelXml.matchAll(GROUP)) {
    const colors = [...(table[2] ?? '').matchAll(/<(?:[\w.-]+:)?color\b[^>]*>/gi)]
      .map((c) => normaliseHex(/\bcolor="([^"]*)"/i.exec(c[0])?.[1]) ?? '');
    addGroup(/\bid="([^"]+)"/i.exec(table[1] ?? '')?.[1], colors);
  }

  if (groups.size === 0) return { byObject, palette };

  const colorAt = (pid: string | undefined, pindex: string | undefined): string | null => {
    if (!pid) return null;
    // `pindex` is optional; absent, it addresses the first entry of the table.
    return groups.get(pid)?.[pindex ? Number(pindex) : 0] || null;
  };

  for (const block of modelXml.split(/<object\b/i).slice(1)) {
    const head = /^[^>]*/.exec(block)?.[0] ?? '';
    const id = /\bid="([^"]+)"/i.exec(head)?.[1];
    if (!id) continue;
    const color = colorAt(/\bpid="([^"]+)"/i.exec(head)?.[1], /\bpindex="(\d+)"/i.exec(head)?.[1]);
    if (color) byObject.set(id, color);
  }

  for (const tag of modelXml.matchAll(/<component\b[^>]*>/gi)) {
    const el = tag[0];
    const objectId = /\bobjectid="([^"]+)"/i.exec(el)?.[1];
    if (!objectId) continue;
    const color = colorAt(/\bpid="([^"]+)"/i.exec(el)?.[1], /\bpindex="(\d+)"/i.exec(el)?.[1]);
    if (color) byObject.set(objectId, color);
  }

  return { byObject, palette };
}

/**
 * A `byId` key that scopes an object id to the `.model` entry it was read from.
 *
 * The same scoping `keyOf` in `mesh.ts` applies to its own object map, for the same reason: the
 * two are answering one question about one archive. `::` cannot collide with the other two key
 * forms: an entry name is a zip path, and both a bare id and the `objectId/partId` form are built
 * from resource ids, which are integers.
 */
function materialKey(entry: string, objectId: string): string {
  return `${entry}::${objectId}`;
}

/**
 * Joins the sources into "this object is this colour".
 *
 * Returns empty maps when the model settings name no slots, no source knows what colour those
 * slots held, and the model document declares no materials of its own.
 *
 * `modelXml` is the root model document, or none. A caller holding every `.model` entry of the
 * archive completes the join entry by entry with `paintWithMaterials`, which also scopes each
 * colour to the entry it came from.
 */
export function buildPaint(
  modelSettingsXml: string,
  sliceInfoXml: string,
  projectSettingsJson = '',
  modelXml = '',
): ThreeMfPaint {
  const slots = parseObjectSlots(modelSettingsXml);

  // `slice_info` wins where it exists: it records what was actually loaded at slice time, where
  // `project_settings` records what the plater was configured with.
  const bySlot = new Map<number, string>();
  for (const c of parseProjectFilamentColors(projectSettingsJson)) bySlot.set(c.slot, c.color);
  for (const c of parseSlotColors(sliceInfoXml)) bySlot.set(c.slot, c.color);

  const byName = new Map<string, string>();
  const byId = new Map<string, string>();

  for (const [key, slot] of slots) {
    const color = bySlot.get(slot);
    if (!color) continue;
    if (key.startsWith('#')) byId.set(key.slice(1), color);
    else byName.set(key, color);
  }

  const palette = [...bySlot.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);

  // The slicer's assignment wins where it exists: it says what actually prints, where a
  // `displaycolor` is a hint the slicer may well have ignored. So materials only fill in objects
  // nothing else spoke for, which, for a file with no `model_settings.config`, is all of them.
  const materials = parseMaterialColors(modelXml);
  for (const [id, color] of materials.byObject) if (!byId.has(id)) byId.set(id, color);

  return { byName, byId, palette, materials: materials.palette, bySlot };
}

/**
 * The same join, completed with one model document's own colours.
 *
 * Returns `paint` untouched when the document declares no colours, so a file coloured only by the
 * slicer pays nothing but the scan.
 *
 * `entry` is the archive entry `modelXml` came out of, and is what makes calling this once per
 * `.model` part safe: object ids repeat across the parts of a Production-extension archive, so the
 * entry-scoped key is the only one that can tell object 1 of `object_3.model` from object 1 of
 * `object_7.model`. The bare key is still written for whichever part claims it first, for a
 * caller with no entry to hand.
 */
export function paintWithMaterials(
  paint: ThreeMfPaint | null,
  modelXml: string,
  entry = '',
): ThreeMfPaint | null {
  const materials = parseMaterialColors(modelXml);
  if (materials.palette.length === 0) return paint;

  const byId = new Map(paint?.byId);
  for (const [id, color] of materials.byObject) {
    if (entry) byId.set(materialKey(entry, id), color);
    if (!byId.has(id)) byId.set(id, color);
  }
  const mats = [...(paint?.materials ?? [])];
  for (const color of materials.palette) if (!mats.includes(color)) mats.push(color);

  return {
    byName: new Map(paint?.byName),
    byId,
    palette: [...(paint?.palette ?? [])],
    materials: mats,
    bySlot: new Map(paint?.bySlot),
  };
}

/**
 * The colour loaded in one filament slot, or null when the file never said.
 *
 * Per-face paint names slots by number, so this is the lookup it needs. `bySlot` is the honest
 * answer; `palette` by position is the fallback for a paint built without a slot map, and is
 * right whenever the slots run from 1 without gaps, which is how slicers write `filament_colour`.
 *
 * The fallback is confined to a paint with no `bySlot` at all. Position stands in for a slot only
 * where there is nothing better: a file that loaded slots 1 and 3 must not be told slot 2 is
 * whatever colour happens to sit second. A model's own `<basematerials>` colours cannot reach
 * here at all: they live in `materials`, not `palette`, precisely because they are not filament
 * slots.
 */
export function colorForSlot(paint: ThreeMfPaint, slot: number): string | null {
  if (slot <= 0) return null;
  const known = paint.bySlot.get(slot);
  if (known) return known;
  return paint.bySlot.size === 0 ? paint.palette[slot - 1] ?? null : null;
}

/**
 * The colour for one object, or null to leave it alone.
 *
 * Slicers write names that pick up a `.stl` suffix or a ` (1)` copy marker on the way in, so the
 * match is tried exact first, then loosened, and never guessed: an object nothing matches keeps
 * whatever the caller would otherwise give it.
 *
 * `entry` is the `.model` the object was read from, and is tried before the bare id for the
 * reason `paintWithMaterials` gives: ids repeat across the parts of one archive.
 */
export function colorForObject(
  paint: ThreeMfPaint,
  name: string | undefined,
  id?: string | number,
  entry?: string | null,
): string | null {
  if (id !== undefined) {
    const scoped = entry ? paint.byId.get(materialKey(entry, String(id))) : undefined;
    if (scoped) return scoped;
    const byId = paint.byId.get(String(id));
    if (byId) return byId;
  }
  if (!name) return null;

  const exact = paint.byName.get(name);
  if (exact) return exact;

  // `Body.stl` written by the slicer, `Body` in the document, or the reverse.
  const stripped = name.replace(/\.(stl|obj|3mf|step|stp)$/i, '');
  for (const [key, color] of paint.byName) {
    if (key === stripped) return color;
    if (key.replace(/\.(stl|obj|3mf|step|stp)$/i, '') === stripped) return color;
  }
  return null;
}

/**
 * The colour for one *part* of an object: one run of an assembly's triangles.
 *
 * Four keys, in the order of how specific the file was:
 *
 * 1. `objectId/partId`, which is what `model_settings.config` states per `<part>`. The slicer's
 *    own assignment leads, here as everywhere: it says what actually prints.
 * 2. `entry::partId`, the `pid`/`pindex` the model document put on that object, read from the
 *    `.model` the part's geometry came out of. Scoped, because a Production-extension archive
 *    reuses ids across its parts.
 * 3. `partId` alone: the same statement from a single-part archive, or for a caller with no
 *    entry to hand.
 * 4. the part's own name, matched the way `colorForObject` matches names.
 *
 * Null means the file said nothing about this part, and the caller falls back to whatever it
 * knows about the object as a whole. Nothing is guessed.
 */
export function colorForPart(
  paint: ThreeMfPaint,
  objectId: string,
  partId: string,
  partName?: string | null,
  entry?: string | null,
): string | null {
  return paint.byId.get(`${objectId}/${partId}`)
    ?? (entry ? paint.byId.get(materialKey(entry, partId)) : undefined)
    ?? paint.byId.get(partId)
    ?? (partName ? colorForObject(paint, partName) : null);
}
