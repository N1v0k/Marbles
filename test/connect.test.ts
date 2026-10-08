// Connect assistant: shortest part sequences from the open end of the main strand to a target socket -
// circuit (lift entry, all four head directions), free socket on the same or a lower level, unreachable targets,
// part set, insertion before branches, runtime.
import { describe, it, expect } from 'vitest';
import { findConnections, connectCandidates, applyConnection, mainEnd, type ConnectTarget, type ConnectSuggestion, type ConnectOptions } from '../src/connect';
import { solveChain, type ChainElement } from '../src/chain';
import { catalog, SCALE } from '../src/catalog';
import { chain, demo, ids } from './helpers';
import { setLang } from '../src/i18n';

const errors = (els: ChainElement[]) => solveChain(els).issues.filter((i) => i.level === 'error');
const times: Record<string, number> = {};
/** findConnections with timing (every call must stay below 2.5 s, see below). */
function find(name: string, els: ChainElement[], target: ConnectTarget, opts?: ConnectOptions): ConnectSuggestion[] {
  const t0 = performance.now();
  const r = findConnections(els, target, opts);
  times[name] = performance.now() - t0;
  return r;
}
/** Free socket where the chain would end with the extra parts (in the main strand) - in the coordinates of the chain
 *  without them (if extra goes below the lowest level, the solver renormalizes). dp shifts the target. */
function portAfter(els: ChainElement[], extra: string[], dp: [number, number, number] = [0, 0, 0], rimCode?: number): ConnectTarget {
  const L0 = solveChain(els), L = solveChain(applyConnection(els, chain(...extra)));
  const e = L.placed[mainEnd(els) + extra.length].exit!;
  const dz = L.placed[0].S - L0.placed[0].S;
  return { kind: 'port', p: [e.p[0] + dp[0], e.p[1] + dp[1], e.p[2] - dz + dp[2]], n: [-e.n[0], -e.n[1], 0], rimCode };
}
/** Does the chain with the suggestion end at the target socket (position within 0.4 mm, opposite normal) without new errors? */
function endsAt(els: ChainElement[], s: ConnectSuggestion, t: Extract<ConnectTarget, { kind: 'port' }>): boolean {
  const L0 = solveChain(els), L = solveChain(applyConnection(els, s));
  const e = L.placed[mainEnd(els) + s.n].exit!;
  const dz = L.placed[0].S - L0.placed[0].S;
  const d = Math.max(Math.abs(e.p[0] - t.p[0]), Math.abs(e.p[1] - t.p[1]), Math.abs(e.p[2] - dz - t.p[2]));
  return d <= 0.4 && e.n[0] * t.n[0] + e.n[1] * t.n[1] < -0.99 && L.issues.filter((i) => i.level === 'error').length <= errors(els).length;
}
/** Every suggestion closes the circuit without new errors. */
function expectRings(els: ChainElement[], r: ConnectSuggestion[], name: string) {
  expect(r.length, name).toBeGreaterThanOrEqual(1);
  for (const s of r) {
    const L = solveChain(applyConnection(els, s));
    expect(L.ring, `${name}: ${s.text}`).toBe(true);
    expect(L.issues.some((i) => i.code === 'ring'), name).toBe(true);
    expect(L.issues.filter((i) => i.level === 'error'), `${name}: ${s.text}`).toEqual([]);
    expect(s.n, name).toBe(s.elements.length);
  }
  // shortest first
  expect(r.map((s) => s.n), name).toEqual([...r.map((s) => s.n)].sort((a, b) => a - b));
}

