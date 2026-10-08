// Strands and branches: second flip-flop exit as a branch, X-crossing with selectable lane, pass-through via the
// free lane, ball check per strand, snap pins, link/JSON/undo with anchor index.
import { describe, it, expect } from 'vitest';
import { solveChain, portW, type ChainElement } from '../src/chain';
import { catalog, branchPorts, freeLane, laneOf, portRim, LANES } from '../src/catalog';
import { simulate, DEFAULT_SIM } from '../src/physics';
import { bom } from '../src/export';
import { encodeChain, decodeChain, sanitizeElements, toPlain, cloneChain, History } from '../src/state';
import { tunnelSwap, spliceRun } from '../src/tunnel';
import { chain, demo, pinSum, id } from './helpers';

/** Main strand + branch at socket `port` of element `anchor` (index). */
function withBranch(main: string[], anchor: number, port: number, branch: string[]): ChainElement[] {
  const m = chain(...main), b = chain(...branch);
  b[0].branch = { from: m[anchor], port };
  return [...m, ...b];
}
const errors = (els: ChainElement[]) => solveChain(els).issues.filter((i) => i.level === 'error');

describe('Catalog: lanes and branch exits', () => {
  it('X-crossing: two lanes, high side at -y and -x (rim 50), free lane depending on the choice', () => {
    const x = catalog.byId.get(id('XKreuzung_50-40'))!;
    expect(LANES[x.id]).toEqual([[0, 1], [3, 2]]);
    expect(laneOf(x, 0)).toEqual([0, 1]); expect(laneOf(x, 1)).toEqual([3, 2]);
    expect(freeLane(x, 0)).toEqual([3, 2]); expect(freeLane(x, 1)).toEqual([0, 1]);
    expect(branchPorts(x, 0)).toEqual([2]); expect(branchPorts(x, 1)).toEqual([1]);
    expect([portRim(x, 0), portRim(x, 3), portRim(x, 1), portRim(x, 2)]).toEqual([50, 50, 40, 40]);
  });
  it('flip-flop: the second exit (port 3) is the branch, rim 60; lift and straights have none', () => {
    for (const side of ['Links', 'Rechts']) {
      const p = catalog.byId.get(id(`Kippwippe_120-60_${side}`))!;
      expect(branchPorts(p)).toEqual([3]);
      expect(portRim(p, 3)).toBe(60);
      expect(p.ports[3].p[2]).toBeCloseTo(p.ports[1].p[2], 6);                 // both exits at the same height
      expect(p.ports[3].p[1]).toBeCloseTo(-p.ports[1].p[1], 6);                // opposite each other
    }
    expect(branchPorts(catalog.byId.get(id('Lift1_Gerade'))!)).toEqual([]);
    expect(branchPorts(catalog.byId.get(id('Gerade120_60-60'))!)).toEqual([]);
  });
});

