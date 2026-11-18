// The picture window's colour list as state: the colours the picture has, the group each prints
// in, each group's filament, and the Colours stepper. Pure (no DOM), so its rules are tested in
// node; the window only draws it.
//
//  - The list is found again whenever the picture changes (`refresh`). A choice survives that by
//    colour, not by position: after a tone nudge every colour moves a little, so each new colour
//    takes the group of the old one nearest it, and a colour near none of them is its own part.
//  - The stepper re-merges the same list by closest pair. Past the colours found, "+" asks for a
//    finer split (`splitFiner`, run by the window after its debounce, so its busy line paints).
//  - A filament picked by hand belongs to the colour it was picked for, and a merge made by hand
//    is kept: a stepper press merges the closest pairs from the hand merges, and "+" takes the
//    latest hand merge apart only when no other merge is left to take apart.
//  - Reopened on a mapping saved at a finer split, the finder is asked that finely again, so the
//    saved colours are all there and the count is the one that was confirmed.
import { closestPairMapping, defaultFilaments, srgbToOklab, type ColourCandidate } from '@vostok/trace';
import type { RGB } from '../types';
import { filamentCountText, finerWith, stepperTop, type MappedColour } from './colourSplit';

type Lab = [number, number, number];

/** Two colours this close in Oklab are "the same colour" when the list is found again after a
 *  tone change nudges every colour a little. */
export const SAME_COLOUR = 0.12;

const keyOf = (rgb: RGB) => rgb.join();
const labDist = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export interface ColourChoices {
  /** The picture's colours, biggest first. */
  readonly candidates: readonly ColourCandidate[];
  /** How finely they were asked for (`findColours`' detail). */
  readonly detail: number;
  /** The finest split has no more colours than the list: "+" ends at the list. */
  readonly exhausted: boolean;
  /** "+" went past the colours found: `splitFiner` is due. */
  readonly wantFiner: boolean;
  groupOf(k: number): number;
  filamentOf(group: number): RGB;
  hasGroup(group: number): boolean;
  /** Candidate `k` is its group's biggest colour, the one the group's row leads with. */
  isLead(k: number): boolean;
  /** The groups, biggest first by the share of the picture they print. */
  groupsInOrder(): number[];
  /** The mapping as `processImage` and the build take it: groups numbered biggest first. */
  mapping(): { colors: MappedColour[]; filaments: RGB[] };
  /** The filament a traced region of colour `rgb` (one of the candidates) prints in. */
  filamentFor(rgb: RGB): RGB;
  /** The picture changed: find its colours again and carry the choices over. */
  refresh(): void;
  /** The stepper: `n` filaments. */
  setCount(n: number): void;
  /** "+" past the colours found: a finer split, mapped to the count asked for. */
  splitFiner(): void;
  /** Colour `k` prints with group `into`; its whole group when `k` leads it. Whether the groups
   *  changed (the picture is traced again). */
  merge(k: number, into: number): boolean;
  /** Colour `k` prints in `rgb`: its group's filament when it leads it, else its own new group.
   *  Whether the groups changed. */
  recolour(k: number, rgb: RGB): boolean;
  stepperTop(): number;
  countText(): string;
}

