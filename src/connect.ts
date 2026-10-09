// Connect assistant: shortest part sequences that lead the open end of the main strand exactly to a target socket -
// back into the first part's entry (loop, e.g. lift inlet) or to any free socket (another part's inlet, free lane of an
// X crossing, cross tunnel lane; the UI computes p/n).
//
// Search: meet-in-the-middle on the 8/15 mm grid. All channel dimensions of the 16 mm track are integer multiples of it
// (original dimensions x 8/15: Gerade120 = 64 mm = 120 u, Gerade100 = 53.333 = 100 u, Distanz46 = 24.533 = 46 u,
// R24 = 45 u, R48 = 90 u, lift sockets 16 / 32 mm = 30 / 60 u), so the states (x, y, heading, level, rim) are integers
// and hash exactly. Forward from the open end up to ceil(max/2) parts, backward from the target up to floor(max/2)
// parts, joined where both halves reach the same state. If the target is off the grid (other parts in the chain, e.g.
// flip-flop 28.6), the remainder is the same for all solutions; up to 0.4 mm (like samePlace in the solver) is a hit.
// Every sequence found is then verified with solveChain: position/direction/rim or loop, and no new errors (collisions
// with parts and adapter towers, joints, missing adapters).
import { catalog, entryExit, requiredFeedRim, LEVEL, SCALE, type Part } from './catalog';
import { apply, rotM, solveChain, portW, type ChainElement, type Layout, type PortW } from './chain';
import { t, tf, partName } from './i18n';
import { offGrid, GRID } from './grid';

/** Target: loop (entry of element 0) or a free socket in world coordinates (absolute z = base + PORT_Z, n horizontal,
 *  pointing out of the target part). rimCode: rim the last part must deliver (like requiredFeedRim or the free lane of
 *  an X crossing); if missing, any rim fits. */
export type ConnectTarget =
  | { kind: 'ring' }
  | { kind: 'port'; p: [number, number, number]; n: [number, number, number]; rimCode?: number; label?: string };

/** A suggestion: parts to append (after the last part of strand `strand`, see applyConnection), part count, largest
 *  position error at the target (mm), levels the connection descends, short description. drop: number of parts at the
 *  end of the strand that are removed first (the route starts from the part before them). */
export interface ConnectSuggestion {
  elements: ChainElement[]; n: number; err: number; levels: number; text: string; strand: number; drop: number;
  /** Instead of appending: replace straight runs inside the strand (count parts from index at; elements = all new parts). */
  edits?: RunEdit[];
}
export interface RunEdit { at: number; count: number; parts: ChainElement[] }

/** strand: strand whose open end is led to the target (0 = main strand, default). maxDrop: also search with up to this
 *  many parts removed from the end of that strand (a dead end often needs a different part a step earlier). */
export interface ConnectOptions { maxParts?: number; max?: number; timeMs?: number; strand?: number; maxDrop?: number;
  /** stop once routes would need more than this many parts beyond the shortest one found (saves time) */
  slack?: number;
  /** only routes with at most this many parts changed (added + removed), e.g. when a cheaper fix is already known */
  maxCost?: number }

/** A candidate in one mounting orientation and what it does to the open end (relative to the running direction at the entry). */
export interface ConnectMove {
  part: string; reversed: boolean;
  fwd: number; left: number;       // exit minus entry offset in mm: forward / to the left
  turn: -1 | 0 | 1;                // heading change in quarter turns (+1 = left)
  dLevel: number;                  // level change (0 or -1)
  rimNeed: number | null;          // rim the preceding part must deliver (requiredFeedRim)
  rimOut: number | null;           // rim at the exit
  filler: boolean;                 // filler piece (Distanz46/65, Gerade100/80) - ranked lower at equal part count
  label: string;                   // short name for the suggestion text
}

const U = SCALE;                   // grid unit 8/15 mm
const TOL = 0.4;                   // mm - like samePlace in the solver
const VERIFY_MAX = 400;            // max solveChain checks per call
const VARIANTS_MAX = 4;            // max orderings verified per geometry (order of straights, rim steps)
const MATCH_MAX = 60000;           // max matches of the two halves evaluated per part count
const NODES_MAX = 1500000;         // states per search depth (memory; with maxParts 8 it is a few tens of thousands)
const DIRS: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];

// ---------------------------------------------------------------- Part set
/** Ids of the part set: channel grid (straights 120/100/80/60, flat and falling by one rim step; spacers 65/46), flat
 *  curves R24/R48 in both directions (right = reversed), falling curves R24/R48 (right = mirrored; forward only, since
 *  reversed they would run uphill), level changers Rutsche 120-60 and 100-60 (forward only).
 *  No lifts, flip-flops, X crossings, funnels, spirals, zigzags, loops, tunnels, rails, bowls or adapters. */
function candidateSpecs(): { id: string; reversed: boolean }[] {
  const out: { id: string; reversed: boolean }[] = [];
  for (const len of [120, 100, 80, 60]) for (const r of ['40-40', '50-50', '60-60', '50-40', '60-50']) out.push({ id: `Gerade${len}_${r}_16mm`, reversed: false });
  out.push({ id: 'Distanz65-0_40-40_16mm', reversed: false }, { id: 'Distanz46-0_40-40_16mm', reversed: false });
  for (const base of ['Kurve90', 'LangeKurve90_R90']) {
    for (const r of [40, 50, 60]) for (const reversed of [false, true]) out.push({ id: `${base}_${r}_16mm`, reversed });
    for (const r of ['50-40', '60-50']) for (const m of ['', '_gespiegelt']) out.push({ id: `${base}_${r}${m}_16mm`, reversed: false });
  }
  out.push({ id: 'Rutsche_120-60_16mm', reversed: false }, { id: 'Rutsche120_100-60_16mm', reversed: false });
  return out;
}

