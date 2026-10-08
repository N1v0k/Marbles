// Print plate planner: packs the parts of each level onto 256x256 plates (Bambu Lab A1), with a time limit per plate.
// Order: level 0 first (the towers stand on it), within a level in chain order, adapters right after their part,
// so the lowest level is complete and ready to assemble first.
// Every part lies as in the print profile (curves 90°, mirrored curves 180°, pins 90°, no socket at the back,
// press flanges towards ±X); parts are never rotated while packing.
import { catalog, SNAP_PIN, partGrams, partHours, kitOf, type Part } from './catalog';
import type { Layout } from './chain';
import { filamentKey, keyLabel } from './colors';
import { t, tf, partName, getLang } from './i18n';

export { SNAP_PIN };

export const BED = 256;          // mm, Bambu Lab A1
export const MARGIN = 5;         // plate margin (profile: >= 5)
export const GAP = 6;            // gap between parts (profile: 6)
/** Setup time per plate (heating, calibration), fitted to the sliced profile plates. */
export const PLATE_H = catalog.calib.plateH ?? 0.12;

export interface PrintJob {
  key: string;          // unique (e.g. 'p12' part 12 / 'a12-60' adapter under part 12 at z 60)
  partId: string;       // catalog ID (the variant for adapters)
  part: Part;
  label: string;        // display name
  level: number;        // level the part stands on
  order: number;        // chain position (part index)
  hours: number; grams: number;
  w: number; d: number; h: number;   // print bounding box (x, y, z) in print orientation
  rotZ: number;         // rotation about z (degrees) for the print orientation (as in the print profile)
  rotFree: boolean;     // may be rotated by 90° while packing (never in the 16 mm system: the orientation is part of the fit)
  support: boolean;     // request supports in the 3MF (profile: none; spiral/loops need them, set in the slicer)
  color: string | null; // filament: Bambu code '11103' or custom colour '#rrggbb' (filament mode only); plates are then single-colour
}
export interface PlacedJob extends PrintJob { x: number; y: number; rot90: boolean }
export interface Plate { level: number; index: number; jobs: PlacedJob[]; hours: number; grams: number; usedArea: number; color: string | null }
export interface PlatePlan { plates: Plate[]; byLevel: Map<number, Plate[]>; maxHours: number; tooBig: PrintJob[] }

/** Print orientation of a part: rotation about z as in the print profile (stored in the catalog) and the
 *  bounding box in that orientation. Everything stands upright as designed. */
export function printOrientation(p: Part): { rotFree: boolean; rotZ: number; w: number; d: number; h: number } {
  const rotZ = ((p.printRot ?? 0) % 360 + 360) % 360;
  const bx = p.bbox[1][0] - p.bbox[0][0], by = p.bbox[1][1] - p.bbox[0][1], bz = p.bbox[1][2] - p.bbox[0][2];
  const swap = rotZ === 90 || rotZ === 270;
  return { rotFree: false, rotZ, w: swap ? by : bx, d: swap ? bx : by, h: bz };
}

export function printJobs(layout: Layout): PrintJob[] {
  const jobs: PrintJob[] = [];
  const mk = (key: string, part: Part, partId: string, level: number, order: number, label: string): PrintJob => {
    const o = printOrientation(part);
    return { key, partId, part, label, level, order, hours: partHours(part), grams: partGrams(part), w: o.w, d: o.d, h: o.h,
             rotZ: o.rotZ, rotFree: o.rotFree, support: false, color: filamentKey(part) };
  };
  for (const q of layout.placed) {
    if (!q.connected) continue;
    const kit = kitOf(q.part);
    if (kit) {
      // Lift / flip-flop: every module is a print job of its own (orientation and settings as in the print profile)
      for (const k of kit) {
        const m = catalog.byId.get(k.id); if (!m) continue;
        for (let i = 0; i < k.n; i++) jobs.push(mk(`p${q.idx}-${k.id}-${i}`, m, m.id, q.S, q.idx, `${q.idx + 1}. ${partName(m)}`));
      }
      continue;
    }
    jobs.push(mk('p' + q.idx, q.part, q.part.id, q.S, q.idx, `${q.idx + 1}. ${partName(q.part)}`));
  }
  for (const a of layout.adapters) jobs.push(mk(`a${a.owner}-${a.z}`, a.part, a.part.id, a.z, a.owner + 0.5, `${partName(a.part)} (${a.owner + 1})`));
  // Snap pins are printed after the parts of their level: they are inserted while assembling exactly that level
  // (joints of the level, tower steps onto it, tower couplings).
  const pin = catalog.byId.get(SNAP_PIN);
  if (pin) {
    let k = 0;
    for (const j of layout.pins) for (let i = 0; i < j.n; i++)
      jobs.push(mk(`s${k++}`, pin, SNAP_PIN, j.z, Number.MAX_SAFE_INTEGER, partName(pin)));
  }
  jobs.sort((x, y) => x.level - y.level || x.order - y.order);
  return jobs;
}

