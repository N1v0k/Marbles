// Height adapters for Y-merge, straights of all lengths and spacers: catalog (family adapter, plate 17), assignment
// (by length, also for parts without a vertical socket), chain (tower, snap pins, coupling), tunnel swap under
// Gerade100, footprint of the Y.
import { describe, it, expect } from 'vitest';
import { catalog, needsAdapter, grooved, LEVEL, PORT_Z } from '../src/catalog';
import { solveChain, vsockW, sameVSock, rotM, type ChainElement } from '../src/chain';
import { footprintPieces, pointInside } from '../src/footprint';
import { tunnelAuto, tunnelLanes, hasTunnelVariant } from '../src/tunnel';
import { bom } from '../src/export';
import { chain, part, pinSum } from './helpers';

const RIMS = ['40-40', '50-40', '50-50', '60-50', '60-60'];
const ADAPTERS: [string, string, number, boolean][] = [   // adapter, English name, length, vertical socket
  ['AdapterYMerge120_16mm', 'AdapterYMerge120_16mm', 64, true],
  ['AdapterGerade100_16mm', 'AdapterStraight100_16mm', 53.333, true],
  ['AdapterGerade88_16mm', 'AdapterStraight88_16mm', 46.933, true],
  ['AdapterGerade80_16mm', 'AdapterStraight80_16mm', 42.667, true],
  ['AdapterGerade60_16mm', 'AdapterStraight60_16mm', 32, false],
  ['AdapterDistanz65_16mm', 'AdapterSpacer65_16mm', 34.667, false],
  ['AdapterDistanz46_16mm', 'AdapterSpacer46_16mm', 24.533, false],
  ['AdapterDistanz45_16mm', 'AdapterSpacer45_16mm', 24, false],      // Fusion export, wall between the sockets 2.8
];
/** part -> expected adapter */
const PART_ADAPTER: [string, string][] = [
  ...RIMS.map((r) => [`YMerge120_${r}`, 'AdapterYMerge120_16mm'] as [string, string]),
  ...RIMS.flatMap((r) => [[`Gerade100_${r}`, 'AdapterGerade100_16mm'], [`SchieneGerade100_${r}`, 'AdapterGerade100_16mm']] as [string, string][]),
  ['Gerade88_60-40', 'AdapterGerade88_16mm'],
  ...RIMS.flatMap((r) => [[`Gerade80_${r}`, 'AdapterGerade80_16mm'], [`SchieneGerade80_${r}`, 'AdapterGerade80_16mm']] as [string, string][]),
  ...RIMS.flatMap((r) => [[`Gerade60_${r}`, 'AdapterGerade60_16mm'], [`SchieneGerade60_${r}`, 'AdapterGerade60_16mm']] as [string, string][]),
  ['Distanz65-0_40-40', 'AdapterDistanz65_16mm'],
  ['Distanz46-0_40-40', 'AdapterDistanz46_16mm'],
  ['Distanz45-0_40-40', 'AdapterDistanz45_16mm'],
];
const key = (q: { p: number[]; n: number[] }) => [q.p[0], q.p[1], q.n[0], q.n[1]].map((x) => Math.round(x * 100) / 100).join(',');
const errs = (els: ChainElement[]) => solveChain(els).issues.filter((i) => i.level === 'error');