/** Quarter turn of a horizontal direction (0 = +x, 1 = +y, 2 = -x, 3 = -y); -1 if it is not axis-parallel. */
function quarter(nx: number, ny: number): number {
  if (Math.abs(Math.hypot(nx, ny) - 1) > 0.01) return -1;
  const a = Math.atan2(ny, nx) / (Math.PI / 2), q = Math.round(a);
  return Math.abs(a - q) > 0.01 ? -1 : ((q % 4) + 4) % 4;
}

/** Short name for the suggestion text in the active language. */
function moveLabel(p: Part, turn: number): string {
  const rimStep = p.rimIn != null && p.rimOut != null && p.rimIn !== p.rimOut && p.family !== 'levelChanger' ? ` ${p.rimIn}→${p.rimOut}` : '';
  if (p.family === 'straight') return tf('connStraight', { n: /^Gerade(\d+)/.exec(p.id)?.[1] ?? '' }) + rimStep;
  if (p.family === 'spacer') return tf('connSpacer', { n: /^Distanz(\d+)/.exec(p.id)?.[1] ?? '' });
  if (p.family === 'curve' || p.family === 'longCurve') return tf('connCurve', { r: p.radius ?? '?', dir: t(turn > 0 ? 'left' : 'right') }) + rimStep;
  if (p.family === 'levelChanger') return tf('connSlide', { a: p.rimIn ?? '?', b: p.rimOut ?? '?' });
  return partName(p).replace(/_16mm$/, '');
}

interface Move extends ConnectMove { fu: number; lu: number; geo: string; idx: number }
let MOVES: Move[] | null = null;
/** Move of a part: entry at the open end (running direction +x), exit relative to it - placed the way solveChain does. */
function buildMoves(specs = candidateSpecs()): Move[] {
  const out: Move[] = [];
  for (const sp of specs) {
    const p = catalog.byId.get(sp.id);
    if (!p || !p.released || (sp.reversed && !p.reversible)) continue;
    const { entry, exit } = entryExit(p, sp.reversed);
    if (!entry || !exit) continue;
    const deg = Math.round(((Math.PI - Math.atan2(entry.n[1], entry.n[0])) * 180) / Math.PI / 90) * 90;
    const R = rotM(deg);
    const [fwd, left] = apply(R, [0, 0], [exit.p[0] - entry.p[0], exit.p[1] - entry.p[1]]);
    const nOut = apply(R, [0, 0], [exit.n[0], exit.n[1]]);
    const q = quarter(nOut[0], nOut[1]);
    const dz = exit.p[2] - entry.p[2], dLevel = Math.round(dz / LEVEL);
    const fu = Math.round(fwd / U), lu = Math.round(left / U);
    // only parts on the grid (whole 8/15 mm units, whole levels, axis-parallel exit) - everything in the set qualifies
    if (q < 0 || q === 2 || Math.abs(dz - dLevel * LEVEL) > 0.01 || Math.abs(fwd - fu * U) > 0.01 || Math.abs(left - lu * U) > 0.01) continue;
    const turn = (q === 1 ? 1 : q === 3 ? -1 : 0) as -1 | 0 | 1;
    const straight = turn === 0 && dLevel === 0 && lu === 0;
    const filler = p.family === 'spacer' || /^Gerade(100|80)_/.test(p.id);
    // geometry key: same key = same track line (rim ignored); straights by length, curves by radius/direction
    const geo = straight ? 'S' + fu : turn ? `C${fu}${turn > 0 ? 'L' : 'R'}` : `W${fu}`;
    out.push({ part: p.id, reversed: sp.reversed && p.reversible, fwd: fu * U, left: lu * U, turn, dLevel, rimNeed: requiredFeedRim(p, sp.reversed),
               rimOut: (sp.reversed && p.reversible ? p.rimIn : p.rimOut), filler, label: moveLabel(p, turn), fu, lu, geo, idx: out.length });
  }
  return out;
}
function moves(): Move[] { return (MOVES ??= buildMoves()); }
let RUN_MOVES: Move[] | null = null;
/** Straights for re-filling a run: the flat straights and spacers of the set plus Gerade88 (60-40, 88 grid units) - not
 *  offered for appending, but a run that contains it can be changed. */
function runMoves(): Move[] {
  return (RUN_MOVES ??= buildMoves([...candidateSpecs(), { id: 'Gerade88_60-40_16mm', reversed: false }])
    .filter((m) => m.turn === 0 && m.lu === 0 && m.dLevel === 0 && m.geo.startsWith('S')));
}

/** The assistant's part set with its moves (for tests and the help). */
export function connectCandidates(): ConnectMove[] {
  return moves().map(({ part, reversed, fwd, left, turn, dLevel, rimNeed, rimOut, filler }) => ({ part, reversed, fwd, left, turn, dLevel, rimNeed, rimOut, filler, label: labelOf(part, turn) }));
}
/** Short name of a move in the active language (the move table is cached, the language can change). */
function labelOf(id: string, turn: number): string { const p = catalog.byId.get(id); return p ? moveLabel(p, turn) : id; }

