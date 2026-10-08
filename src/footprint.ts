// Footprint polygons (convex pieces) per part for collision checks - more precise than bounding boxes, because curves,
// spiral and funnel are round and neighbouring parts may reach into their "empty corners".
import { LEVEL, rimMm, type Part } from './catalog';
import { apply, type Mat2, type Vec2 } from './chain';

export type Poly = [number, number][];
export interface Piece { poly: Poly; z0: number; z1: number }

function rect(x0: number, y0: number, x1: number, y1: number): Poly { return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; }
function circle(cx: number, cy: number, r: number, n = 16): Poly {
  const out: Poly = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return out;
}
/** Annular sector as convex quads. Angles in degrees, counter-clockwise. */
function ringSector(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number, n = 6): Poly[] {
  const out: Poly[] = [];
  const da = (a1 - a0) / n;
  for (let i = 0; i < n; i++) {
    const b0 = ((a0 + i * da) * Math.PI) / 180, b1 = ((a0 + (i + 1) * da) * Math.PI) / 180;
    // push the outer edge slightly outwards (the chord lies inside the arc)
    const ro = r1 / Math.cos((b1 - b0) / 2);
    out.push([[cx + r0 * Math.cos(b0), cy + r0 * Math.sin(b0)], [cx + ro * Math.cos(b0), cy + ro * Math.sin(b0)],
              [cx + ro * Math.cos(b1), cy + ro * Math.sin(b1)], [cx + r0 * Math.cos(b1), cy + r0 * Math.sin(b1)]]);
  }
  return out;
}

/** Y merge: one branch from (0 | 16*sign) to (64 | 0) made of two circular arcs with the same turning angle (tight R 25.5
 *  up to x 12, then flat R 110.5), footprint +-13.333 perpendicular to the branch - as convex quads along the branch. */
function yMergeBranch(sign: number): Poly[] {
  const D = 16, L = 64, L1 = 12, th = 2 * Math.atan(D / L), r1 = L1 / Math.sin(th), r2 = (L - L1) / Math.sin(th), w = 13.333;
  const at = (x: number): [number, number, number, number] => {
    let y: number, dy: number;
    if (x <= L1) { const s = Math.sqrt(r1 * r1 - x * x); y = D - r1 + s; dy = -x / s; }
    else { const u = L - x, s = Math.sqrt(r2 * r2 - u * u); y = r2 - s; dy = -u / s; }
    const n = Math.hypot(1, dy);
    return [x, sign * y, -sign * dy / n, 1 / n];   // centre (x, y) and normal (across the branch)
  };
  const xs = [0, 3, 6, 9, 12, 20, 28, 36, 44, 52, 58, 64].map(at);
  const out: Poly[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const [x0, y0, nx0, ny0] = xs[i], [x1, y1, nx1, ny1] = xs[i + 1];
    out.push([[x0 - nx0 * w, y0 - ny0 * w], [x1 - nx1 * w, y1 - ny1 * w], [x1 + nx1 * w, y1 + ny1 * w], [x0 + nx0 * w, y0 + ny0 * w]]);
  }
  return out;
}

const cache = new Map<string, Piece[]>();

/** Convex footprint pieces in part coordinates (z relative to the base). Special shapes are measured on the STLs
 *  (bounding box, socket positions). */
