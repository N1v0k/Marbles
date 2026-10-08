// State: URL encoding (m1), sanitizing, undo/redo.
import { describe, it, expect } from 'vitest';
import { encodeChain, decodeChain, sanitizeElements, sanitizeSim, sanitizeOmit, History, CHAIN_PREFIX, MAX_ELEMENTS, toPlain } from '../src/state';
import { DEFAULT_SIM } from '../src/physics';
import { chain, demos, demo } from './helpers';

describe('URL encoding', () => {
  it('m1.<code>[*][~slots] - demos round-trip losslessly', () => {
    expect(CHAIN_PREFIX).toBe('m1.');
    for (const d of demos.demos) {
      const els = demo(d.id);
      const s = encodeChain(els);
      expect(s.startsWith('m1.')).toBe(true);
      const dec = decodeChain(s)!;
      expect(dec.unknown).toBe(0);
      expect(toPlain(dec.elements)).toEqual(toPlain(els));
      expect(toPlain(els)).toEqual(d.chain);          // demos are already stored in plain form in demos.json
    }
    const els = chain('StartSchale_60', 'Kurve90_60*', 'Gerade120_60-60');
    els[2].omit = [1, 0];
    const dec = decodeChain(encodeChain(els))!;
    expect(dec.elements[1]).toEqual({ part: 'Kurve90_60_16mm', reversed: true });
    expect(dec.elements[2].omit).toEqual([0, 1]);
  });
  it('links with another prefix (v2.) are rejected, unknown codes skipped and counted', () => {
    expect(decodeChain('v2.0.1.2')).toBeNull();
    const s = encodeChain(chain('StartSchale_60', 'Gerade120_60-50'));
    expect(decodeChain(s.replace('m1.', 'm1.zzzz.'))).toMatchObject({ unknown: 1 });
  });
});

describe('Sanitizing', () => {
  it('sanitizeElements: only known parts, reversed only true, omit as a slot list', () => {
    expect(sanitizeElements([{ part: 'StartSchale_60_16mm' }, { part: 'StartSchale_60' }, { part: 'Gerade120_60-50_16mm', reversed: 'yes', omit: [2, 2, 'x', 48, 0] }, null]))
      .toEqual([{ part: 'StartSchale_60_16mm' }, { part: 'Gerade120_60-50_16mm', omit: [0, 2] }]);
    expect(sanitizeOmit([])).toBeUndefined();
  });
  it('sanitizeSim: ranges, ball weight rounded to 0.1 g', () => {
    expect(sanitizeSim({})).toEqual(DEFAULT_SIM);
    expect(sanitizeSim({ v0: 9999, crr: 0, mass: 16.84 })).toEqual({ v0: 400, crr: 0.005, mass: 16.8 });
  });
});

describe('History', () => {
  it('undo/redo', () => {
    const h = new History();
    h.push(chain('StartSchale_60'));
    const cur = chain('StartSchale_60', 'Gerade120_60-50');
    expect(h.undo(cur)).toEqual(chain('StartSchale_60'));
    expect(h.redo(chain('StartSchale_60'))).toEqual(cur);
    expect(h.canRedo).toBe(false);
  });
});

describe('Limits', () => {
  it('omitted slots from 10 up survive link, JSON and undo; single-digit slots also work without commas', () => {
    const els = chain('StartSchale_60', 'Gerade120_60-60');
    els[1].omit = [10, 0, 1];
    const s = encodeChain(els);
    expect(s).toContain('~0,1,10');
    expect(decodeChain(s)!.elements[1].omit).toEqual([0, 1, 10]);
    expect(sanitizeElements(toPlain(els))[1].omit).toEqual([0, 1, 10]);
    const h = new History(); h.push(els);
    expect(h.undo([])![1].omit).toEqual([0, 1, 10]);
    expect(decodeChain(s.replace('~0,1,10', '~013'))!.elements[1].omit).toEqual([0, 1, 3]);
    expect(sanitizeOmit([48, 47, -1, 2.5])).toEqual([47]);
  });
  it('a short link with very many parts does not freeze the tab (limits on parts and tower height)', async () => {
    const { solveChain, MAX_LEVELS } = await import('../src/chain');
    const s = CHAIN_PREFIX + Array(1000).fill('13').join('.');   // 1000 x Rutsche_120-60 (3 KB)
    const dec = decodeChain(s)!;
    expect(dec.elements.length).toBe(MAX_ELEMENTS);
    expect(dec.unknown).toBe(1000 - MAX_ELEMENTS);
    const t0 = Date.now();
    const L = solveChain(dec.elements);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(L.adapters.length).toBeLessThanOrEqual(MAX_ELEMENTS * MAX_LEVELS);
    expect(Math.max(...L.adapters.map((a) => a.slot))).toBeLessThan(MAX_LEVELS);
    expect(L.issues.some((i) => /keinen Adapterturm/.test(i.text))).toBe(true);
  });
});