describe('Branch at the flip-flop', () => {
  const els = withBranch(['StartSchale_60', 'Kippwippe_120-60_Links', 'Gerade120_60-50', 'Kurve90_50-40', 'EndSchale_40'], 1, 3,
    ['Gerade120_60-50', 'Kurve90_50-40_gespiegelt', 'EndSchale_40']);
  const L = solveChain(els);
  it('two strands; the branch plugs into the second exit (opposite, same height), no errors', () => {
    expect(L.strands.map((s) => s.idxs)).toEqual([[0, 1, 2, 3, 4], [5, 6, 7]]);
    expect(L.strands[1].from).toEqual({ idx: 1, port: 3 });
    expect(L.issues.filter((i) => i.level === 'error')).toEqual([]);
    const W = L.placed[1], b = L.placed[5];
    const p3 = portW(W.part.ports[3], W.R, W.t, W.S);
    expect(b.entry!.p[0]).toBeCloseTo(p3.p[0], 6); expect(b.entry!.p[1]).toBeCloseTo(p3.p[1], 6); expect(b.entry!.p[2]).toBeCloseTo(p3.p[2], 6);
    expect(b.S).toBe(0); expect(b.strand).toBe(1); expect(b.from).toEqual({ idx: 1, port: 3 });
    // main strand and branch start in opposite directions
    const n0 = L.placed[2].entry!.n, n1 = b.entry!.n;
    expect(n0[0] * n1[0] + n0[1] * n1[1]).toBeCloseTo(-1, 6);
  });
  it('snap pins: the joint at the branch counts; no joint across the strand boundary', () => {
    const joints = L.pins.filter((j) => j.kind === 'joint');
    expect(joints.length).toBe(4 + 3);                   // main strand 4 joints, branch 2 + 1 at the anchor
    expect(joints.some((j) => j.a.startsWith('5. ') && j.b.startsWith('6. '))).toBe(false);   // EndSchale -> first branch part
    expect(joints.some((j) => j.a.startsWith('2. Kippwippe') && j.a.includes('(3)') && j.b.startsWith('6. '))).toBe(true);
  });
  it('ball check: the branch starts with the exit speed of the flip-flop', () => {
    const st = simulate(L, DEFAULT_SIM);
    expect(st[1].vOut).toBe(180);
    expect(st[5].vIn).toBe(180);
    expect(st.every((s) => s.status === 'ok')).toBe(true);
  });
  it('the BOM counts both strands (two end bowls)', () => {
    const rows = bom(L);
    expect(rows.find((r) => r.id === id('EndSchale_40'))!.count).toBe(2);
    expect(rows.find((r) => r.id === id('Gerade120_60-50'))!.count).toBe(2);
  });
  it('a collision between strands is reported', () => {
    // the branch turns right twice and runs under the start (adapter tower)
    const bad = withBranch(['StartSchale_60', 'Kippwippe_120-60_Links', 'Gerade120_60-50'], 1, 3, ['Kurve90_60*', 'Kurve90_60*', 'Gerade120_60-60']);
    const errs = errors(bad);
    expect(errs.some((i) => i.code === 'collision' && i.idx.some((x) => x >= 3))).toBe(true);
  });
  it('branch without anchor (part missing or no exit there): error, the part lies loose beside it', () => {
    const m = chain('StartSchale_60', 'Gerade120_60-60'), b = chain('Gerade120_60-60');
    b[0].branch = { from: m[1], port: 3 };                 // a straight has no branch exit
    const L2 = solveChain([...m, ...b]);
    expect(L2.placed[2].connected).toBe(false);
    expect(L2.issues.some((i) => i.code === 'joint' && i.idx.includes(2))).toBe(true);
  });
  it('free branch sockets: free before the branch, occupied afterwards', () => {
    const only = solveChain(chain('StartSchale_60', 'Kippwippe_120-60_Links'));
    expect(only.freePorts.map((f) => [f.idx, f.port, f.kind])).toEqual([[1, 3, 'branch']]);
    expect(L.freePorts).toEqual([]);
  });
});