export function footprintPieces(p: Part): Piece[] {
  const c = cache.get(p.id);
  if (c) return c;
  const carrier = p.family === 'adapter' || p.id.startsWith('AdapterTunnel');
  const z0 = carrier ? 0 : p.bbox[0][2];
  const z1 = carrier ? LEVEL : p.bbox[1][2];
  const f = p.foot;
  let polys: Poly[];
  if (p.lift) {
    // lift: housing (bottom .. top) as a block, above it the circle swept by the crank (room to turn it)
    const L = p.lift;
    const pieces: Piece[] = [{ poly: rect(f[0], f[1], f[2], f[3]), z0: 0, z1: L.housingTop },
                             { poly: circle(0, 0, L.crankR, 20), z0: L.crankZ[0], z1: L.crankZ[1] }];
    cache.set(p.id, pieces);
    return pieces;
  }
  if (p.id.startsWith('Spirale')) {
    // helix: inlet at (-42.7 | -24) on rim 100 (platform level), one turn R24, outlet rim 60 at (12.8 | -24)
    const rOut = Math.max(p.bbox[1][0], p.bbox[1][1]);
    const pieces: Piece[] = [
      { poly: circle(0, 0, 15.5), z0: 0, z1: rimMm(100) },                  // column r 15.47
      { poly: rect(-42.667, -37.333, -10.667, -10.667), z0: LEVEL, z1: rimMm(100) },  // inlet channel (platform level)
      { poly: rect(-10.667, -37.333, p.ports[p.lane[1] ?? 0].p[0], -10.667), z0: 0, z1: rimMm(62) },  // outlet block up to the outlet end face
    ];
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a0 = -90 + (360 / n) * i, a1 = a0 + 360 / n;
      const rim = rimMm(100 - (40 * (i + 0.5)) / n);
      for (const poly of ringSector(0, 0, 15.5, rOut, a0, a1, 1)) pieces.push({ poly, z0: i >= n - 2 ? 0 : rim - 13.333, z1: rim + 1 });
    }
    cache.set(p.id, pieces);
    return pieces;
  } else if (p.id.startsWith('Trichter') || p.id.startsWith('AdapterTrichter')) {
    polys = [circle(0, 0, 38.133), rect(32, -13.333, f[2], 13.333), rect(f[0], 14.933, -20.533, f[3])];
  } else if (p.id.startsWith('AdapterSpirale')) {
    // spiral height adapter: column disc r 15.467 + bar under inlet and outlet (y -37.333 .. -10.667)
    polys = [circle(0, 0, 15.467), rect(f[0], -37.333, 12.8, -10.667)];
  } else if (p.id.startsWith('Kippwippe_120-60') || p.id.startsWith('AdapterKippwippe')) {
    // flip-flop (body and height adapter): tower x 0..10.6 (|y| 13.333), block x 10.6..47.6 (|y| 36)
    polys = [rect(0, -13.333, 10.6, 13.333), rect(10.6, f[1], f[2], f[3])];
  } else if (p.id.startsWith('XKreuzung') || p.id.startsWith('AdapterXKreuzung')) {
    polys = [rect(f[0], -13.333, f[2], 13.333), rect(-13.333, f[1], 13.333, f[3])];
  } else if (p.id.startsWith('YMerge') || p.id.startsWith('AdapterYMerge')) {   // Y merge and its height adapter
    // plus the wedge between the inlets (solid up to rim height), where the two footprints are still apart
    polys = [...yMergeBranch(1), ...yMergeBranch(-1), rect(0, -14, 12, 14)];
  } else if (p.id.startsWith('StartSchale') || p.id.startsWith('AdapterStart')) {
    // disc r16 + footprint up to the outlet end face
    polys = [circle(0, 0, 16), rect(0, -13.333, f[2], 13.333)];
  } else if (p.id.startsWith('EndSchale')) {
    // straight inlet (footprint +-13.3) + round basin with base disc r 20.27 around x 30.93
    polys = [rect(0, -13.333, 30.933, 13.333), circle(30.933, 0, 20.267)];
  } else if ((p.turn === 90 || p.turn === -90) && p.center && p.radius) {
    // curve: annular sector from entry to exit
    const pin = p.ports[p.lane[0] ?? 0], pout = p.ports[p.lane[1] ?? 1];
    const a0 = (Math.atan2(pin.p[1] - p.center[1], pin.p[0] - p.center[0]) * 180) / Math.PI;
    let a1 = (Math.atan2(pout.p[1] - p.center[1], pout.p[0] - p.center[0]) * 180) / Math.PI;
    while (a1 - a0 > 180) a1 -= 360; while (a1 - a0 < -180) a1 += 360;
    const w = 13.333; // footprint 26.67 wide
    polys = ringSector(p.center[0], p.center[1], Math.max(0.1, p.radius - w), p.radius + w, Math.min(a0, a1), Math.max(a0, a1));
  } else {
    polys = [rect(f[0], f[1], f[2], f[3])];
  }
  const pieces = polys.map((poly) => ({ poly, z0, z1 }));
  cache.set(p.id, pieces);
  return pieces;
}

export interface WPiece { poly: Poly; z0: number; z1: number }
export function worldPieces(p: Part, R: Mat2, t: Vec2, S: number, zOverride?: [number, number]): WPiece[] {
  return footprintPieces(p).map((pc) => ({
    poly: pc.poly.map((v) => apply(R, t, v)),
    z0: S + (zOverride ? zOverride[0] : pc.z0), z1: S + (zOverride ? zOverride[1] : pc.z1),
  }));
}

/** Is the point (x, y, z) inside one of the pieces? (Polygons are convex, any winding order.) */
export function pointInside(pieces: WPiece[], x: number, y: number, z: number, tol = 0): boolean {
  for (const pc of pieces) {
    if (z < pc.z0 - tol || z > pc.z1 + tol) continue;
    let pos = 0, neg = 0;
    for (let i = 0; i < pc.poly.length; i++) {
      const a = pc.poly[i], b = pc.poly[(i + 1) % pc.poly.length];
      const d = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
      if (d > tol) pos++; else if (d < -tol) neg++;
    }
    if (!pos || !neg) return true;
  }
  return false;
}

/** Convex polygons: penetration depth via the separating axis theorem (0 if separated). */
export function penetration(a: Poly, b: Poly): number {
  let minOverlap = Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
      let nx = -(p2[1] - p1[1]), ny = p2[0] - p1[0];
      const len = Math.hypot(nx, ny); if (len < 1e-9) continue;
      nx /= len; ny /= len;
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      for (const v of a) { const d = v[0] * nx + v[1] * ny; if (d < amin) amin = d; if (d > amax) amax = d; }
      for (const v of b) { const d = v[0] * nx + v[1] * ny; if (d < bmin) bmin = d; if (d > bmax) bmax = d; }
      const o = Math.min(amax, bmax) - Math.max(amin, bmin);
      if (o <= 0) return 0;
      if (o < minOverlap) minOverlap = o;
    }
  }
  return minOverlap;
}

/** Do two footprints overlap in top view (ignoring z)? Returns the largest penetration depth.
 *  Used for "what stands on what" - there the z ranges precisely do NOT overlap. */
export function piecesOverlapXY(A: WPiece[], B: WPiece[], tol = 1): number {
  let worst = 0;
  for (const a of A) for (const b of B) {
    const d = penetration(a.poly, b.poly);
    if (d > tol && d > worst) worst = d;
  }
  return worst;
}

/** Do two piece sets intersect (with tolerance in mm)? Returns the largest penetration depth. */
export function piecesCollide(A: WPiece[], B: WPiece[], tol = 0.6): number {
  let worst = 0;
  for (const a of A) for (const b of B) {
    if (a.z0 + tol >= b.z1 || b.z0 + tol >= a.z1) continue;
    const d = penetration(a.poly, b.poly);
    if (d > tol && d > worst) worst = d;
  }
  return worst;
}