describe('Part set', () => {
  const C = connectCandidates();
  it('only released on-grid channel parts: straights, spacers, curves R24/R48, slides', () => {
    expect(C.length).toBe(44);   // 20 straights, 2 spacers, 12 flat curves (left/right each), 8 descending curves, 2 slides
    for (const c of C) {
      const p = catalog.byId.get(c.part)!;
      expect(p, c.part).toBeTruthy();
      expect(p.released, c.part).toBe(true);
      expect(p.system, c.part).toBe('channel');
      expect(['straight', 'spacer', 'curve', 'longCurve', 'levelChanger'], c.part).toContain(p.family);
      expect(c.part, c.part).not.toMatch(/Lift|Kippwippe|XKreuzung|Trichter|Spirale|Zickzack|Looping|Tunnel|Schiene|Schale|Adapter|Raststift|Huegel|Versatz/);
      // on the 8/15 mm grid - that is why the search uses integers
      expect(Math.abs(c.fwd / SCALE - Math.round(c.fwd / SCALE)), c.part).toBeLessThan(1e-6);
      expect(Math.abs(c.left / SCALE - Math.round(c.left / SCALE)), c.part).toBeLessThan(1e-6);
    }
    for (const id of ['Distanz46-0_40-40_16mm', 'Distanz65-0_40-40_16mm', 'Rutsche_120-60_16mm', 'Rutsche120_100-60_16mm', 'LangeKurve90_R90_50-40_gespiegelt_16mm', 'Gerade80_60-50_16mm'])
      expect(C.some((c) => c.part === id), id).toBe(true);
  });
  it('flat curves left and right (right = reversed), descending curves and slides forward only (downhill)', () => {
    const r24 = C.filter((c) => c.part === 'Kurve90_60_16mm');
    expect(r24.map((c) => [c.reversed, c.turn, c.fwd, c.left])).toEqual([[false, 1, 24, 24], [true, -1, 24, -24]]);
    const r48 = C.filter((c) => c.part === 'LangeKurve90_R90_40_16mm');
    expect(r48.map((c) => [c.turn, c.fwd, c.left])).toEqual([[1, 48, 48], [-1, 48, -48]]);
    for (const c of C.filter((x) => x.rimNeed !== x.rimOut || x.dLevel !== 0)) expect(c.reversed, c.part).toBe(false);
    expect(C.find((c) => c.part === 'Kurve90_60-50_gespiegelt_16mm')!.turn).toBe(-1);
    const r = C.find((c) => c.part === 'Rutsche120_100-60_16mm')!;
    expect([r.dLevel, r.rimNeed, r.rimOut, r.fwd]).toEqual([-1, 40, 60, 64]);
    expect(C.find((c) => c.part === 'Distanz46-0_40-40_16mm')!.filler).toBe(true);
    expect(C.find((c) => c.part === 'Gerade120_40-40_16mm')!.filler).toBe(false);
  });
});