// ---------------------------------------------------------------- MaxRects packer (best short side fit, with 90° rotation)
interface Rect { x: number; y: number; w: number; h: number }
export class Packer {
  free: Rect[] = [];
  constructor(public W: number, public H: number) { this.free.push({ x: 0, y: 0, w: W, h: H }); }
  /** Places a w x h rectangle; allowRot permits a 90° rotation (only for parts whose orientation does not matter). */
  insert(w: number, h: number, allowRot = true): { x: number; y: number; rot: boolean } | null {
    let best: { x: number; y: number; rot: boolean; score: number } | null = null;
    for (const f of this.free) {
      for (const rot of allowRot ? [false, true] : [false]) {
        const rw = rot ? h : w, rh = rot ? w : h;
        if (rw <= f.w && rh <= f.h) {
          const score = Math.min(f.w - rw, f.h - rh) * 1000 + f.y * 2 + f.x; // short side, then bottom/left
          if (!best || score < best.score) best = { x: f.x, y: f.y, rot, score };
        }
      }
    }
    if (!best) return null;
    const rw = best.rot ? h : w, rh = best.rot ? w : h;
    const used: Rect = { x: best.x, y: best.y, w: rw, h: rh };
    const next: Rect[] = [];
    for (const f of this.free) {
      if (used.x >= f.x + f.w || used.x + used.w <= f.x || used.y >= f.y + f.h || used.y + used.h <= f.y) { next.push(f); continue; }
      if (used.x > f.x) next.push({ x: f.x, y: f.y, w: used.x - f.x, h: f.h });
      if (used.x + used.w < f.x + f.w) next.push({ x: used.x + used.w, y: f.y, w: f.x + f.w - used.x - used.w, h: f.h });
      if (used.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: used.y - f.y });
      if (used.y + used.h < f.y + f.h) next.push({ x: f.x, y: used.y + used.h, w: f.w, h: f.y + f.h - used.y - used.h });
    }
    // drop rectangles contained in others
    this.free = next.filter((a, i) => !next.some((b, j) => i !== j && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h && (a.w < b.w || a.h < b.h || i > j)));
    return { x: best.x, y: best.y, rot: best.rot };
  }
}

/** Packs the jobs onto plates: per level, in order, starting a new plate when time or space runs out.
 *  With filament colours, only parts of the same colour share a plate. */
export function planPlates(layout: Layout, maxHours: number): PlatePlan {
  const jobs = printJobs(layout);
  const plates: Plate[] = []; const tooBig: PrintJob[] = [];
  const inner = BED - 2 * MARGIN;
  const levels = [...new Set(jobs.map((j) => j.level))].sort((a, b) => a - b);
  for (const level of levels) {
    const open: { plate: Plate; packer: Packer }[] = [];
    let idx = 0;
    for (const job of jobs.filter((j) => j.level === level)) {
      const w = job.w + GAP, d = job.d + GAP;
      // Every part keeps its print orientation from the profile (press flanges, seam at the back, bridges across the socket ceiling)
      const allowRot = job.rotFree;
      const fits = allowRot ? Math.min(job.w, job.d) <= inner && Math.max(job.w, job.d) <= inner : job.w <= inner && job.d <= inner;
      if (!fits || job.h > BED) { tooBig.push(job); continue; }
      let placed = false;
      // Try the most recently opened plate first, then older open plates (fill gaps), otherwise start a new plate
      for (const o of [...open].reverse()) {
        if (o.plate.color !== job.color) continue;
        if (o.plate.hours + job.hours > maxHours + 1e-6 && o.plate.jobs.length) continue;
        const pos = o.packer.insert(w, d, allowRot);
        if (!pos) continue;
        o.plate.jobs.push({ ...job, x: pos.x + MARGIN, y: pos.y + MARGIN, rot90: pos.rot });
        o.plate.hours += job.hours; o.plate.grams += job.grams; o.plate.usedArea += job.w * job.d; placed = true; break;
      }
      if (!placed) {
        const packer = new Packer(inner, inner);
        const pos = packer.insert(w, d, allowRot);
        if (!pos) { tooBig.push(job); continue; }
        const plate: Plate = { level, index: ++idx, jobs: [{ ...job, x: pos.x + MARGIN, y: pos.y + MARGIN, rot90: pos.rot }], hours: PLATE_H + job.hours, grams: job.grams, usedArea: job.w * job.d, color: job.color };
        plates.push(plate); open.push({ plate, packer });
      }
    }
  }
  const byLevel = new Map<number, Plate[]>();
  for (const p of plates) byLevel.set(p.level, [...(byLevel.get(p.level) ?? []), p]);
  return { plates, byLevel, maxHours, tooBig };
}

