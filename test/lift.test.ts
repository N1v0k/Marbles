// Lift (screw lift): catalog (modules + assembled lifts), chain, circuit, snap pins, BOM, print plates.
import { describe, it, expect, afterEach } from 'vitest';
import { catalog, liftVariant, nextLiftDir, needsAdapter, setEdition, partGrams, partHours, LEVEL, PORT_Z, LIFT_MAX, LIFT_TESTED } from '../src/catalog';
import { solveChain } from '../src/chain';
import { simulate, DEFAULT_SIM } from '../src/physics';
import { bom, makerworldList } from '../src/export';
import { planPlates, printJobs } from '../src/plates';
import { setLang } from '../src/i18n';
import { solve, part, demo, pinSum } from './helpers';

afterEach(() => { setEdition('plain'); setLang('de'); });

const LIFT = catalog.parts.filter((p) => p.family === 'lift');
const MODULES = catalog.parts.filter((p) => p.family === 'liftPart');

describe('Catalog', () => {
  it('7 modules (plate 16) and 40 lifts: height 1..10 x head straight/left/back/right; parts list: one lift card with height', () => {
    expect(MODULES.map((p) => p.id).sort()).toEqual(['LiftFuss_40_16mm', 'LiftKopf_60_16mm', 'LiftKurbel_16mm', 'LiftMitte_16mm',
      'LiftSchnecke_Fuss_16mm', 'LiftSchnecke_Kopf_16mm', 'LiftSchnecke_Mitte_16mm']);
    expect(MODULES.map((p) => p.nameEn).sort()).toEqual(['LiftBottom_40_16mm', 'LiftCrank_16mm', 'LiftMiddle_16mm', 'LiftScrew_Bottom_16mm',
      'LiftScrew_Middle_16mm', 'LiftScrew_Top_16mm', 'LiftTop_60_16mm']);
    expect(LIFT.length).toBe(40);
    expect(LIFT.filter((p) => p.palette !== false).map((p) => p.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `Lift${n}_Gerade_16mm`));
    expect(LIFT_MAX).toBe(10); expect(LIFT_TESTED).toBe(5);
    for (const p of [...LIFT, ...MODULES]) expect(p.released, p.id).toBe(true);
  });
  it('inlet at the foot (rim 40, +y end at x 16, z 5.7), outlet at the head (rim 60) on level N - direction follows the head rotation', () => {
    const want: Record<string, [number, number, number, number]> = {
      straight: [16, -32, 0, -1], left: [32, 16, 1, 0], back: [-16, 32, 0, 1], right: [-32, -16, -1, 0] };
    for (const p of LIFT) {
      const L = p.lift!;
      expect(p.ports[0]).toEqual({ p: [16, 32, PORT_Z], n: [0, 1, 0] });
      const w = want[L.dir], q = p.ports[1];
      expect(q.p[0]).toBeCloseTo(w[0], 3); expect(q.p[1]).toBeCloseTo(w[1], 3); expect(q.p[2]).toBeCloseTo(L.n * LEVEL + PORT_Z, 3);
      expect(q.n[0]).toBeCloseTo(w[2], 6); expect(q.n[1]).toBeCloseTo(w[3], 6);
      expect([p.rimIn, p.rimOut, p.feedRim, p.reversible]).toEqual([40, 60, 40, false]);
      expect(p.foot).toEqual([-32, -32, 32, 32]);
      expect(needsAdapter(p)).toBe(true);          // no adapter in the range: stands on the floor only
    }
  });
  it('modules and snap pins per height: foot + N-1 middle + head, one screw per module, crank; pins 3 / 4 / 3 + 1', () => {
    const kit = (id: string) => Object.fromEntries(part(id).lift!.kit.map((k) => [k.id.replace('_16mm', ''), k.n]));
    expect(kit('Lift1_Gerade')).toEqual({ LiftFuss_40: 1, LiftKopf_60: 1, LiftSchnecke_Fuss: 1, LiftSchnecke_Kopf: 1, LiftKurbel: 1 });
    expect(kit('Lift3_Rechts')).toEqual({ LiftFuss_40: 1, LiftMitte: 2, LiftKopf_60: 1, LiftSchnecke_Fuss: 1, LiftSchnecke_Mitte: 2, LiftSchnecke_Kopf: 1, LiftKurbel: 1 });
    // head directly on the foot: 2 corner pins, 3 if the free corners are stacked (head +90 = exit left)
    expect(part('Lift1_Gerade').lift!.pins).toBe(3); expect(part('Lift1_Links').lift!.pins).toBe(4);
    expect(part('Lift2_Gerade').lift!.pins).toBe(3 + 3 + 1); expect(part('Lift3_Zurueck').lift!.pins).toBe(3 + 4 + 3 + 1);
    expect(part('Lift5_Gerade').lift!.pins).toBe(3 + 3 * 4 + 3 + 1);
  });
  it('filament and time of the modules scaled to plate 16 (housing infill 8 %: plain 176.2 g / 5 h 11 min, Japandi 182.7 g / 6 h 55 min, each incl. setup time)', () => {
    const g = MODULES.reduce((s, p) => s + p.grams, 0), h = MODULES.reduce((s, p) => s + p.hours, 0) + catalog.calib.plateH;
    expect(g).toBeCloseTo(176.2, 0); expect(h).toBeCloseTo(18638 / 3600, 1);
    setEdition('japandi');
    expect(MODULES.reduce((s, p) => s + partGrams(p), 0)).toBeCloseTo(182.65, 0);
    expect(MODULES.reduce((s, p) => s + partHours(p), 0) + catalog.calib.plateH).toBeCloseTo(24922 / 3600, 1);
    // the assembled lift = sum of its modules
    const L3 = part('Lift3_Gerade');
    expect(partGrams(L3)).toBeCloseTo(L3.lift!.kit.reduce((s, k) => s + k.n * partGrams(part(k.id)), 0), 0);
  });
  it('variants: rotating the exit goes straight -> left -> back -> right -> straight, height 1..10', () => {
    const p = part('Lift2_Gerade');
    let d = p.lift!.dir; const seen = [d];
    for (let i = 0; i < 4; i++) { d = nextLiftDir(d); seen.push(d); }
    expect(seen).toEqual(['straight', 'left', 'back', 'right', 'straight']);
    expect(liftVariant(p, 3, 'left')!.id).toBe('Lift3_Links_16mm');
    expect(liftVariant(p, 10, 'back')!.id).toBe('Lift10_Zurueck_16mm');
    expect(liftVariant(p, 11, 'straight')).toBeNull(); expect(liftVariant(p, 0, 'straight')).toBeNull();
  });
});

