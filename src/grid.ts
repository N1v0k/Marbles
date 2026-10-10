// Grid helpers.
// Where does the open end lie in the 8 mm grid of the chain start? Almost all parts keep the grid (Gerade120 = 64 mm,
// Gerade60 = 32, Distanz45 = 24, curves R24/R48, lift sockets 16/32); Gerade80 and Distanz65 shift by +1/3 grid (2.667 mm),
// Gerade100 by +2/3. Along the running direction a one-third offset can therefore be fixed with one part; across only after
// a curve. Off-grid parts (Distanz46, flip-flop, funnel, spiral) yield 'off'. Distanz45 fills the gaps of
// 3, 6, 7, 9 and 10 grid units exactly (e.g. Gerade60 + Distanz45 = 56 mm = 7 units).
// nearRing: if the main strand ends just short of the first part's entry (loop almost closed), the UI says by how much.
import type { Layout, PortW } from './chain';

export const GRID = 8;                 // mm
const THIRD = GRID / 3;                // 2.667 mm
const TOL = 0.3;                       // mm: counts as on the grid or exactly one third

/** State of one axis: 'on' = on the grid, 'third' / 'twoThirds' = how much is missing to the next grid point in running
 *  direction, 'off' = off the one-third grid. need: mm to the next grid point (along, forward) or the smallest distance
 *  to a grid line (across). */
export type GridState = 'on' | 'third' | 'twoThirds' | 'off';
export interface GridAxis { state: GridState; need: number }
export interface GridInfo { along: GridAxis; across: GridAxis }

const mod = (a: number, m: number) => ((a % m) + m) % m;
function classify(need: number): GridState {
  if (need < TOL || need > GRID - TOL) return 'on';
  if (Math.abs(need - THIRD) < TOL) return 'third';
  if (Math.abs(need - 2 * THIRD) < TOL) return 'twoThirds';
  return 'off';
}

/** Position of the open end `end` in the grid of the reference socket `ref` (entry or exit of the first part). null if
 *  the running direction is not axis-parallel. */
export function gridInfo(ref: PortW, end: PortW): GridInfo | null {
  const ux = end.n[0], uy = end.n[1];
  const len = Math.hypot(ux, uy);
  if (len < 1e-6) return null;
  const u = [ux / len, uy / len];
  if (Math.min(Math.abs(u[0]), Math.abs(u[1])) > 1e-3) return null;
  const d = [end.p[0] - ref.p[0], end.p[1] - ref.p[1]];
  const along = d[0] * u[0] + d[1] * u[1];
  const across = -d[0] * u[1] + d[1] * u[0];
  const needAlong = mod(-along, GRID);
  const r = mod(across, GRID), offAcross = Math.min(r, GRID - r);
  const stateAcross = offAcross < TOL ? 'on' : Math.abs(offAcross - THIRD) < TOL ? 'third' : 'off';
  return { along: { state: classify(needAlong), need: needAlong }, across: { state: stateAcross, need: offAcross } };
}

/** Grid reference socket: entry of the first part (lift, loop) or its exit (start bowl). */
export function gridRef(L: Layout): PortW | null {
  const q = L.placed[0];
  if (!q || !q.connected) return null;
  return q.entry ?? q.exit;
}

/** Loop almost closed: the main strand ends at most maxDist mm beside the first part's entry, facing it.
 *  Returns the offset (target minus end, mm) or null. */
export function nearRing(L: Layout, maxDist = 3): { dx: number; dy: number; dz: number } | null {
  if (L.ring) return null;
  const first = L.placed[0];
  if (!first || !first.connected || !first.entry) return null;
  const st = L.strands[0]; if (!st || !st.idxs.length) return null;
  const last = L.placed[st.idxs[st.idxs.length - 1]];
  if (!last || last === first || !last.connected || !last.out) return null;
  const e = last.out, f = first.entry;
  if (e.n[0] * f.n[0] + e.n[1] * f.n[1] > -0.99) return null;     // exit must point into the entry
  const dx = f.p[0] - e.p[0], dy = f.p[1] - e.p[1], dz = f.p[2] - e.p[2];
  if (Math.hypot(dx, dy) > maxDist || Math.abs(dz) > 1) return null;
  if (Math.hypot(dx, dy, dz) < 0.05) return null;
  return { dx, dy, dz };
}
