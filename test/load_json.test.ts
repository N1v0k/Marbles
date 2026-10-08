// Loading JSON: main.ts sanitizes the loaded chain and setElements sanitizes it once more. The second pass must keep
// the branches (anchor as object instead of index), otherwise the branch parts end up appended to the end of the track.
import { describe, it, expect } from 'vitest';
import { sanitizeElements, toPlain } from '../src/state';
import { solveChain } from '../src/chain';
import { demos } from './helpers';

const CIRCUIT = [ // Y-merge circuit with lift +2
  'Lift2_Links', 'Gerade80_60-50', 'Gerade60_50-40', 'Distanz46-0_40-40', 'Distanz46-0_40-40', 'Kurve90_40', 'Rutsche120_100-60',
  'Gerade60_60-60', 'Gerade120_60-60', 'Gerade120_60-60', 'LangeKurve90_R90_60', 'LangeKurve90_R90_60', 'Kippwippe_120-60_Rechts',
  'LangeKurve90_R90_60-50', 'Gerade60_50-40', 'Distanz65-0_40-40', 'YMerge120_40-40', 'Distanz46-0_40-40',
  'Kurve90_60-50_gespiegelt', 'Gerade80_50-40', 'Kurve90_40', 'Gerade120_40-40', 'Kurve90_40',
].map((p) => ({ part: p + '_16mm' })) as { part: string; reversed?: boolean; lane?: number; branch?: { from: number; port: number } }[];
CIRCUIT[16].lane = 1;
CIRCUIT[20].reversed = true;
CIRCUIT[18].branch = { from: 12, port: 3 };

describe('Load JSON', () => {
  it('sanitized twice: branches and lanes stay, the anchor is the element of the new list', () => {
    for (const d of demos.demos) {
      const once = sanitizeElements(JSON.parse(JSON.stringify(d.chain)));
      const twice = sanitizeElements(once);
      expect(toPlain(twice)).toEqual(d.chain);
      twice.forEach((e) => { if (e.branch) expect(twice.includes(e.branch.from)).toBe(true); });
    }
  });
  it('Y-merge circuit loaded as in the builder: circuit, one branch, no errors', () => {
    const els = sanitizeElements(sanitizeElements(JSON.parse(JSON.stringify(CIRCUIT))));
    expect(els.filter((e) => e.branch).length).toBe(1);
    const L = solveChain(els);
    expect(L.ring).toBe(true);
    expect(L.issues.filter((i) => i.level === 'error')).toEqual([]);
  });
  it('an anchor referencing a foreign or later element is dropped', () => {
    const a = { part: 'StartSchale_60_16mm' }, k = { part: 'Kippwippe_120-60_Links_16mm' };
    const foreign = { part: 'Kippwippe_120-60_Links_16mm' };
    const out = sanitizeElements([a, k, { part: 'Kurve90_60-50_16mm', branch: { from: foreign, port: 3 } }]);
    expect(out[2].branch).toBeUndefined();
    const later = { part: 'Gerade120_60-60_16mm' } as Record<string, unknown>;
    const out2 = sanitizeElements([a, { part: 'Kurve90_60-50_16mm', branch: { from: later, port: 3 } }, later]);
    expect(out2[1].branch).toBeUndefined();
  });
});
