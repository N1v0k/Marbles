// Distanz45. User report: a flat circuit could not be closed, the last gap was 56 mm (7 grid units);
// the nearest fit Gerade60 + Distanz46 = 56.533 misses the 0.4 mm port tolerance. Distanz45-0_40-40 = 24.000 (wall
// between the sockets 2.8 instead of 3.0, documented exception) closes it. Catalog, height adapter, the circuit of the
// report, the connect assistant and the spacer fill.
import { describe, it, expect } from 'vitest';
import { catalog, needsAdapter, grooved, LEVEL, PORT_Z } from '../src/catalog';
import { solveChain } from '../src/chain';
import { findConnections, connectCandidates, applyConnection } from '../src/connect';
import { fillLength } from '../src/tunnel';
import { chain, ids, part } from './helpers';

// Circuit of the report, flat, rim 40, four left curves R24: side A = Gerade100 + Distanz65 = 88 mm, opposite side
// Gerade60 + 56 mm gap. (Workaround from the analysis: lengthen the opposite side by a Gerade60.)
const OPEN = ['Kurve90_40', 'Gerade100_40-40', 'Distanz65-0_40-40', 'Kurve90_40', 'Gerade120_40-40', 'Kurve90_40', 'Gerade60_40-40'];
const circuit = (...gap: string[]) => solveChain(chain(...OPEN, ...gap, 'Kurve90_40', 'Gerade120_40-40'));
const key = (q: { p: number[]; n: number[] }) => [q.p[0], q.p[1], q.n[0], q.n[1]].map((x) => Math.round(x * 1000) / 1000).join(',');
const lenOf = (id: string) => catalog.byId.get(id)!.length!;

