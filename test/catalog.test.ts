// Catalog checks: sockets, running track, adapters, print profile, physics scaling.
import { describe, it, expect } from 'vitest';
import { catalog, entryExit, isFlatCurve, needsAdapter, rimMm, ballZ, LEVEL, PORT_Z, SNAP_PIN } from '../src/catalog';
import { vsockW, sameVSock, rotM, apply } from '../src/chain';
import { part, demo } from './helpers';

const ALL = catalog.parts;
/** Track parts from the CAD export (without the lift: modules and assembled lifts, own section below; without the
 *  flip-flop: modules, views and the two chain parts, see test/flipflop.test.ts) */
const isFlipflop = (p: { id: string }) => p.id.startsWith('Kippwippe');
/** Height adapters (tested in test/height_adapter.test.ts and test/height_adapter2.test.ts) */
const isHeightAdapter = (p: { id: string }) => /^Adapter(Kippwippe|Spirale|XKreuzung|YMerge120|Gerade(100|88|80|60)|Distanz(65|46))_/.test(p.id);
/** Y-merge: own section in test/ymerge.test.ts */
const isYMerge = (p: { id: string }) => p.id.startsWith('YMerge');
const P = ALL.filter((p) => p.family !== 'lift' && p.family !== 'liftPart' && !isFlipflop(p) && !isHeightAdapter(p) && !isYMerge(p));
const LIFT = ALL.filter((p) => p.family === 'lift'), MODULE = ALL.filter((p) => p.family === 'liftPart');

describe('Scope and names', () => {
  it('121 parts = 124 CAD exports minus the 3 fit-test blocks; IDs end in _16mm, codes unique', () => {
    expect(P.length).toBe(121);                    // incl. 30 straights 100/80/60 (groove and rail, 5 rims each)
    expect(ALL.length).toBe(121 + 7 + 40 + 7 + 3 + 5 + 7);  // + 7 lift modules + 40 lifts (height 1..10 x 4 head directions) + flip-flop (3 modules, 2 views, 2 chain parts) + 3 height adapters + 5 Y-merge + 7 height adapters
    expect(ALL.every((p) => p.id.endsWith('_16mm'))).toBe(true);
    expect(P.some((p) => p.id.startsWith('Passprobe'))).toBe(false);
    expect(new Set(ALL.map((p) => p.code)).size).toBe(ALL.length);
    expect(catalog.byId.has(SNAP_PIN)).toBe(true);
    // no parts outside the snap-pin system
    for (const x of ['WendeAdapter', 'Stift_D6x11', 'Kurve90_40_gespiegelt', 'AdapterKurve90_gespiegelt', 'Distanz15-0']) expect(P.some((p) => p.id.startsWith(x))).toBe(false);
  });
  it('palette = release profile (15 plates, 111 parts + snap pin); extras = hill, zigzag, loopings, offset (no plate)', () => {
    for (const p of P) {
      expect(p.nameEn, p.id).toMatch(/_16mm$/);
      expect(p.released, p.id).toBe(p.plate !== null);
      if (p.plate) { expect(p.plate.no).toBeGreaterThanOrEqual(2); expect(p.plate.no).toBeLessThanOrEqual(15); }
    }
    expect(P.filter((p) => p.released).length).toBe(112);
    // straights 100/80/60: groove on plate 04, rail on plate 07
    for (const L of [100, 80, 60]) for (const r of ['40-40', '50-40', '50-50', '60-50', '60-60']) {
      expect(part(`Gerade${L}_${r}`).plate, `Gerade${L}_${r}`).toEqual({ no: 4, name: '04 Groove straights' });
      expect(part(`SchieneGerade${L}_${r}`).plate, `SchieneGerade${L}_${r}`).toEqual({ no: 7, name: '07 Rail straights' });
    }
    // plate 16 = lift (7 modules); the assembled lifts point to the same plate
    for (const p of [...MODULE, ...LIFT]) expect(p.plate, p.id).toEqual({ no: 16, name: '16 Lift tower' });
    expect(P.filter((p) => !p.released).map((p) => p.id).sort()).toEqual(['Gerade120_60-40_Huegel_16mm', 'Gerade120_60-50_Huegel_16mm',
      'GeradeVersatz120_40-40_16mm', 'Looping240_40-40_16mm', 'Looping240_40-40_v2_16mm', 'SchieneLooping240_40-40_16mm',
      'SchieneLooping240_40-40_v2_16mm', 'SchieneVersatz120_40-40_16mm', 'Zickzack240_180-60_16mm']);
    expect(part('Raststift').plate).toEqual({ no: 2, name: '02 Pins - duplicate as needed' });
    expect(part('Trichter_100-60').plate).toEqual({ no: 12, name: '12 Level changers' });
    expect(part('TunnelGerade120_60-50_Hex').released).toBe(true);     // tunnels are released
  });
  it('demo tracks use only parts from the release profile (no hill)', () => {
    for (const id of ['mini', 'starter-slide', 'starter-funnel', 'rail-loop', 'three-levels', 'lift-circuit'])
      for (const e of demo(id)) expect(catalog.byId.get(e.part)!.released, `${id}: ${e.part}`).toBe(true);
  });
});

