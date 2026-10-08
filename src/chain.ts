// Chain model: derives placement (position, rotation, level), adapter towers and geometry checks from a part list.
// 16 mm system: every end is a socket, every joint is a snap pin.
import { catalog, entryExit, entryExitIdx, needsAdapter, part, requiredFeedRim, rimMm, LEVEL, PORT_Z, LANES, MERGE, branchPorts, freeLane, portRim, type AdapterSpec, type Part, type Port, type VSock } from './catalog';
import { worldPieces, piecesCollide, piecesOverlapXY, type WPiece } from './footprint';
import { t as tr, tf, partName } from './i18n';

/** omit: stack slots (0 = lowest adapter) left out when building (freestyle tunnel: the lower track runs through the gap,
 *  the part above hangs on its horizontal neighbours).
 *  lane: X crossing lane (0 = default, 1 = the crossing lane).
 *  branch: this part starts a new strand (branch) at socket `port` of part `from` (second flip-flop exit, free lane of
 *  an X crossing). In memory a reference to the element (stable across insert/delete); link, JSON and undo store the
 *  index (state.ts: toPlain/fromPlain). The list is flat: a strand runs up to the next element with a branch, and the
 *  anchor always comes earlier. */
export interface BranchRef { from: ChainElement; port: number }
export interface ChainElement { part: string; reversed?: boolean; omit?: number[]; lane?: number; branch?: BranchRef }
export type Mat2 = [number, number, number, number]; // [a b; c d]
export type Vec2 = [number, number];
export interface AABB { min: [number, number, number]; max: [number, number, number] }

export interface PortW { p: [number, number, number]; n: [number, number, number] }
/** Socket of a placed part (index in layout.placed, port index in the catalog part). */
export interface PortRef { idx: number; port: number }
export interface Placed {
  idx: number; part: Part; reversed: boolean; lane: number;
  R: Mat2; rot: number; t: Vec2; S: number;
  entry: PortW | null; exit: PortW | null;
  aabb: AABB; connected: boolean; pieces: WPiece[];
  rimOutEff: number | null; // rim at the exit (code, relative to the part's own base)
  strand: number;            // strand (0 = main strand, 1.. = branches in list order)
  from: PortRef | null;      // branch: the first part plugs into this socket
  dock: PortRef | null;      // the exit plugs into a free socket (free lane of an X crossing)
  via: { idx: number; inPort: number; outPort: number } | null;  // entered through the free lane of X crossing idx
  out: PortW | null;         // connection for the next part: the exit or (after docking into a free lane) that lane's exit
  outRim: number | null;     // rim there (code, relative to the base of the part that owns out)
  outS: number;              // base height of the part that owns out
}
/** A strand: main strand or branch (starts at from). fed: the part plugged into the free lane at whose exit this branch
 *  starts (the ball comes from there), otherwise null. */
export interface StrandInfo { id: number; idxs: number[]; from: PortRef | null; fed: number | null }
export interface PlacedAdapter {
  part: Part; R: Mat2; rot: number; t: Vec2; z: number; owner: number; aabb: AABB; pieces: WPiece[];
  ports: PortW[];      // horizontal sockets in world coordinates (coupling to the neighbouring tower)
  spec: AdapterSpec;   // catalog adapter spec of the supported part
  dx: number;          // offset along the part axis (short part on a longer adapter)
  slot: number;        // stack slot (0 = lowest adapter, z = slot * 32)
}
/** Omitted adapter slot (freestyle tunnel): where it would have stood and whether the part above is still held. */
export interface OmittedAdapter { owner: number; slot: number; z: number; type: string; held: boolean }
export interface Issue { level: 'error' | 'warn' | 'info'; code: string; idx: number[]; text: string }
/** A spot holding snap pins: 'joint' = track part to track part, 'tower' = vertical (part on adapter, adapter on
 *  adapter), 'row' = two adapters on the same level coupled horizontally. */
export interface PinJoint { kind: 'joint' | 'tower' | 'row'; z: number; n: number; a: string; b: string; owner: number }
/** Horizontal coupling of two towers (adapters/carriers on the same level, socket to socket). */
export interface Coupling { z: number; a: number; b: number; la: string; lb: string }
export interface Layout {
  placed: Placed[]; adapters: PlacedAdapter[]; issues: Issue[]; pins: PinJoint[]; omitted: OmittedAdapter[]; couplings: Coupling[];
  bounds: AABB | null; maxLevel: number; height: number; length: number; drop: number;
  ring: boolean;          // loop: the last part's exit plugs into the first part's entry (e.g. lift loop)
  strands: StrandInfo[];  // main strand + branches
  freePorts: { idx: number; port: number; w: PortW; kind: 'branch' | 'lane' }[];  // free branch exits and free lane entries
}

