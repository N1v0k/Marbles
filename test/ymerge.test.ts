// Y-merge 120: catalog (5 rims, plate 14, two lanes with a shared exit), parts list (direction = inlet), chain (exit
// 16 mm beside the track, AdapterYMerge120), a strand merging into the free inlet (connect assistant), physics (loss at
// the merge, limits 0.8 / 1.2 m/s), footprint.
import { describe, it, expect, afterEach } from 'vitest';
import { catalog, LANES, MERGE, branchPorts, freeLane, laneOf, setEdition, partGrams, PORT_Z } from '../src/catalog';
import { solveChain, type ChainElement } from '../src/chain';
import { simulate, DEFAULT_SIM } from '../src/physics';
import { findConnections, applyConnection } from '../src/connect';
import { GROUP_BY_ID, variantOf, valueLabel } from '../src/groups';
import { footprintPieces, worldPieces, pointInside } from '../src/footprint';
import { encodeChain, decodeChain } from '../src/state';
import { bom } from '../src/export';
import { setLang } from '../src/i18n';
import { chain, part, pinSum, demo } from './helpers';

afterEach(() => { setEdition('plain'); setLang('de'); });

const RIMS = ['40-40', '50-40', '50-50', '60-50', '60-60'];
const Y = (r: string) => `YMerge120_${r}_16mm`;
const el = (r: string, lane = 0): ChainElement => (lane ? { part: Y(r), lane } : { part: Y(r) });
const errs = (els: ChainElement[]) => solveChain(els).issues.filter((i) => i.level === 'error');

describe('Catalog', () => {
  it('5 Y-merges: attraction, plate 14, same English name, Japandi grooved, AdapterYMerge120', () => {
    expect(catalog.parts.filter((p) => p.id.startsWith('YMerge')).map((p) => p.id).sort()).toEqual(RIMS.map(Y));
    for (const r of RIMS) {
      const p = part(Y(r));
      const [a, b] = r.split('-').map(Number);
      expect([p.family, p.system, p.rimIn, p.rimOut, p.feedRim, p.reversible, p.turn], r).toEqual(['attraction', 'channel', a, b, a, false, 0]);
      expect(p.plate, r).toEqual({ no: 14, name: '14 Attractions' });
      expect([p.released, p.nameEn, p.printRot], r).toEqual([true, Y(r), 0]);
      expect(p.printMeta, r).toEqual({});
      expect(p.jp, r).not.toBeNull();
      expect(p.adapter, r).toEqual({ type: 'AdapterYMerge120_16mm', offset: [0, 0], rot: 0 });
      expect(p.phys.inLoss, r).toBe(0.7);
      expect([p.phys.limits.vwarn, p.phys.limits.vmax], r).toEqual([800, 1200]);
      expect(p.phys.L, r).toBeCloseTo(66.63, 1);
      expect(p.foot, r).toEqual([0, -29.333, 64, 29.333]);
    }
  });
  it('sockets: inlet +y, exit, inlet -y; two lanes with a shared exit, no branch', () => {
    const p = part(Y('60-50'));
    expect(p.ports.map((q) => [q.p, q.n])).toEqual([[[0, 16, PORT_Z], [-1, 0, 0]], [[64, 0, PORT_Z], [1, 0, 0]], [[0, -16, PORT_Z], [-1, 0, 0]]]);
    expect(LANES[p.id]).toEqual([[0, 1], [2, 1]]);
    expect(MERGE.has(p.id)).toBe(true);
    expect(laneOf(p, 0)).toEqual([0, 1]); expect(laneOf(p, 1)).toEqual([2, 1]);
    expect(freeLane(p, 0)).toEqual([2, 1]); expect(freeLane(p, 1)).toEqual([0, 1]);
    expect(branchPorts(p, 0)).toEqual([]); expect(branchPorts(p, 1)).toEqual([]);
    // the X-crossing is not a merge
    expect(MERGE.has('XKreuzung_50-40_16mm')).toBe(false);
    expect(branchPorts(part('XKreuzung_50-40_16mm'), 0)).toEqual([2]);
  });
  it('filament/time: plain ~20 g per part, Japandi slightly heavier', () => {
    const p = part(Y('60-60'));
    expect(p.grams).toBeGreaterThan(15); expect(p.grams).toBeLessThan(30);
    setEdition('japandi');
    expect(partGrams(p)).toBeGreaterThanOrEqual(p.grams - 1);
  });
});