// ---------------------------------------------------------------- Chain: open end, insertion
/** Index of the last element in the main strand (a new strand starts at the first element with a branch). */
export function mainEnd(elements: ChainElement[]): number { return strandEnd(elements, 0); }
/** Index of the last element of strand s (strands in list order: the main strand, then one per element with a branch);
 *  -1 if there is no such strand. */
export function strandEnd(elements: ChainElement[], s: number): number {
  let k = 0;
  for (let i = 1; i < elements.length; i++) if (elements[i].branch && k++ === s) return i - 1;
  return k === s ? elements.length - 1 : -1;
}
/** The chain with the last `drop` parts of strand s removed; null if that would empty the strand or remove a part
 *  another branch starts at. */
export function trimStrand(elements: ChainElement[], s: number, drop: number): ChainElement[] | null {
  const end = strandEnd(elements, s);
  if (end < 0) return null;
  if (!drop) return elements;
  const gone = elements.slice(end - drop + 1, end + 1);
  if (end - drop + 1 <= 0 || gone.some((e) => e.branch) || elements.some((e) => e.branch && gone.includes(e.branch.from))) return null;
  return [...elements.slice(0, end - drop + 1), ...elements.slice(end + 1)];
}
/** Applies a suggestion: removes its dropped parts and inserts its parts after the last element of its strand (main
 *  strand for a plain list; other strands stay as they are). */
export function applyConnection(elements: ChainElement[], add: ChainElement[] | ConnectSuggestion): ChainElement[] {
  if (!Array.isArray(add) && add.edits) return applyEdits(elements, add.edits);
  const list = Array.isArray(add) ? add : add.elements;
  const s = Array.isArray(add) ? 0 : add.strand;
  const out = (Array.isArray(add) ? elements : trimStrand(elements, s, add.drop) ?? elements).slice();
  out.splice(strandEnd(out, s) + 1, 0, ...list.map((e) => ({ ...e })));
  return out;
}

/** Target socket in world space (layout of the current chain) with the required rim; null if the target does not exist. */
function resolveTarget(L: Layout, target: ConnectTarget): { p: [number, number, number]; n: [number, number]; rim: number | null } | null {
  if (target.kind === 'ring') {
    const first = L.placed[0];
    if (!first || !first.connected || !first.entry) return null;          // start bowl: no entry, no loop
    return { p: [...first.entry.p], n: [first.entry.n[0], first.entry.n[1]], rim: requiredFeedRim(first.part, first.reversed) };
  }
  return { p: [...target.p], n: [target.n[0], target.n[1]], rim: target.rimCode ?? null };
}

/** Which socket of which element a port target is (a free lane, the entry of part 1 ...), so it can be found again after
 *  the chain changed - parts before it may move it. null for a target that is no socket of the chain. */
interface TargetRef { el: ChainElement; port: number; free: boolean }
function targetRef(elements: ChainElement[], L: Layout, target: ConnectTarget): TargetRef | null {
  if (target.kind !== 'port') return null;
  for (const q of L.placed) {
    if (!q.connected) continue;
    for (let i = 0; i < q.part.ports.length; i++) {
      const w = portW(q.part.ports[i], q.R, q.t, q.S);
      if (Math.max(Math.abs(w.p[0] - target.p[0]), Math.abs(w.p[1] - target.p[1]), Math.abs(w.p[2] - target.p[2])) <= TOL
          && w.n[0] * target.n[0] + w.n[1] * target.n[1] > 0.99)
        return { el: elements[q.idx], port: i, free: L.freePorts.some((f) => f.idx === q.idx && f.port === i) };
    }
  }
  return null;
}
/** That socket in another layout of the (changed) chain; null if its element is gone. */
function resolveRef(ref: TargetRef, elements: ChainElement[], L: Layout): PortW | null {
  const q = L.placed[elements.indexOf(ref.el)];
  return q?.connected ? portW(q.part.ports[ref.port], q.R, q.t, q.S) : null;
}

// ---------------------------------------------------------------- Search
/** Search state: position in grid units (forward from the open end, backward from the target), heading, level
 *  (relative to the open end), rim (-1 = any). prev/m: the path that led here. */
interface SNode { prev: SNode | null; m: number; x: number; y: number; h: number; L: number; rim: number }
const RIM_IDX: Record<number, number> = { 40: 0, 50: 1, 60: 2 };
/** "Drop potential": each rim step counts 1, each level 3. Flat parts keep it, all others in the set lower it by 1 (rim
 *  step, Rutsche 100-60) or 3 (Rutsche 120-60) - it never rises. rim -1 = any (wildcard), unknown code: NaN. */
function pot(L: number, rim: number, wildcard: number): number {
  if (rim < 0) return 3 * L + wildcard;
  const r = RIM_IDX[rim];
  return r == null ? Number.NaN : 3 * L + r;
}
function nodeKey(x: number, y: number, h: number, L: number, rim: number): number {
  return ((((x + 32768) * 65536 + (y + 32768)) * 4 + h) * 32 + (16 - L)) * 4 + (RIM_IDX[rim] ?? 3);
}
function pathOf(n: SNode): number[] { const out: number[] = []; for (let s: SNode | null = n; s && s.prev; s = s.prev) out.push(s.m); return out.reverse(); }

interface Cand { ms: number[]; err: number; sig: string; score: number[] }

/** Geometry signature: same signature = same alternative for the user. Straight pieces (straights, spacers, slides)
 *  between two curves are sorted and rims are ignored - the order of straights and the position of rim steps give the
 *  same track line (several orderings are still verified, see VARIANTS_MAX). */