const ROTS: Record<number, Mat2> = { 0: [1, 0, 0, 1], 90: [0, -1, 1, 0], 180: [-1, 0, 0, -1], 270: [0, 1, -1, 0] };
export function rotM(deg: number): Mat2 { return ROTS[((deg % 360) + 360) % 360]; }
export function mulM(a: Mat2, b: Mat2): Mat2 { return [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3]]; }
export function apply(R: Mat2, t: Vec2, p: [number, number]): Vec2 { return [R[0] * p[0] + R[1] * p[1] + t[0], R[2] * p[0] + R[3] * p[1] + t[1]]; }
export function rotOf(R: Mat2): number { return ((Math.round(Math.atan2(R[2], R[0]) / (Math.PI / 2)) * 90) % 360 + 360) % 360; }

export function portW(q: Port, R: Mat2, t: Vec2, S: number): PortW {
  const p = apply(R, t, [q.p[0], q.p[1]]);
  const n = apply(R, [0, 0], [q.n[0], q.n[1]]);
  return { p: [p[0], p[1], S + q.p[2]], n: [n[0], n[1], 0] };
}
/** Vertical socket in world space: centre, width axis and ear side rotate along. */
export function vsockW(s: VSock, R: Mat2, t: Vec2): VSock {
  const c = apply(R, t, s.c);
  const ear = apply(R, [0, 0], s.wax === 'x' ? [0, s.ear] : [s.ear, 0]);
  const wax: 'x' | 'y' = Math.abs(ear[1]) > 0.5 ? 'x' : 'y';
  return { c, wax, ear: Math.round(wax === 'x' ? ear[1] : ear[0]) };
}
export function sameVSock(a: VSock, b: VSock, tol = 0.3): boolean {
  return Math.abs(a.c[0] - b.c[0]) < tol && Math.abs(a.c[1] - b.c[1]) < tol && a.wax === b.wax && a.ear === b.ear;
}
function aabbOf(bb: [number, number, number, number], z0: number, z1: number, R: Mat2, t: Vec2): AABB {
  const pts = [apply(R, t, [bb[0], bb[1]]), apply(R, t, [bb[2], bb[1]]), apply(R, t, [bb[0], bb[3]]), apply(R, t, [bb[2], bb[3]])];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { min: [Math.min(...xs), Math.min(...ys), z0], max: [Math.max(...xs), Math.max(...ys), z1] };
}
/** AABB prefilter: do a and b overlap by more than tol (total tolerance, tol/2 per side)? */
function overlap(a: AABB, b: AABB, tol = 0.4): boolean {
  const s = tol / 2;
  for (let i = 0; i < 3; i++) if (a.min[i] + s >= b.max[i] - s || b.min[i] + s >= a.max[i] - s) return false;
  return true;
}
export function isCarrier(p: Part): boolean { return p.family === 'adapter' || p.id.startsWith('AdapterTunnel'); }
/** Rim at the entry/exit of a placed part (code, relative to its base), honouring the mounting direction. */
export function entryRim(q: Placed): number | null { return (q.reversed ? q.part.rimOut : q.part.rimIn) ?? (q.reversed ? q.part.rimIn : q.part.rimOut); }
export function exitRim(q: Placed): number | null { return (q.reversed ? q.part.rimIn : q.part.rimOut) ?? (q.reversed ? q.part.rimOut : q.part.rimIn); }
const COLL_TOL = 0.4;   // mm - touching at a joint is not a collision
/** Tallest adapter tower in levels (48 x 32 = 1.5 m); above it the solver reports an error instead of stacking adapters. */
export const MAX_LEVELS = 48;

/** Checks whether part p (optionally reversed) fits the open end. Socket to socket always fits (snap pin in between);
 *  the rim decides. */
export interface Attach { exit: PortW | null; rimOutEff: number | null }
export function compatible(prev: Attach | null, p: Part, reversed: boolean, lane = 0): { ok: boolean; why?: string } {
  const { entry } = entryExit(p, reversed, lane);
  if (!prev) {
    return p.family === 'start' ? { ok: true } : (entry ? { ok: true } : { ok: false, why: tr('noEntry') });
  }
  if (!prev.exit) return { ok: false, why: tr('jointEnded') };
  if (!entry) return { ok: false, why: tr('noEntry') };
  const need = requiredFeedRim(p, reversed);
  const have = prev.rimOutEff;
  if (need != null && have != null && need !== have) return { ok: false, why: tf('rimMismatch', { need, have }) };
  return { ok: true };
}

export interface SolveOptions { quick?: boolean } // quick: placement + joints only (palette probes), no adapters/collisions

