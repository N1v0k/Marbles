// Connecting to a lane under a 120 adapter: find an approach, append a cross tunnel ->
// the tunnel replaces the adapter, no new errors.
import { describe, it, expect } from 'vitest';
import { solveChain } from '../src/chain';
import { findConnections, applyConnection } from '../src/connect';
import { tunnelLaneTargets } from '../src/tunnel';
import { chain, ids } from './helpers';

// Top (level 32): start bowl + straight 60-50 (with AdapterGerade120 below), U-turn, rail slide down; open at the bottom.
const TOP = ['StartSchale_60', 'Gerade120_60-50', 'Kurve90_50-40', 'Kurve90_40', 'SchieneRutsche120_100-60', 'SchieneBremse120_60-60_K607',
  'SchieneLangeKurveBank90_R90_60_v2', 'SchieneGerade120_60-50', 'SchieneGerade120_50-40', 'Kurve90_40'];

describe('Lanes under the adapter', () => {
  it('Q32 center (2 sides) + V16 (16 and 48 per side): 6 targets on level 0, rim 40', () => {
    const L = solveChain(chain(...TOP));
    const a = L.adapters.find((x) => x.owner === 1 && x.slot === 0)!;
    const ts = tunnelLaneTargets(a);
    expect(ts.length).toBe(6);
    for (const tg of ts) { expect(tg.p[2]).toBeCloseTo(5.7, 3); expect(tg.rim).toBe(40); }
    expect([...new Set(ts.map((x) => Math.round(x.pos)))].sort((x, y) => x - y)).toEqual([16, 32, 48]);
  });
  it('approach + cross tunnel: adapter replaced, track afterwards without new errors', () => {
    const els = chain(...TOP);
    const L = solveChain(els);
    const a = L.adapters.find((x) => x.owner === 1 && x.slot === 0)!;
    const errs0 = L.issues.filter((i) => i.level === 'error').length;
    let ok = 0;
    for (const tg of tunnelLaneTargets(a)) {
      const sug = findConnections(els, { kind: 'port', p: tg.p, n: tg.n, rimCode: tg.rim ?? undefined }, { maxParts: 6, max: 2, timeMs: 1500 });
      for (const s of sug) {
        const work = applyConnection(els, s);
        work.splice(work.length, 0, tg.rev ? { part: tg.id, reversed: true } : { part: tg.id });
        const L2 = solveChain(work);
        const tun = L2.placed[L2.placed.length - 1];
        expect(tun.connected, ids(work).join(' ')).toBe(true);
        expect(L2.adapters.filter((x) => x.owner === 1 && x.slot === 0), ids(work).join(' ')).toEqual([]);
        expect(L2.issues.filter((i) => i.level === 'error').length, L2.issues.map((i) => i.text).join(' | ')).toBeLessThanOrEqual(errs0);
        ok++;
      }
    }
    expect(ok).toBeGreaterThan(0);
  }, 20000);
});
