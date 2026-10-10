// Swap an adapter for its tunnel version: a straight adapter (AdapterGerade120/95) under which a rim-40 straight of the
// lower level wants to pass becomes an AdapterTunnelQuer. The cross tunnel is a PART OF THE LOWER TRACK (32 mm lane
// across the adapter axis = Gerade60), so the swap is chain surgery: the crossing straight run of the lower level is
// split into spacers + tunnel + spacers so that the tunnel sits exactly under the adapter. The solver then replaces the
// adapter itself automatically (carrier rule).
// Every end is a socket, so the cross tunnel can be mounted in both directions (reversed); the offset V16 variant thus
// has two lane positions (16 / 48 mm from the adapter start), and so does the 95 under the Gerade100 (24 mm from the
// start or end of the Gerade100). Fillers: straights 120/100/80/60 and the spacers 24.5 / 34.7 (channel), 50.7 (rail).
import { catalog, entryExit, requiredFeedRim, PORT_Z, type Part } from './catalog';
import { apply, rotM, solveChain, type ChainElement, type Layout, type Placed, type PlacedAdapter, type Vec2 } from './chain';
import { piecesCollide } from './footprint';
import { t, tf, partName } from './i18n';

/** Tunnel variants per adapter: lane position (x from the adapter origin, along its axis). */
const VARIANTS: Record<string, { id: string; x: number }[]> = {
  AdapterGerade120_16mm: [{ id: 'AdapterTunnelQuer120_40-40_Q32_16mm', x: 32 }, { id: 'AdapterTunnelQuer120_40-40_Q32_V16_16mm', x: 16 }],
  AdapterGerade95_16mm: [{ id: 'AdapterTunnelQuer95_40-40_Q32_16mm', x: 22.667 }],
  // the Gerade100 stands on AdapterGerade100: the 95 cross tunnel replaces it, lane 24 mm from the start of the
  // Gerade100 (tunnel centred, 2.7 mm shorter than the adapter)
  AdapterGerade100_16mm: [{ id: 'AdapterTunnelQuer95_40-40_Q32_16mm', x: 24.0 }],
};
/** Filler pieces per system and rim (straight, same rim in/out), length = footprint. With the straights 100/80/60 the
 *  swap hits almost any length on the 8 mm grid with few pieces. */
const FILL: Record<string, Record<number, string[]>> = {
  channel: {
    40: ['Gerade120_40-40_16mm', 'Gerade100_40-40_16mm', 'Gerade80_40-40_16mm', 'Gerade60_40-40_16mm', 'Distanz65-0_40-40_16mm', 'Distanz46-0_40-40_16mm',
      'Distanz45-0_40-40_16mm'],
    50: ['Gerade120_50-50_16mm', 'Gerade100_50-50_16mm', 'Gerade80_50-50_16mm', 'Gerade60_50-50_16mm'],
    60: ['Gerade120_60-60_16mm', 'Gerade100_60-60_16mm', 'Gerade80_60-60_16mm', 'Gerade60_60-60_16mm'],
  },
  rail: {
    40: ['SchieneGerade120_40-40_16mm', 'SchieneGerade100_40-40_16mm', 'SchieneGerade80_40-40_16mm', 'SchieneGerade60_40-40_16mm', 'SchieneDistanz95-0_40-40_16mm'],
    50: ['SchieneGerade120_50-50_16mm', 'SchieneGerade100_50-50_16mm', 'SchieneGerade80_50-50_16mm', 'SchieneGerade60_50-50_16mm'],
    60: ['SchieneGerade120_60-60_16mm', 'SchieneGerade100_60-60_16mm', 'SchieneGerade80_60-60_16mm', 'SchieneGerade60_60-60_16mm'],
  },
};
/** Ids of all filler pieces (for tests and the help). */
export const FILL_IDS: string[] = [...new Set(Object.values(FILL).flatMap((r) => Object.values(r).flat()))];
const TOL = 0.6;           // mm - the solver accepts a carrier with < 0.8 mm footprint deviation
/** Cross tunnel lane length = adapter width across the adapter axis (Q32: 32 mm). */
function tunnelLen(id: string): number { const p = catalog.byId.get(id); return p ? p.foot[3] - p.foot[1] : 32; }
/** Lane positions of the tunnel variants per adapter (for target marks and hints): x from the adapter start, normal and reversed. */
export function tunnelLanes(adapterType: string): { id: string; x: number[] }[] {
  return (VARIANTS[adapterType] ?? []).map((v) => {
    const La = footLen(catalog.byId.get(adapterType) ?? catalog.byId.get(v.id)!);
    const xs = [v.x, La - v.x].filter((x, i, a) => a.findIndex((y) => Math.abs(y - x) < 0.01) === i);
    return { id: v.id, x: xs };
  });
}
export function hasTunnelVariant(adapterType: string): boolean { return !!VARIANTS[adapterType]; }