export function solveChain(elements: ChainElement[], opts: SolveOptions = {}): Layout {
  const placed: Placed[] = [];
  const issues: Issue[] = [];
  // Strands: a new one starts at every element with a branch (anchor earlier); element 0 is always the main strand
  const strands: StrandInfo[] = [];
  const indexOf = new Map<ChainElement, number>(elements.map((e, i) => [e, i]));
  // Used sockets as "idx:port"; branch anchors are reserved up front (a strand must not run through a lane where a branch starts)
  const used = new Set<string>();
  const anchorOf = (el: ChainElement, k: number): PortRef | null => {
    if (!el.branch || k === 0) return null;
    const a = indexOf.get(el.branch.from);
    return a != null && a < k ? { idx: a, port: el.branch.port } : { idx: -1, port: el.branch.port };
  };
  elements.forEach((el, k) => { const a = anchorOf(el, k); if (a && a.idx >= 0) used.add(a.idx + ':' + a.port); });
  let attach: { exit: PortW; rimOutEff: number | null; S: number } | null = null;
  let prev: Placed | null = null;
  let viaNext: Placed['via'] = null;
  // Once the strand follows a loose part (not placed at a joint: past the strand end, or a branch without anchor),
  // everything after it is loose too. A rim error mid-track, by contrast, is still placed at the joint, so the parts
  // after it stay connected.
  let floating = false;
  elements.forEach((el, idx) => {
    const p = part(el.part);
    const reversed = !!el.reversed && p.reversible;
    const lane = LANES[p.id] && el.lane === 1 ? 1 : 0;
    const { entry, exit } = entryExit(p, reversed, lane);
    const anchor = anchorOf(el, idx);
    if (idx === 0 || anchor) {
      strands.push({ id: strands.length, idxs: [], from: anchor && anchor.idx >= 0 ? anchor : null, fed: null });
      viaNext = null; floating = false;
      if (anchor) {
        // Branch: attach at the anchor's socket (if the anchor exists, is connected and has a free exit there)
        const A = anchor.idx >= 0 ? placed[anchor.idx] : null;
        if (A && A.connected && branchPorts(A.part, A.lane).includes(anchor.port)) {
          attach = { exit: portW(A.part.ports[anchor.port], A.R, A.t, A.S), rimOutEff: portRim(A.part, anchor.port), S: A.S };
        } else attach = null;
        prev = A ?? prev;
      } else { attach = null; prev = null; }
    }
    const strand = strands[strands.length - 1];
    let R: Mat2 = rotM(0), t: Vec2 = [0, 0], S = 0, connected = true;
    const first = strand.idxs.length === 0;
    if (first && !anchor) {
      // start of the main strand: at the origin
    } else if (first && anchor && !attach) {
      connected = false; floating = true;
      issues.push({ level: 'error', code: 'joint', idx: [idx], text: tr('branchLost') });
      const ref = prev ?? placed[placed.length - 1];
      if (ref) { t = [ref.t[0] + 80, ref.t[1] + 80]; S = ref.S; }
    } else if (attach && entry) {
      const comp = compatible(attach, p, reversed, lane);
      if (!comp.ok) { issues.push({ level: 'error', code: 'joint', idx: [idx], text: comp.why ?? tr('noFit') }); connected = false; }
      if (floating) connected = false;   // hangs on a loose part (already reported there)
      // rotation: R * entry.n == -attach.exit.n
      const target = [-attach.exit.n[0], -attach.exit.n[1]];
      const a0 = Math.atan2(entry.n[1], entry.n[0]);
      const a1 = Math.atan2(target[1], target[0]);
      const deg = Math.round(((a1 - a0) * 180) / Math.PI / 90) * 90;
      R = rotM(deg);
      const ep = apply(R, [0, 0], [entry.p[0], entry.p[1]]);
      t = [attach.exit.p[0] - ep[0], attach.exit.p[1] - ep[1]];
      S = attach.exit.p[2] - entry.p[2];
    } else {
      // not connectable: place it next to the end so it stays visible
      connected = false; floating = true;
      const ref = prev ?? placed[placed.length - 1];
      issues.push({ level: 'error', code: 'joint', idx: [idx], text: ref && !ref.exit ? tr('jointEnded') : (attach ? tr('notConnectable') : tr('jointEnded')) });
      if (ref) { t = [ref.t[0] + 80, ref.t[1] + 80]; S = ref.S; }
    }
    const carrier = isCarrier(p);
    const [ie, ix] = entryExitIdx(p, reversed, lane);
    const pl: Placed = {
      idx, part: p, reversed, lane, R, rot: rotOf(R), t, S,
      entry: entry ? portW(entry, R, t, S) : null,
      exit: exit ? portW(exit, R, t, S) : null,
      // carriers (AdapterTunnelQuer): footprint x level height, otherwise the full bounding box
      aabb: carrier ? aabbOf(p.foot, S, S + LEVEL, R, t)
                    : aabbOf([p.bbox[0][0], p.bbox[0][1], p.bbox[1][0], p.bbox[1][1]], S + p.bbox[0][2], S + p.bbox[1][2], R, t),
      connected, pieces: [],
      rimOutEff: (reversed ? p.rimIn : p.rimOut) ?? (attach && Math.abs(attach.S - S) < 0.01 ? attach.rimOutEff : null),
      strand: strand.id, from: first && anchor && anchor.idx >= 0 ? anchor : null, dock: null, via: first ? null : viaNext,
      out: null, outRim: null, outS: S,
    };
    if (connected && !first && ie != null) used.add(idx + ':' + ie);
    if (connected && first && anchor && ie != null) used.add(idx + ':' + ie);
    if (pl.via) issues.push({ level: 'info', code: 'passThrough', idx: [idx, pl.via.idx], text: tf('passThrough', { n: pl.via.idx + 1, name: partName(placed[pl.via.idx].part) }) });
    viaNext = null;
    placed.push(pl);
    strand.idxs.push(idx);
    // Connection for the next part: the exit, or the lane's exit if it docks into the free lane of an X crossing
    pl.out = pl.exit; pl.outRim = pl.rimOutEff; pl.outS = S;
    if (connected && pl.exit && ix != null) {
      const d = laneDock(pl.exit, placed, used);
      if (d && !d.rimOk(pl.rimOutEff)) {
        issues.push({ level: 'error', code: 'joint', idx: [idx, d.idx], text: tf('laneRim', { n: d.idx + 1, need: d.need ?? '?', have: pl.rimOutEff ?? '?' }) });
      } else if (d) {
        const X = placed[d.idx];
        pl.dock = { idx: d.idx, port: d.inPort };
        used.add(d.idx + ':' + d.inPort);
        if (d.merge) {
          // Y merge: the strand flows into the free inlet and ends there; the ball continues in the Y's strand
          pl.out = null; pl.outRim = null;
          issues.push({ level: 'info', code: 'merge', idx: [idx, d.idx], text: tf('mergeIn', { n: d.idx + 1, name: partName(X.part) }) });
        } else if (used.has(d.idx + ':' + d.outPort)) { pl.out = null; pl.outRim = null; }   // a branch starts at the lane's end: this strand feeds it
        else {
          used.add(d.idx + ':' + d.outPort);
          pl.out = portW(X.part.ports[d.outPort], X.R, X.t, X.S);
          pl.outRim = d.fwd ? X.part.rimOut : X.part.rimIn;   // forward through the lane: low rim at the exit
          pl.outS = X.S;
          viaNext = { idx: d.idx, inPort: d.inPort, outPort: d.outPort };
        }
      }
    }
    attach = pl.out ? { exit: pl.out, rimOutEff: pl.outRim, S: pl.outS } : null;
    prev = pl;
  });
  // Fed branches: a strand docks into the free lane at whose exit a branch starts
  for (const st of strands) {
    if (!st.from) continue;
    const A = placed[st.from.idx]; if (!A || !LANES[A.part.id]) continue;
    const feeder = placed.find((q) => q.dock && q.dock.idx === st.from!.idx && q.out == null);
    if (feeder) st.fed = feeder.idx;
  }

  // Normalize levels: lowest connected part at 0 (loose parts are only placed alongside for display)
  const connectedParts = placed.filter((q) => q.connected);
  if (connectedParts.length) {
    const minS = Math.min(...connectedParts.map((q) => q.S));
    if (minS !== 0) for (const q of placed) shiftZ(q, -minS);
  }
  for (const q of placed) { q.S = Math.round(q.S * 1000) / 1000; q.pieces = worldPieces(q.part, q.R, q.t, q.S); }
  const freePorts = collectFreePorts(placed, used);
  if (opts.quick) return { placed, adapters: [], issues, pins: [], omitted: [], couplings: [], bounds: null, maxLevel: 0, height: 0, length: 0, drop: 0, ring: false, strands, freePorts };

  // Loop: if the chain ends exactly in the first part's entry (same spot, matching rim), it is closed - one more snap
  // pin, and the ball runs in circles
  const ring = isRing(placed, strands);
  if (ring) issues.push({ level: 'info', code: 'ring', idx: [ringLast(placed, strands), 0], text: tr('ringClosed') });

  // ---------------------------------------------------------------- Adapter towers
  // Adapters are solid 32 mm blocks with the same socket on top and bottom as the parts (one snap pin per step) and
  // horizontal sockets on their ends - neighbouring towers on the same level couple like track parts.
  const adapters: PlacedAdapter[] = [];
  const adaptersAt = new Map<number, PlacedAdapter[]>();   // per stack slot (level)
  const omitted: OmittedAdapter[] = [];
  for (const q of placed) {
    const ad = q.part.adapter;
    if (q.S <= 0 || !q.connected) continue;
    if (!ad) {
      // no adapter in the catalog (end bowl, spiral, X crossing, loops): level 0 only
      if (needsAdapter(q.part)) issues.push({ level: 'error', code: 'noAdapter', idx: [q.idx], text: tf('noAdapter', { n: q.idx + 1, name: partName(q.part), S: q.S }) });
      continue;
    }
    const ap = catalog.byId.get(ad.type);
    if (!ap) continue;
    const n = Math.round(q.S / LEVEL);
    if (Math.abs(n * LEVEL - q.S) > 0.01) { issues.push({ level: 'error', code: 'level', idx: [q.idx], text: tf('levelBad', { S: q.S, L: LEVEL }) }); continue; }
    // upper limit: a short link with many slides would otherwise create hundreds of thousands of adapters and freeze the tab
    if (n > MAX_LEVELS) { issues.push({ level: 'error', code: 'level', idx: [q.idx], text: tf('tooHigh', { n: q.idx + 1, name: partName(q.part), S: q.S, max: MAX_LEVELS * LEVEL }) }); continue; }
    const pl = placeAdapter(q, ad, 0);
    const omit = new Set(elements[q.idx]?.omit ?? []);
    for (let k = 0; k < n; k++) {
      const z = k * LEVEL;
      const aabb = aabbOf(ap.foot, z, z + LEVEL, pl.R, pl.t);
      // a carrier part of the chain at this spot (AdapterTunnelQuer) replaces the adapter
      const carrier = placed.find((c) => c !== q && isCarrier(c.part) && Math.abs(c.S - z) < 0.01 && carrierFits(c.aabb, aabb));
      if (carrier) continue;
      // an existing adapter with the same footprint (two parts share one adapter), looked up per level
      if ((adaptersAt.get(k) ?? []).some((a) => sameFoot(a.aabb, aabb))) continue;
      // intentionally omitted (freestyle tunnel): the gap stays and is checked for support below
      if (omit.has(k)) { omitted.push({ owner: q.idx, slot: k, z, type: ap.id, held: false }); continue; }
      const pa: PlacedAdapter = { part: ap, R: pl.R, rot: rotOf(pl.R), t: pl.t, z, owner: q.idx, aabb, pieces: worldPieces(ap, pl.R, pl.t, z),
                                  spec: ad, dx: 0, slot: k, ports: ap.ports.map((p) => portW(p, pl.R, pl.t, z)) };
      adapters.push(pa);
      if (!adaptersAt.has(k)) adaptersAt.set(k, []);
      adaptersAt.get(k)!.push(pa);
    }
  }

  // Horizontal coupling of neighbouring towers (socket to socket, one snap pin)
  const couplings = coupleRows(placed, adapters);

  // Freestyle tunnel: is whatever stands above the gap still held by its horizontal neighbours?
  for (const o of omitted) {
    const q = placed[o.owner];
    const zAbove = o.z + LEVEL;
    const above = adapters.find((a) => a.owner === o.owner && Math.abs(a.z - zAbove) < 0.01);
    if (above) o.held = couplings.some((c) => c.a === adapters.indexOf(above) || c.b === adapters.indexOf(above));
    else {
      // the part itself sits directly above: the parts joined to it (same strand, branch anchor, X crossing/Y merge,
      // branches on it, loop) hold it if they stand on the same level
      o.held = joinedParts(q, placed, strands, ring).some((n) => n.connected && Math.abs(n.S - q.S) < 0.01);
    }
    issues.push({ level: o.held ? 'info' : 'warn', code: 'omit', idx: [o.owner],
                  text: tf(o.held ? 'omitHeld' : 'omitFree', { n: o.owner + 1, name: partName(q.part), z: o.z, type: partName(catalog.byId.get(o.type) ?? { id: o.type }) }) });
  }

  // Collisions part/part and part/adapter (footprint polygons per level)
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    const a = placed[i], b = placed[j];
    if (!a.connected || !b.connected) continue;
    if (!overlap(a.aabb, b.aabb, COLL_TOL)) continue;
    const d = piecesCollide(a.pieces, b.pieces, COLL_TOL);
    if (d > 0) issues.push({ level: 'error', code: 'collision', idx: [i, j], text: tf('collide', { a: `${i + 1}. ${partName(a.part)}`, b: `${j + 1}. ${partName(b.part)}`, d: d.toFixed(1) }) });
  }
  for (const a of adapters) for (const q of placed) {
    if (q.idx === a.owner || !q.connected) continue;
    if (!overlap(a.aabb, q.aabb, COLL_TOL)) continue;
    const d = piecesCollide(a.pieces, q.pieces, COLL_TOL);
    if (d > 0) issues.push({ level: 'error', code: 'collision', idx: [q.idx, a.owner], text: tf('collideAdapter', { a: `${q.idx + 1}. ${partName(q.part)}`, b: partName(a.part), z: a.z, n: a.owner + 1, d: d.toFixed(1) }) });
  }
  // Adapter vs. adapter only on the same level (grouped per slot, ordered by index in adapters)
  for (const list of adaptersAt.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (a.owner === b.owner || !overlap(a.aabb, b.aabb, COLL_TOL)) continue;
    const d = piecesCollide(a.pieces, b.pieces, COLL_TOL);
    if (d > 0) issues.push({ level: 'error', code: 'collision', idx: [a.owner, b.owner], text: tf('collideStacks', { a: a.owner + 1, b: b.owner + 1, z: a.z, d: d.toFixed(1) }) });
  }
  // Metrics
  let bounds: AABB | null = null;
  const all = [...placed.filter((q) => q.connected).map((q) => q.aabb), ...adapters.map((a) => a.aabb)];
  for (const b of all) {
    if (!bounds) bounds = { min: [...b.min], max: [...b.max] };
    else for (let i = 0; i < 3; i++) { bounds.min[i] = Math.min(bounds.min[i], b.min[i]); bounds.max[i] = Math.max(bounds.max[i], b.max[i]); }
  }
  const maxLevel = placed.length ? Math.max(...placed.map((q) => q.S)) : 0;
  const length = placed.reduce((s, q) => s + (q.connected ? q.part.phys.L ?? 0 : 0), 0);
  // Total drop (main strand): exit rim of the first part down to exit rim of the last connected part (mm)
  const main = connectedParts.filter((q) => q.strand === 0);
  const first = main.find((q) => exitRim(q) != null), last = [...main].reverse().find((q) => exitRim(q) != null);
  const drop = first && last ? (first.S + rimMm(exitRim(first) ?? 0)) - (last.S + rimMm(exitRim(last) ?? 0)) : 0;
  return { placed, adapters, issues, pins: pinJoints(placed, adapters, couplings, ring, strands), omitted, couplings, bounds, maxLevel,
           height: bounds ? bounds.max[2] : 0, length, drop, ring, strands, freePorts };
}