function signature(ms: number[], M: Move[]): string {
  const out: string[] = []; let run: string[] = [];
  const flush = () => { if (run.length) { out.push(...run.sort()); run = []; } };
  for (const i of ms) { const m = M[i]; if (m.turn === 0) run.push(m.geo); else { flush(); out.push(m.geo); } }
  flush();
  return out.join(',');
}
/** Score (smaller = better): part count, filler pieces, distinct part types, position error, then drop as early as
 *  possible (the ball leaves a lift slowly - running on flat would brake it to a standstill). */
function scoreOf(ms: number[], M: Move[], err: number): number[] {
  const fill = ms.filter((i) => M[i].filler).length;
  const distinct = new Set(ms.map((i) => M[i].part)).size;
  let late = 0;
  ms.forEach((i, k) => { const m = M[i]; late += k * ((m.rimNeed != null && m.rimOut != null ? (RIM_IDX[m.rimNeed] ?? 0) - (RIM_IDX[m.rimOut] ?? 0) : 0) - 3 * m.dLevel); });
  return [ms.length, fill, distinct, Math.round(err * 1000), late];
}
function cmpScore(a: number[], b: number[]): number { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; }

function describe(ms: number[], M: Move[]): string {
  const parts: string[] = [];
  const lbl = (k: number) => labelOf(M[ms[k]].part, M[ms[k]].turn);
  for (let i = 0; i < ms.length;) {
    let j = i; while (j < ms.length && lbl(j) === lbl(i)) j++;
    parts.push((j - i > 1 ? `${j - i}× ` : '') + lbl(i));
    i = j;
  }
  return parts.join(' · ');
}

/** Shortest collision-free part sequences from the open end of a strand (default: the main strand) to the target (at
 *  most max, sorted by parts changed, part count, filler pieces, distinct part types, position error, early drop).
 *  With maxDrop, the search also starts 1..maxDrop parts earlier (those parts are replaced). Empty if there are none -
 *  e.g. target higher than the open end (the parts in the set only descend), loop without an entry at element 0 (start
 *  bowl), target not on a level. The target is resolved on the full chain, so it stays put when parts are dropped. */
export function findConnections(elements: ChainElement[], target: ConnectTarget, opts: ConnectOptions = {}): ConnectSuggestion[] {
  const strand = opts.strand ?? 0, maxDrop = Math.max(0, Math.min(3, opts.maxDrop ?? 0));
  const maxOut = Math.max(1, opts.max ?? 5);
  const t0 = Date.now(), deadline = t0 + (opts.timeMs ?? 2500);
  if (!elements.length || (target.kind === 'ring' && strand !== 0)) return [];
  const L = solveChain(elements);
  if (target.kind === 'ring' && L.ring) return [];                        // already closed
  const tg = resolveTarget(L, target); if (!tg) return [];
  const ref = targetRef(elements, L, target);
  const out: ConnectSuggestion[] = [];
  let maxCost = opts.maxCost ?? Infinity;
  for (let drop = 0; drop <= maxDrop && Date.now() < deadline; drop++) {
    const maxParts = Math.min(opts.maxParts ?? 8, maxCost - drop);
    if (maxParts < 1) break;
    const els = trimStrand(elements, strand, drop); if (!els) break;
    if (ref && !els.includes(ref.el)) break;                              // never remove the target part itself
    // later drops share the remaining time; each gets at least its fair part
    const share = (deadline - Date.now()) / (maxDrop - drop + 1);
    // starting with the part that was just removed is the same route as one drop fewer
    const first = elements[strandEnd(elements, strand) - drop + 1];
    const found = searchFrom(els, target, tg, L.placed[0]?.S ?? 0, strand, drop, { ...opts, maxParts, timeMs: share })
      .filter((s) => !drop || s.elements[0].part !== first.part || !!s.elements[0].reversed !== !!first.reversed);
    out.push(...found);
    // with slack: later drops only for routes about as cheap as the best so far
    if (opts.slack != null && found.length) maxCost = Math.min(maxCost, Math.min(...found.map((x) => x.n + x.drop)) + opts.slack);
  }
  const changed = (s: ConnectSuggestion) => s.n + s.drop;
  return out.sort((a, b) => changed(a) - changed(b) || a.drop - b.drop || a.n - b.n).slice(0, maxOut);
}

/** One search from the open end of `strand` in `elements` (already trimmed by `drop`). tg was resolved on the full chain,
 *  whose first part stands at height S0full. */
