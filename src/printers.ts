// Build plates of Bambu Lab printers for the "print in one piece" mode.
// Dimensions from the Bambu Studio printer profiles (resources/profiles/BBL/machine/*.json, printable_area/printable_height).
// For dual-nozzle printers the area of a single nozzle applies (the piece prints with one filament).

export interface Printer { id: string; name: string; x: number; y: number; z: number }
export const PRINTERS: Printer[] = [
  { id: 'a1mini', name: 'Bambu Lab A1 mini', x: 180, y: 180, z: 180 },
  { id: 'a1', name: 'Bambu Lab A1', x: 256, y: 256, z: 256 },
  { id: 'p2s', name: 'Bambu Lab P2S', x: 256, y: 256, z: 256 },
  { id: 'p1', name: 'Bambu Lab P1P / P1S', x: 256, y: 256, z: 250 },
  { id: 'x1', name: 'Bambu Lab X1 Carbon / X1E', x: 256, y: 256, z: 250 },
  { id: 'x2d', name: 'Bambu Lab X2D', x: 256, y: 256, z: 256 },
  { id: 'a2l', name: 'Bambu Lab A2L', x: 330, y: 320, z: 325 },
  { id: 'h2c', name: 'Bambu Lab H2C', x: 305, y: 320, z: 325 },
  { id: 'h2d', name: 'Bambu Lab H2D / H2D Pro', x: 325, y: 320, z: 325 },
  { id: 'h2s', name: 'Bambu Lab H2S', x: 340, y: 320, z: 340 },
];
export const DEFAULT_PRINTER = 'a1';
/** Margin around the plate edge (as on the release plates: >= 5 mm). */
export const PLATE_MARGIN = 5;
export const CUSTOM_RANGE: [number, number] = [100, 1000];

export interface PlateSettings { on: boolean; printer: string; custom: [number, number, number] }
export const DEFAULT_PLATE: PlateSettings = { on: false, printer: DEFAULT_PRINTER, custom: [256, 256, 256] };

/** Printer for the given settings (custom size: id 'custom'). */
export function printerOf(s: PlateSettings): Printer {
  if (s.printer === 'custom') {
    const [x, y, z] = s.custom.map((v) => clamp(v));
    return { id: 'custom', name: `${x} × ${y} × ${z} mm`, x, y, z };
  }
  return PRINTERS.find((p) => p.id === s.printer) ?? PRINTERS.find((p) => p.id === DEFAULT_PRINTER)!;
}
function clamp(v: number): number { return Math.min(CUSTOM_RANGE[1], Math.max(CUSTOM_RANGE[0], Math.round(Number(v) || 0))); }

export function sanitizePlate(raw: unknown): PlateSettings {
  const r = (raw ?? {}) as Partial<PlateSettings>;
  const printer = typeof r.printer === 'string' && (r.printer === 'custom' || PRINTERS.some((p) => p.id === r.printer)) ? r.printer : DEFAULT_PRINTER;
  const c = Array.isArray(r.custom) && r.custom.length === 3 ? r.custom.map((v) => clamp(Number(v))) as [number, number, number] : DEFAULT_PLATE.custom;
  return { on: !!r.on, printer, custom: c };
}
const KEY = 'kb16-plate';
export function loadPlate(): PlateSettings { try { return sanitizePlate(JSON.parse(localStorage.getItem(KEY) ?? 'null')); } catch { return { ...DEFAULT_PLATE }; } }
export function savePlate(s: PlateSettings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } }

/** Does a body of the given size (x, y, z in mm) fit on the plate? Rotated by 90° if only that fits or it overhangs
 *  less. over: overhang per axis (>0 = too big), in plate axes after rotation. */
export interface PlateFit { fits: boolean; rot90: boolean; size: [number, number, number]; usable: [number, number, number]; over: [number, number, number] }
export function fitWithRot(size: [number, number, number], pr: Printer, rot: boolean, margin = PLATE_MARGIN): PlateFit {
  const usable: [number, number, number] = [pr.x - 2 * margin, pr.y - 2 * margin, pr.z];
  const sx = rot ? size[1] : size[0], sy = rot ? size[0] : size[1];
  const over: [number, number, number] = [sx - usable[0], sy - usable[1], size[2] - usable[2]];
  return { fits: over.every((o) => o <= 1e-6), rot90: rot, size: [sx, sy, size[2]], usable, over };
}
export function fitOnPlate(size: [number, number, number], pr: Printer, margin = PLATE_MARGIN): PlateFit {
  const a = fitWithRot(size, pr, false, margin), b = fitWithRot(size, pr, true, margin);
  if (a.fits) return a;
  if (b.fits) return b;
  const worst = (f: PlateFit) => Math.max(0, f.over[0]) + Math.max(0, f.over[1]);
  return worst(b) < worst(a) ? b : a;
}

/** Position of the build plate under the track.
 *  The plate must hold the fused piece including the margin (fitOnPlate). Within that leeway it is shifted so the
 *  loose kits (lift, flip-flop) stand on it too - up to the plate edge, without margin, since they print separately.
 *  If both do not fit, the whole track is centred as well as possible. On non-square plates the rotation that fits
 *  everything wins. cx/cy: plate centre in world coordinates, w/d: plate size along world x/y. */
export interface PlatePlace extends PlateFit { cx: number; cy: number; w: number; d: number; whole: boolean }
export function placeOnPlate(fused: { min: number[]; max: number[] }, loose: { min: number[]; max: number[] } | null, pr: Printer, margin = PLATE_MARGIN): PlatePlace {
  const size: [number, number, number] = [fused.max[0] - fused.min[0], fused.max[1] - fused.min[1], fused.max[2] - fused.min[2]];
  const all = loose ? { min: fused.min.map((v, i) => Math.min(v, loose.min[i])), max: fused.max.map((v, i) => Math.max(v, loose.max[i])) } : fused;
  const cl = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  /** Plate start p on one axis (length L): fused piece with margin needs p in [f1-L+m, f0-m], whole track p in [w1-L, w0]. */
  const axis = (i: number, L: number) => {
    const f0 = fused.min[i], f1 = fused.max[i], w0 = all.min[i], w1 = all.max[i];
    const ideal = (w0 + w1) / 2 - L / 2;
    const lo = f1 - L + margin, hi = f0 - margin;
    if (lo > hi + 1e-9) return { p: (f0 + f1) / 2 - L / 2, on: false };
    const wlo = Math.max(lo, w1 - L), whi = Math.min(hi, w0);
    return wlo <= whi + 1e-9 ? { p: cl(ideal, wlo, whi), on: true } : { p: cl(ideal, lo, hi), on: false };
  };
  const one = (fit: PlateFit): PlatePlace => {
    const w = fit.rot90 ? pr.y : pr.x, d = fit.rot90 ? pr.x : pr.y;
    const ax = axis(0, w), ay = axis(1, d);
    return { ...fit, cx: ax.p + w / 2, cy: ay.p + d / 2, w, d, whole: fit.fits && ax.on && ay.on };
  };
  const fitting = [false, true].map((r) => fitWithRot(size, pr, r, margin)).filter((x) => x.fits).map(one);
  if (!fitting.length) return one(fitOnPlate(size, pr, margin));
  return fitting.find((x) => x.whole) ?? fitting[0];
}