export interface TunnelResult { ok: true; elements: ChainElement[]; tunnel: string; replaced: number; inserted: number; text: string; shift?: string }
export interface TunnelFail { ok: false; code: 'variant' | 'nothing' | 'notStraight' | 'notAcross' | 'noFit' | 'edge' | 'spacers'; text: string }

function footLen(p: Part): number { return p.foot[2] - p.foot[0]; }
/** Replaces the run i0..i0+n-1; if a branch starts there, it then starts at the first new part. */
export function spliceRun(els: ChainElement[], i0: number, n: number, newEls: ChainElement[]): ChainElement[] {
  const br = els[i0]?.branch;
  const repl = newEls.map((e, k) => {
    if (k === 0 && br) return { ...e, branch: br };
    if (e.branch) { const c = { ...e }; delete c.branch; return c; }
    return e;
  });
  const out = els.slice(); out.splice(i0, n, ...repl); return out;
}
function isStraight40(p: Part): boolean { return isStraightSameRim(p) && p.rimIn === 40; }
/** Straight piece with the same rim in/out - can be lengthened/shortened with spacers. */
function isStraightSameRim(p: Part): boolean {
  return p.turn === 0 && p.rimIn != null && p.rimIn === p.rimOut && (p.family === 'straight' || p.family === 'spacer')
    && (p.system === 'channel' || p.system === 'rail') && !!FILL[p.system]?.[p.rimIn];
}
function dir(q: Placed): Vec2 | null {
  if (!q.entry || !q.exit) return null;
  const d: Vec2 = [q.exit.p[0] - q.entry.p[0], q.exit.p[1] - q.entry.p[1]];
  const n = Math.hypot(d[0], d[1]); if (n < 1e-6) return null;
  return [d[0] / n, d[1] / n];
}

/** Fewest pieces that hit target (mm) within +-TOL; null if impossible. The 16 mm lengths are fractional
 *  (64 / 34.667 / 24.533), hence all combinations instead of coin change on whole millimetres. */
export function fillLength(target: number, system: 'channel' | 'rail', rim = 40): string[] | null {
  if (target < -TOL) return null;
  if (target <= TOL) return [];
  const ids = FILL[system]?.[rim]; if (!ids) return null;
  const lens = ids.map((id) => footLen(catalog.byId.get(id)!));
  let best: number[] | null = null, bestErr = Infinity;
  const counts = new Array(ids.length).fill(0);
  const rec = (i: number, sum: number) => {
    if (sum > target + TOL) return;
    if (i === ids.length) {
      const err = Math.abs(sum - target), n = counts.reduce((a, b) => a + b, 0);
      if (err <= TOL && (!best || n < best.reduce((a, b) => a + b, 0) || (n === best.reduce((a, b) => a + b, 0) && err < bestErr))) { best = counts.slice(); bestErr = err; }
      return;
    }
    for (let c = 0; sum + c * lens[i] <= target + TOL; c++) { counts[i] = c; rec(i + 1, sum + c * lens[i]); }
    counts[i] = 0;
  };
  rec(0, 0);
  if (!best) return null;
  const out: string[] = [];
  (best as number[]).forEach((c, i) => { for (let k = 0; k < c; k++) out.push(ids[i]); });
  return out;
}