describe('Circuit', () => {
  it('lift + Gerade120: the suggestions close the ring into the lift entry without new errors', () => {
    const els = chain('Lift1_Gerade', 'Gerade120_60-60');
    const r = find('lift+straight120', els, { kind: 'ring' });
    expectRings(els, r, 'Lift1_Gerade + Gerade120');
    expect(r.length).toBe(5);
    expect(r[0].n).toBe(6);                        // e.g. curve R24 left 60->50 · curve R24 left 50->40 · Gerade120 · slide 100-60 · 2 curves
    expect(r.every((s) => s.levels === 1 && s.err < 0.01)).toBe(true);
    expect(r[0].text).toMatch(/Rutsche/);
  });
  it('all four head directions can be closed (entry/exit 16 mm beside the screw axis)', () => {
    // shortest ring (parts after the lift): straight 5, left 6, right 5, back 7 - 5 suggestions each
    const shortest: Record<string, number> = {};
    for (const d of ['Gerade', 'Links', 'Rechts', 'Zurueck']) {
      const els = chain(`Lift1_${d}`);
      const r = find('lift-' + d, els, { kind: 'ring' });
      expectRings(els, r, d);
      shortest[d] = r[0].n;
    }
    expect(shortest).toEqual({ Gerade: 5, Links: 6, Rechts: 5, Zurueck: 7 });
  });
  it('demo "lift circuit": with the last parts missing, the assistant finds the closure (exactly the two curves)', () => {
    const d = demo('lift-circuit');
    const r2 = find('demo-2', d.slice(0, -2), { kind: 'ring' });
    expect(ids(r2[0].elements)).toEqual(['Kurve90_60-50', 'Kurve90_50-40']);
    expect(r2[0].text).toBe('Kurve R24 links 60→50 · Kurve R24 links 50→40');
    for (const k of [1, 3, 4]) {
      const els = d.slice(0, -k);
      const r = find('demo-' + k, els, { kind: 'ring' });
      expectRings(els, r, 'demo-' + k);
      expect(r[0].n, 'demo-' + k).toBeLessThanOrEqual(k);
    }
  });
  it('no circuit with a start bowl (no entry) and none when it is already closed', () => {
    expect(find('start', chain('StartSchale_60', 'Gerade120_60-60', 'Kurve90_60'), { kind: 'ring' })).toEqual([]);
    expect(find('closed', demo('lift-circuit'), { kind: 'ring' })).toEqual([]);
    expect(findConnections([], { kind: 'ring' })).toEqual([]);
    // strand ends in the end bowl: no open end
    expect(find('end', chain('Lift1_Gerade', 'Rutsche_120-60', 'Kurve90_60-50', 'Kurve90_50-40', 'EndSchale_40'), { kind: 'ring' })).toEqual([]);
  });
});

describe('Free socket', () => {
  const base = chain('StartSchale_60', 'Gerade120_60-60');
  it('two flat parts away (same level): exactly those two parts', () => {
    const t = portAfter(base, ['Kurve90_60', 'Gerade120_60-60'], [0, 0, 0], 60) as Extract<ConnectTarget, { kind: 'port' }>;
    const r = find('port-2', base, t);
    expect(r.length).toBeGreaterThanOrEqual(3);
    expect(r[0].elements).toEqual(chain('Kurve90_60', 'Gerade120_60-60'));
    expect([r[0].n, r[0].err, r[0].levels, r[0].text]).toEqual([2, 0, 0, 'Kurve R24 links · Gerade120']);
    for (const s of r) expect(endsAt(base, s, t), s.text).toBe(true);
    // rim 60 required: all suggestions deliver it
    for (const s of r) expect(solveChain(applyConnection(base, s)).placed[1 + s.n].rimOutEff).toBe(60);
  });
  it('one level lower: curve + slide, the solver renormalizes the levels', () => {
    const t = portAfter(base, ['Kurve90_60', 'Rutsche_120-60']) as Extract<ConnectTarget, { kind: 'port' }>;
    expect(t.p[2]).toBeCloseTo(5.7 - 32, 3);
    const r = find('port-lower', base, t);
    expect(ids(r[0].elements)).toEqual(['Kurve90_60', 'Rutsche_120-60']);
    expect(r[0].levels).toBe(1);
    for (const s of r) expect(endsAt(base, s, t), s.text).toBe(true);
  });
  it('unreachable: higher than the open end, not on a level, 1.3 mm off the grid, oblique normal', () => {
    const t = portAfter(base, ['Kurve90_60', 'Gerade120_60-60']) as Extract<ConnectTarget, { kind: 'port' }>;
    const at = (dp: [number, number, number]): ConnectTarget => ({ ...t, p: [t.p[0] + dp[0], t.p[1] + dp[1], t.p[2] + dp[2]] });
    expect(find('higher', base, at([0, 0, 32]))).toEqual([]);           // the parts in the set only descend
    expect(find('z+1.3', base, at([0, 0, 1.3]))).toEqual([]);          // not a whole level
    expect(find('side+1.3', base, at([1.3, 0, 0]))).toEqual([]);       // sideways offset (detours up to 8 parts collide)
    expect(find('side+1.3/6', base, at([1.3, 0, 0]), { maxParts: 6 })).toEqual([]);
    expect(find('oblique', base, { ...t, n: [Math.SQRT1_2, -Math.SQRT1_2, 0] })).toEqual([]);
  });
  it('off-grid position: the remainder goes into err (up to 0.4 mm), 1.3 mm sideways is partly reachable with 8 parts', () => {
    const t = portAfter(base, ['Kurve90_60', 'Gerade120_60-60']) as Extract<ConnectTarget, { kind: 'port' }>;
    const r = find('side+0.3', base, { ...t, p: [t.p[0] + 0.3, t.p[1], t.p[2]] });
    expect(r[0].n).toBe(2); expect(r[0].err).toBeCloseTo(0.3, 3);
    // 1.3 mm = 2 grid units (1.067 mm) + 0.233: e.g. 2x Distanz46 (2 x 24.533) against a curve R48 (48.0)
    const t2: Extract<ConnectTarget, { kind: 'port' }> = { ...t, p: [t.p[0] - 1.3, t.p[1], t.p[2]] };
    const r2 = find('side-1.3', base, t2);
    expect(r2.length).toBeGreaterThanOrEqual(1);
    expect(r2[0].n).toBe(8); expect(r2[0].err).toBeCloseTo(0.233, 3);
    expect(endsAt(base, r2[0], t2)).toBe(true);
  });
});