function searchFrom(elements: ChainElement[], target: ConnectTarget, tgFull: NonNullable<ReturnType<typeof resolveTarget>>, S0full: number,
                    strand: number, drop: number, opts: ConnectOptions): ConnectSuggestion[] {
  const maxParts = Math.max(1, Math.min(10, opts.maxParts ?? 8));
  const maxOut = Math.max(1, opts.max ?? 5);
  const t0 = Date.now(), deadline = t0 + (opts.timeMs ?? 2500);
  const L0 = solveChain(elements);
  const st0 = L0.strands[strand]; if (!st0 || !st0.idxs.length) return [];
  const endIdx = st0.idxs[st0.idxs.length - 1];
  const end = L0.placed[endIdx];
  if (!end || !end.connected || !end.out) return [];                      // strand ends (end bowl, in a lane)
  // fewer parts can change the level normalization (lowest part at 0): move the target with the chain
  const tg = { ...tgFull, p: [tgFull.p[0], tgFull.p[1], tgFull.p[2] + (L0.placed[0].S - S0full)] as [number, number, number] };
  const open = end.out, rim0 = end.outRim ?? -1;
  const h0 = quarter(open.n[0], open.n[1]), hT = quarter(-tg.n[0], -tg.n[1]);
  if (h0 < 0 || hT < 0) return [];
  // level: only down (or equal), whole levels
  const dz = tg.p[2] - open.p[2], LT = Math.round(dz / LEVEL), errZ = Math.abs(dz - LT * LEVEL);
  if (errZ > TOL || LT > 0) return [];
  const rimT = tg.rim ?? -1;
  if (rimT >= 0 && RIM_IDX[rimT] == null) return [];
  const pot0 = pot(0, rim0, 2), potT = pot(LT, rimT, 0);
  if (!(pot0 >= potT)) return [];
  // target relative to the open end in grid units; integer neighbours within 0.4 mm (1 or 2 per axis)
  const Tx = (tg.p[0] - open.p[0]) / U, Ty = (tg.p[1] - open.p[1]) / U;
  const near = (t: number) => [Math.floor(t), Math.ceil(t)].filter((k, i, a) => a.indexOf(k) === i && Math.abs(k - t) * U <= TOL);
  const D: { x: number; y: number; err: number }[] = [];
  for (const kx of near(Tx)) for (const ky of near(Ty)) D.push({ x: kx, y: ky, err: Math.max(Math.abs(kx - Tx) * U, Math.abs(ky - Ty) * U, errZ) });
  if (!D.length) return [];
  // already at the target? Then there is nothing to append
  if (h0 === hT && LT === 0 && D.some((d) => d.x === 0 && d.y === 0) && (rimT < 0 || rim0 < 0 || rim0 === rimT)) return [];

  const M = moves();
  const reach = Math.max(...M.map((m) => Math.hypot(m.fu, m.lu))) + 1;
  const timeUp = () => Date.now() > deadline;

  // forward: states after d parts from the open end
  const fwd: SNode[][] = [[{ prev: null, m: -1, x: 0, y: 0, h: h0, L: 0, rim: rim0 }]];
  const expandF = (d: number): boolean => {
    const out: SNode[] = []; const rem = maxParts - d - 1;
    for (const s of fwd[d]) {
      if (out.length > NODES_MAX || (out.length & 4095) === 0 && timeUp()) return false;
      for (const m of M) {
      if (s.rim >= 0 && m.rimNeed != null && m.rimNeed !== s.rim) continue;   // compatible(): rim must match
      const L = s.L + m.dLevel; if (L < LT) continue;
      const rim = m.rimOut ?? s.rim;
      const pp = pot(L, rim, 2); if (!(pp >= potT) || Math.ceil((pp - potT) / 3) > rem) continue;
      const [ax, ay] = DIRS[s.h], [bx, by] = DIRS[(s.h + 1) & 3];
      const x = s.x + m.fu * ax + m.lu * bx, y = s.y + m.fu * ay + m.lu * by;
      if (Math.hypot(Tx - x, Ty - y) > rem * reach + 1) continue;
      out.push({ prev: s, m: m.idx, x, y, h: (s.h + m.turn + 4) & 3, L, rim });
      }
    }
    fwd.push(out);
    return true;
  };
  // backward: states d parts before the target (x, y relative to the target); rim = rim the preceding part must deliver
  const bwd: SNode[][] = [[{ prev: null, m: -1, x: 0, y: 0, h: hT, L: LT, rim: rimT }]];
  const bwdHash: Map<number, SNode[]>[] = [];
  const expandB = (d: number): boolean => {
    const out: SNode[] = []; const rem = maxParts - d - 1;
    for (const s of bwd[d]) {
      if (out.length > NODES_MAX || (out.length & 4095) === 0 && timeUp()) return false;
      for (const m of M) {
      if (s.rim >= 0 && m.rimOut != null && m.rimOut !== s.rim) continue;
      const L = s.L - m.dLevel; if (L > 0) continue;
      const rim = m.rimNeed ?? -1;
      const pp = pot(L, rim, 0); if (!(pp <= pot0) || Math.ceil((pot0 - pp) / 3) > rem) continue;
      const h = (s.h - m.turn + 4) & 3;
      const [ax, ay] = DIRS[h], [bx, by] = DIRS[(h + 1) & 3];
      const x = s.x - (m.fu * ax + m.lu * bx), y = s.y - (m.fu * ay + m.lu * by);
      if (Math.hypot(Tx + x, Ty + y) > rem * reach + 1) continue;
      out.push({ prev: s, m: m.idx, x, y, h, L, rim });
      }
    }
    bwd.push(out);
    return true;
  };
  const hashOf = (b: number): Map<number, SNode[]> => {
    if (bwdHash[b]) return bwdHash[b];
    const H = new Map<number, SNode[]>();
    for (const s of bwd[b]) for (const r of s.rim >= 0 ? [s.rim] : [40, 50, 60]) {
      const k = nodeKey(s.x, s.y, s.h, s.L, r); const l = H.get(k); if (l) l.push(s); else H.set(k, [s]);
    }
    return (bwdHash[b] = H);
  };

  // verify: append, solve, check target/loop and error count
  const baseErr = L0.issues.filter((i) => i.level === 'error').length;
  const S0 = L0.placed[0].S;
  const first = endIdx + 1;
  let verified = 0;
  const check = (add: ChainElement[]): boolean => {
    verified++;
    const els = applyConnection(elements, { elements: add, strand, drop: 0 } as ConnectSuggestion);
    const L = solveChain(els);
    const errs = L.issues.filter((i) => i.level === 'error');
    if (errs.length > baseErr || errs.some((i) => i.idx.some((k) => k >= first && k < first + add.length))) return false;
    const q = L.placed[first + add.length - 1];
    if (!q || !q.connected || !q.exit) return false;
    if (target.kind === 'ring') return L.ring;
    const dzN = L.placed[0].S - S0;                                         // levels renormalized?
    const e = q.exit;
    if (Math.abs(e.p[0] - tg.p[0]) > TOL || Math.abs(e.p[1] - tg.p[1]) > TOL || Math.abs(e.p[2] - (tg.p[2] + dzN)) > TOL) return false;
    if (e.n[0] * tg.n[0] + e.n[1] * tg.n[1] > -0.99) return false;
    return rimT < 0 || q.rimOutEff == null || q.rimOutEff === rimT;
  };

  const result: ConnectSuggestion[] = [];
  const seen = new Set<string>();
  for (let N = 1; N <= maxParts && result.length < maxOut && verified < VERIFY_MAX && !timeUp(); N++) {
    if (opts.slack != null && result.length && N > result[0].n + opts.slack) break;
    const a = Math.ceil(N / 2), b = N - a;
    while (fwd.length <= a && expandF(fwd.length - 1));
    while (bwd.length <= b && expandB(bwd.length - 1));
    if (fwd.length <= a || bwd.length <= b) break;                         // time or memory exhausted
    const H = hashOf(b);
    // matches of the two halves, grouped by geometry
    const groups = new Map<string, Cand[]>();
    let matches = 0;
    outer: for (const f of fwd[a]) {
      if (f.rim < 0) continue;
      for (const dd of D) {
        const list = H.get(nodeKey(f.x - dd.x, f.y - dd.y, f.h, f.L, f.rim));
        if (!list) continue;
        const head = pathOf(f);
        for (const s of list) {
          const ms = head.slice();
          for (let n: SNode | null = s; n && n.prev; n = n.prev) ms.push(n.m);
          const sig = signature(ms, M);
          if (seen.has(sig)) continue;
          const c: Cand = { ms, err: dd.err, sig, score: scoreOf(ms, M, dd.err) };
          const g = groups.get(sig); if (g) g.push(c); else groups.set(sig, [c]);
          if (++matches >= MATCH_MAX || (matches & 1023) === 0 && timeUp()) break outer;
        }
      }
    }
    // Rank geometries by their best variant; verify up to VARIANTS_MAX orderings per geometry - per ordering of pieces
    // only the best rim distribution (collisions depend on position, not on rim)
    const ranked = [...groups.entries()].map(([sig, list]) => {
      const order = new Set<string>();
      const vs = list.sort((x, y) => cmpScore(x.score, y.score) || (x.ms.join() < y.ms.join() ? -1 : 1))
        .filter((c) => { const k = c.ms.map((i) => M[i].geo).join(); if (order.has(k)) return false; order.add(k); return true; }).slice(0, VARIANTS_MAX);
      return { sig, vs };
    }).sort((x, y) => cmpScore(x.vs[0].score, y.vs[0].score) || (x.sig < y.sig ? -1 : 1));
    for (const { sig, vs } of ranked) {
      if (result.length >= maxOut || verified >= VERIFY_MAX || timeUp()) break;
      seen.add(sig);
      for (const c of vs) {
        if (verified >= VERIFY_MAX || timeUp()) break;
        const add: ChainElement[] = c.ms.map((i) => (M[i].reversed ? { part: M[i].part, reversed: true } : { part: M[i].part }));
        if (!check(add)) continue;
        result.push({ elements: add, n: add.length, err: Math.round(c.err * 1000) / 1000, levels: LT ? -LT : 0, text: describe(c.ms, M), strand, drop });
        break;
      }
    }
  }
  return result;
}