export function plateName(p: Plate): string {
  const first = p.jobs[0]; const more = p.jobs.length - 1;
  return `L${p.level}-${String(p.index).padStart(2, '0')}  ${p.hours.toFixed(1)}h  ${partName(first.part)}${more ? ' +' + more : ''}`;
}

/** Part list of a plate for display: consecutive identical parts are merged into "Name ×N" (pins). */
export function jobLabels(p: Plate): string[] {
  const out: { label: string; n: number }[] = [];
  for (const j of p.jobs) {
    const last = out[out.length - 1];
    if (last && last.label === j.label) last.n++;
    else out.push({ label: j.label, n: 1 });
  }
  return out.map((e) => (e.n > 1 ? `${e.label} ×${e.n}` : e.label));
}

/** Print plan as Markdown, in the active language. */
export function planMarkdown(plan: PlatePlan, title: string): string {
  const lines = [`# ${title}`, '', tf('mdHeader', { h: plan.maxHours }), ''];
  const tot = plan.plates.reduce((s, p) => s + p.hours, 0), g = plan.plates.reduce((s, p) => s + p.grams, 0), n = plan.plates.reduce((s, p) => s + p.jobs.length, 0);
  lines.push(t('mdCols'), '|---:|---:|---:|---:|---:|');
  for (const [lvl, ps] of [...plan.byLevel.entries()].sort((a, b) => a[0] - b[0]))
    lines.push(`| ${lvl} mm | ${ps.length} | ${ps.reduce((s, p) => s + p.jobs.length, 0)} | ${Math.round(ps.reduce((s, p) => s + p.hours, 0))} h | ${Math.round(ps.reduce((s, p) => s + p.grams, 0))} g |`);
  lines.push(`| **${t('mdSum')}** | **${plan.plates.length}** | **${n}** | **${Math.round(tot)} h** | **${(g / 1000).toFixed(2)} kg** |`, '');
  // amount per filament (plates are single-colour)
  const perColor = new Map<string, number>();
  for (const p of plan.plates) if (p.color) perColor.set(p.color, (perColor.get(p.color) ?? 0) + p.grams);
  if (perColor.size) {
    lines.push(`**${t('mdColor')}:** ` + [...perColor.entries()].map(([c, gr]) => `${keyLabel(c, getLang())} ${Math.round(gr)} g`).join(' · '), '');
  }
  for (const [lvl, ps] of [...plan.byLevel.entries()].sort((a, b) => a[0] - b[0])) {
    lines.push(`## ${tf('mdLevel', { l: lvl })}`, '', t('mdPlateCols'), '|---:|---:|---:|---|');
    for (const p of ps) lines.push(`| ${p.index} | ${p.hours.toFixed(1)} h | ${Math.round(p.grams)} g | ${p.color ? `**${keyLabel(p.color, getLang())}** · ` : ''}${jobLabels(p).join(', ')} |`);
    lines.push('');
  }
  if (plan.tooBig.length) lines.push('', t('mdTooBig') + plan.tooBig.map((j) => j.label).join(', '));
  return lines.join('\n');
}