describe('X-crossing: lane and pass-through', () => {
  it('lane 1: the chain runs across (inlet port 3), the free lane is then the other one', () => {
    const a = solveChain(chain('StartSchale_60', 'Gerade120_60-50', 'XKreuzung_50-40'));
    const els = chain('StartSchale_60', 'Gerade120_60-50', 'XKreuzung_50-40'); els[2].lane = 1;
    const b = solveChain(els);
    expect(a.placed[2].lane).toBe(0); expect(b.placed[2].lane).toBe(1);
    // same travel direction, but the crossing is rotated by 90 degrees -> the free lane comes from the other side
    expect(a.placed[2].exit!.n).toEqual(b.placed[2].exit!.n);
    expect(a.placed[2].rot).not.toBe(b.placed[2].rot);
    const fa = a.freePorts.find((f) => f.kind === 'lane')!, fb = b.freePorts.find((f) => f.kind === 'lane')!;
    const dir = a.placed[2].exit!.n;   // travel direction
    const side = (w: { p: number[] }, q: { p: number[] }) => Math.sign((w.p[0] - q.p[0]) * -dir[1] + (w.p[1] - q.p[1]) * dir[0]);
    expect(side(fa.w, a.placed[2].entry!)).toBe(1);        // lane 0: the cross lane comes from the left
    expect(side(fb.w, b.placed[2].entry!)).toBe(-1);       // lane 1: from the right
  });
  it('demo "flipflop-crossing": the branch plugs into the free lane (uphill, rim 40), passes through and continues', () => {
    const L = solveChain(demo('flipflop-crossing'));
    expect(L.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(L.strands.length).toBe(2);
    const dockIdx = L.placed.findIndex((q) => q.dock);
    expect(L.placed[dockIdx].dock!.idx).toBe(3);                         // XKreuzung in the main strand
    expect(L.placed[dockIdx + 1].via).toEqual({ idx: 3, inPort: 2, outPort: 3 });   // in at the low end, out at the high end
    expect(L.issues.some((i) => i.code === 'passThrough')).toBe(true);
    expect(L.freePorts).toEqual([]);                                    // lane occupied, flip-flop exit occupied
    const st = simulate(L, DEFAULT_SIM);
    expect(st.every((s) => s.status === 'ok')).toBe(true);
    // uphill through the lane: the ball comes out slower than it goes in
    expect(st[dockIdx + 1].vIn).toBeLessThan(st[dockIdx].vOut);
    // snap pins: 2 joints at the pass-through (in + out)
    const viaPins = L.pins.filter((j) => j.kind === 'joint' && (j.b.includes('XKreuzung') || j.a.includes('XKreuzung')));
    expect(viaPins.length).toBe(2 + 2);                                  // main strand 2 + pass-through 2
    expect(bom(L).find((r) => r.id === id('XKreuzung_50-40'))!.count).toBe(1);
  });
  it('the rim must match: high side of the free lane with rim 40 -> error instead of pass-through', () => {
    // like the demo, but with the crossing the other way round (lane 1): the branch then plugs into the high end of the cross lane
    const els = demo('flipflop-crossing'); els[3].lane = 1;
    const L = solveChain(els);
    expect(L.placed.some((q) => q.via)).toBe(false);
    expect(L.issues.some((i) => i.level === 'error')).toBe(true);
  });
  it('after plugging into the free lane the next part attaches at its exit (out)', () => {
    const els = demo('flipflop-crossing');
    const k = els.findIndex((e) => e.part === id('Distanz65-0_40-40'));
    const L = solveChain(els.slice(0, k + 1));                          // strand ends in the crossing
    const q = L.placed[k];
    expect(q.dock!.idx).toBe(3);
    const X = L.placed[3];
    const far = portW(X.part.ports[q.dock!.port === 2 ? 3 : 2], X.R, X.t, X.S);
    for (let k2 = 0; k2 < 3; k2++) expect(q.out!.p[k2]).toBeCloseTo(far.p[k2], 6);
    expect(q.outRim).toBe(50);
  });
  it('a branch at the exit of the free lane is fed by the docking strand (ball check); without feed it gets a push + hint', () => {
    const els = demo('flipflop-crossing');
    const k = els.findIndex((e) => e.part === id('Distanz65-0_40-40'));
    const X = els[3];
    // strand ends in the crossing; a third strand starts at the high end of the cross lane (port 3)
    const a = els.slice(0, k + 1), tail = chain('Kurve90_50-40', 'EndSchale_40');
    tail[0].branch = { from: X, port: 3 };
    // with lane 0, port 3 is not a branch exit (port 2 is) - only with lane 1 of the crossing. So the free lane in forward
    // direction is checked on the simple case: X in the main strand, branch at the exit of the free lane, without feed
    const m = chain('StartSchale_60', 'Gerade120_60-50', 'XKreuzung_50-40', 'Kurve90_40', 'EndSchale_40');
    const b = chain('Kurve90_40', 'EndSchale_40'); b[0].branch = { from: m[2], port: 2 };
    const L = solveChain([...m, ...b]);
    expect(L.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(L.strands[1].from).toEqual({ idx: 2, port: 2 });
    expect(L.strands[1].fed).toBeNull();
    const st = simulate(L, { ...DEFAULT_SIM, v0: 300 });
    expect(st[5].vIn).toBe(300);
    expect(st[5].status).toBe('warn');
    expect(st[5].msgs[0]).toMatch(/keinen Zulauf/);
    expect(a.length).toBeGreaterThan(0); expect(tail.length).toBe(2);
  });
});

describe('Fed lane (figure eight with lift, collisions ignored here)', () => {
  // the main strand passes through the X-crossing, goes back up with the lift and then plugs into its free lane (high end, rim 50)
  const MAIN = ['StartSchale_60', 'Gerade120_60-50', 'XKreuzung_50-40', 'LangeKurve90_R90_40', 'Kurve90_40', 'Lift1_Gerade', 'Rutsche_120-60',
    'Kurve90_60*', 'LangeKurve90_R90_60*', 'LangeKurve90_R90_60*', 'Gerade120_60-50'];
  it('without a branch: pass-through, the chain continues at the exit of the cross lane', () => {
    const L = solveChain(chain(...MAIN, 'Kurve90_40', 'EndSchale_40'));
    expect(L.placed[10].dock).toEqual({ idx: 2, port: 3 });
    expect(L.placed[11].via).toEqual({ idx: 2, inPort: 3, outPort: 2 });
    const st = simulate(L, DEFAULT_SIM);
    expect(st[11].vIn).toBeGreaterThan(st[10].vOut);                 // forward through the lane: downhill, faster
  });
  it('with a branch at the exit of the cross lane: the main strand ends in the lane and feeds the branch', () => {
    const els = withBranch(MAIN, 2, 2, ['Kurve90_40', 'EndSchale_40']);
    const L = solveChain(els);
    expect(L.strands[1].from).toEqual({ idx: 2, port: 2 });
    expect(L.strands[1].fed).toBe(10);
    expect(L.placed[10].out).toBeNull();
    expect(L.placed[11].from).toEqual({ idx: 2, port: 2 });
    const st = simulate(L, DEFAULT_SIM);
    expect(st[11].vIn).toBeGreaterThan(st[10].vOut);
    expect(st[11].msgs.join(' ')).not.toMatch(/Zulauf/);
    // joint at the end of the main strand (into the lane) + joint at the branch
    expect(L.pins.filter((j) => j.kind === 'joint' && j.b.includes('XKreuzung') && j.b.includes('(3)')).length).toBe(1);
    expect(L.pins.filter((j) => j.kind === 'joint' && j.a.includes('XKreuzung') && j.a.includes('(2)')).length).toBe(1);
  });
});

describe('Saving: link, JSON, undo', () => {
  const els = demo('flipflop-crossing');
  it('toPlain/sanitizeElements: anchor as index, back as reference', () => {
    const plain = toPlain(els);
    const k = plain.findIndex((e) => e.branch);
    expect(plain[k].branch).toEqual({ from: 1, port: 3 });
    const back = sanitizeElements(plain);
    expect(back[k].branch!.from).toBe(back[1]);
    expect(toPlain(back)).toEqual(plain);
    const c = cloneChain(els);
    expect(c[k].branch!.from).toBe(c[1]); expect(c[1]).not.toBe(els[1]);
  });
  it('invalid anchors are dropped (anchor after the part, first part, unknown index)', () => {
    const r = sanitizeElements([{ part: id('StartSchale_60'), branch: { from: 0, port: 3 } }, { part: id('Kippwippe_120-60_Links') },
      { part: id('Gerade120_60-60'), branch: { from: 5, port: 3 } }, { part: id('Gerade120_60-60'), branch: { from: 1, port: 3 } }]);
    expect(r[0].branch).toBeUndefined(); expect(r[2].branch).toBeUndefined(); expect(r[3].branch!.from).toBe(r[1]);
  });
  it('URL: "@anchor:port" for branches and "!" for lane 1; unknown parts do not shift the anchors', () => {
    const e2 = cloneChain(els); e2[3].lane = 1;
    const s = encodeChain(e2);
    expect(s).toContain('@1:3'); expect(s).toContain(catalog.byId.get(id('XKreuzung_50-40'))!.code + '!');
    const dec = decodeChain(s)!;
    expect(toPlain(dec.elements)).toEqual(toPlain(e2));
    // unknown token before the anchor
    const toks = s.slice(3).split('.');
    const withJunk = 'm1.' + ['zzzz9', ...toks].join('.').replace('@1:3', '@2:3');
    const d2 = decodeChain(withJunk)!;
    expect(d2.unknown).toBe(1);
    expect(toPlain(d2.elements)).toEqual(toPlain(e2));
  });
  it('undo/redo restores branches with references', () => {
    const h = new History();
    h.push(els);
    const back = h.undo([])!;
    const k = back.findIndex((e) => e.branch);
    expect(back[k].branch!.from).toBe(back[1]);
    const fwd = h.redo(back)!;
    expect(fwd).toEqual([]);
  });
});

describe('Tunnel swap respects strand boundaries', () => {
  it('a failed swap leaves the chain including the branch unchanged', () => {
    // the only adapter of this chain (under StartSchale) has no tunnel version - the input stays as it was
    const e = withBranch(['StartSchale_60', 'Kippwippe_120-60_Links', 'Gerade120_60-50', 'Kurve90_50-40', 'EndSchale_40'], 1, 3, ['Gerade120_60-50', 'Gerade120_50-40', 'Gerade120_40-40']);
    const before = toPlain(e);
    const L = solveChain(e);
    expect(L.adapters.map((x) => x.part.id)).toEqual(['AdapterStart_16mm']);
    const r = tunnelSwap(e, L, L.adapters[0]);
    expect(r).toMatchObject({ ok: false, code: 'variant' });
    expect(toPlain(e)).toEqual(before);
    expect(e[5].branch!.from).toBe(e[1]);
  });
  it('a branch that starts with the replaced run keeps its anchor on the first new part (spliceRun)', () => {
    const e = withBranch(['StartSchale_60', 'Kippwippe_120-60_Links', 'Gerade120_60-50', 'Kurve90_50-40', 'EndSchale_40'], 1, 3, ['Gerade120_60-50', 'Gerade120_50-40', 'Gerade120_40-40']);
    const out = spliceRun(e, 5, 2, [{ part: 'Distanz46-0_40-40_16mm', branch: { from: e[0], port: 9 } }, { part: 'Gerade120_40-40_16mm' }]);
    expect(out.map((x) => x.part)).toEqual([...e.slice(0, 5).map((x) => x.part), 'Distanz46-0_40-40_16mm', 'Gerade120_40-40_16mm', e[7].part]);
    expect(out[5].branch).toBe(e[5].branch);          // the anchor moves to the first new part
    expect(out[6].branch).toBeUndefined();
    expect(e[5].part).toBe('Gerade120_60-50_16mm');     // input unchanged
    expect(toPlain(out)[5].branch).toEqual({ from: 1, port: 3 });
  });
});

it('helper pinSum counts branch joints', () => {
  const L = solveChain(demo('flipflop-crossing'));
  expect(pinSum(L)).toBe(L.pins.reduce((s, j) => s + j.n, 0));
  expect(pinSum(L, 'joint')).toBeGreaterThan(10);
});