/** Adapter axis in world coordinates: origin and direction of the local x axis, length. */
function adapterAxis(a: PlacedAdapter): { o: Vec2; u: Vec2; La: number } {
  return { o: apply(a.R, a.t, [a.part.foot[0], 0]), u: apply(a.R, [0, 0], [1, 0]), La: footLen(a.part) };
}
/** All lane positions of the tunnel variants (each mounted normally and reversed), measured along the adapter axis
 *  from its origin, for a lower track running in direction v. */
function laneOptions(a: PlacedAdapter, v: Vec2): { id: string; rev: boolean; pos: number }[] {
  const { u, La } = adapterAxis(a);
  const out: { id: string; rev: boolean; pos: number }[] = [];
  for (const vr of VARIANTS[a.spec.type] ?? []) {
    const tun = catalog.byId.get(vr.id); if (!tun) continue;
    for (const rev of [false, true]) {
      const { entry } = entryExit(tun, rev);
      if (!entry) continue;
      const a0 = Math.atan2(entry.n[1], entry.n[0]), a1 = Math.atan2(-v[1], -v[0]);
      const R = rotM(Math.round(((a1 - a0) * 180) / Math.PI / 90) * 90);
      const w = apply(R, [0, 0], [1, 0]);
      const pos = w[0] * u[0] + w[1] * u[1] > 0 ? vr.x : La - vr.x;
      if (!out.some((o) => o.id === vr.id && Math.abs(o.pos - pos) < 0.01)) out.push({ id: vr.id, rev, pos });
    }
  }
  return out;
}

/** Lanes of a cross tunnel not yet built in under adapter a: per tunnel variant, mounting direction and side, the entry
 *  socket in world space (p at base + PORT_Z, n pointing out of the tunnel), the rim the approach must deliver, and the
 *  lane position along the adapter (mm from its origin). With exactly this socket as target followed by the tunnel
 *  element {part: id, reversed: rev}, the tunnel replaces the adapter (chain.ts: carrier with the same centre). */
export function tunnelLaneTargets(a: PlacedAdapter): { id: string; rev: boolean; pos: number; p: [number, number, number]; n: [number, number, number]; rim: number | null; mid: Vec2 }[] {
  if (!VARIANTS[a.spec.type]) return [];
  const { o, u } = adapterAxis(a);
  const w: Vec2 = [-u[1], u[0]];
  const out: ReturnType<typeof tunnelLaneTargets> = [];
  for (const s of [1, -1]) {
    const v: Vec2 = [w[0] * s, w[1] * s];          // running direction through the tunnel
    for (const op of laneOptions(a, v)) {
      const tun = catalog.byId.get(op.id); if (!tun) continue;
      const half = tunnelLen(op.id) / 2;
      const mid: Vec2 = [o[0] + u[0] * op.pos, o[1] + u[1] * op.pos];
      out.push({ id: op.id, rev: op.rev, pos: op.pos, mid, rim: requiredFeedRim(tun, op.rev),
        p: [mid[0] - v[0] * half, mid[1] - v[1] * half, a.z + PORT_Z], n: [-v[0], -v[1], 0] });
    }
  }
  return out;
}