describe('Sockets', () => {
  it('all horizontal sockets at z 5.7 (+32 / +64 for level changers), normals axis-aligned; no part has a tenon', () => {
    for (const p of P) for (const q of p.ports) {
      expect([PORT_Z, PORT_Z + LEVEL, PORT_Z + 2 * LEVEL].some((z) => Math.abs(q.p[2] - z) < 0.01), p.id).toBe(true);
      expect(Math.abs(q.n[0]) + Math.abs(q.n[1])).toBeCloseTo(1, 6);
      expect((q as unknown as { kind?: string }).kind).toBeUndefined();
    }
  });
  it('straight is 64 long with sockets at both ends; curves R24 / R48; spacers 24.5 / 34.7 / 50.7', () => {
    expect(part('Gerade120_40-40').ports.map((q) => q.p)).toEqual([[0, 0, 5.7], [64, 0, 5.7]]);
    expect(part('Kurve90_40').radius).toBe(24); expect(part('LangeKurve90_R90_40').radius).toBe(48);
    expect(part('Distanz46-0_40-40').length).toBeCloseTo(24.53, 2);
    expect(part('Distanz65-0_40-40').length).toBeCloseTo(34.67, 2);
    expect(part('SchieneDistanz95-0_40-40').length).toBeCloseTo(50.67, 2);
  });
  it('vertical socket: one per part in the middle (straight x 32, curve R24 offset 0.4 outward to 17.37 | 17.37); adapters top and bottom', () => {
    expect(part('Gerade120_40-40').vsock).toEqual({ bottom: [{ c: [32, 0], wax: 'x', ear: -1 }], top: [] });
    expect(part('Kurve90_40').vsock.bottom).toEqual([{ c: [17.371, 17.371], wax: 'y', ear: -1 }]);
    expect(part('Kurve90_50-40_gespiegelt').vsock.bottom).toEqual([{ c: [17.371, -17.371], wax: 'x', ear: 1 }]);
    for (const a of P.filter((p) => p.family === 'adapter')) {
      expect(a.vsock.top.length, a.id).toBe(1); expect(a.vsock.bottom.length, a.id).toBe(1);
      expect(a.height).toBeCloseTo(LEVEL, 2);
    }
    // no vertical socket: end bowl (rests on the floor), groove spacers, cross-tunnel adapter
    for (const s of ['EndSchale_40', 'Distanz46-0_40-40', 'Distanz65-0_40-40', 'AdapterTunnelQuer120_40-40_Q32']) expect(part(s).vsock.bottom, s).toEqual([]);
  });
});

describe('Running track', () => {
  it('entry derived from geometry: straight -x, curve at the y end, cross track -y, level changers at the top', () => {
    const g = entryExit(part('Gerade120_60-50'), false);
    expect(g.entry!.n).toEqual([-1, 0, 0]); expect(g.exit!.n).toEqual([1, 0, 0]);
    expect(entryExit(part('Kurve90_40'), false).entry!.p).toEqual([24, 0, 5.7]);
    expect(part('Kurve90_40').turn).toBe(90); expect(part('Kurve90_50-40_gespiegelt').turn).toBe(-90);
    expect(entryExit(part('XKreuzung_50-40'), false).entry!.n).toEqual([0, -1, 0]);
    expect(entryExit(part('AdapterTunnelQuer120_40-40_Q32'), false).entry!.p).toEqual([32, -16, 5.7]);   // cross tunnel 32: cross track is 32 long
    expect(entryExit(part('Rutsche_120-60'), false).entry!.p[2]).toBeCloseTo(37.7, 3);
    expect(entryExit(part('Zickzack240_180-60'), false).entry!.p[2]).toBeCloseTo(69.7, 3);
    expect(entryExit(part('StartSchale_60'), false)).toMatchObject({ entry: null });
    expect(entryExit(part('EndSchale_40'), false)).toMatchObject({ exit: null });
  });
  it('reversed swaps entry and exit (all ends are sockets); a reversed flat curve is the opposite curve', () => {
    const c = part('Kurve90_40');
    expect(c.reversible).toBe(true); expect(isFlatCurve(c)).toBe(true);
    expect(entryExit(c, true).entry).toEqual(entryExit(c, false).exit);
    expect(isFlatCurve(part('Kurve90_50-40'))).toBe(false);          // descending curve: mirrored part instead
    expect(part('Rutsche_120-60').reversible).toBe(false);            // level changers are never reversed
    expect(part('StartSchale_60').reversible).toBe(false);
  });
  it('feedRim: level changers are fed from the rim one level higher (slide 60, funnel/spiral/rail slide 40, zigzag 60)', () => {
    expect(part('Rutsche_120-60').feedRim).toBe(60);
    for (const s of ['Trichter_100-60', 'Spirale_100-60', 'SchieneRutsche120_100-60', 'Rutsche120_100-60']) expect(part(s).feedRim, s).toBe(40);
    expect(part('Zickzack240_180-60').feedRim).toBe(60);
  });
});

