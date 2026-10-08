// Speed chain (energy model per part):
//   v_out^2 = v_in^2 + (2/k) * g * (drop - C_rr * L)      k = 1.4 groove (7/10 rule), 1.544 rail
// Per-part limits (lift-off, lateral acceleration, working window) come from the catalog - computed estimates, not yet
// measured on the printed track. C_rr measured with a roll-down test: 0.020..0.022.
import type { Layout, Placed } from './chain';
import { freeLane, MERGE } from './catalog';
import { t, tf, pick } from './i18n';

export const G = 9810; // mm/s^2

export interface SpeedStep {
  idx: number; vIn: number; vOut: number;
  status: 'ok' | 'warn' | 'error' | 'stop'; msgs: string[];
  vCrest?: number; estimate?: boolean;
}
/** Ball mass in g (default: glass marble D16 = 5.4 g; steel D16 = 16.8 g). It cancels out of the rolling model - a
 *  lighter ball rolls just as fast - and only enters the energy at the end (impact, catch basin). */
export interface SimOptions { crr: number; v0: number; mass?: number }
export const DEFAULT_SIM: SimOptions = { crr: 0.021, v0: 70, mass: 5.4 };
export const MASS_RANGE: readonly [number, number] = [1, 100];
/** Kinetic energy in mJ including rotation: E = 1/2 * k * m * v^2 (m in g, v in mm/s). */
export function ballEnergy(v: number, mass: number | undefined, k = 1.4): number { const m = (mass ?? DEFAULT_SIM.mass!) / 1000, vv = v / 1000; return 0.5 * k * m * vv * vv * 1000; }

/** Ball check per strand. Main strand from the start (push v0); a branch at a flip-flop with its exit speed; a branch at
 *  the exit of an X crossing's free lane with the speed of the strand docking there (computed through the lane), or
 *  with the push if nothing feeds it. If a strand passes through a free lane (via), the lane is computed before the part. */