/** What the swap would yield for this adapter (without changing the chain). */
export function tunnelSwap(elements: ChainElement[], layout: Layout, a: PlacedAdapter): TunnelResult | TunnelFail {
  if (!VARIANTS[a.spec.type]) return { ok: false, code: 'variant', text: tf('tunnelNoVariant', { type: partName(a.part) }) };
  const { o, u } = adapterAxis(a);
  // crossing parts of the lower level (same base level as the adapter slot)
  const hits = layout.placed.filter((q) => q.connected && q.idx !== a.owner && Math.abs(q.S - a.z) < 0.01 && piecesCollide(q.pieces, a.pieces, 0.4) > 0);
  if (!hits.length) return { ok: false, code: 'nothing', text: tf('tunnelNothingCrosses', { z: a.z }) };
  const bad = hits.find((q) => !isStraight40(q.part));
  if (bad) return { ok: false, code: 'notStraight', text: tf('tunnelNotStraight', { n: bad.idx + 1, name: partName(bad.part) }) };
  const v = dir(hits[0]);
  if (!v || Math.abs(u[0] * v[0] + u[1] * v[1]) > 0.01) return { ok: false, code: 'notAcross', text: tf('tunnelNotAcross', { n: hits[0].idx + 1, name: partName(hits[0].part) }) };
  // the straight run around the hits: collinear rim-40 straights on the same level
  const online = (q: Placed) => {
    if (!q.connected || q.strand !== hits[0].strand || Math.abs(q.S - a.z) > 0.01 || !isStraight40(q.part) || !q.entry) return false;
    const d = dir(q); if (!d || Math.abs(d[0] * v[0] + d[1] * v[1]) < 0.999) return false;
    const off = (q.entry.p[0] - hits[0].entry!.p[0]) * -v[1] + (q.entry.p[1] - hits[0].entry!.p[1]) * v[0];
    return Math.abs(off) < 0.4;
  };
  let i0 = hits[0].idx, i1 = hits[0].idx;
  // strand limits: the run ends at the start of a strand (branch) and at a pass-through
  while (i0 > 0 && !layout.placed[i0].from && !layout.placed[i0].via && online(layout.placed[i0 - 1])) i0--;
  while (i1 + 1 < layout.placed.length && !layout.placed[i1 + 1].via && online(layout.placed[i1 + 1])) i1++;
  if (hits.some((q) => q.idx < i0 || q.idx > i1)) return { ok: false, code: 'notStraight', text: tf('tunnelNotStraight', { n: hits[0].idx + 1, name: partName(hits[0].part) }) };
  const run = layout.placed.slice(i0, i1 + 1);
  const P0 = run[0].entry!.p; const Lrun = run.reduce((s, q) => s + footLen(q.part), 0);
  // crossing: position of the track axis along the adapter (c, from the adapter origin) and of the adapter along the
  // track (dMid, from the run start)
  const c = (P0[0] - o[0]) * u[0] + (P0[1] - o[1]) * u[1];
  // dMid: position of the adapter centre line along the track (the cross tunnel is 32 wide, symmetric about its axis)
  const dMid = (o[0] - P0[0]) * v[0] + (o[1] - P0[1]) * v[1];
  const options = laneOptions(a, v).map((op) => ({ ...op, err: Math.abs(op.pos - c) })).sort((x, y) => x.err - y.err);
  const pickV = options[0];
  if (!pickV || pickV.err > TOL) {
    const list = options.map((op) => `${partName(catalog.byId.get(op.id)!)}${op.rev ? ' ⇄' : ''} (${op.pos.toFixed(1)} mm)`).join(', ');
    return { ok: false, code: 'noFit', text: tf('tunnelNoFit', { c: c.toFixed(1), list }) };
  }
  const TL = tunnelLen(pickV.id);
  const aLen = dMid - TL / 2, bLen = Lrun - dMid - TL / 2;
  if (aLen < -TOL || bLen < -TOL) return { ok: false, code: 'edge', text: tf('tunnelAtEdge', { d: dMid.toFixed(0), L: Lrun.toFixed(0) }) };
  const system: 'channel' | 'rail' = run.every((q) => q.part.system === 'rail') ? 'rail' : 'channel';
  const fillA = fillLength(aLen, system);
  if (!fillA) return { ok: false, code: 'spacers', text: tf('tunnelNoSpacers', { a: aLen.toFixed(1), b: bLen.toFixed(1) }) };
  const tunEl: ChainElement = pickV.rev ? { part: pickV.id, reversed: true } : { part: pickV.id };
  // After the tunnel: fill exactly if possible. The 16 mm spacers are coarse (24.5 / 34.7 / 50.7), otherwise take the
  // nearest length; the rest of the track then shifts by the difference and is re-checked (no new errors).
  let fillB = fillLength(bLen, system), shiftB = 0;
  if (!fillB) {
    const near = nearestFill(bLen, system);
    if (near) {
      const test = spliceRun(elements, i0, i1 - i0 + 1, [...fillA.map((id) => ({ part: id })), tunEl, ...near.ids.map((id) => ({ part: id }))]);
      const before = layout.issues.filter((i) => i.level === 'error' && i.code !== 'collision').length;
      const L2 = solveChain(test);
      if (L2.issues.filter((i) => i.level === 'error').length <= before) { fillB = near.ids; shiftB = near.len - bLen; }
    }
  }
  if (!fillB) return { ok: false, code: 'spacers', text: tf('tunnelNoSpacers', { a: aLen.toFixed(1), b: bLen.toFixed(1) }) };
  const newEls: ChainElement[] = [...fillA.map((id) => ({ part: id })), tunEl, ...fillB.map((id) => ({ part: id }))];
  const out = spliceRun(elements, i0, i1 - i0 + 1, newEls);
  const txt = tf('tunnelDone', { tunnel: partName(catalog.byId.get(pickV.id)!), n: i1 - i0 + 1, m: newEls.length,
                                 a: fillA.map((id) => partName(catalog.byId.get(id)!)).join(' + ') || '–', b: fillB.map((id) => partName(catalog.byId.get(id)!)).join(' + ') || '–' });
  return { ok: true, elements: out, tunnel: pickV.id, replaced: i1 - i0 + 1, inserted: newEls.length,
           text: Math.abs(shiftB) > TOL ? txt + ' ' + tf('tunnelShiftAfter', { mm: (shiftB > 0 ? '+' : '') + shiftB.toFixed(1) }) : txt };
}