describe('Adapter assignment', () => {
  it("the adapter's top socket matches the part's bottom socket (center, width axis, ear side)", () => {
    let n = 0;
    for (const p of P) {
      if (!p.adapter || p.id.startsWith('AdapterTunnel')) continue;
      const a = catalog.byId.get(p.adapter.type)!;
      // Gerade60/SchieneGerade60 and spacers without a vertical socket stand on a socketless adapter of the same length
      if (!p.vsock.bottom.length) { expect(a.vsock.top, p.id).toEqual([]); expect(a.foot[2] - a.foot[0], p.id).toBeCloseTo(p.foot[2] - p.foot[0], 2); continue; }
      const R = rotM(p.adapter.rot);
      const top = vsockW(a.vsock.top[0], R, p.adapter.offset);
      expect(sameVSock(top, p.vsock.bottom[0]), p.id).toBe(true);
      n++;
    }
    expect(n).toBeGreaterThan(60);
  });
  it('mirrored curves stand on the standard curve adapter rotated by -90 degrees', () => {
    expect(part('Kurve90_50-40_gespiegelt').adapter).toEqual({ type: 'AdapterKurve90_16mm', offset: [0, 0], rot: 270 });
    expect(part('SchieneLangeKurveBank90_R90_60_v2_gespiegelt').adapter).toMatchObject({ type: 'AdapterLangeKurve90_16mm', rot: 270 });
    expect(part('Kurve90_40').adapter).toMatchObject({ type: 'AdapterKurve90_16mm', rot: 0 });
  });
  it('SchieneDistanz95 stands on AdapterGerade95, cross tunnels on the straight adapter of the same length', () => {
    expect(part('SchieneDistanz95-0_40-40').adapter!.type).toBe('AdapterGerade95_16mm');
    expect(part('AdapterTunnelQuer95_40-40_Q32').adapter!.type).toBe('AdapterGerade95_16mm');
    expect(part('AdapterTunnelQuer120_40-40_Q32_V16').adapter!.type).toBe('AdapterGerade120_16mm');
    expect(part('Trichter_100-60').adapter!.type).toBe('AdapterTrichter_100-60_16mm');
    expect(part('StartSchale_60').adapter!.type).toBe('AdapterStart_16mm');
  });
  it('only end bowl and loopings have no adapter (level 0); spiral, X-crossing, Gerade88 and spacers have a height adapter', () => {
    for (const s of ['Distanz46-0_40-40', 'Distanz65-0_40-40', 'Gerade88_60-40']) expect(needsAdapter(part(s)), s).toBe(false);
    expect(['Distanz46-0_40-40', 'Distanz65-0_40-40', 'Gerade88_60-40'].map((s) => part(s).adapter!.type)).toEqual(['AdapterDistanz46_16mm', 'AdapterDistanz65_16mm', 'AdapterGerade88_16mm']);
    for (const s of ['EndSchale_40', 'Looping240_40-40']) { expect(part(s).adapter, s).toBeNull(); expect(needsAdapter(part(s)), s).toBe(true); }
    expect(part('Spirale_100-60').adapter).toEqual({ type: 'AdapterSpirale_100-60_16mm', offset: [0, 0], rot: 0 });
    expect(part('XKreuzung_50-40').adapter).toEqual({ type: 'AdapterXKreuzung_50-40_16mm', offset: [0, 0], rot: 0 });
    for (const s of ['Spirale_100-60', 'XKreuzung_50-40']) expect(needsAdapter(part(s)), s).toBe(false);
  });
});

