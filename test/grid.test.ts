// Grid hints: position of the open end on the 8 mm grid, and nearly closed circuit.
import { describe, it, expect } from 'vitest';
import { solveChain } from '../src/chain';
import { gridInfo, gridRef, nearRing } from '../src/grid';
import { demo, solve } from './helpers';

function endInfo(...ids: string[]) {
  const L = solve(...ids);
  const q = L.placed[L.placed.length - 1];
  return gridInfo(gridRef(L)!, q.out!);
}

describe('Grid at the open end', () => {
  it('straights 120/60 and curves stay on the grid', () => {
    expect(endInfo('StartSchale_60', 'Gerade120_60-50', 'Kurve90_50-40', 'Gerade60_40-40', 'Kurve90_40')).toMatchObject({ along: { state: 'on' }, across: { state: 'on' } });
  });
  it('Gerade80 or Distanz65: +1/3 -> 2/3 missing (Gerade100); Gerade100: 1/3 missing (Distanz65 or Gerade80)', () => {
    expect(endInfo('StartSchale_60', 'Gerade120_60-50', 'Kurve90_50-40', 'Gerade80_40-40')!.along.state).toBe('twoThirds');
    expect(endInfo('StartSchale_60', 'Gerade120_60-50', 'Kurve90_50-40', 'Distanz65-0_40-40')!.along.state).toBe('twoThirds');
    expect(endInfo('StartSchale_60', 'Gerade120_60-50', 'Kurve90_50-40', 'Gerade100_40-40')!.along.state).toBe('third');
    expect(endInfo('StartSchale_60', 'Gerade120_60-50', 'Kurve90_50-40', 'Gerade100_40-40', 'Gerade80_40-40')!.along.state).toBe('on');
  });
  it('after a curve a longitudinal offset becomes a lateral offset', () => {
    const g = endInfo('StartSchale_60', 'Gerade120_60-50', 'Kurve90_50-40', 'Gerade80_40-40', 'Kurve90_40')!;
    expect(g.along.state).toBe('on');
    expect(g.across.state).toBe('third');
  });
  it('Distanz46 is off the one-third grid', () => {
    const g = endInfo('StartSchale_60', 'Gerade120_60-50', 'Kurve90_50-40', 'Distanz46-0_40-40')!;
    expect(g.along.state).toBe('off');
    expect(g.along.need).toBeGreaterThan(0.3);
  });
  it('all demo tracks: result present (axis-aligned direction)', () => {
    for (const d of ['mini', 'starter-slide', 'three-levels', 'lift-circuit']) {
      const L = solveChain(demo(d));
      const q = L.placed[L.strands[0].idxs[L.strands[0].idxs.length - 1]];
      if (q.out) expect(gridInfo(gridRef(L)!, q.out), d).not.toBeNull();
    }
  });
});

describe('Circuit nearly closed', () => {
  it('closed lift circuit: no hint', () => {
    const L = solveChain(demo('lift-circuit'));
    expect(L.ring).toBe(true);
    expect(nearRing(L)).toBeNull();
  });
  it('end 0.8 mm off the lift entry (position shifted artificially): hint with the offset', () => {
    const L = solveChain(demo('lift-circuit'));
    const last = L.placed[L.placed.length - 1];
    const fake = { ...L, ring: false, placed: L.placed.map((q) => (q === last ? { ...q, out: { p: [q.out!.p[0] + 0.8, q.out!.p[1] - 0.5, q.out!.p[2]] as [number, number, number], n: q.out!.n } } : q)) };
    const r = nearRing(fake)!;
    expect(r.dx).toBeCloseTo(-0.8, 3);
    expect(r.dy).toBeCloseTo(0.5, 3);
    // farther than 3 mm: no hint
    const far = { ...fake, placed: fake.placed.map((q, i) => (i === fake.placed.length - 1 ? { ...q, out: { p: [q.out!.p[0] + 5, q.out!.p[1], q.out!.p[2]] as [number, number, number], n: q.out!.n } } : q)) };
    expect(nearRing(far)).toBeNull();
  });
  it('start bowl: never (no entry)', () => {
    expect(nearRing(solve('StartSchale_60', 'Gerade120_60-50'))).toBeNull();
  });
});