describe('Catalog', () => {
  it('eight height adapters: family adapter, plate 17, English names, Japandi grooved, one level high, printed as built', () => {
    for (const [a, en, L] of ADAPTERS) {
      const p = part(a);
      expect(p.family, a).toBe('adapter');
      expect(p.plate, a).toEqual({ no: 17, name: '17 Adapters 2 of 2' });
      expect([p.released, p.nameEn, p.printRot], a).toEqual([true, en, 0]);
      expect(p.height, a).toBeCloseTo(LEVEL, 2);
      expect(p.foot[2] - p.foot[0], a).toBeCloseTo(L, 2);
      expect(grooved(p), a).toBe(true);
      expect(Object.keys(p.printMeta), a).toEqual([]);           // like all adapters in the release profile
      expect(p.grams, a).toBeGreaterThan(5); expect(p.grams, a).toBeLessThan(30);
    }
    expect(part('AdapterYMerge120_16mm').foot).toEqual([0, -29.333, 64, 29.333]);
    // plate 15 is the first of the two adapter plates
    expect(part('AdapterGerade120_16mm').plate).toEqual({ no: 15, name: '15 Adapters 1 of 2' });
  });
  it('vertical sockets: top = bottom at the center (Y, 100, 88, 80); Gerade60 and spacers have none (like their parts)', () => {
    for (const [a, , L, vs] of ADAPTERS) {
      const p = part(a);
      if (vs) {
        expect(p.vsock.top, a).toEqual(p.vsock.bottom);
        expect(p.vsock.top.length, a).toBe(1);
        expect(p.vsock.top[0].c[0], a).toBeCloseTo(L / 2, 2); expect(p.vsock.top[0].c[1], a).toBeCloseTo(0, 3);
        expect([p.vsock.top[0].wax, p.vsock.top[0].ear], a).toEqual(['x', -1]);
      } else expect(p.vsock, a).toEqual({ top: [], bottom: [] });
    }
  });
  it('every part stands on its adapter: same length, socket fits, end faces like the part (neighboring towers couple)', () => {
    for (const [t, a] of PART_ADAPTER) {
      const T = part(t), A = part(a);
      expect(T.adapter, t).toEqual({ type: a, offset: [0, 0], rot: 0 });
      expect(needsAdapter(T), t).toBe(false);
      expect(A.foot, t).toEqual(T.foot);
      if (A.vsock.top.length) expect(sameVSock(vsockW(A.vsock.top[0], rotM(0), [0, 0]), T.vsock.bottom[0]), t).toBe(true);
      else expect(T.vsock.bottom, t).toEqual([]);
      expect(A.ports.map(key).sort(), t).toEqual(T.ports.filter((q) => Math.abs(q.p[2] - PORT_Z) < 0.01).map(key).sort());
    }
    // SchieneDistanz95 and cross tunnel 95 stand on AdapterGerade95, the 120 parts on AdapterGerade120
    expect(part('SchieneDistanz95-0_40-40').adapter!.type).toBe('AdapterGerade95_16mm');
    expect(part('AdapterTunnelQuer95_40-40_Q32').adapter!.type).toBe('AdapterGerade95_16mm');
    expect(part('Gerade120_60-50').adapter!.type).toBe('AdapterGerade120_16mm');
  });
  it('only EndSchale (level 0) and the unreleased loopings remain without an adapter', () => {
    const withoutAdapter = catalog.parts.filter((p) => !['adapter', 'pin', 'liftPart', 'flipflopPart', 'lift'].includes(p.family) && !p.adapter).map((p) => p.id).sort();
    expect(withoutAdapter).toEqual(['EndSchale_40_16mm', 'Looping240_40-40_16mm', 'Looping240_40-40_v2_16mm', 'SchieneLooping240_40-40_16mm', 'SchieneLooping240_40-40_v2_16mm']);
  });
});