describe('Insertion', () => {
  it('the suggestion goes after the last part of the main strand, the branch after it stays on its anchor', () => {
    const els = chain('StartSchale_60', 'Kippwippe_120-60_Links', 'Kurve90_60*', 'Kurve90_60-50');
    els[3].branch = { from: els[1], port: 3 };
    expect(mainEnd(els)).toBe(2);
    const t = portAfter(els, ['Gerade120_60-60', 'Kurve90_60']) as Extract<ConnectTarget, { kind: 'port' }>;
    const r = find('branch', els, t);
    expect(r[0].elements).toEqual(chain('Gerade120_60-60', 'Kurve90_60'));
    const out = applyConnection(els, r[0]);
    expect(ids(out)).toEqual(['StartSchale_60', 'Kippwippe_120-60_Links', 'Kurve90_60*', 'Gerade120_60-60', 'Kurve90_60', 'Kurve90_60-50']);
    expect(out[5].branch!.from).toBe(els[1]);
    const L = solveChain(out);
    expect(L.strands.map((s) => s.idxs)).toEqual([[0, 1, 2, 3, 4], [5]]);
    expect(endsAt(els, r[0], t)).toBe(true);
    expect(els.length).toBe(4);                                      // input unchanged
  });
});

describe('Runtime', () => {
  it('every call stays below 2.5 s (maxParts 8)', () => {
    expect(Object.keys(times).length).toBeGreaterThanOrEqual(15);
    for (const [k, ms] of Object.entries(times)) expect(ms, k).toBeLessThan(2500);
  });
});

describe('Language', () => {
  it('suggestion texts follow the UI language', () => {
    const base = chain('Lift1_Gerade', 'Gerade120_60-60');
    try {
      setLang('en');
      const en = findConnections(base, { kind: 'ring' }, { maxParts: 10, max: 1 });
      expect(en[0].text).toMatch(/^Curve R24 left 60→50 · .*Slide 100-60 \(level −1\) · Straight120/);
      expect(en[0].text).not.toMatch(/Kurve|links|rechts|Gerade|Rutsche|Ebene/);
      expect(connectCandidates().find((c) => c.part === 'Distanz46-0_40-40_16mm')!.label).toBe('Spacer46');
    } finally { setLang('de'); }
    const de = findConnections(base, { kind: 'ring' }, { maxParts: 10, max: 1 });
    expect(de[0].text).toMatch(/^Kurve R24 links 60→50 · .*Rutsche 100-60 \(Ebene −1\) · Gerade120/);
  });
});
