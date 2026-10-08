// Height adapters for flip-flop, spiral and X-crossing: catalog (family adapter, plate 15), sockets match the part,
// chain (a part one level up gets its tower), flip-flop coupling, footprint.
import { describe, it, expect } from 'vitest';
import { catalog, needsAdapter, grooved, LEVEL, PORT_Z } from '../src/catalog';
import { vsockW, sameVSock, rotM } from '../src/chain';
import { footprintPieces, pointInside } from '../src/footprint';
import { bom } from '../src/export';
import { solve, part, pinSum } from './helpers';

const HEIGHT_ADAPTERS: [string, string, string][] = [   // adapter, part, English name
  ['AdapterKippwippe_120-60_16mm', 'Kippwippe_120-60_Links_16mm', 'AdapterFlipFlop_120-60_16mm'],
  ['AdapterSpirale_100-60_16mm', 'Spirale_100-60_16mm', 'AdapterSpiral_100-60_16mm'],
  ['AdapterXKreuzung_50-40_16mm', 'XKreuzung_50-40_16mm', 'AdapterCrossing_50-40_16mm'],
];

describe('Catalog', () => {
  it('three height adapters: family adapter, plate 15, English names, Japandi grooved, one level high', () => {
    for (const [a, , en] of HEIGHT_ADAPTERS) {
      const p = part(a);
      expect(p.family, a).toBe('adapter');
      expect(p.plate, a).toEqual({ no: 15, name: '15 Adapters 1 of 2' });
      expect(p.released, a).toBe(true);
      expect(p.nameEn, a).toBe(en);
      expect(p.height, a).toBeCloseTo(LEVEL, 2);
      expect(grooved(p), a).toBe(true);
      expect(Object.keys(p.printMeta), a).toEqual([]);          // like all adapters in the release profile
    }
    // print orientation: vertical socket with the press flanks along +-X (flip-flop rotated 90 degrees like its body)
    expect(HEIGHT_ADAPTERS.map(([a]) => part(a).printRot)).toEqual([90, 0, 0]);
  });
  it('vertical socket aligned top and bottom, same as the bottom socket of the part (center, width axis, ear side)', () => {
    for (const [a, t] of HEIGHT_ADAPTERS) {
      const A = part(a), T = part(t);
      expect(A.vsock.top, a).toEqual(A.vsock.bottom);
      expect(T.adapter, t).toEqual({ type: a, offset: [0, 0], rot: 0 });
      expect(sameVSock(vsockW(A.vsock.top[0], rotM(0), [0, 0]), T.vsock.bottom[0]), t).toBe(true);
      expect(needsAdapter(T), t).toBe(false);
      expect(A.foot, a).toEqual([T.foot[0], T.foot[1], Math.min(T.foot[2], A.foot[2]), Math.min(T.foot[3], A.foot[3])]);
    }
  });
  it('horizontal sockets exactly at the end faces where the part has a socket on its level (neighboring towers couple)', () => {
    const key = (q: { p: number[]; n: number[] }) => [q.p[0], q.p[1], q.n[0], q.n[1]].map((x) => Math.round(x * 100) / 100).join(',');
    for (const [a, t] of HEIGHT_ADAPTERS) {
      const A = part(a), T = part(t);
      const lower = T.ports.filter((q) => Math.abs(q.p[2] - PORT_Z) < 0.01).map(key).sort();
      expect(A.ports.map(key).sort(), a).toEqual(lower);
      for (const q of A.ports) expect(q.p[2]).toBeCloseTo(PORT_Z, 3);
    }
  });
  it('footprint: flip-flop T, spiral disc + web, X-crossing cross', () => {
    const inside = (id: string, x: number, y: number) => pointInside(footprintPieces(part(id)).map((pc) => ({ ...pc })), x, y, 16);
    expect(inside('AdapterKippwippe_120-60_16mm', 5, 0)).toBe(true);
    expect(inside('AdapterKippwippe_120-60_16mm', 5, 20)).toBe(false);          // free in front of the shoulders
    expect(inside('AdapterKippwippe_120-60_16mm', 30, 30)).toBe(true);
    expect(inside('AdapterSpirale_100-60_16mm', -35, -24)).toBe(true);          // web under the inlet
    expect(inside('AdapterSpirale_100-60_16mm', 0, 12)).toBe(true);             // column
    expect(inside('AdapterSpirale_100-60_16mm', -30, 5)).toBe(false);
    expect(inside('AdapterXKreuzung_50-40_16mm', 25, 0)).toBe(true);
    expect(inside('AdapterXKreuzung_50-40_16mm', 25, 25)).toBe(false);          // corner between the arms is free
  });
});

describe('Chain', () => {
  it('spiral one level up: stands on AdapterSpirale, no errors', () => {
    const L = solve('StartSchale_60', 'Gerade120_60-50', 'Gerade120_50-40', 'Spirale_100-60', 'Rutsche_120-60', 'Gerade120_60-50', 'Gerade120_50-40', 'EndSchale_40');
    expect(L.placed.map((q) => q.S)).toEqual([64, 64, 64, 32, 0, 0, 0, 0]);
    expect(L.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(L.adapters.filter((a) => a.owner === 3).map((a) => a.part.id)).toEqual(['AdapterSpirale_100-60_16mm']);
    expect(bom(L).find((r) => r.id === 'AdapterSpirale_100-60_16mm')?.count).toBe(1);
  });
  it('X-crossing one level up: stands on AdapterXKreuzung, no errors', () => {
    const L = solve('StartSchale_60', 'Gerade120_60-50', 'XKreuzung_50-40', 'Spirale_100-60', 'Gerade120_60-50', 'Gerade120_50-40', 'EndSchale_40');
    expect(L.placed.map((q) => q.S)).toEqual([32, 32, 32, 0, 0, 0, 0]);
    expect(L.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(L.adapters.filter((a) => a.owner === 2).map((a) => a.part.id)).toEqual(['AdapterXKreuzung_50-40_16mm']);
  });
  it('flip-flop: the lower socket at the inlet end couples with the tower of the feeding part (one more snap pin)', () => {
    const L = solve('StartSchale_60', 'Gerade120_60-60', 'Kippwippe_120-60_Links', 'Gerade120_60-50', 'Kurve90_50-40', 'EndSchale_40');
    expect(L.issues.filter((i) => i.level === 'error')).toEqual([]);
    const k = L.pins.filter((j) => j.kind === 'row' && j.b.includes('Kippwippe') || j.kind === 'row' && j.a.includes('Kippwippe'));
    expect(k.length).toBe(1);
    expect(pinSum(L, 'row')).toBeGreaterThanOrEqual(1);
  });
  it('flip-flop two levels up: tower of two AdapterKippwippe', () => {
    const L = solve('StartSchale_60', 'Gerade120_60-60', 'Rutsche_120-60', 'Gerade120_60-60', 'Kippwippe_120-60_Rechts', 'Gerade120_60-50', 'Kurve90_50-40',
      'Trichter_100-60', 'Gerade120_60-50', 'Gerade120_50-40', 'EndSchale_40');
    const flip = L.placed[4];
    expect(L.issues.filter((i) => i.level === 'error' && i.idx.includes(4))).toEqual([]);
    expect(L.adapters.filter((a) => a.owner === 4).length).toBe(flip.S / LEVEL);
    expect(L.adapters.filter((a) => a.owner === 4).every((a) => a.part.id === 'AdapterKippwippe_120-60_16mm')).toBe(true);
    expect(flip.S).toBeGreaterThan(0);
    expect(catalog.byId.has('AdapterKippwippe_120-60_16mm')).toBe(true);
  });
});