export function simulate(layout: Layout, opt: SimOptions): SpeedStep[] {
  const steps: SpeedStep[] = new Array(layout.placed.length);
  const strands = layout.strands?.length ? layout.strands : [{ id: 0, idxs: layout.placed.map((q) => q.idx), from: null, fed: null }];
  const done = new Set<number>();
  // strands in dependency order (a branch after its anchor or after the strand feeding it)
  for (let pass = 0; pass < strands.length + 1 && done.size < strands.length; pass++) {
    for (const st of strands) {
      if (done.has(st.id)) continue;
      let v = opt.v0, startMsg: string | null = null;
      if (st.from) {
        const a = steps[st.from.idx];
        if (!a) continue;                                   // anchor not computed yet
        const anchor = layout.placed[st.from.idx];
        if (anchor.part.phys.fixedExit != null) v = a.status === 'stop' ? 0 : a.vOut;   // flip-flop: both exits equally fast
        else if (st.fed != null) {
          const f = steps[st.fed]; if (!f) continue;        // feeding strand not computed yet
          const r = through(anchor, f.status === 'stop' ? 0 : f.vOut, opt);
          v = r.v; if (r.msg) startMsg = r.msg;
        } else { v = opt.v0; startMsg = t('laneNoFeed'); }
      }
      let stopped = st.from != null && v <= 0;
      for (const i of st.idxs) {
        const q = layout.placed[i];
        let msgPre: string | null = null;
        if (i === st.idxs[0] && startMsg) msgPre = startMsg;
        if (q.via && !stopped) {
          // through the free lane of the X crossing before the ball reaches this part
          const X = layout.placed[q.via.idx], fl = freeLane(X.part, X.lane);
          const r = through(X, v, opt, !!fl && q.via.inPort !== fl[0]);
          v = r.v; if (r.msg) msgPre = r.msg; if (v <= 0) stopped = true;
        }
        const res = stepPart(q, v, opt, stopped);
        if (msgPre) { res.st.msgs.unshift(msgPre); if (res.st.status === 'ok' && (msgPre === t('laneNoFeed'))) res.st.status = 'warn'; }
        steps[i] = res.st; v = res.v; if (res.stopped) stopped = true;
      }
      done.add(st.id);
    }
  }
  // Y merge: a strand flowing into the free inlet must respect the Y's limits (speed at the end of the strand)
  for (const q of layout.placed) {
    if (!q.dock || !steps[q.idx]) continue;
    const Y = layout.placed[q.dock.idx]; if (!Y || !MERGE.has(Y.part.id)) continue;
    const s = steps[q.idx]; if (s.status === 'stop') continue;
    const lim = Y.part.phys.limits ?? {}, v = s.vOut;
    const bad = lim.vmax != null && v > lim.vmax, marg = !bad && lim.vwarn != null && v > lim.vwarn;
    if (!bad && !marg) continue;
    s.msgs.push(tf('mergeFast', { v: r(v), n: Y.idx + 1, max: lim.vmax ?? lim.vwarn ?? 0 }));
    if (lim.why || lim.whyEn) s.msgs.push(pick(lim.why, lim.whyEn));
    if (bad) s.status = 'error'; else if (s.status === 'ok') s.status = 'warn';
  }
  // Y merge, second feed: the ball from the joining strand runs through the Y and the shared track after it - at ITS own
  // speed. The displayed speed stays that of the Y's own strand; if the second ball is worse off, the part's status is
  // raised and a message names the feed.
  const order = ['ok', 'warn', 'error', 'stop'];
  const work: { y: number; v: number; from: number; first: boolean }[] = [];
  const seen = new Set<string>();
  for (const q of layout.placed) {
    if (!q.dock || !steps[q.idx] || !MERGE.has(layout.placed[q.dock.idx]?.part.id ?? '')) continue;
    const s = steps[q.idx]; if (s.status === 'stop' || !q.connected) continue;
    work.push({ y: q.dock.idx, v: s.vOut, from: q.idx, first: true });
  }
  for (let guard = 0; work.length && guard < 50; guard++) {
    const w = work.shift()!;
    const Y = layout.placed[w.y]; const st = strands.find((x) => x.id === Y.strand); if (!st) continue;
    // a strand flowing into its own Y (loop) carries the same ball on its next lap - not a second feed
    if (layout.placed[w.from].strand === Y.strand) continue;
    const seenKey = w.from + ':' + w.y; if (seen.has(seenKey)) continue; seen.add(seenKey);
    let v = w.v, stopped = false;
    for (const i of st.idxs.slice(st.idxs.indexOf(w.y))) {
      const q = layout.placed[i]; let pre: string | null = null;
      if (q.via && i !== w.y && !stopped) {
        const X = layout.placed[q.via.idx], fl = freeLane(X.part, X.lane);
        const r = through(X, v, opt, !!fl && q.via.inPort !== fl[0]);
        v = r.v; pre = r.msg; if (v <= 0) stopped = true;
      }
      const wasStopped = stopped;
      const res = stepPart(q, v, opt, stopped);
      v = res.v; if (res.stopped) stopped = true;
      const main = steps[i];
      // the Y itself: mergeFast already checks its inlet limits for this feed - only further Ys are checked here
      const skip = wasStopped || !main || (i === w.y && w.first);
      if (!skip && (order.indexOf(res.st.status) > order.indexOf(main.status) || pre)) {
        const msgs = [...(pre ? [pre] : []), ...res.st.msgs];
        if (msgs.length) main.msgs.push(tf('mergeBall', { n: w.from + 1, msg: msgs.join(' – ') }));
        if (order.indexOf(res.st.status) > order.indexOf(main.status)) main.status = res.st.status;
      }
      if (stopped) break;
      if (i === st.idxs[st.idxs.length - 1] && q.dock && MERGE.has(layout.placed[q.dock.idx]?.part.id ?? '')) work.push({ y: q.dock.idx, v, from: w.from, first: false });
    }
  }
  // strands without a computable start (anchor missing): not connected
  for (let i = 0; i < steps.length; i++) if (!steps[i]) steps[i] = { idx: i, vIn: 0, vOut: 0, status: 'error', msgs: [t('notConnected')] };
  return steps;
}

/** Ball through the (free) lane of a part - same physics as the part itself; up: uphill (from the low end). */
function through(X: Placed, v: number, opt: SimOptions, up = false): { v: number; msg: string | null } {
  const ph = X.part.phys, k = ph.k, L = ph.L ?? 0, drop = up ? -ph.drop : ph.drop;
  const v2 = v * v + (2 / k) * G * (drop - opt.crr * L);
  if (v2 <= 0) return { v: 0, msg: tf('laneStops', { n: X.idx + 1 }) };
  return { v: Math.sqrt(v2), msg: null };
}