/** Nearest length reachable with the filler pieces (up to +-40 mm off) - for the end of a run. */
function nearestFill(target: number, system: 'channel' | 'rail', rim = 40): { ids: string[]; len: number } | null {
  for (let d = 0; d <= 40; d += 0.5) {
    const hits: { ids: string[]; len: number }[] = [];
    for (const s of [target - d, target + d]) {
      if (s < -TOL) continue;
      const f = fillLength(s, system, rim);
      if (f) hits.push({ ids: f, len: f.reduce((acc, id) => acc + footLen(catalog.byId.get(id)!), 0) });
    }
    if (hits.length) return hits.sort((x, y) => Math.abs(x.len - target) - Math.abs(y.len - target))[0];
  }
  return null;
}

// ---------------------------------------------------------------- Auto mode: shift the lower (or upper) run
/** Straight run of the chain (same rim, one direction) on one level: indices, direction, length, rim, system. */
interface Segment { i0: number; i1: number; e: Vec2; L: number; rim: number; system: 'channel' | 'rail' }

function segmentsUpstream(layout: Layout, fromIdx: number, level: number): Segment[] {
  const segs: Segment[] = [];
  let i = fromIdx;
  while (i >= 0) {
    const q = layout.placed[i];
    if (!q.connected || Math.abs(q.S - level) > 0.01) break;      // other level: stop (limits side effects)
    if (q.strand !== layout.placed[fromIdx].strand) break;        // other strand: stop
    if (!isStraightSameRim(q.part) || !dir(q)) { if (q.via || q.from) break; i--; continue; }
    const e = dir(q)!, rim = q.part.rimIn!, system = q.part.system as 'channel' | 'rail';
    let j = i;
    while (j - 1 >= 0) {
      const r = layout.placed[j - 1]; const d = r.connected && isStraightSameRim(r.part) ? dir(r) : null;
      if (!d || r.strand !== q.strand || layout.placed[j].from || layout.placed[j].via || Math.abs(r.S - level) > 0.01 || r.part.rimIn !== rim || r.part.system !== system || d[0] * e[0] + d[1] * e[1] < 0.999) break;
      j--;
    }
    const L = layout.placed.slice(j, i + 1).reduce((acc, r) => acc + footLen(r.part), 0);
    segs.push({ i0: j, i1: i, e, L, rim, system });
    if (layout.placed[j].via || layout.placed[j].from) break;     // before it: X crossing or anchor - do not shift
    i = j - 1;
  }
  return segs;
}