describe('Distanz45: catalog', () => {
  it('24.000 long, rim 40, sockets at both ends, no vertical socket, plate 04, Japandi grooved, English Spacer45', () => {
    const p = part('Distanz45-0_40-40');
    expect([p.family, p.system, p.rimIn, p.rimOut, p.turn, p.released]).toEqual(['spacer', 'channel', 40, 40, 0, true]);
    expect(p.length).toBeCloseTo(24, 3);
    expect(p.foot).toEqual([0, -13.333, 24, 13.333]);
    expect(p.ports.map((q) => q.p).sort((a, b) => a[0] - b[0])).toEqual([[0, 0, PORT_Z], [24, 0, PORT_Z]]);
    expect(p.vsock).toEqual({ top: [], bottom: [] });
    expect(p.plate).toEqual({ no: 4, name: '04 Groove straights' });
    expect([p.nameEn, p.printRot]).toEqual(['Spacer45-0_40-40_16mm', 0]);     // sockets along x (+-X on the plate), like Distanz46
    expect(grooved(p)).toBe(true);
    expect(p.note).toContain('24 mm'); expect(p.note).not.toMatch(/30 ?mm/);
    // Distanz46 is no longer the shortest part
    expect(part('Distanz46-0_40-40').note).not.toContain('kürzeste');
  });
  it('AdapterDistanz45: one level high, 24 x 26.667, sockets at both end faces, no vertical socket, plate 17', () => {
    const a = part('AdapterDistanz45_16mm');
    expect([a.family, a.released, a.nameEn, a.printRot]).toEqual(['adapter', true, 'AdapterSpacer45_16mm', 0]);
    expect(a.height).toBeCloseTo(LEVEL, 2);
    expect(a.foot).toEqual([0, -13.333, 24, 13.333]);
    expect(a.vsock).toEqual({ top: [], bottom: [] });
    expect(a.plate).toEqual({ no: 17, name: '17 Adapters 2 of 2' });
    expect(Object.keys(a.printMeta)).toEqual([]);                            // like all adapters in the release profile
    expect(grooved(a)).toBe(true);
  });
  it('the part stands on AdapterDistanz45 (same footprint, sockets at the same end faces); Distanz46 keeps its own adapter', () => {
    const p = part('Distanz45-0_40-40'), a = part('AdapterDistanz45_16mm');
    expect(p.adapter).toEqual({ type: 'AdapterDistanz45_16mm', offset: [0, 0], rot: 0 });
    expect(needsAdapter(p)).toBe(false);
    expect(a.ports.map(key).sort()).toEqual(p.ports.filter((q) => Math.abs(q.p[2] - PORT_Z) < 0.01).map(key).sort());
    expect(part('Distanz46-0_40-40').adapter!.type).toBe('AdapterDistanz46_16mm');
    // one level up (then the slide down): tower AdapterDistanz45 under the part, coupled at both end faces, no pin from below
    const L = solveChain(chain('StartSchale_60', 'Gerade120_60-50', 'Kurve90_50-40', 'Distanz45-0_40-40', 'Gerade120_40-40',
      'Rutsche120_100-60', 'Gerade120_60-50', 'Kurve90_50-40', 'EndSchale_40'));
    expect(L.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(L.placed[3].S).toBe(LEVEL);
    expect(L.adapters.filter((x) => x.owner === 3).map((x) => x.part.id)).toEqual(['AdapterDistanz45_16mm']);
    expect(L.pins.filter((j) => j.kind === 'tower' && j.b.startsWith('4.'))).toEqual([]);
    expect(L.couplings.filter((c) => c.la.startsWith('AdapterDistanz45') || c.lb.startsWith('AdapterDistanz45')).length).toBe(2);
  });
  it('new URL codes are appended, existing codes unchanged', () => {
    expect([part('Distanz45-0_40-40').code, part('AdapterDistanz45_16mm').code]).toEqual(['5f', '5e']);
    expect([part('Distanz46-0_40-40').code, part('Distanz65-0_40-40').code, part('AdapterDistanz46_16mm').code, part('AdapterDistanz65_16mm').code])
      .toEqual(['9', 'a', '57', '58']);
    expect(new Set(catalog.parts.map((p) => p.code)).size).toBe(catalog.parts.length);
  });
});

describe('Distanz45: the circuit from the user report', () => {
  it('Gerade60 + Distanz45 closes the 56 mm gap: ring, one pin more, no errors', () => {
    const L = circuit('Gerade60_40-40', 'Distanz45-0_40-40');
    expect(L.ring).toBe(true);
    expect(L.issues.some((i) => i.code === 'ring')).toBe(true);
    expect(L.issues.filter((i) => i.level === 'error')).toEqual([]);
  });
  it('before: Gerade60 + Distanz46 misses by 0.533 mm (tolerance 0.4), without a filler the gap stays 24 mm', () => {
    for (const [gap, miss] of [[['Gerade60_40-40', 'Distanz46-0_40-40'], 0.533], [['Gerade60_40-40'], 24]] as [string[], number][]) {
      const L = circuit(...gap);
      expect(L.ring, gap.join('+')).toBe(false);
      const e = L.placed[L.placed.length - 1].exit!.p, s = L.placed[0].entry!.p;
      expect(Math.hypot(e[0] - s[0], e[1] - s[1]), gap.join('+')).toBeCloseTo(miss, 2);
    }
  });
  it('fill: 3, 6, 7, 9 and 10 grid units (24 ... 80 mm) are filled exactly; 56 = Gerade60 + Distanz45', () => {
    expect(fillLength(56, 'channel')).toEqual(['Gerade60_40-40_16mm', 'Distanz45-0_40-40_16mm']);
    for (const u of [3, 6, 7, 9, 10]) {
      const r = fillLength(u * 8, 'channel');
      expect(r, `${u} units`).not.toBeNull();
      expect(r!.reduce((s, id) => s + lenOf(id), 0), `${u} units`).toBeCloseTo(u * 8, 2);
    }
  });
});

describe('Distanz45: connect assistant', () => {
  it('Distanz45 is a candidate: spacer, filler, on the grid (3 units forward)', () => {
    const c = connectCandidates().find((x) => x.part === 'Distanz45-0_40-40_16mm')!;
    expect(c).toBeTruthy();
    expect(c.filler).toBe(true);
    expect([c.turn, c.dLevel, c.left]).toEqual([0, 0, 0]);
    expect(c.fwd).toBeCloseTo(24, 6);
  });
  it('closes the circuit of the report; every suggestion uses Distanz45, the shortest is Distanz45 + curve + Gerade120', () => {
    const els = chain(...OPEN, 'Gerade60_40-40');
    const r = findConnections(els, { kind: 'ring' });
    expect(r.length).toBeGreaterThanOrEqual(1);
    for (const s of r) {
      const L = solveChain(applyConnection(els, s));
      expect(L.ring, s.text).toBe(true);
      expect(L.issues.filter((i) => i.level === 'error'), s.text).toEqual([]);
      expect(ids(s.elements), s.text).toContain('Distanz45-0_40-40');
    }
    expect(ids(r[0].elements)).toEqual(['Distanz45-0_40-40', 'Kurve90_40', 'Gerade120_40-40']);
  });
});