/** One part of the chain: check the inlet limits, compute the exit speed. */
function stepPart(q: Placed, v: number, opt: SimOptions, stopped: boolean): { st: SpeedStep; v: number; stopped: boolean } {
  const p = q.part; const ph = p.phys; const lim = ph.limits ?? {};
  const st: SpeedStep = { idx: q.idx, vIn: v, vOut: v, status: 'ok', msgs: [] };
  if (!q.connected) { st.status = 'error'; st.msgs.push(t('notConnected')); return { st, v, stopped }; }
  if (p.family === 'start') { const v0 = Math.max(opt.v0, 0); st.vIn = 0; st.vOut = v0; return { st, v: v0, stopped: false }; }
  if (p.family === 'adapter') return { st, v, stopped };
  if (stopped) { st.vIn = 0; st.vOut = 0; st.status = 'stop'; st.msgs.push(t('noArrival')); return { st, v: 0, stopped: true }; }

  // inlet limits
  if (lim.vmax != null && v > lim.vmax) { st.status = 'error'; st.msgs.push(tf('tooFast', { v: r(v), max: lim.vmax })); }
  else if (lim.vwarn != null && v > lim.vwarn) { st.status = 'warn'; st.msgs.push(tf('marginal', { v: r(v), max: lim.vmax ?? lim.vwarn })); }
  if (lim.vmin != null && v < lim.vmin) { st.status = 'error'; st.msgs.push(tf('tooSlow', { v: r(v), min: lim.vmin })); }
  if (st.msgs.length && (lim.why || lim.whyEn)) st.msgs.push(pick(lim.why, lim.whyEn));

  const k = ph.k, L = ph.L ?? 0, drop = q.reversed ? -ph.drop : ph.drop;
  let vOut: number;
  if (ph.fixedExit != null) {
    vOut = ph.fixedExit; if (ph.estimate) st.estimate = true;
  } else {
    if (ph.crest) {
      // rise to the crest from the entry rim: forward dh (catalog), reversed from the lower end: dh + drop
      const dh = crestRise(ph.crest.dh, ph.drop, q.reversed);
      const vc2 = v * v - (2 / k) * G * dh;
      if (vc2 <= 0) { st.status = 'stop'; st.msgs.push(tf('crestFail', { dh: dh.toFixed(1) })); st.vOut = 0; return { st, v: 0, stopped: true }; }
      st.vCrest = Math.sqrt(vc2);
      if (st.vCrest > ph.crest.vcrestMax) { st.status = 'error'; st.msgs.push(tf('liftOff', { v: r(st.vCrest), max: ph.crest.vcrestMax, R: ph.crest.R })); }
    }
    // curves: wall contact raises the normal force by v^2/R -> rolling resistance grows with (1 + a_lat/g)
    let crr = opt.crr;
    if (ph.R) { const vAvg2 = v * v + (1 / k) * G * Math.max(0, drop); crr = opt.crr * (1 + vAvg2 / (ph.R * G)); }
    // Y merge: junction loss as a factor on the inlet speed (3D simulation: ~70 % on flat, a slope compensates it)
    const vi = ph.inLoss ? v * ph.inLoss : v;
    const v2 = vi * vi + (2 / k) * G * (drop - crr * L);
    if (v2 <= 0) { st.status = 'stop'; st.msgs.push(drop < 0 ? tf('uphillFail', { h: (-drop).toFixed(1) }) : t('stops')); st.vOut = 0; return { st, v: 0, stopped: true }; }
    vOut = Math.sqrt(v2);
    if (ph.loss) vOut *= ph.loss;
    if (ph.brake && vOut > ph.brake.threshold) vOut = ph.brake.cap;
  }
  st.vOut = vOut;
  return { st, v: vOut, stopped: false };
}

function r(x: number) { return Math.round(x); }
/** Crest height above the entry rim: forward dh, reversed (entering at the lower end) dh + drop. */
export function crestRise(dh: number, drop: number, reversed: boolean): number { return reversed ? dh + drop : dh; }

/** Drop-height equivalent of a speed (groove): h = 7 v^2 / (10 g), in mm. */
export function heightEquivalent(v: number, k = 1.4): number { return (k * v * v) / (2 * G); }

export function worstStatus(steps: SpeedStep[]): SpeedStep['status'] {
  const order = ['ok', 'warn', 'error', 'stop'];
  return steps.reduce((w, s) => (order.indexOf(s.status) > order.indexOf(w) ? s.status : w), 'ok' as SpeedStep['status']);
}