/** Makes the segment s mm longer (s may be negative): first add/remove spacers, otherwise refill it completely. Returns
 *  the segment's new part list or null. */
function resizeSegment(elements: ChainElement[], seg: Segment, s: number): ChainElement[] | null {
  const cur = elements.slice(seg.i0, seg.i1 + 1);
  if (Math.abs(s) <= TOL) return cur;
  if (s > 0) {
    const add = fillLength(s, seg.system, seg.rim);
    if (add) return [...add.map((id) => ({ part: id })), ...cur];
    // no piece for exactly s (e.g. 5.3 or 21.3 mm): refill the whole run (often possible with the straights 100/80/60)
    const refill = fillLength(seg.L + s, seg.system, seg.rim);
    return refill ? refill.map((id) => ({ part: id })) : null;
  }
  // shorten: remove a subset of the existing spacers whose sum matches |s|
  const spacers = cur.map((el, k) => ({ k, L: footLen(catalog.byId.get(el.part)!), isSpacer: catalog.byId.get(el.part)!.family === 'spacer' })).filter((x) => x.isSpacer);
  let best: number[] | null = null;
  for (let mask = 1; mask < 1 << spacers.length && spacers.length <= 12; mask++) {
    let sum = 0; const ks: number[] = [];
    spacers.forEach((d, b) => { if (mask & (1 << b)) { sum += d.L; ks.push(d.k); } });
    if (Math.abs(sum + s) <= TOL && (!best || ks.length < best.length)) best = ks;
  }
  if (best) return cur.filter((_, k) => !best!.includes(k));
  const refill = fillLength(seg.L + s, seg.system, seg.rim);
  return refill ? refill.map((id) => ({ part: id })) : null;
}

/** Tunnel swap with auto mode: if the crossing does not hit a tunnel lane, the lower run (preferred) or the upper part
 *  is shifted with spacers until it does - then the normal swap. */
