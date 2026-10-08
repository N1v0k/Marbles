// Flip-flop: catalog (3 modules on plate 14, 2 views, 2 chain parts with exit left/right), chain (inlet one level up,
// also on AdapterKippwippe), physics (exit ~180 mm/s, limit 1.3 m/s), BOM and print plates use the modules.
import { describe, it, expect, afterEach } from 'vitest';
import { catalog, kitOf, asmOf, needsAdapter, setEdition, partGrams, partHours, LEVEL, PORT_Z } from '../src/catalog';
import { simulate, DEFAULT_SIM } from '../src/physics';
import { bom } from '../src/export';
import { printJobs, printOrientation } from '../src/plates';
import { setLang } from '../src/i18n';
import { solve, part } from './helpers';

afterEach(() => { setEdition('plain'); setLang('de'); });

const FLIPFLOP_PARTS = catalog.parts.filter((p) => p.id.startsWith('Kippwippe'));
const MODULES = ['Kippwippe_120-60_16mm', 'Kippwippe_Wippe_16mm', 'Kippwippe_Achsstift_16mm'];
const CHAIN = (side: string) => solve('StartSchale_60', 'Gerade120_60-60', `Kippwippe_120-60_${side}`, 'Gerade120_60-50', 'Kurve90_50-40', 'EndSchale_40');

describe('Catalog', () => {
  it('3 modules (plate 14, not in the palette), 2 views (3D only), 2 chain parts Links/Rechts', () => {
    expect(FLIPFLOP_PARTS.map((p) => p.id).sort()).toEqual(['Kippwippe_120-60_16mm', 'Kippwippe_120-60_Links_16mm', 'Kippwippe_120-60_Rechts_16mm',
      'Kippwippe_Achsstift_16mm', 'Kippwippe_Ansicht_Wippe_Links_16mm', 'Kippwippe_Ansicht_Wippe_Rechts_16mm', 'Kippwippe_Wippe_16mm']);
    for (const id of MODULES) {
      const p = part(id);
      expect(p.family, id).toBe('flipflopPart');
      expect(p.plate, id).toEqual({ no: 14, name: '14 Attractions' });
      expect(p.released, id).toBe(true);
    }
    expect(MODULES.map((id) => part(id).nameEn)).toEqual(['FlipFlop_120-60_16mm', 'FlipFlop_Rocker_16mm', 'FlipFlop_AxlePin_16mm']);
    expect(part('Kippwippe_120-60').printRot).toBe(90);
    expect(printOrientation(part('Kippwippe_120-60')).rotZ).toBe(90);
    for (const side of ['Links', 'Rechts']) {
      const a = part(`Kippwippe_Ansicht_Wippe_${side}`);
      expect([a.display, a.palette, a.plate, a.released]).toEqual([true, false, null, false]);
      const p = part(`Kippwippe_120-60_${side}`);
      expect(p.family).toBe('attraction');
      expect(p.file).toBe('');
      expect(p.nameEn).toBe(`FlipFlop_120-60_${side === 'Links' ? 'Left' : 'Right'}_16mm`);
      expect(kitOf(p)).toEqual(MODULES.map((id) => ({ id, n: 1 })));
      expect(asmOf(p)!.map((x) => x.id)).toEqual(['Kippwippe_120-60_16mm', `Kippwippe_Ansicht_Wippe_${side}_16mm`]);
      expect(p.swap).toBe(`Kippwippe_120-60_${side === 'Links' ? 'Rechts' : 'Links'}_16mm`);
      expect([p.rimIn, p.rimOut, p.feedRim, p.reversible, p.floorOnly ?? false]).toEqual([120, 60, 60, false, false]);
      expect(p.adapter).toEqual({ type: 'AdapterKippwippe_120-60_16mm', offset: [0, 0], rot: 0 });
      expect(needsAdapter(p)).toBe(false);
    }
    // parts without a kit: kitOf/asmOf return null
    expect(kitOf(part('Gerade120_40-40'))).toBeNull(); expect(asmOf(part('Gerade120_40-40'))).toBeNull();
  });
  it('inlet on top at the -x end (one level up), exit left +y or right -y at z 5.7', () => {
    const L = part('Kippwippe_120-60_Links'), R = part('Kippwippe_120-60_Rechts');
    expect(L.ports[L.lane[0]!]).toEqual({ p: [0, 0, PORT_Z + LEVEL], n: [-1, 0, 0] });
    expect(R.ports[R.lane[0]!]).toEqual({ p: [0, 0, PORT_Z + LEVEL], n: [-1, 0, 0] });
    expect(L.ports[L.lane[1]!]).toEqual({ p: [28.6, 36, PORT_Z], n: [0, 1, 0] });
    expect(R.ports[R.lane[1]!]).toEqual({ p: [28.6, -36, PORT_Z], n: [0, -1, 0] });
    expect([L.turn, R.turn]).toEqual([90, -90]);
  });
  it('filament and time = sum of the modules, Japandi with the grooved body', () => {
    const p = part('Kippwippe_120-60_Links');
    const sum = (f: (id: string) => number) => MODULES.reduce((s, id) => s + f(id), 0);
    expect(partGrams(p)).toBeCloseTo(sum((id) => partGrams(part(id))), 0);
    expect(partHours(p)).toBeCloseTo(sum((id) => partHours(part(id))), 2);
    setEdition('japandi');
    expect(partGrams(p)).toBeCloseTo(sum((id) => partGrams(part(id))), 0);
    expect(partGrams(part('Kippwippe_120-60'))).toBeGreaterThan(part('Kippwippe_120-60').grams);
  });
});