/** Why nothing connects: the gap from the open end of the strand to the target in its running direction (along, + =
 *  target ahead) and sideways, whether that gap is a whole number of grid thirds, and the off-grid parts in the chain
 *  (indices) that shift it. null if the target does not exist or the strand has no open end. */
export function connectGap(elements: ChainElement[], target: ConnectTarget, strand = 0): { along: number; side: number; onGrid: boolean; offGrid: number[] } | null {
  const L = solveChain(elements);
  const tg = resolveTarget(L, target), st = L.strands[strand];
  const end = st && st.idxs.length ? L.placed[st.idxs[st.idxs.length - 1]] : null;
  if (!tg || !end?.connected || !end.out) return null;
  const u = end.out.n, d = [tg.p[0] - end.out.p[0], tg.p[1] - end.out.p[1]];
  const along = d[0] * u[0] + d[1] * u[1], side = -d[0] * u[1] + d[1] * u[0];
  const third = (v: number) => { const k = v / (GRID / 3); return Math.abs(k - Math.round(k)) * (GRID / 3) <= TOL; };
  return { along, side, onGrid: third(along) && third(side), offGrid: L.placed.filter((q) => q.connected && offGrid(q.part)).map((q) => q.idx) };
}

// ---------------------------------------------------------------- Re-fill straight runs
/** Replaces element ranges (the first part of a range keeps its branch anchor; anchors pointing at replaced parts move to
 *  the new part at the same position, or the last one). */
export function applyEdits(elements: ChainElement[], edits: RunEdit[]): ChainElement[] {
  let out = elements.slice();
  for (const e of [...edits].sort((a, b) => b.at - a.at)) {
    const old = out.slice(e.at, e.at + e.count);
    const parts = e.parts.map((p, i) => ({ ...p, ...(i === 0 && old[0]?.branch ? { branch: old[0].branch } : {}) }));
    out.splice(e.at, e.count, ...parts);
    out = out.map((x) => {
      const k = x.branch ? old.indexOf(x.branch.from) : -1;
      return k < 0 ? x : { ...x, branch: { ...x.branch!, from: parts[Math.min(k, parts.length - 1)] } };
    });
  }
  return out;
}