export function colourChoices(
  /** The picture's colours at a detail: `findColours` on the picture as it stands. */
  find: (detail: number) => ColourCandidate[],
  /** The mapping confirmed last time, when the window is reopened on the same picture. */
  initial?: { colors: MappedColour[]; filaments: RGB[] },
): ColourChoices {
  let candidates: ColourCandidate[] = [];
  let detail = 0;
  let exhausted = false;
  let wantFiner = false;
  /** How many filaments: the picture's default until the stepper is used. */
  let budget = 1;
  let budgetTouched = false;
  let groups: number[] = [];
  const filaments = new Map<number, RGB>();
  let nextGroup = 0;
  /** The mapping as it stands, by colour, to carry across a refresh. */
  let remembered: { lab: Lab; group: number; filament: RGB }[] = initial
    ? initial.colors.map((c) => ({ lab: srgbToOklab(c.rgb), group: c.group, filament: initial.filaments[c.group] ?? c.rgb }))
    : [];
  /** Filaments picked for a colour, by its colour: kept while the colour is not leading a group. */
  const picks = new Map<string, { rgb: RGB; filament: RGB }>();
  /** Merges made by hand, latest last; each is the pairs of colours one choice put together. */
  let joins: [RGB, RGB][][] = [];
  /** A reopened mapping's colour count: the first find asks at least this finely. */
  let seedWant = initial?.colors.length ?? 0;
  if (initial) {
    const led = new Set<number>();
    for (const c of initial.colors) {
      if (led.has(c.group)) continue;
      led.add(c.group);
      const fil = initial.filaments[c.group];
      if (fil && keyOf(fil) !== keyOf(c.rgb)) picks.set(keyOf(c.rgb), { rgb: c.rgb, filament: fil });
    }
  }

  const indexOf = (rgb: RGB) => candidates.findIndex((c) => keyOf(c.rgb) === keyOf(rgb));
  const leadOf = (g: number) => groups.indexOf(g);
  const groupsInOrder = (): number[] => {
    const cover = new Map<number, number>();
    candidates.forEach((c, k) => cover.set(groups[k], (cover.get(groups[k]) ?? 0) + c.coverage));
    return [...cover.keys()].sort((p, q) => cover.get(q)! - cover.get(p)!);
  };
  const remember = () => {
    remembered = candidates.map((c, k) => ({ lab: srgbToOklab(c.rgb), group: groups[k], filament: filaments.get(groups[k])! }));
    // The stepper shows the count as it stands, so a later split starts from it.
    budget = Math.max(1, groupsInOrder().length);
  };

  /** After the list is found again, a pick or a hand merge names the new colour nearest its old one. */
  const rekey = () => {
    const labs = candidates.map((c) => srgbToOklab(c.rgb));
    const nearest = (rgb: RGB): RGB => {
      const lab = srgbToOklab(rgb);
      let best = -1;
      let bestD = SAME_COLOUR;
      labs.forEach((l, k) => {
        const d = labDist(l, lab);
        if (d <= bestD) { bestD = d; best = k; }
      });
      return best >= 0 ? candidates[best].rgb : rgb;
    };
    const old = [...picks.values()];
    picks.clear();
    for (const p of old) {
      const rgb = nearest(p.rgb);
      picks.set(keyOf(rgb), { rgb, filament: p.filament });
    }
    joins = joins.map((pairs) => pairs.map(([a, b]) => [nearest(a), nearest(b)] as [RGB, RGB]));
  };

  /** The hand merges whose colours are both in the list, as `closestPairMapping`'s `joined`. */
  const joinedIds = (): { ids: number[]; count: number; latest: number } => {
    const parent = candidates.map((_, k) => k);
    const root = (k: number): number => (parent[k] === k ? k : (parent[k] = root(parent[k])));
    let latest = -1;
    joins.forEach((pairs, j) => {
      for (const [a, b] of pairs) {
        const p = indexOf(a), q = indexOf(b);
        if (p < 0 || q < 0) continue;
        latest = j;
        parent[root(p)] = root(q);
      }
    });
    const ids = candidates.map((_, k) => root(k));
    return { ids, count: new Set(ids).size, latest };
  };

  /** Merge the list into `n` groups, closest first, from the hand merges. When they alone leave
   *  fewer groups than `n`, the latest of them is taken apart. */
  const mapTo = (wanted: number) => {
    const n = Math.max(1, Math.min(wanted, candidates.length));
    let joined = joinedIds();
    while (joined.count < n && joined.latest >= 0) {
      joins.splice(joined.latest, 1);
      joined = joinedIds();
    }
    const split = closestPairMapping(candidates, n, joined.ids);
    const base = nextGroup;
    nextGroup += new Set(split).size;
    groups = split.map((g) => base + g);
    filaments.clear();
    // Candidates come biggest first, so a group's first member leads it and names its filament.
    candidates.forEach((c, k) => {
      const g = groups[k];
      if (!filaments.has(g)) filaments.set(g, picks.get(keyOf(c.rgb))?.filament ?? c.rgb);
    });
  };

  /** Each new colour takes the group of the remembered colour nearest it. */
  const carryOver = () => {
    filaments.clear();
    groups = [];
    const fromOld = new Map<number, number>();
    candidates.forEach((c, k) => {
      const lab = srgbToOklab(c.rgb);
      let best = -1;
      let bestD = SAME_COLOUR;
      remembered.forEach((m, i) => {
        const d = labDist(m.lab, lab);
        if (d <= bestD) { bestD = d; best = i; }
      });
      if (best < 0) {
        const g = nextGroup++;
        groups[k] = g;
        filaments.set(g, c.rgb);
        return;
      }
      let g = fromOld.get(remembered[best].group);
      if (g === undefined) {
        g = nextGroup++;
        fromOld.set(remembered[best].group, g);
        filaments.set(g, remembered[best].filament);
      }
      groups[k] = g;
    });
  };

  const dropJoinsOf = (rgb: RGB) => {
    joins = joins.map((pairs) => pairs.filter(([a, b]) => keyOf(a) !== keyOf(rgb) && keyOf(b) !== keyOf(rgb))).filter((p) => p.length);
  };

  return {
    get candidates() { return candidates; },
    get detail() { return detail; },
    get exhausted() { return exhausted; },
    get wantFiner() { return wantFiner; },
    groupOf: (k) => groups[k],
    filamentOf: (g) => filaments.get(g)!,
    hasGroup: (g) => filaments.has(g),
    isLead: (k) => leadOf(groups[k]) === k,
    groupsInOrder,
    mapping() {
      const order = groupsInOrder();
      const rank = new Map(order.map((g, i) => [g, i] as const));
      return {
        colors: candidates.map((c, k) => ({ rgb: c.rgb, group: rank.get(groups[k])! })),
        filaments: order.map((g) => filaments.get(g)!),
      };
    },
    filamentFor(rgb) {
      const k = indexOf(rgb);
      return k >= 0 ? filaments.get(groups[k]) ?? rgb : rgb;
    },
    refresh() {
      let found = find(detail);
      exhausted = false;
      if (seedWant > found.length) {
        // Reopened on a finer split than this detail gives: ask as finely as it was.
        const finer = finerWith(find, { candidates: found, detail }, seedWant);
        found = finer.candidates;
        detail = finer.detail;
        exhausted = finer.exhausted;
      }
      seedWant = 0;
      candidates = found;
      rekey();
      if (remembered.length) carryOver();
      else mapTo(budgetTouched ? budget : defaultFilaments(candidates));
      remember();
    },
    setCount(n) {
      budget = n;
      budgetTouched = true;
      if (n > candidates.length && !exhausted) {
        wantFiner = true;
        return;
      }
      mapTo(n);
      remember();
    },
    splitFiner() {
      wantFiner = false;
      const want = budget;
      const more = finerWith(find, { candidates, detail }, want);
      candidates = more.candidates;
      detail = more.detail;
      exhausted = more.exhausted;
      mapTo(want);
      remember();
    },
    merge(k, into) {
      const g = groups[k];
      if (into === g || !filaments.has(into)) return false;
      const target = candidates[leadOf(into)].rgb;
      const fil = filaments.get(into)!;
      const moved: [RGB, RGB][] = [];
      if (leadOf(g) === k) {
        for (let i = 0; i < groups.length; i++) {
          if (groups[i] !== g) continue;
          groups[i] = into;
          moved.push([candidates[i].rgb, target]);
        }
        filaments.delete(g);
      } else {
        dropJoinsOf(candidates[k].rgb);
        groups[k] = into;
        moved.push([candidates[k].rgb, target]);
      }
      joins.push(moved);
      // The group prints in the filament it was merged into, whichever colour now leads it.
      const lead = candidates[leadOf(into)].rgb;
      picks.set(keyOf(lead), { rgb: lead, filament: fil });
      remember();
      return true;
    },
    recolour(k, rgb) {
      const c = candidates[k].rgb;
      picks.set(keyOf(c), { rgb: c, filament: rgb });
      if (leadOf(groups[k]) === k) {
        filaments.set(groups[k], rgb);
        remember();
        return false;
      }
      // A colour that is not its group's lead gets a filament of its own: it leaves the group.
      dropJoinsOf(c);
      const ng = nextGroup++;
      groups[k] = ng;
      filaments.set(ng, rgb);
      remember();
      return true;
    },
    stepperTop: () => stepperTop(candidates.length, exhausted),
    countText: () => filamentCountText(groupsInOrder().length, candidates.length, exhausted),
  };
}