describe('Chain', () => {
  it('the lift raises by N levels: the next part stands on level 32 N and gets an adapter tower', () => {
    const L = solve('Lift2_Gerade', 'Gerade120_60-50', 'Kurve90_50-40');
    expect(L.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(L.placed.map((q) => q.S)).toEqual([0, 64, 64]);
    expect(L.adapters.filter((a) => a.owner === 1).length).toBe(2);
    // snap pins: 2 joints + lift (3 + 3 + crank) + tower steps of both towers
    expect(pinSum(L, 'joint')).toBe(2);
    expect(L.pins.find((j) => j.b === 'Lift')!.n).toBe(7);
  });
  it('before the lift: the part must deliver rim 40 into the inlet (e.g. Kurve 50-40), nothing else fits', () => {
    expect(solve('StartSchale_60', 'Gerade120_60-50', 'Kurve90_50-40', 'Lift1_Gerade').issues.filter((i) => i.code === 'joint')).toEqual([]);
    expect(solve('StartSchale_60', 'Gerade120_60-60', 'Lift1_Gerade').issues.some((i) => i.code === 'joint')).toBe(true);
  });
  it('a lift on a higher level is an error (it stands on the floor only)', () => {
    const L = solve('Lift1_Gerade', 'Kurve90_60-50', 'Kurve90_50-40', 'Lift1_Gerade');
    expect(L.placed[3].S).toBe(32);
    expect(L.issues.some((i) => i.code === 'noAdapter' && i.idx[0] === 3)).toBe(true);
  });
  it('rotated head: the outlet points in the chosen direction (the chain runs into the lift along -y)', () => {
    const r = (v: number[]) => v.map((x) => Math.round(x) + 0);      // without -0
    const dir = (id: string) => { const L = solve('Gerade120_40-40', id); const q = L.placed[1]; return r([q.exit!.n[0], q.exit!.n[1]]); };
    const inDir = (() => { const L = solve('Gerade120_40-40', 'Lift1_Gerade'); return r([-L.placed[1].entry!.n[0], -L.placed[1].entry!.n[1]]); })();
    expect(dir('Lift1_Gerade')).toEqual(inDir);
    expect(dir('Lift1_Links')).toEqual(r([-inDir[1], inDir[0]]));      // left of the travel direction
    expect(dir('Lift1_Rechts')).toEqual(r([inDir[1], -inDir[0]]));
    expect(dir('Lift1_Zurueck')).toEqual(r([-inDir[0], -inDir[1]]));
  });
  it('collision: the crank circle (r 46.5) above the head and the housing count', () => {
    const L = solve('Lift1_Gerade', 'Rutsche_120-60', 'Kurve90_60', 'Kurve90_60', 'Gerade120_60-60', 'Gerade120_60-60', 'Kurve90_60-50', 'Kurve90_50-40');
    expect(L.issues.filter((i) => i.code === 'collision')).toEqual([]);
    const bad = solve('Lift1_Gerade', 'Rutsche_120-60', 'Kurve90_60*', 'Kurve90_60*', 'Gerade120_60-60', 'Gerade120_60-60');
    expect(bad.issues.some((i) => i.code === 'collision')).toBe(true);
  });
});

describe('Circuit', () => {
  it('demo "lift-circuit": the end plugs into the lift inlet, no error, the ball arrives', () => {
    const L = solveChain(demo('lift-circuit'));
    expect(L.ring).toBe(true);
    expect(L.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(L.issues.some((i) => i.code === 'ring')).toBe(true);
    // 7 joints + the ring joint + 3 in the lift (head on foot 2, crank 1)
    expect(pinSum(L)).toBe(7 + 1 + 3);
    const st = simulate(L, DEFAULT_SIM);
    expect(st.every((s) => s.status !== 'stop' && s.status !== 'error')).toBe(true);
    expect(st[0].vOut).toBe(120);                        // slow out of the head (estimated)
    expect(st[0].estimate).toBe(true);
  });
  it('demo "loop-funnel-flipflop": lift +3, funnel, flip-flop and Y merge close into a loop', () => {
    const L = solveChain(demo('loop-funnel-flipflop'));
    expect(L.ring).toBe(true);
    expect(L.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(L.issues.some((i) => i.code === 'merge')).toBe(true);           // the flip-flop branch ends in the Y
    expect([L.placed.length, L.adapters.length, L.strands.length, pinSum(L), Math.round(L.height)]).toEqual([22, 15, 2, 62, 188]);
    const st = simulate(L, DEFAULT_SIM);
    expect(st.every((s) => s.status !== 'stop' && s.status !== 'error')).toBe(true);
  });
  it('no circuit if the end does not plug exactly into the start', () => {
    const L = solve('Lift1_Gerade', 'Rutsche_120-60', 'Kurve90_60', 'Kurve90_60', 'Gerade120_60-60', 'Gerade120_60-60', 'Kurve90_60-50');
    expect(L.ring).toBe(false);
    expect(L.issues.some((i) => i.code === 'ring')).toBe(false);
  });
});

describe('BOM and printing', () => {
  it('the BOM lists the modules, not the assembled lift', () => {
    const rows = bom(solve('Lift3_Links', 'Gerade120_60-50'));
    const n = Object.fromEntries(rows.map((r) => [r.id, r.count]));
    expect(n['Lift3_Links_16mm']).toBeUndefined();
    expect(n['LiftMitte_16mm']).toBe(2); expect(n['LiftSchnecke_Mitte_16mm']).toBe(2); expect(n['LiftKurbel_16mm']).toBe(1);
    expect(n['LiftFuss_40_16mm']).toBe(1); expect(n['LiftKopf_60_16mm']).toBe(1);
    const mw = makerworldList(rows);
    expect(mw).toMatch(/\| 16 Lift tower \| LiftMitte_16mm \| 2 \|/);
  });
  it('print plates: one job per module in the print orientation of plate 16 (foot and head rotated 270 degrees)', () => {
    const L = solve('Lift2_Gerade', 'Gerade120_60-50');
    const jobs = printJobs(L).filter((j) => j.partId.startsWith('Lift'));
    expect(jobs.length).toBe(7);
    expect(jobs.find((j) => j.partId === 'LiftKopf_60_16mm')!.rotZ).toBe(270);
    expect(jobs.every((j) => Number(j.key.slice(1).split('-')[0]) === 0)).toBe(true);   // display: part 1 of the chain
    const plan = planPlates(L, 8);
    expect(plan.tooBig).toEqual([]);
    expect(plan.plates.flatMap((p) => p.jobs).filter((j) => j.partId.startsWith('Lift')).length).toBe(7);
  });
});