interface Run { at: number; count: number; units: number; u: [number, number]; rimIn: number | null; rimOut: number | null; old: string[] }
/** Straight runs of a strand: maximal sequences of straights/spacers from the assistant's set (flat, no turn). */
function strandRuns(elements: ChainElement[], L: Layout, strand: number): Run[] {
  const st = L.strands[strand]; if (!st) return [];
  const S = runMoves();
  const runs: Run[] = []; let cur: Run | null = null;
  for (const i of st.idxs) {
    const q = L.placed[i], e = elements[i];
    const m = q?.connected && q.entry && q.exit ? S.find((x) => x.part === e.part && x.reversed === !!e.reversed) : undefined;
    if (!m || (cur && cur.at + cur.count !== i)) { if (cur) runs.push(cur); cur = null; }
    if (!m) continue;
    const dx = q.exit!.p[0] - q.entry!.p[0], dy = q.exit!.p[1] - q.entry!.p[1], len = Math.hypot(dx, dy) || 1;
    if (!cur) cur = { at: i, count: 0, units: 0, u: [dx / len, dy / len], rimIn: m.rimNeed, rimOut: m.rimOut, old: [] };
    cur.count++; cur.units += m.fu; cur.rimOut = m.rimOut; cur.old.push(m.part + (m.reversed ? '*' : ''));
  }
  if (cur) runs.push(cur);
  return runs;
}
/** Straight sequences of exactly `units` grid units (up to maxN parts) whose rims chain from rimIn to rimOut, best first:
 *  fewest parts, fewest fillers, most parts kept from the old run. */
function fillRun(units: number, rimIn: number | null, rimOut: number | null, old: string[], maxN = 4): Move[][] {
  const S = runMoves();
  const out: Move[][] = []; const seq: Move[] = [];
  const go = (left: number, rim: number | null) => {
    if (left === 0 && seq.length && (rimOut == null || rim === rimOut)) { out.push(seq.slice()); return; }
    if (left <= 0 || seq.length >= maxN) return;
    for (const m of S) {
      if (m.fu > left || (rim != null && m.rimNeed != null && m.rimNeed !== rim)) continue;
      seq.push(m); go(left - m.fu, m.rimOut ?? rim); seq.pop();
    }
  };
  go(units, rimIn);
  const kept = (ms: Move[]) => ms.filter((m, i) => old[i] === m.part + (m.reversed ? '*' : '')).length;
  const key = (ms: Move[]) => [ms.length, ms.filter((m) => m.filler).length, -kept(ms)];
  return out.sort((a, b) => cmpScore(key(a), key(b))).filter((ms, i, a) => a.findIndex((x) => x.map((m) => m.idx).join() === ms.map((m) => m.idx).join()) === i);
}

/** Lengths (grid units) a run from rimIn to rimOut can have with up to maxN straights -> fewest parts for it. */
const LEN_CACHE = new Map<string, Map<number, number>>();
function runLengths(rimIn: number | null, rimOut: number | null, maxN = 4): Map<number, number> {
  const key = `${rimIn}|${rimOut}|${maxN}`, hit = LEN_CACHE.get(key); if (hit) return hit;
  const out = new Map<number, number>(), S = runMoves();
  const go = (len: number, rim: number | null, n: number) => {
    if (n && (rimOut == null || rim === rimOut) && !(out.get(len)! <= n)) out.set(len, n);
    if (n >= maxN) return;
    for (const m of S) if (rim == null || m.rimNeed == null || m.rimNeed === rim) go(len + m.fu, m.rimOut ?? rim, n + 1);
  };
  go(0, rimIn, 0);
  LEN_CACHE.set(key, out);
  return out;
}

/** Lengthen or shorten one straight run of the strand - or two perpendicular ones, or two parallel ones (one longer, the
 *  other one running the opposite way also longer: the difference closes the gap) - so that its open end, already
 *  pointing the right way, arrives at the target: everything after a run moves with it. For the case appending cannot fix: the
 *  end is a few grid steps short or long (or beside the target) because an earlier straight has the wrong length.
 *  Verified with solveChain (target reached, no new errors). n = parts in the new runs, drop = parts they replace. */
