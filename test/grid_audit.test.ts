// Grid audit: which released parts are off the one-third grid (sockets not a whole number of 2.667 mm apart)? Every
// such part shifts the rest of the track off the grid, so a loop or lane after it can only close with another off-grid
// part. The list is explicit: a new off-grid part fails this test, and a part fixed in CAD is removed from it.
import { describe, it, expect } from 'vitest';
import { catalog } from '../src/catalog';
import { offGrid } from '../src/grid';
import { part } from './helpers';

// target sizes once on the grid (for the CAD), see the PR "grid audit": socket offsets in mm
const KNOWN_OFF_GRID = [
  'Distanz46-0_40-40_16mm', 'AdapterDistanz46_16mm',             // 24.533 long -> 24 (3 steps)
  'Gerade88_60-40_16mm', 'AdapterGerade88_16mm',                 // 46.933 long -> 48 (6 steps)
  'Spirale_100-60_16mm', 'AdapterSpirale_100-60_16mm',           // entry -> exit 55.467 -> 56 (7 steps)
  'Trichter_100-60_16mm', 'AdapterTrichter_100-60_16mm',         // exit 27.783 sideways -> 24; 101.333 along -> 104
  'Kippwippe_120-60_16mm', 'Kippwippe_120-60_Links_16mm', 'Kippwippe_120-60_Rechts_16mm',
  'AdapterKippwippe_120-60_16mm',                                // outlets (28.6 | +-36) -> (32 | +-40)
  'AdapterTunnelQuer95_40-40_Q32_16mm',                          // deliberate: cross lanes 22.667 from the entry
];

describe('Grid audit', () => {
  it('released parts off the one-third grid: exactly the known list', () => {
    const off = catalog.parts.filter((p) => p.released && offGrid(p)).map((p) => p.id);
    expect(off.sort()).toEqual([...KNOWN_OFF_GRID].sort());
  });
  it('the one-third shifters are on the grid (Gerade80/100, Distanz65), so are curves, slides and lifts', () => {
    for (const s of ['Gerade80_40-40', 'Gerade100_40-40', 'Distanz65-0_40-40', 'SchieneDistanz95-0_40-40', 'Kurve90_40', 'LangeKurve90_R90_40',
                     'Rutsche_120-60', 'Rutsche120_100-60', 'YMerge120_40-40', 'XKreuzung_50-40', 'Lift2_Links'])
      expect(offGrid(part(s)), s).toBe(false);
  });
});
