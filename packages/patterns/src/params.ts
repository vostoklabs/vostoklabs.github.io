// Parameter plumbing: defaults from the spec, the caller's overrides on top, everything
// coerced to the spec's type and clamped to its range so a pattern never sees a NaN or a
// negative spacing.
import type { ParamSpec, ParamValue, Params, PatternDef } from './types';

export function resolveParams(def: PatternDef, given?: Partial<Params>): Params {
  const out: Params = {};
  for (const spec of def.params) out[spec.key] = coerce(spec, given?.[spec.key]);
  return out;
}

function coerce(spec: ParamSpec, raw: ParamValue | undefined): ParamValue {
  if (raw === undefined || raw === null) return spec.value;
  if (spec.kind === 'number') {
    const v = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(v)) return spec.value;
    const lo = spec.min ?? -Infinity;
    const hi = spec.max ?? Infinity;
    return Math.min(hi, Math.max(lo, v));
  }
  if (spec.kind === 'toggle') return raw === true || raw === 'true' || raw === 1;
  const s = String(raw);
  return spec.options?.some((o) => o.value === s) ? s : spec.value;
}

export const num = (p: Params, key: string, fallback = 0): number => {
  const v = p[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};
export const bool = (p: Params, key: string): boolean => p[key] === true;
export const str = (p: Params, key: string, fallback = ''): string => (typeof p[key] === 'string' ? (p[key] as string) : fallback);

// Spec builders, so a pattern file reads as a list of knobs rather than object literals.
export const number = (key: string, label: string, value: number, min: number, max: number, step = 0.5, unit = 'mm', help?: string): ParamSpec => ({
  kind: 'number', key, label, value, min, max, step, unit, ...(help ? { help } : {}),
});
export const toggle = (key: string, label: string, value: boolean, help?: string): ParamSpec => ({ kind: 'toggle', key, label, value, ...(help ? { help } : {}) });
export const select = (key: string, label: string, value: string, options: { value: string; label: string }[], help?: string): ParamSpec => ({
  kind: 'select', key, label, value, options, ...(help ? { help } : {}),
});

/** The knobs nearly every pattern shares, in the house wording. */
export const SIZE = (value: number, min = 2, max = 60, label = 'Size'): ParamSpec => number('size', label, value, min, max, 0.5, 'mm');
export const GAP = (value: number, min = 0.8, max = 30): ParamSpec => number('gap', 'Gap', value, min, max, 0.1, 'mm', 'Material left between neighbours. Keep it at least as wide as the sheet is thick when cutting.');
export const SPACING = (value: number, min = 0.5, max = 60): ParamSpec => number('spacing', 'Spacing', value, min, max, 0.1, 'mm');
