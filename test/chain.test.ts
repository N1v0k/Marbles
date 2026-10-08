// Chain model: placement, levels (32 mm), adapter towers, snap pins, reversing, collisions, metrics.
import { describe, it, expect } from 'vitest';
import { solveChain, compatible, rotM, mulM, apply, rotOf, entryRim, exitRim, coupleRows, joinedParts } from '../src/chain';
import { sanitizeElements } from '../src/state';
import { LEVEL } from '../src/catalog';
import { chain, solve, part, demo, pinSum, demos } from './helpers';

describe('Matrices', () => {
  it('rotation matrices and rotOf are consistent (multiples of 90 only)', () => {
    for (const d of [0, 90, 180, 270, 360, -90]) expect(rotOf(rotM(d))).toBe(((d % 360) + 360) % 360);
    expect(rotOf(mulM(rotM(90), rotM(90)))).toBe(180);
    expect(apply(rotM(90), [1, 2], [1, 0])).toEqual([1, 3]);
  });
});

describe('Chain rule S_next = S_prev + z(exit) - z(entry)', () => {
  it('mini track: everything on level 0, socket to socket, 5 snap pins, no issues', () => {
    const L = solveChain(demo('mini'));
    expect(L.placed.map((q) => q.S)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(L.placed[1].t).toEqual([27.733, 0]);          // entry socket (0,0) at the start bowl socket (27.733 | 0)
    expect(L.placed[2].t[0]).toBeCloseTo(91.733, 3);
    expect(L.issues).toEqual([]);
    expect(L.pins.map((j) => j.kind)).toEqual(['joint', 'joint', 'joint', 'joint', 'joint']);
    expect(L.adapters).toEqual([]);
    expect(L.drop).toBeCloseTo(20 * 8 / 15, 3);          // rim 60 -> 40
  });
  it('level changer (slide, socket at 37.7) stands one level (32) lower; the start bowl stands on AdapterStart', () => {
    const L = solve('StartSchale_60', 'Rutsche_120-60', 'Gerade120_60-50');
    expect(L.placed.map((q) => q.S)).toEqual([LEVEL, 0, 0]);
    expect(L.adapters.map((a) => a.part.id)).toEqual(['AdapterStart_16mm']);
    expect(pinSum(L, 'tower')).toBe(1);                    // AdapterStart -> StartSchale
    expect(pinSum(L, 'joint')).toBe(2);
  });
  it('zigzag drops two levels (64 mm): two stacked AdapterStart, two tower stages', () => {
    const L = solve('StartSchale_60', 'Zickzack240_180-60', 'Gerade120_60-50');
    expect(L.placed.map((q) => q.S)).toEqual([2 * LEVEL, 0, 0]);
    expect(L.adapters.map((a) => [a.part.id, a.z])).toEqual([['AdapterStart_16mm', 0], ['AdapterStart_16mm', 32]]);
    expect(pinSum(L, 'tower')).toBe(2);
    expect(L.maxLevel).toBe(64);
  });
  it('rims must match: after rim 50 no part that needs rim 60', () => {
    const L = solve('StartSchale_60', 'Gerade120_60-50', 'Gerade120_60-60');
    expect(L.issues[0]).toMatchObject({ code: 'joint', idx: [2] });
    expect(L.issues[0].text).toContain('Rand 60');
    expect(compatible(L.placed[1], part('Gerade120_50-40'), false).ok).toBe(true);
  });
  it('loose parts hang beside the track and do not count (end bowl terminates the chain)', () => {
    const L = solve('StartSchale_60', 'Gerade120_60-50', 'Gerade120_50-40', 'EndSchale_40', 'Gerade120_40-40');
    expect(L.placed[4].connected).toBe(false);
    expect(L.issues.map((i) => i.code)).toEqual(['joint']);
    expect(L.pins.length).toBe(3);
  });
});

describe('Reversing (all ends are sockets)', () => {
  it('reversed flat curve = opposite curve: same position, other direction, no extra part', () => {
    const left = solve('StartSchale_60', 'Kurve90_60'), right = solve('StartSchale_60', 'Kurve90_60*');
    const dl = left.placed[1].exit!.n, dr = right.placed[1].exit!.n;
    expect(dl[1]).toBeCloseTo(1, 9); expect(dr[1]).toBeCloseTo(-1, 9);   // left +y, right -y
    expect(right.placed.length).toBe(2); expect(right.issues).toEqual([]);
    expect(pinSum(right)).toBe(1);
  });
  it('reversed descending curve runs uphill (rim 40 -> 50) and needs rim 40 before it', () => {
    const L = solve('StartSchale_60', 'Gerade120_60-50', 'Gerade120_50-40', 'Kurve90_50-40*');
    expect(L.issues).toEqual([]);
    const q = L.placed[3];
    expect(entryRim(q)).toBe(40); expect(exitRim(q)).toBe(50);
    expect(compatible(L.placed[1], part('Kurve90_50-40'), true).ok).toBe(false);
  });
  it('level changers cannot be reversed (reversed is ignored)', () => {
    const L = solve('StartSchale_60', 'Rutsche_120-60*');
    expect(L.placed[1].reversed).toBe(false);
    expect(L.placed[1].S).toBe(0);
  });
});

describe('Adapter towers and snap pins', () => {
  it('starter funnel: curves on rotated curve adapters, towers coupled horizontally', () => {
    const L = solveChain(demo('starter-funnel'));
    expect(L.issues).toEqual([]);
    expect(L.adapters.map((a) => [a.part.id, a.rot])).toEqual([['AdapterStart_16mm', 0], ['AdapterKurve90_16mm', 270], ['AdapterKurve90_16mm', 0]]);
    expect(pinSum(L, 'tower')).toBe(3);
    expect(pinSum(L, 'row')).toBe(3);                  // AdapterStart - AdapterKurve - AdapterKurve - funnel (lower entry socket)
    expect(pinSum(L, 'joint')).toBe(8);
    expect(L.couplings.length).toBe(3);
  });
  it('three levels: towers with two stages, one snap pin per stage', () => {
    const L = solveChain(demo('three-levels'));
    expect(L.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect([...new Set(L.placed.map((q) => q.S))].sort((a, b) => a - b)).toEqual([0, 32, 64]);
    const upper = L.adapters.filter((a) => a.z === LEVEL);
    expect(upper.length).toBe(3);                          // below the three parts on level 64
    // every tower stage has exactly one pin: parts on adapters + adapters on adapters
    const partsOnAdapters = L.placed.filter((q) => q.S > 0 && q.part.adapter).length;
    expect(pinSum(L, 'tower')).toBe(partsOnAdapters + upper.length);
    expect(pinSum(L)).toBe(pinSum(L, 'joint') + pinSum(L, 'tower') + pinSum(L, 'row'));
  });
  it('coupleRows only couples facing end sockets on the same level', () => {
    const L = solve('StartSchale_60', 'Gerade120_60-60', 'Rutsche_120-60');   // level 32: start bowl + straight on adapters
    expect(L.adapters.map((a) => a.part.id)).toEqual(['AdapterStart_16mm', 'AdapterGerade120_16mm']);
    // AdapterStart - AdapterGerade and AdapterGerade - slide (second, lower entry socket)
    expect(coupleRows(L.placed, L.adapters).length).toBe(2);
  });
  it('level changers: second entry socket on level 0 couples with the tower below the feeding part', () => {
    for (const w of ['Rutsche_120-60', 'Rutsche120_100-60', 'SchieneRutsche120_100-60', 'Spirale_100-60', 'Trichter_100-60']) {
      const p = part(w);
      expect(p.ports.length, w).toBe(3);
      const [entry, exit, lower] = [p.ports[p.lane[0]!], p.ports[p.lane[1]!], p.ports[2]];
      expect(entry.p[2], w).toBeCloseTo(5.7 + LEVEL, 3);    // entry on level 32
      expect(exit.n[0], w).toBeCloseTo(-entry.n[0], 6);     // exit at the opposite end
      expect(lower.p[2], w).toBeCloseTo(5.7, 3);            // below on level 0, same end and axis
      expect([lower.p[0], lower.p[1], lower.n[0], lower.n[1]], w).toEqual([entry.p[0], entry.p[1], entry.n[0], entry.n[1]]);
    }
    expect(part('Zickzack240_180-60').ports.length).toBe(2);   // zigzag excluded (own design, a single entry socket)
    const L = solveChain(demo('starter-slide'));
    expect(L.couplings.map((c) => c.lb)).toEqual(['2. Rutsche_120-60_16mm']);
    expect(pinSum(L, 'row')).toBe(1);
  });
  it('end bowl/spiral/X-crossing without adapter can only stand on level 0', () => {
    const L = solve('StartSchale_60', 'Kurve90_60-50', 'Gerade120_50-40', 'EndSchale_40');
    expect(L.placed[3].S).toBe(0);
    const L2 = solve('StartSchale_60', 'Rutsche_120-60', 'Gerade120_60-50', 'Gerade120_50-40', 'Trichter_100-60', 'Kurve90_60', 'EndSchale_40');
    expect(L2.issues.filter((i) => i.code === 'noAdapter')).toEqual([]);
  });
});

describe('Collisions', () => {
  it('a track running into itself is reported', () => {
    const L = solve('StartSchale_60', 'Gerade120_60-60', 'Kurve90_60', 'Kurve90_60', 'Kurve90_60', 'Gerade120_60-60');
    expect(L.issues.some((i) => i.code === 'collision')).toBe(true);
  });
  it('all demo tracks are collision-free and without joint errors', () => {
    for (const d of demos.demos) {
      const L = solveChain(demo(d.id));
      expect(L.issues.filter((i) => i.level === 'error'), d.id).toEqual([]);
      expect(L.placed.every((q) => q.connected), d.id).toBe(true);
    }
  });
});

describe('Metrics', () => {
  it('build height, track length, drop in mm', () => {
    const L = solveChain(demo('starter-slide'));
    expect(L.height).toBeCloseTo(64, 0);                    // start bowl on level 32 (32 tall)
    expect(L.drop).toBeCloseTo((60 - 40) * 8 / 15 + LEVEL, 2);
    expect(L.length).toBeGreaterThan(200);
  });
  it('omit (freestyle tunnel): omitted slot, held by the neighbors', () => {
    const els = chain('StartSchale_60', 'Gerade120_60-60', 'Rutsche_120-60');
    els[1].omit = [0];
    const L = solveChain(els);
    expect(L.omitted).toEqual([{ owner: 1, slot: 0, z: 0, type: 'AdapterGerade120_16mm', held: true }]);
    expect(L.adapters.map((a) => a.owner)).toEqual([0]);
    expect(L.issues.find((i) => i.code === 'omit')!.level).toBe('info');
  });
  it('omit on the first part of a branch: the anchor (flip-flop) holds it, not the list neighbor', () => {
    // the list neighbors (end of the main strand on level 0 and the following slide) must not count
    const els = sanitizeElements([
      { part: 'StartSchale_60_16mm' }, { part: 'Kippwippe_120-60_Links_16mm' }, { part: 'Gerade120_60-60_16mm' }, { part: 'Rutsche_120-60_16mm' },
      { part: 'Gerade120_60-60_16mm', omit: [0], branch: { from: 1, port: 3 } }, { part: 'Rutsche_120-60_16mm' },
    ]);
    const L = solveChain(els);
    expect(L.placed.map((q) => q.S)).toEqual([64, 32, 32, 0, 32, 0]);
    expect(L.omitted).toEqual([{ owner: 4, slot: 0, z: 0, type: 'AdapterGerade120_16mm', held: true }]);
    expect(L.issues.find((i) => i.code === 'omit')!.level).toBe('info');
    // joined: branch start with anchor and successor; the flip-flop with start, main strand and branch
    expect(joinedParts(L.placed[4], L.placed, L.strands).map((q) => q.idx)).toEqual([1, 5]);
    expect(joinedParts(L.placed[1], L.placed, L.strands).map((q) => q.idx)).toEqual([0, 2, 4]);
    expect(joinedParts(L.placed[3], L.placed, L.strands).map((q) => q.idx)).toEqual([2]);   // not the list neighbor 4
  });
});

describe('Loose parts after the end of a strand', () => {
  it('everything after a loose part stays loose: not in parts list, normalization, adapters', () => {
    // the second part after the end bowl must not count as connected again
    const L = solve('StartSchale_60', 'Gerade120_60-50', 'Gerade120_50-40', 'EndSchale_40', 'Gerade120_40-40', 'Gerade120_40-40');
    expect(L.placed.map((q) => q.connected)).toEqual([true, true, true, true, false, false]);
    // two slides after the end must not lift the whole valid track to level 32 (adapters, error at the end bowl)
    const L2 = solve('StartSchale_60', 'Gerade120_60-50', 'Gerade120_50-40', 'EndSchale_40', 'Rutsche_120-60', 'Rutsche_120-60', 'Gerade120_60-60');
    expect(L2.placed.slice(0, 4).map((q) => q.S)).toEqual([0, 0, 0, 0]);
    expect(L2.placed.map((q) => q.connected)).toEqual([true, true, true, true, false, false, false]);
    expect(L2.adapters).toEqual([]);
    expect(L2.issues.filter((i) => i.level === 'error').map((i) => i.code)).toEqual(['joint']);
  });
  it('a rim mismatch mid-track: the part sits at the joint, the parts after it stay connected', () => {
    const L = solve('StartSchale_60', 'Gerade120_60-60', 'Gerade120_40-40', 'Gerade120_40-40');
    expect(L.placed.map((q) => q.connected)).toEqual([true, true, false, true]);
  });
});