export function findRunAdjustments(elements: ChainElement[], target: ConnectTarget, opts: { strand?: number; max?: number } = {}): ConnectSuggestion[] {
  const strand = opts.strand ?? 0, maxOut = opts.max ?? 3;
  if (!elements.length || (target.kind === 'ring' && strand !== 0)) return [];
  const L0 = solveChain(elements);
  if (target.kind === 'ring' && L0.ring) return [];
  const tg = resolveTarget(L0, target); if (!tg) return [];
  const st = L0.strands[strand]; if (!st || !st.idxs.length) return [];
  const end = L0.placed[st.idxs[st.idxs.length - 1]];
  if (!end?.connected || !end.out) return [];
  const e = end.out;
  if (e.n[0] * tg.n[0] + e.n[1] * tg.n[1] > -0.99 || Math.abs(tg.p[2] - e.p[2]) > TOL) return [];   // must already face the target
  const d: [number, number] = [tg.p[0] - e.p[0], tg.p[1] - e.p[1]];
  if (Math.hypot(d[0], d[1]) < TOL) return [];
  const ref = targetRef(elements, L0, target);
  if (target.kind === 'port' && !ref) return [];                          // only targets that can be found again
  const runs = strandRuns(elements, L0, strand);
  const baseErr = L0.issues.filter((i) => i.level === 'error').length;
  // plans: (run, delta in units) - one run along d, or two perpendicular runs spanning it
  const plans: { run: Run; du: number }[][] = [];
  const units = (v: number) => { const k = Math.round(v / U); return Math.abs(k * U - v) <= TOL ? k : null; };
  for (const r of runs) {
    const along = d[0] * r.u[0] + d[1] * r.u[1], side = Math.abs(-d[0] * r.u[1] + d[1] * r.u[0]);
    const k = units(along); if (side <= TOL && k) plans.push([{ run: r, du: k }]);
  }
  for (const a of runs) for (const b of runs) {
    if (b.at <= a.at || Math.abs(a.u[0] * b.u[0] + a.u[1] * b.u[1]) > 0.01) continue;
    const ka = units(d[0] * a.u[0] + d[1] * a.u[1]), kb = units(d[0] * b.u[0] + d[1] * b.u[1]);
    if (ka && kb) plans.push([{ run: a, du: ka }, { run: b, du: kb }]);
  }
  // two parallel runs along d: du_a + sb * du_b = k (sb = +1 same direction, -1 opposite); fewest parts, smallest change
  const pairs: { plan: { run: Run; du: number }[]; cost: number }[] = [];
  for (const a of runs) for (const b of runs) {
    const sb = a.u[0] * b.u[0] + a.u[1] * b.u[1];
    if (b.at <= a.at || Math.abs(Math.abs(sb) - 1) > 0.01) continue;
    const side = Math.abs(-d[0] * a.u[1] + d[1] * a.u[0]), k = units(d[0] * a.u[0] + d[1] * a.u[1]);
    if (side > TOL || k == null) continue;
    const lb = runLengths(b.rimIn, b.rimOut);
    for (const [la, na] of runLengths(a.rimIn, a.rimOut)) {
      const dua = la - a.units, dub = Math.round((k - dua) * sb), nb = lb.get(b.units + dub);
      if (!dua || !dub || nb == null) continue;
      pairs.push({ plan: [{ run: a, du: dua }, { run: b, du: dub }], cost: (na + nb) * 1000 + Math.abs(dua) + Math.abs(dub) });
    }
  }
  plans.push(...pairs.sort((x, y) => x.cost - y.cost).slice(0, 12).map((p) => p.plan));
  const result: ConnectSuggestion[] = [];
  for (const plan of plans) {
    const fills = plan.map(({ run, du }) => fillRun(run.units + du, run.rimIn, run.rimOut, run.old).slice(0, 4));
    if (fills.some((f) => !f.length)) continue;
    // try the best few combinations of fills
    const combos: Move[][][] = fills.length === 1 ? fills[0].map((f) => [f]) : fills[0].flatMap((f0) => fills[1].map((f1) => [f0, f1]));
    for (const combo of combos) {
      const edits: RunEdit[] = plan.map(({ run }, i) => ({ at: run.at, count: run.count,
        parts: combo[i].map((m) => (m.reversed ? { part: m.part, reversed: true } : { part: m.part })) }));
      const els = applyEdits(elements, edits);
      const L = solveChain(els);
      if (L.issues.filter((i) => i.level === 'error').length > baseErr) continue;
      if (!arrives(els, L, strand, target, ref, tg.rim)) continue;
      const added = edits.flatMap((x) => x.parts), removed = plan.reduce((n, p) => n + p.run.count, 0);
      const text = plan.map(({ run }, i) => `${run.old.map(shortMove).join(' + ')} → ${combo[i].map((m) => labelOf(m.part, m.turn)).join(' + ')}`).join('; ');
      result.push({ elements: added, n: added.length, err: 0, levels: 0, text, strand, drop: removed, edits });
      break;
    }
  }
  return result.sort((a, b) => a.n + a.drop - (b.n + b.drop)).slice(0, maxOut);
}
/** After a change: does the strand end where the target socket now is (parts before it may have moved it) - the part's
 *  own exit (out moves on to the far end of a lane it docks into) at the socket's position and height, facing into it,
 *  with the required rim; a free lane must be taken. A loop: L.ring. */
function arrives(els: ChainElement[], L: Layout, strand: number, target: ConnectTarget, ref: TargetRef | null, rim: number | null): boolean {
  if (target.kind === 'ring') return L.ring;
  const st = L.strands[strand], q = st && st.idxs.length ? L.placed[st.idxs[st.idxs.length - 1]] : null;
  const w = ref && resolveRef(ref, els, L);
  if (!q?.connected || !q.exit || !w) return false;
  if (Math.max(Math.abs(q.exit.p[0] - w.p[0]), Math.abs(q.exit.p[1] - w.p[1]), Math.abs(q.exit.p[2] - w.p[2])) > TOL) return false;
  if (q.exit.n[0] * w.n[0] + q.exit.n[1] * w.n[1] > -0.99) return false;
  if (rim != null && rim >= 0 && q.rimOutEff != null && q.rimOutEff !== rim) return false;
  return !ref!.free || !L.freePorts.some((f) => els[f.idx] === ref!.el && f.port === ref!.port);
}
function shortMove(s: string): string { const m = runMoves().find((x) => x.part + (x.reversed ? '*' : '') === s); return m ? labelOf(m.part, m.turn) : s; }