describe('Chain', () => {
  it('start and feed one level up (with adapters), flip-flop on the floor; exit left or right of the travel direction', () => {
    for (const [side, sgn] of [['Links', 1], ['Rechts', -1]] as const) {
      const L = CHAIN(side);
      expect(L.issues.filter((i) => i.level === 'error'), side).toEqual([]);
      expect(L.placed.map((q) => q.S)).toEqual([32, 32, 0, 0, 0, 0]);
      expect(L.adapters.filter((a) => a.owner <= 1).length).toBeGreaterThan(0);
      const flip = L.placed[2], before = L.placed[1].exit!.n;
      // exit = travel direction rotated by 90 degrees (left +90, right -90)
      const want = [-sgn * before[1], sgn * before[0]];
      expect(flip.exit!.n[0]).toBeCloseTo(want[0], 6); expect(flip.exit!.n[1]).toBeCloseTo(want[1], 6);
      expect(flip.exit!.p[2]).toBeCloseTo(PORT_Z, 3);
    }
  });
  it('two flip-flops in a row: the upper one stands on AdapterKippwippe', () => {
    const L = solve('StartSchale_60', 'Gerade120_60-60', 'Kippwippe_120-60_Links', 'Gerade120_60-60', 'Kippwippe_120-60_Rechts', 'Gerade120_60-50');
    expect(L.placed.map((q) => q.S)).toEqual([64, 64, 32, 32, 0, 0]);
    expect(L.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(L.adapters.filter((a) => a.owner === 2).map((a) => a.part.id)).toEqual(['AdapterKippwippe_120-60_16mm']);
  });
  it('only rim 60 fits before the flip-flop (e.g. Gerade 60-60), rim 50 does not', () => {
    expect(solve('StartSchale_60', 'Gerade120_60-60', 'Kippwippe_120-60_Links').issues.filter((i) => i.code === 'joint')).toEqual([]);
    expect(solve('StartSchale_60', 'Gerade120_60-50', 'Kippwippe_120-60_Links').issues.filter((i) => i.code === 'joint').length).toBe(1);
  });
});

describe('Physics', () => {
  it('exit ~180 mm/s regardless of the inlet (estimated); warning from 1.1 m/s, error above 1.3 m/s', () => {
    const L = CHAIN('Links');
    for (const v0 of [300, 600, 900]) {        // feed Gerade 60-60 has no slope: a slow start would stop before it
      const st = simulate(L, { ...DEFAULT_SIM, v0 })[2];
      expect(st.vOut).toBe(180); expect(st.estimate).toBe(true); expect(st.status).toBe('ok');
    }
    expect(simulate(L, { ...DEFAULT_SIM, v0: 1200 })[2].status).toBe('warn');
    const e = simulate(L, { ...DEFAULT_SIM, v0: 1400 })[2];
    expect(e.status).toBe('error');
    expect(e.msgs.join(' ')).toContain('Kippwippe');
  });
});

describe('BOM and printing', () => {
  it('BOM and print plan list body, rocker and axle pin once each - not the chain part, not the view', () => {
    for (const side of ['Links', 'Rechts']) {
      const L = CHAIN(side);
      const rows = bom(L);
      for (const id of MODULES) expect(rows.find((r) => r.id === id)?.count, id).toBe(1);
      expect(rows.some((r) => r.id.startsWith(`Kippwippe_120-60_${side}`) || r.id.includes('Ansicht'))).toBe(false);
      const jobs = printJobs(L).filter((j) => j.partId.startsWith('Kippwippe'));
      expect(jobs.map((j) => j.partId).sort()).toEqual([...MODULES].sort());
      expect(jobs.every((j) => j.level === 0)).toBe(true);
    }
  });
});