describe('Parts list', () => {
  it('Y-merge card (special): rim as a select field, direction = inlet (left/right) when inserting', () => {
    const g = GROUP_BY_ID.get('ymerge')!;
    expect(g.chip).toBe('special');
    expect(g.dims).toEqual(['rim']);
    expect(g.variants.map((v) => v.dims.rim)).toEqual(['60-50', '60-60', '50-40', '50-50', '40-40']);
    for (const v of g.variants) expect(v.opts.map((o) => [o.dir, o.lane])).toEqual([['left', 1], ['right', 0]]);
    expect(variantOf(Y('50-40'), false, 1)!.opt.dir).toBe('left');
    expect(variantOf(Y('50-40'), false, 0)!.opt.dir).toBe('right');
    expect(valueLabel('rim', '60-50', 'de')).toBe('60 → 50');
  });
});

describe('Chain', () => {
  it('lane 0: exit 16 mm right of the track, lane 1: 16 mm left', () => {
    for (const [lane, sgn] of [[0, -1], [1, 1]] as const) {
      const els = [...chain('StartSchale_60', 'Gerade120_60-60'), el('60-50', lane), ...chain('Gerade120_50-40', 'EndSchale_40')];
      const L = solveChain(els);
      expect(L.issues.filter((i) => i.level === 'error'), String(lane)).toEqual([]);
      const a = L.placed[1].exit!, y = L.placed[2];
      // travel direction +x (straight at the origin): exit 64 further on, offset 16 sideways (right = -y)
      const d = [a.n[0], a.n[1]], q = [-d[1], d[0]];
      const dx = y.exit!.p[0] - a.p[0], dy = y.exit!.p[1] - a.p[1];
      expect(dx * d[0] + dy * d[1]).toBeCloseTo(64, 3);
      expect(dx * q[0] + dy * q[1]).toBeCloseTo(16 * sgn, 3);
      expect(y.S).toBe(0);
      expect(L.freePorts.filter((f) => f.idx === 2).map((f) => f.kind)).toEqual(['lane']);
    }
  });
  it('on a higher level the Y stands on AdapterYMerge120 (vertical snap pin in the center)', () => {
    const els = [...chain('StartSchale_60', 'Gerade120_60-60'), el('60-60', 1), ...chain('Kippwippe_120-60_Links', 'Gerade120_60-50', 'Kurve90_50-40', 'EndSchale_40')];
    const L = solveChain(els);
    expect(L.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(L.placed[2].S).toBe(32);
    const ad = L.adapters.filter((a) => a.owner === 2);
    expect(ad.map((a) => a.part.id)).toEqual(['AdapterYMerge120_16mm']);
    expect(L.pins.some((j) => j.kind === 'tower' && j.b.startsWith('3. ' + Y('60-60')))).toBe(true);
  });
  it('link and JSON keep the lane (second inlet = "!")', () => {
    const els = [...chain('StartSchale_60', 'Gerade120_60-60'), el('60-60', 1), ...chain('Gerade120_60-50')];
    const s = encodeChain(els);
    expect(s).toContain('!');
    expect(decodeChain(s)!.elements[2]).toEqual({ part: Y('60-60'), lane: 1 });
  });
  it('a strand merges into the free inlet (connect assistant): ends there, snap pin, hint, no errors', () => {
    const els: ChainElement[] = [el('40-40')];
    const L0 = solveChain(els);
    const f = L0.freePorts.find((x) => x.kind === 'lane')!;
    expect(f.port).toBe(2);
    const res = findConnections(els, { kind: 'port', p: f.w.p, n: f.w.n, rimCode: 40 }, { maxParts: 10 });
    expect(res.length).toBeGreaterThan(0);
    const work = applyConnection(els, res[0]);
    const L = solveChain(work);
    expect(L.issues.filter((i) => i.level === 'error')).toEqual([]);
    const last = L.placed[L.placed.length - 1];
    expect(last.dock).toEqual({ idx: 0, port: 2 });
    expect(last.out).toBeNull();
    expect(L.issues.some((i) => i.code === 'merge' && i.idx[0] === last.idx && i.idx[1] === 0)).toBe(true);
    expect(L.freePorts.filter((x) => x.kind === 'lane')).toEqual([]);
    // joints: n-1 in the chain + 1 at the free inlet
    expect(L.pins.filter((j) => j.kind === 'joint').length).toBe(work.length - 1 + 1);
    expect(pinSum(L, 'joint')).toBe(work.length);
    // another part after it no longer fits (the strand has ended)
    expect(errs([...work, ...chain('Gerade120_40-40')]).length).toBeGreaterThan(0);
  });
});

describe('Demo flip-flop and Y-merge', () => {
  it('the flip-flop splits, the branch merges into the free inlet: no errors, all balls arrive, both below 0.8 m/s at the Y', () => {
    const els = demo('flipflop-ymerge');
    const L = solveChain(els);
    expect(L.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(L.strands.length).toBe(2);
    const yi = L.placed.findIndex((q) => q.part.id.startsWith('YMerge'));
    const feeder = L.placed.find((q) => q.dock)!;
    expect(feeder.dock).toEqual({ idx: yi, port: 2 });
    expect(feeder.strand).toBe(1);
    expect(L.issues.some((i) => i.code === 'merge')).toBe(true);
    const st = simulate(L, DEFAULT_SIM);
    expect(st.every((s) => s.status === 'ok')).toBe(true);
    expect(st[yi].vIn).toBeLessThan(800); expect(st[feeder.idx].vOut).toBeLessThan(800);
    expect(st[feeder.idx].vOut).toBeGreaterThan(0);
  });
  it('the ball from the feed is tracked beyond the Y: if it stops, the part reports it', () => {
    const L = solveChain(demo('flipflop-ymerge'));
    const yi = L.placed.findIndex((q) => q.part.id.startsWith('YMerge'));
    const feeder = L.placed.find((q) => q.dock)!;
    // rolling resistance 0.025: the main-strand ball makes it over the straight after the Y (~131 mm/s), the branch ball does not
    const st = simulate(L, { ...DEFAULT_SIM, crr: 0.025 });
    expect(st[yi + 1].vOut).toBeGreaterThan(100);                                   // shown: speed of its own strand
    expect(st[yi + 1].status).toBe('stop');
    expect(st[yi + 1].msgs.some((m) => m.startsWith(`Kugel aus dem Zulauf von ${feeder.idx + 1}.`))).toBe(true);
    expect(st[yi].status).toBe('ok');                                                // the Y itself: inlet limits ok
    // default rolling resistance: both balls arrive
    expect(simulate(L, DEFAULT_SIM).every((s) => s.status === 'ok')).toBe(true);
  });
});

describe('Physics', () => {
  const run = (r: string, v0: number) => {
    const L = solveChain([el(r)]);
    return simulate(L, { ...DEFAULT_SIM, v0 })[0];
  };
  it('flat: about 70 % of the inlet speed (simulation), less loss with a slope', () => {
    const flat = run('40-40', 500), down = run('60-50', 500);
    expect(flat.vOut / 500).toBeGreaterThan(0.55); expect(flat.vOut / 500).toBeLessThan(0.7);
    expect(down.vOut).toBeGreaterThan(flat.vOut);
    expect(flat.status).toBe('ok');
  });
  it('limits: marginal from 0.8 m/s, error above 1.2 m/s', () => {
    expect(run('40-40', 900).status).toBe('warn');
    expect(run('40-40', 1300).status).toBe('error');
  });
  it('if a strand merges too fast, its last part reports it', () => {
    const els: ChainElement[] = [el('40-40')];
    const f = solveChain(els).freePorts.find((x) => x.kind === 'lane')!;
    const res = findConnections(els, { kind: 'port', p: f.w.p, n: f.w.n, rimCode: 40 }, { maxParts: 10 });
    const L = solveChain(applyConnection(els, res[0]));
    const steps = simulate(L, { ...DEFAULT_SIM, v0: 2500 });
    const last = steps[L.placed.length - 1];
    expect(last.msgs.some((m) => /Y-Merge/.test(m))).toBe(true);
    expect(['warn', 'error']).toContain(last.status);
  });
});

describe('Footprint and BOM', () => {
  it('two arms + wedge: center and wings inside, corners beside the arms outside', () => {
    const p = part(Y('50-50'));
    const W = worldPieces(p, [1, 0, 0, 1], [0, 0], 0);
    expect(footprintPieces(p).length).toBe(23);
    for (const [x, y] of [[32, 0], [2, 0], [2, 26], [2, -26], [60, 10], [63, -10], [20, 20]]) expect(pointInside(W, x, y, 5), `${x},${y}`).toBe(true);
    for (const [x, y] of [[60, 25], [60, -25], [-1, 0], [65, 0], [40, 28]]) expect(pointInside(W, x, y, 5), `${x},${y}`).toBe(false);
  });
  it('BOM: the Y itself (no kit) and the snap pins', () => {
    const L = solveChain([...chain('StartSchale_60', 'Gerade120_60-60'), el('60-60'), ...chain('Gerade120_60-50')]);
    const rows = bom(L);
    expect(rows.find((r) => r.id === Y('60-60'))?.count).toBe(1);
    expect(rows.find((r) => r.id === 'Raststift_16mm')?.count).toBe(pinSum(L));
  });
});