describe('Print profile', () => {
  it('print orientation as in the profile 3MF: curves 90, mirrored 180, straights/adapters 0, snap pin 90', () => {
    expect(part('Kurve90_40').printRot).toBe(90); expect(part('Kurve90_60-50_gespiegelt').printRot).toBe(180);
    expect(part('Gerade120_40-40').printRot).toBe(0); expect(part('AdapterKurve90').printRot).toBe(0);
    expect(part('Raststift').printRot).toBe(90);
  });
  it('per-object settings as in the release profile: curves (groove, rail, banked, tunnel) concentric top surface, nothing else', () => {
    for (const id of ['Kurve90_40', 'LangeKurve90_R90_60', 'SchieneKurve90_40', 'SchieneLangeKurveBank90_R90_50_v2', 'TunnelKurve90_50_Voll_v3'])
      expect(part(id).printMeta, id).toEqual({ top_surface_pattern: 'concentric' });
    for (const id of ['AdapterGerade120', 'Gerade120_40-40', 'Trichter_100-60', 'Spirale_100-60']) expect(part(id).printMeta, id).toEqual({});
    expect(P.filter((p) => Object.keys(p.printMeta).length).length).toBe(42);
    // lift modules as printed (concentric top surface): housing sparse grid infill without brim, screws/crank 4 walls 30 %
    expect(part('LiftKopf_60').printMeta).toEqual({ sparse_infill_density: '8%', sparse_infill_pattern: 'grid', brim_type: 'no_brim', top_surface_pattern: 'concentric' });
    expect(part('LiftSchnecke_Kopf').printMeta).toMatchObject({ wall_loops: '4', sparse_infill_density: '30%', brim_type: 'outer_only', top_surface_pattern: 'concentric' });
    expect(MODULE.every((p) => p.printMeta.top_surface_pattern === 'concentric')).toBe(true);
    expect(part('LiftFuss_40').printRot).toBe(270); expect(part('LiftKopf_60').printRot).toBe(270); expect(part('LiftMitte').printRot).toBe(0);
  });
  it('filament and time fitted to the sliced plates: sum of all parts once each is in the range of the profile (~1670 g, ~49 h)', () => {
    const g = P.reduce((s, p) => s + p.grams, 0), h = P.reduce((s, p) => s + p.hours, 0);
    expect(g).toBeGreaterThan(1500); expect(g).toBeLessThan(1850);
    expect(h).toBeGreaterThan(45); expect(h).toBeLessThan(65);
    expect(catalog.calib.plateH).toBeGreaterThan(0);
  });
});

describe('Physics per part', () => {
  it('drop in mm: rim code x 8/15 (straight 60-50: 5.33 mm; slide 120-60: 32 mm)', () => {
    expect(part('Gerade120_60-50').phys.drop).toBeCloseTo(5.333, 3);
    expect(part('Rutsche_120-60').phys.drop).toBeCloseTo(32, 3);
    expect(rimMm(40)).toBeCloseTo(21.333, 3); expect(ballZ(40)).toBeCloseTo(20.583, 3);
  });
  it('limits: rail curve R24 226 / R48 319, banked 354 / 501; looping from 971; brake K607, funnel, hill', () => {
    expect(part('SchieneKurve90_40').phys.limits.vmax).toBe(226);
    expect(part('SchieneLangeKurve90_R90_40').phys.limits.vmax).toBe(319);
    expect(part('SchieneLangeKurveBank90_R90_60_v2').phys.limits.vmax).toBe(501);
    expect(part('Looping240_40-40').phys.limits.vmin).toBe(971);
    expect(part('SchieneBremse120_60-60_K607').phys.brake).toMatchObject({ threshold: 443, cap: 445, runout: 16 });
    expect(part('Trichter_100-60').phys.fixedExit).toBe(453);
    expect(part('Gerade120_60-50_Huegel').phys.crest).toMatchObject({ dh: 3.2, vcrestMax: 473 });
    // hint texts are bilingual
    for (const p of P) if (p.phys.limits.why) expect(p.phys.limits.whyEn, p.id).toBeTruthy();
  });
  it('curves use the centerline length (pi/2 R), slides a fixed length', () => {
    expect(part('Kurve90_40').length).toBeCloseTo(Math.PI / 2 * 24, 1);
    expect(part('Rutsche_120-60').length).toBeCloseTo(72, 1);
  });
});

describe('Geometry helpers', () => {
  it('vsockW rotates center, width axis and ear side', () => {
    const s = { c: [32, 0] as [number, number], wax: 'x' as const, ear: -1 };
    expect(vsockW(s, rotM(0), [0, 0])).toEqual(s);
    const r = vsockW(s, rotM(90), [0, 0]);
    expect(r.wax).toBe('y'); expect(r.c[0]).toBeCloseTo(0, 9); expect(r.c[1]).toBeCloseTo(32, 9);
    expect(r.ear).toBe(1);   // ears -y -> +x
    const q = apply(rotM(90), [0, 0], [0, -1]); expect(q[0]).toBe(1); expect(q[1]).toBeCloseTo(0, 9);
  });
});