export function tunnelAuto(elements: ChainElement[], layout: Layout, a: PlacedAdapter, solve: (els: ChainElement[]) => Layout): TunnelResult | TunnelFail {
  const direct = tunnelSwap(elements, layout, a);
  if (direct.ok || direct.code !== 'noFit') return direct;
  const g = crossingGeometry(layout, a); if (!g) return direct;
  const { c, lanes, u, i0 } = g;
  const targets = lanes.map((ct) => ct - c);    // required shift of c
  const errorsBefore = layout.issues.filter((i) => i.level === 'error').length;
  const ownerEl = elements[a.owner];
  type Cand = { els: ChainElement[]; pieces: number; label: string; mm: number };
  const cands: Cand[] = [];
  const tryCand = (segEls: ChainElement[] | null, seg: Segment, label: string, mm: number) => {
    if (!segEls) return;
    const els = spliceRun(elements, seg.i0, seg.i1 - seg.i0 + 1, segEls);
    cands.push({ els, pieces: Math.abs(segEls.length - (seg.i1 - seg.i0 + 1)), label, mm });
  };
  // (1) lower level: nearest straight run along the adapter axis before the crossing; +s there shifts the crossing by s*(e.u)
  for (const seg of segmentsUpstream(layout, i0 - 1, a.z).filter((sg) => Math.abs(sg.e[0] * u[0] + sg.e[1] * u[1]) > 0.99).slice(0, 2)) {
    const eu = seg.e[0] * u[0] + seg.e[1] * u[1];
    for (const dc of targets) tryCand(resizeSegment(elements, seg, dc / eu), seg, `${seg.i0 + 1}..${seg.i1 + 1}`, dc / eu);
  }
  // (2) upper level: shift the part above the adapter along its axis (spacer before it): c changes by -s*(e.u)
  const q = layout.placed[a.owner]; const eo = dir(q);
  if (eo && isStraightSameRim(q.part) && Math.abs(eo[0] * u[0] + eo[1] * u[1]) > 0.99) {
    const segs = segmentsUpstream(layout, a.owner, q.S);
    const seg = segs[0];
    if (seg && seg.i1 === a.owner) {
      const eu = eo[0] * u[0] + eo[1] * u[1];
      for (const dc of targets) tryCand(resizeSegment(elements, seg, -dc / eu), seg, `${seg.i0 + 1}..${seg.i1 + 1}`, -dc / eu);
    }
  }
  // evaluate candidates: re-solve, find the same adapter slot, swap, check the error count
  let best: (TunnelResult & { score: number }) | null = null;
  for (const cd of cands) {
    const L2 = solve(cd.els);
    const ownerIdx = cd.els.indexOf(ownerEl); if (ownerIdx < 0) continue;
    const a2 = L2.adapters.find((x) => x.owner === ownerIdx && x.slot === a.slot); if (!a2) continue;
    const r = tunnelSwap(cd.els, L2, a2); if (!r.ok) continue;
    const L3 = solve(r.elements);
    const errorsAfter = L3.issues.filter((i) => i.level === 'error').length;
    if (errorsAfter >= errorsBefore) continue;                              // fixed nothing or broke something else
    const score = cd.pieces * 10 + r.inserted + errorsAfter * 100;
    if (!best || score < best.score) {
      const shift = tf('tunnelShift', { seg: cd.label, mm: (cd.mm > 0 ? '+' : '') + cd.mm.toFixed(0) });
      best = { ...r, score, shift, text: shift + ' ' + r.text };
    }
  }
  return best ?? { ok: false, code: 'noFit', text: direct.text + ' ' + t('tunnelAutoFail') };
}

/** Crossing geometry as in tunnelSwap (c, lane positions, u, run start i0) - for auto mode. */
function crossingGeometry(layout: Layout, a: PlacedAdapter): { c: number; lanes: number[]; u: Vec2; i0: number } | null {
  if (!VARIANTS[a.spec.type]) return null;
  const { o, u } = adapterAxis(a);
  const hits = layout.placed.filter((q) => q.connected && q.idx !== a.owner && Math.abs(q.S - a.z) < 0.01 && piecesCollide(q.pieces, a.pieces, 0.4) > 0);
  if (!hits.length || !isStraight40(hits[0].part)) return null;
  const v = dir(hits[0]); if (!v) return null;
  let i0 = hits[0].idx;
  const online = (q: Placed) => {
    if (!q.connected || q.strand !== hits[0].strand || Math.abs(q.S - a.z) > 0.01 || !isStraight40(q.part) || !q.entry) return false;
    const d = dir(q); if (!d || Math.abs(d[0] * v[0] + d[1] * v[1]) < 0.999) return false;
    const off = (q.entry.p[0] - hits[0].entry!.p[0]) * -v[1] + (q.entry.p[1] - hits[0].entry!.p[1]) * v[0];
    return Math.abs(off) < 0.4;
  };
  while (i0 > 0 && !layout.placed[i0].from && !layout.placed[i0].via && online(layout.placed[i0 - 1])) i0--;
  const P0 = layout.placed[i0].entry!.p;
  const c = (P0[0] - o[0]) * u[0] + (P0[1] - o[1]) * u[1];
  return { c, lanes: laneOptions(a, v).map((op) => op.pos), u, i0 };
}