/** Parts joined directly to q (snap pin): the predecessor in the strand, or the branch anchor, or the X crossing whose
 *  free lane q enters through; the successor in the strand (unless it first passes through a free lane), or the part
 *  whose free lane q docks into; the first parts of branches on q; for a loop the first/last part. */
export function joinedParts(q: Placed, placed: Placed[], strands: StrandInfo[], ring = false): Placed[] {
  const out: Placed[] = [];
  const st = strands[q.strand]; const k = st ? st.idxs.indexOf(q.idx) : -1;
  const prev = q.from ? placed[q.from.idx] : q.via ? placed[q.via.idx] : k > 0 ? placed[st.idxs[k - 1]] : undefined;
  if (prev) out.push(prev);
  const next = st && k >= 0 && k + 1 < st.idxs.length ? placed[st.idxs[k + 1]] : undefined;
  if (next && !next.via) out.push(next);
  if (q.dock) out.push(placed[q.dock.idx]);
  for (const s of strands) if (s.from && s.from.idx === q.idx && s.idxs.length) out.push(placed[s.idxs[0]]);
  if (ring) { const li = ringLast(placed, strands); if (q.idx === 0) out.push(placed[li]); if (q.idx === li) out.push(placed[0]); }
  return out.filter((x): x is Placed => !!x && x !== q);
}

