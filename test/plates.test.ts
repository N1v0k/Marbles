// Print plates: orientation as in the print profile, jobs per level, MaxRects packer, time limit, snap pins, Markdown.
import { describe, it, expect } from 'vitest';
import { printOrientation, printJobs, planPlates, plateName, planMarkdown, jobLabels, Packer, BED, MARGIN, GAP, SNAP_PIN, PLATE_H, type PlacedJob } from '../src/plates';
import { solveChain } from '../src/chain';
import { setLang } from '../src/i18n';
import { demo, part, pinSum } from './helpers';

function noOverlap(jobs: PlacedJob[]): boolean {
  for (let i = 0; i < jobs.length; i++) for (let j = i + 1; j < jobs.length; j++) {
    const a = jobs[i], b = jobs[j];
    const aw = a.rot90 ? a.d : a.w, ad = a.rot90 ? a.w : a.d, bw = b.rot90 ? b.d : b.w, bd = b.rot90 ? b.w : b.d;
    const sep = a.x + aw + GAP <= b.x + 1e-9 || b.x + bw + GAP <= a.x + 1e-9 || a.y + ad + GAP <= b.y + 1e-9 || b.y + bd + GAP <= a.y + 1e-9;
    if (!sep) return false;
  }
  return true;
}
function inBed(j: PlacedJob): boolean {
  const w = j.rot90 ? j.d : j.w, d = j.rot90 ? j.w : j.d;
  return j.x >= MARGIN - 1e-9 && j.y >= MARGIN - 1e-9 && j.x + w <= BED - MARGIN + 1e-9 && j.y + d <= BED - MARGIN + 1e-9;
}

describe('printOrientation', () => {
  it('orientation from the print profile, never freely rotated; bounding box follows the rotation', () => {
    const k = printOrientation(part('Kurve90_40'));
    expect(k).toMatchObject({ rotZ: 90, rotFree: false });
    expect(printOrientation(part('Kurve90_50-40_gespiegelt')).rotZ).toBe(180);
    const s = printOrientation(part('Raststift'));
    expect(s.rotZ).toBe(90); expect(s.w).toBeCloseTo(9.4, 1); expect(s.d).toBeCloseTo(20, 1);
    expect(printOrientation(part('AdapterGerade120')).rotFree).toBe(false);
  });
});

describe('printJobs', () => {
  it('one job per part, adapter and snap pin; levels ascending, pins at the end of their level', () => {
    const L = solveChain(demo('starter-funnel'));
    const jobs = printJobs(L);
    expect(jobs.filter((j) => j.key.startsWith('p')).length).toBe(9);
    expect(jobs.filter((j) => j.key.startsWith('a')).length).toBe(3);
    expect(jobs.filter((j) => j.partId === SNAP_PIN).length).toBe(pinSum(L));
    for (let i = 1; i < jobs.length; i++) expect(jobs[i].level).toBeGreaterThanOrEqual(jobs[i - 1].level);
    const lvl0 = jobs.filter((j) => j.level === 0);
    expect(lvl0[lvl0.length - 1].partId).toBe(SNAP_PIN);
  });
});

describe('planPlates', () => {
  it('everything on the bed, no overlap, time limit incl. setup time, plate time = setup time + parts', () => {
    const L = solveChain(demo('three-levels'));
    for (const h of [2, 4, 8, 16]) {
      const plan = planPlates(L, h);
      expect(plan.tooBig).toEqual([]);
      for (const p of plan.plates) {
        expect(noOverlap(p.jobs)).toBe(true);
        for (const j of p.jobs) expect(inBed(j), j.label).toBe(true);
        expect(p.hours).toBeCloseTo(PLATE_H + p.jobs.reduce((s, j) => s + j.hours, 0), 6);
        if (p.jobs.length > 1) expect(p.hours).toBeLessThanOrEqual(h + 1e-6);
      }
      const n = plan.plates.reduce((s, p) => s + p.jobs.length, 0);
      expect(n).toBe(printJobs(L).length);
    }
  });
  it('plate name, part labels (pins grouped), Markdown', () => {
    const plan = planPlates(solveChain(demo('mini')), 8);
    expect(plateName(plan.plates[0])).toMatch(/^L0-01 {2}\d+\.\dh {2}/);
    expect(jobLabels(plan.plates[0]).some((l) => /Raststift_16mm ×\d/.test(l))).toBe(true);
    setLang('de');
    const md = planMarkdown(plan, 'Test');
    expect(md).toContain('# Test'); expect(md).toContain('| Ebene | Platten |');
  });
  it('packer: MaxRects places rectangles without overlap, rotation only when allowed', () => {
    const p = new Packer(100, 100);
    expect(p.insert(60, 40, false)).toEqual({ x: 0, y: 0, rot: false });
    expect(p.insert(60, 40, false)).toMatchObject({ rot: false });
    expect(p.insert(90, 90, false)).toBeNull();
  });
});