describe('Chain', () => {
  // four parts on level 32, then the slide down
  const UPPER = (middle: string) => chain('StartSchale_60', 'Gerade120_60-60', middle, 'Gerade120_60-60', 'Rutsche_120-60', 'Gerade120_60-50', 'Kurve90_50-40', 'EndSchale_40');
  it('Gerade60 one level up: AdapterGerade60 between two AdapterGerade120, coupled, no pin from below', () => {
    const L = solveChain(UPPER('Gerade60_60-60'));
    expect(L.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(L.placed.slice(0, 4).map((q) => q.S)).toEqual([32, 32, 32, 32]);
    expect(L.adapters.filter((a) => a.owner === 2).map((a) => a.part.id)).toEqual(['AdapterGerade60_16mm']);
    expect(L.pins.filter((j) => j.kind === 'tower' && j.b.startsWith('3.'))).toEqual([]);          // no vertical socket
    // the tower under Gerade60 couples at both end faces with the towers of its neighbors
    expect(L.couplings.filter((c) => c.la.startsWith('AdapterGerade60') || c.lb.startsWith('AdapterGerade60')).length).toBe(2);
    expect(bom(L).find((r) => r.id === 'AdapterGerade60_16mm')?.count).toBe(1);
  });
  it('Gerade80, Gerade100, Gerade88, SchieneGerade60 one level up: own adapter, tower pin where the part has a socket', () => {
    for (const [t, a, pin] of [['Gerade80_60-60', 'AdapterGerade80_16mm', true], ['Gerade100_60-60', 'AdapterGerade100_16mm', true],
                                ['Gerade88_60-40', 'AdapterGerade88_16mm', true], ['SchieneGerade60_60-60', 'AdapterGerade60_16mm', false]] as [string, string, boolean][]) {
      const els = t === 'Gerade88_60-40'
        ? chain('StartSchale_60', 'Gerade120_60-60', 'Gerade88_60-40', 'Gerade120_40-40', 'Kurve90_40', 'EndSchale_40')
        : UPPER(t);
      const L = solveChain(els);
      const q = L.placed[2];
      if (q.S > 0) {
        expect(L.adapters.filter((x) => x.owner === 2).map((x) => x.part.id), t).toEqual(Array(q.S / LEVEL).fill(a));
        expect(L.pins.some((j) => j.kind === 'tower' && j.b.startsWith('3.')), t).toBe(pin);
      }
      expect(L.issues.filter((i) => i.level === 'error' && i.idx.includes(2)), t).toEqual([]);
    }
  });
  it('Y-merge two levels up: tower of two AdapterYMerge120, tower pins', () => {
    const els: ChainElement[] = [...chain('StartSchale_60', 'Gerade120_60-60'), { part: 'YMerge120_60-60_16mm' },
      ...chain('Rutsche_120-60', 'Gerade120_60-60', 'Rutsche_120-60', 'Gerade120_60-50', 'Kurve90_50-40', 'EndSchale_40')];
    const L = solveChain(els);
    const y = L.placed[2];
    expect(y.S).toBe(64);
    expect(L.adapters.filter((a) => a.owner === 2).map((a) => a.part.id)).toEqual(['AdapterYMerge120_16mm', 'AdapterYMerge120_16mm']);
    // step 1: adapter on adapter, step 2: Y on the upper adapter
    expect(L.pins.filter((j) => j.kind === 'tower' && (j.b.startsWith('3.') || j.b === 'AdapterYMerge120_16mm (3)')).length).toBe(2);
    expect(L.issues.filter((i) => i.level === 'error' && i.idx.includes(2))).toEqual([]);
    expect(pinSum(L, 'tower')).toBeGreaterThanOrEqual(2);
  });
  it('all demos stay error-free', async () => {
    const { demos } = await import('./helpers');
    const { sanitizeElements } = await import('../src/state');
    for (const d of demos.demos) {
      const e = errs(sanitizeElements(JSON.parse(JSON.stringify(d.chain))));
      expect(e.map((i) => i.text), d.id).toEqual([]);
    }
  });
});

describe('Tunnel under Gerade100 (cross tunnel 95 replaces AdapterGerade100)', () => {
  it('lane 24 mm from the start of Gerade100 (reversed 29.3)', () => {
    expect(hasTunnelVariant('AdapterGerade100_16mm')).toBe(true);
    expect(tunnelLanes('AdapterGerade100_16mm')).toEqual([{ id: 'AdapterTunnelQuer95_40-40_Q32_16mm', x: [24, 29.333] }]);
    // in world coordinates the same lanes as with AdapterGerade95 (offset by 1.333 mm under Gerade100)
    expect(tunnelLanes('AdapterGerade95_16mm')[0].x.map((x) => Math.round((x + 1.333) * 100) / 100)).toEqual([24, 29.33]);
  });
  it('swap via tunnelAuto: cross tunnel 95 inserted, no adapter left under part 2 (carrier detected)', () => {
    const CROSS = ['StartSchale_60', 'Gerade100_60-50', 'Kurve90_50-40', 'Kurve90_40', 'SchieneRutsche120_100-60', 'SchieneBremse120_60-60_K607',
      'SchieneLangeKurveBank90_R90_60_v2', 'SchieneGerade120_60-50', 'SchieneGerade120_50-40', 'Kurve90_40', 'Gerade120_40-40',
      'Gerade60_40-40', 'Kurve90_40', 'Gerade120_40-40', 'Gerade120_40-40', 'Gerade120_40-40', 'Gerade120_40-40', 'EndSchale_40'];
    const els = chain(...CROSS);
    const L = solveChain(els);
    const a = L.adapters.find((x) => x.owner === 1 && x.slot === 0)!;
    expect(a.part.id).toBe('AdapterGerade100_16mm');
    const r = tunnelAuto(els, L, a, (e) => solveChain(e));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tunnel).toBe('AdapterTunnelQuer95_40-40_Q32_16mm');
    const L2 = solveChain(r.elements);
    expect(L2.adapters.filter((x) => x.owner === 1)).toEqual([]);
    expect(L2.issues.filter((i) => i.text.includes('AdapterGerade100_16mm'))).toEqual([]);
  });
});

describe('Footprint', () => {
  it('AdapterYMerge120 like the Y: wings and wedge covered, corners at the exit side free', () => {
    const inside = (x: number, y: number) => pointInside(footprintPieces(part('AdapterYMerge120_16mm')).map((pc) => ({ ...pc })), x, y, 16);
    expect(inside(2, 25)).toBe(true);           // wing at the +y inlet
    expect(inside(2, -25)).toBe(true);
    expect(inside(6, 0)).toBe(true);            // between the inlets (wedge)
    expect(inside(60, 0)).toBe(true);           // at the exit
    expect(inside(60, 20)).toBe(false);         // free beside the exit
    expect(inside(60, -20)).toBe(false);
  });
});