/** Index of the last part of the main strand. */
function ringLast(placed: Placed[], strands?: StrandInfo[]): number {
  const m = strands?.[0]?.idxs; return m && m.length ? m[m.length - 1] : placed.length - 1;
}
/** Free lane of an already placed X crossing whose entry (or exit - then uphill) this exit plugs into.
 *  Y merge (merge): only the free inlet - the exit belongs to the chain; the strand flows in and ends there. */
function laneDock(exit: PortW, placed: Placed[], used: Set<string>): { idx: number; inPort: number; outPort: number; fwd: boolean; merge: boolean; need: number | null; rimOk: (r: number | null) => boolean } | null {
  for (const X of placed) {
    if (!X.connected) continue;
    const fl = freeLane(X.part, X.lane); if (!fl) continue;
    const merge = MERGE.has(X.part.id);
    const dirs: [number, number, boolean][] = merge ? [[fl[0], fl[1], true]] : [[fl[0], fl[1], true], [fl[1], fl[0], false]];
    for (const [inPort, outPort, fwd] of dirs) {
      if (used.has(X.idx + ':' + inPort)) continue;
      if (samePlace(exit, portW(X.part.ports[inPort], X.R, X.t, X.S))) {
        // the rim must match as at any joint: forward (high end) the feed rim, uphill (low end) the exit rim
        const need = fwd ? X.part.feedRim ?? X.part.rimIn : X.part.rimOut;
        return { idx: X.idx, inPort, outPort, fwd, merge, need, rimOk: (r) => need == null || r == null || r === need };
      }
    }
  }
  return null;
}
/** Free sockets for the UI: branch exits (flip-flop, exit of a free lane) and free lane entries. */
function collectFreePorts(placed: Placed[], used: Set<string>): Layout['freePorts'] {
  const out: Layout['freePorts'] = [];
  for (const q of placed) {
    if (!q.connected) continue;
    for (const port of branchPorts(q.part, q.lane)) if (!used.has(q.idx + ':' + port)) out.push({ idx: q.idx, port, w: portW(q.part.ports[port], q.R, q.t, q.S), kind: 'branch' });
    const fl = freeLane(q.part, q.lane);
    // Y merge: the shared exit belongs to the chain; the inlet is free as long as nothing flows into it
    if (fl && !used.has(q.idx + ':' + fl[0]) && (MERGE.has(q.part.id) || !used.has(q.idx + ':' + fl[1]))) out.push({ idx: q.idx, port: fl[0], w: portW(q.part.ports[fl[0]], q.R, q.t, q.S), kind: 'lane' });
  }
  return out;
}

