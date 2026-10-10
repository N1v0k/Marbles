// Adapter slots: swap for the tunnel version (chain surgery with spacers) and omission.
import { describe, it, expect } from 'vitest';
import { solveChain } from '../src/chain';
import { tunnelSwap, tunnelAuto, fillLength } from '../src/tunnel';
import { chain, ids, pinSum } from './helpers';

// Upper (level 32): StartSchale + Gerade 60-50, U-turn, SchieneRutsche down; below, a rim-40 rail straight runs
// across under the adapter of the straight (part 2). The crossing is exactly at the middle of the adapter (32 mm).
const CROSS = ['StartSchale_60', 'Gerade120_60-50', 'Kurve90_50-40', 'Kurve90_40', 'SchieneRutsche120_100-60', 'SchieneBremse120_60-60_K607',
  'SchieneLangeKurveBank90_R90_60_v2', 'SchieneGerade120_60-50', 'SchieneGerade120_50-40', 'Kurve90_40', 'Gerade120_40-40',
  'Gerade60_40-40', 'Kurve90_40', 'Gerade120_40-40', 'Gerade120_40-40', 'Gerade120_40-40', 'Gerade120_40-40', 'EndSchale_40'];
// Gerade80 + 2 x Distanz65 instead of Gerade120 + Gerade60: the crossing is at 48 mm.
const CROSS_V16 = CROSS.map((s, i) => (i === 10 ? 'Gerade80_40-40' : s)).flatMap((s, i) => (i === 11 ? ['Distanz65-0_40-40', 'Distanz65-0_40-40'] : [s]));

describe('fillLength (16 mm spacers 24 / 24.5 / 34.7, rail 50.7)', () => {
  it('fewest pieces within +-0.6 mm, otherwise null', () => {
    expect(fillLength(0, 'channel')).toEqual([]);
    expect(fillLength(64, 'channel')).toEqual(['Gerade120_40-40_16mm']);
    expect(fillLength(59.2, 'channel')).toEqual(['Distanz65-0_40-40_16mm', 'Distanz46-0_40-40_16mm']);
    expect(fillLength(114.67, 'rail')).toEqual(['SchieneGerade120_40-40_16mm', 'SchieneDistanz95-0_40-40_16mm']);
    // with Distanz45 (24.000): 114.67 = Gerade60 + Distanz65 + 2 x Distanz45; 56 = Gerade60 + Distanz45
    expect(fillLength(114.67, 'channel')).toEqual(['Gerade60_40-40_16mm', 'Distanz65-0_40-40_16mm', 'Distanz45-0_40-40_16mm', 'Distanz45-0_40-40_16mm']);
    expect(fillLength(56, 'channel')).toEqual(['Gerade60_40-40_16mm', 'Distanz45-0_40-40_16mm']);
    expect(fillLength(10, 'channel')).toBeNull();                 // shorter than the shortest part
    expect(fillLength(-5, 'channel')).toBeNull();
  });
});

describe('Tunnel swap', () => {
  it('the lower rail straight crosses under the adapter of the upper straight: collision', () => {
    const L = solveChain(chain(...CROSS));
    const k = L.issues.filter((i) => i.code === 'collision' && i.text.includes('AdapterGerade120_16mm'));
    expect(k.length).toBeGreaterThan(0);                     // the crossing is at a joint: two straights hit the adapter
    for (const i of k) expect(i.idx).toContain(1);
  });
  it('swap: the run becomes Gerade100 + Distanz65 + Distanz45 + cross tunnel 32 (center) + Gerade100 + Distanz65 + Distanz45; the adapter is removed', () => {
    const els = chain(...CROSS);
    const L = solveChain(els);
    const a = L.adapters.find((x) => x.owner === 1 && x.slot === 0)!;
    const r = tunnelSwap(els, L, a);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 112 mm each side: Gerade100 + Distanz65 + Distanz45 = 112.000 (exact) beats Gerade80 + 2 x Distanz65 = 112.001 (same count)
    expect(ids(r.elements).slice(13, 20)).toEqual(['Gerade100_40-40', 'Distanz65-0_40-40', 'Distanz45-0_40-40', 'AdapterTunnelQuer120_40-40_Q32', 'Gerade100_40-40', 'Distanz65-0_40-40', 'Distanz45-0_40-40']);
    const L2 = solveChain(r.elements);
    // the collision with the adapter is gone (the track still runs into the SchieneRutsche afterwards - the example is only for the swap)
    expect(L2.issues.filter((i) => i.text.includes('AdapterGerade120_16mm'))).toEqual([]);
    expect(L2.issues.filter((i) => i.code === 'collision').length).toBeLessThan(L.issues.filter((i) => i.code === 'collision').length);
    expect(L2.adapters.filter((x) => x.owner === 1)).toEqual([]);          // the cross tunnel carries part 2 (32 wide under a 26.7 footprint)
    // the cross tunnel has no vertical socket - there is no pin between it and part 2
    expect(L2.pins.filter((j) => j.kind === 'tower' && j.b.startsWith('2.'))).toEqual([]);
    expect(pinSum(L2, 'joint')).toBe(r.elements.length - 1);
    expect(r.text).toContain('AdapterTunnelQuer120_40-40_Q32_16mm eingesetzt');
  });
  it('crossing at 48 mm: cross tunnel 32 with offset 16, reversed', () => {
    const els = chain(...CROSS_V16);
    const L = solveChain(els);
    const a = L.adapters.find((x) => x.owner === 1 && x.slot === 0)!;
    const r = tunnelSwap(els, L, a);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(ids(r.elements)).toContain('AdapterTunnelQuer120_40-40_Q32_V16*');
    expect(solveChain(r.elements).adapters.filter((x) => x.owner === 1)).toEqual([]);
  });
  it('tunnelAuto gives the same result as the direct swap for a matching crossing', () => {
    const els = chain(...CROSS);
    const L = solveChain(els);
    const a = L.adapters.find((x) => x.owner === 1 && x.slot === 0)!;
    const r1 = tunnelSwap(els, L, a), r2 = tunnelAuto(els, L, a, (e) => solveChain(e));
    expect(r2).toEqual(r1);
  });
  it('adapter without tunnel version and adapter without crossing report the reason', () => {
    const els = chain(...CROSS);
    const L = solveChain(els);
    const start = L.adapters.find((x) => x.part.id === 'AdapterStart_16mm')!;
    expect(tunnelSwap(els, L, start)).toMatchObject({ ok: false, code: 'variant' });
    const L3 = solveChain(chain('StartSchale_60', 'Gerade120_60-60', 'Rutsche_120-60'));
    const g = L3.adapters.find((x) => x.part.id === 'AdapterGerade120_16mm')!;
    expect(tunnelSwap(chain('StartSchale_60', 'Gerade120_60-60', 'Rutsche_120-60'), L3, g)).toMatchObject({ ok: false, code: 'nothing' });
  });
  it('crossing outside any lane: the error message names the positions (16 / 32 / 48 mm)', () => {
    // Gerade100 instead of Gerade120 + Gerade60 -> the lower track crosses the adapter beside every lane
    const els = chain(...CROSS.slice(0, 10), 'Gerade100_40-40', ...CROSS.slice(12));
    const L = solveChain(els);
    const a = L.adapters.find((x) => x.owner === 1 && x.slot === 0);
    expect(a).toBeDefined();
    const r = tunnelSwap(els, L, a!);
    expect(r).toMatchObject({ ok: false, code: 'noFit' });
    expect(r.text).toMatch(/16\.0 mm.*32\.0 mm.*48\.0 mm/);
  });
});