/** Does the exit of the last part (main strand) plug into the entry of the first (position, direction, rim)? */
export function isRing(placed: Placed[], strands?: StrandInfo[]): boolean {
  if (placed.length < 3) return false;
  const first = placed[0], last = placed[ringLast(placed, strands)];
  if (!last || last === first) return false;
  if (!first.connected || !last.connected || !first.entry || !last.exit) return false;
  if (!samePlace(last.exit, first.entry)) return false;
  const need = requiredFeedRim(first.part, first.reversed), have = last.rimOutEff;
  return need == null || have == null || need === have;
}

function shiftZ(q: Placed, dz: number) {
  q.S += dz; q.outS += dz; q.aabb.min[2] += dz; q.aabb.max[2] += dz;
  if (q.entry) q.entry.p[2] += dz; if (q.exit) q.exit.p[2] += dz;
  if (q.out && q.out !== q.exit) q.out.p[2] += dz;
}
/** Carrier (cross tunnel) in place of the adapter: same centre, same length along the adapter axis; across, the carrier
 *  may be wider (32 mm cross tunnel under a 26.7 mm wide adapter footprint). */
function carrierFits(c: AABB, a: AABB, tol = 0.8): boolean {
  const cx = (c.min[0] + c.max[0]) / 2 - (a.min[0] + a.max[0]) / 2, cy = (c.min[1] + c.max[1]) / 2 - (a.min[1] + a.max[1]) / 2;
  if (Math.abs(cx) > tol || Math.abs(cy) > tol) return false;
  const dx = (c.max[0] - c.min[0]) - (a.max[0] - a.min[0]), dy = (c.max[1] - c.min[1]) - (a.max[1] - a.min[1]);
  // along the adapter axis: equal or up to 3 mm shorter (the 50.7 mm cross tunnel 95 also replaces the 53.3 mm
  // AdapterGerade100 under a Gerade100, both centred); across: up to 6 mm wider (cross lane 32 instead of 26.7)
  const along = (d: number) => d > -3 && d < tol;
  return (along(dx) && dy > -tol && dy < 6) || (along(dy) && dx > -tol && dx < 6);
}
function sameFoot(a: AABB, b: AABB, tol = 0.8): boolean {
  return Math.abs(a.min[0] - b.min[0]) < tol && Math.abs(a.min[1] - b.min[1]) < tol && Math.abs(a.max[0] - b.max[0]) < tol && Math.abs(a.max[1] - b.max[1]) < tol;
}

/** Places an adapter in part coordinates (dx shifts along the part axis). */
function placeAdapter(q: Placed, spec: AdapterSpec, dx: number): { R: Mat2; t: Vec2 } {
  return { R: mulM(q.R, rotM(spec.rot)), t: apply(q.R, q.t, [spec.offset[0] + dx, spec.offset[1]]) };
}

// ---------------------------------------------------------------- Tower coupling
const PORT_TOL = 0.4;
export function samePlace(a: PortW, b: PortW): boolean {
  return Math.abs(a.p[0] - b.p[0]) < PORT_TOL && Math.abs(a.p[1] - b.p[1]) < PORT_TOL && Math.abs(a.p[2] - b.p[2]) < PORT_TOL
    && a.n[0] * b.n[0] + a.n[1] * b.n[1] < -0.99;
}
/** Carrier parts of the chain (AdapterTunnelQuer) couple into the row via their end sockets (not the cross lane). */
function carrierPorts(q: Placed): PortW[] {
  const lane = new Set(q.part.lane.filter((i): i is number => i != null));
  return q.part.ports.filter((_, i) => !lane.has(i)).map((p) => portW(p, q.R, q.t, q.S));
}
/** Two towers on the same level whose end sockets face each other exactly are coupled with one snap pin.
 *  Nodes: adapters (index in adapters) and chain carriers (-(idx+1)). */
export function coupleRows(placed: Placed[], adapters: PlacedAdapter[]): Coupling[] {
  const nodes: { key: number; z: number; ports: PortW[]; label: string }[] = adapters.map((a, i) => ({ key: i, z: a.z, ports: a.ports, label: `${partName(a.part)} (${a.owner + 1})` }));
  for (const q of placed) if (q.connected && isCarrier(q.part)) nodes.push({ key: -(q.idx + 1), z: q.S, ports: carrierPorts(q), label: `${q.idx + 1}. ${partName(q.part)}` });
  // Level changer: the second socket at the bottom of the entry end (port outside the lane) couples with the tower under
  // the feeding part - one snap pin, as between two towers. Flip-flop: likewise, at the bottom of the entry end and at
  // the second exit.
  for (const q of placed) if (q.connected && (q.part.family === 'levelChanger' || q.part.id.startsWith('Kippwippe_120-60_')) && q.part.ports.length > 2) nodes.push({ key: -(q.idx + 1), z: q.S, ports: carrierPorts(q), label: `${q.idx + 1}. ${partName(q.part)}` });
  const out: Coupling[] = [];
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const A = nodes[i], B = nodes[j];
    if (Math.abs(A.z - B.z) > 0.01) continue;
    for (const pa of A.ports) for (const pb of B.ports) if (samePlace(pa, pb)) out.push({ z: A.z, a: A.key, b: B.key, la: A.label, lb: B.label });
  }
  return out;
}

/** Counts snap pins: one per track joint, one per tower step (vertical socket on vertical socket - part on adapter,
 *  adapter on adapter; the lowest adapter stands freely on the table) and one per coupling of two towers. The number and
 *  position of a part's vertical sockets come from the catalog (measured on the STLs). */
export function pinJoints(placed: Placed[], adapters: PlacedAdapter[], couplings: Coupling[], ring = false, strands?: StrandInfo[]): PinJoint[] {
  const out: PinJoint[] = [];
  const zOf = (w: PortW) => Math.round((w.p[2] - PORT_Z) * 1000) / 1000;
  const lbl = (q: Placed) => `${q.idx + 1}. ${q.part.id}`;
  // Loop: the joint between the last and the first part
  if (ring) {
    const a = placed[ringLast(placed, strands)], b = placed[0];
    out.push({ kind: 'joint', z: zOf(a.exit!), n: 1, a: lbl(a), b: lbl(b), owner: b.idx });
  }
  // Lift: module-to-module joints (corner sockets) and the crank - counted as tower steps
  for (const q of placed) if (q.connected && q.part.lift) out.push({ kind: 'tower', z: q.S, n: q.part.lift.pins, a: `${q.idx + 1}. ${q.part.id}`, b: 'Lift', owner: q.idx });
  // Track joints (within a strand), a branch at its anchor, docking into the free lane of an X crossing
  for (const b of placed) {
    if (!b.connected || !b.entry) continue;
    if (b.from) { const A = placed[b.from.idx]; if (A) out.push({ kind: 'joint', z: zOf(b.entry), n: 1, a: `${lbl(A)} (${b.from.port})`, b: lbl(b), owner: b.idx }); continue; }
    const a = placed[b.idx - 1];
    if (!a || a.strand !== b.strand || !a.connected || !a.exit) continue;
    if (b.via) {
      const X = placed[b.via.idx];
      out.push({ kind: 'joint', z: zOf(a.exit), n: 1, a: lbl(a), b: `${lbl(X)} (${b.via.inPort})`, owner: b.idx });
      out.push({ kind: 'joint', z: zOf(b.entry), n: 1, a: `${lbl(X)} (${b.via.outPort})`, b: lbl(b), owner: b.idx });
    } else out.push({ kind: 'joint', z: zOf(a.exit), n: 1, a: lbl(a), b: lbl(b), owner: b.idx });
  }
  // Strand ends in a free lane (no following part): the joint there
  for (const a of placed) {
    if (!a.connected || !a.dock || !a.exit) continue;
    const nxt = placed[a.idx + 1];
    if (nxt && nxt.strand === a.strand && nxt.via) continue;
    out.push({ kind: 'joint', z: zOf(a.exit), n: 1, a: lbl(a), b: `${lbl(placed[a.dock.idx])} (${a.dock.port})`, owner: a.idx });
  }
  // Tower steps: a support's top socket meets the bottom socket of whatever stands on it
  const supports = [
    ...adapters.map((a) => ({ part: a.part, R: a.R, t: a.t, z: a.z, pieces: a.pieces, owner: a.owner, label: `${a.part.id} (${a.owner + 1})` })),
    ...placed.filter((q) => q.connected && isCarrier(q.part)).map((q) => ({ part: q.part, R: q.R, t: q.t, z: q.S, pieces: q.pieces, owner: q.idx, label: `${q.idx + 1}. ${q.part.id}` })),
  ];
  for (const s of supports) {
    const tops = s.part.vsock.top.map((v) => vsockW(v, s.R, s.t));
    if (!tops.length) continue;
    const above = [
      ...adapters.filter((b) => Math.abs(b.z - (s.z + LEVEL)) < 0.01 && piecesOverlapXY(b.pieces, s.pieces) > 0).map((b) => ({ part: b.part, R: b.R, t: b.t, label: `${b.part.id} (${b.owner + 1})` })),
      ...placed.filter((q) => q.connected && Math.abs(q.S - (s.z + LEVEL)) < 0.01 && piecesOverlapXY(q.pieces, s.pieces) > 0).map((q) => ({ part: q.part, R: q.R, t: q.t, label: `${q.idx + 1}. ${q.part.id}` })),
    ];
    for (const u of above) {
      const bottoms = u.part.vsock.bottom.map((v) => vsockW(v, u.R, u.t));
      const n = tops.filter((tp) => bottoms.some((bt) => sameVSock(tp, bt))).length;
      if (n > 0) out.push({ kind: 'tower', z: s.z + LEVEL, n, a: s.label, b: u.label, owner: s.owner });
    }
  }
  // Tower couplings
  for (const c of couplings) out.push({ kind: 'row', z: c.z, n: 1, a: c.la, b: c.lb, owner: c.a >= 0 ? adapters[c.a].owner : -c.a - 1 });
  return out.sort((a, b) => a.z - b.z || a.owner - b.owner);
}

/** Free sockets in the layout (for loop-closing hints). */
export function openPorts(layout: Layout): { idx: number; port: PortW }[] {
  const res: { idx: number; port: PortW }[] = [];
  const used = new Set<string>();
  for (const q of layout.placed) { if (q.entry) used.add(key(q.entry)); if (q.exit) used.add(key(q.exit)); }
  for (const q of layout.placed) for (const port of q.part.ports) {
    const w = portW(port, q.R, q.t, q.S);
    if (!used.has(key(w))) res.push({ idx: q.idx, port: w });
  }
  return res;
}
function key(p: PortW) { return `${p.p[0].toFixed(1)},${p.p[1].toFixed(1)},${p.p[2].toFixed(1)}`; }
