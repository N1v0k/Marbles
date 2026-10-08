#!/usr/bin/env python3
"""Measure the sockets of the 16 mm parts directly from STL files (numpy + trimesh).

Every part of the 16 mm system has sockets only; parts are joined with a loose pin.
- Horizontal socket: floor 8.30 x 7.40 (width 7.00 + 2 x groove 0.65; z 2.0..9.4), 10.6 deep from the end face.
  Port = point on the end face (socket mouth, centre z 5.7 above the base), n = outward normal.
- Vertical socket: the same socket open downwards (parts, adapters) or upwards (adapters), with 0.07 clearance all
  round: roof 8.44 x 7.54 at depth 10.6, counterbore for the pin collar (ear pockets 9.74 x 3.80) at depth 1.1. The
  counterbore is measured (on rails the roof is split by the hump); the roof decides on which side the ears sit (flat
  side of the D profile). Result per socket: centre (x, y), width axis 'x'/'y', ear side +-1.
  An adapter fits under a part if its top socket matches the part's bottom socket in centre, width axis AND ear side -
  the pin has a D profile and fits in one orientation only.

Usage: python stl16.py <file.stl> [...]   -> one JSON line per file
"""
import json, os, struct, sys
import numpy as np

HS_W, HS_H, HS_DEPTH = 8.30, 7.40, 10.6      # horizontal socket: floor width (incl. grooves) x height, depth
VS_D, CB_W, CB_D, VS_HALF = 7.54, 9.74, 3.80, 3.77   # vertical socket: D direction, counterbore width x depth, half D width
TOL = 0.12


def load_stl(fn):
    """Triangles (n, 3, 3) from a binary or ASCII STL."""
    with open(fn, 'rb') as fh: b = fh.read()
    if b[:5] == b'solid' and b'facet' in b[:400]:
        import re
        vs = re.findall(rb'vertex\s+(\S+)\s+(\S+)\s+(\S+)', b)
        return np.array(vs, dtype=np.float64).reshape(-1, 3, 3)
    n = struct.unpack('<I', b[80:84])[0]
    a = np.frombuffer(b[84:84 + n * 50], dtype=np.dtype([('n', '<3f4'), ('v', '<9f4'), ('a', '<u2')]))
    return a['v'].reshape(-1, 3, 3).astype(np.float64)


def indexed(tri):
    """Triangles -> (V, F) with welded vertices (exact equality is enough for the CAD exports). Degenerate triangles are
    dropped, together with vertices used only by them (unused vertices would break kbm3())."""
    V = tri.reshape(-1, 3)
    uniq, inv = np.unique(V, axis=0, return_inverse=True)
    F = inv.reshape(-1, 3)
    ok = (F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])
    F = F[ok]
    used, F2 = np.unique(F, return_inverse=True)
    if len(used) == len(uniq): return uniq, F
    return uniq[used], F2.reshape(-1, 3)


def mesh(tri):
    import trimesh
    V, F = indexed(tri)
    return trimesh.Trimesh(V, F, process=False)


def _r(x): return round(float(x), 3) + 0.0


def hsockets(m):
    """Horizontal sockets: a planar connected facet with horizontal normal and the socket floor's size."""
    out = []
    for f, n, a in zip(m.facets, m.facets_normal, m.facets_area):
        if abs(n[2]) >= 0.01: continue
        V = m.triangles[f].reshape(-1, 3); n = n / np.linalg.norm(n); side = np.cross([0, 0, 1.0], n)
        u = V @ side; z = V[:, 2]
        if abs(np.ptp(u) - HS_W) < TOL and abs(np.ptp(z) - HS_H) < TOL and abs(a - 55.6) < 2.5:
            c = (u.min() + u.max()) / 2 * side + float((V @ n).mean()) * n + np.array([0, 0, (z.min() + z.max()) / 2])
            p = c + n * HS_DEPTH
            out.append({'p': [_r(x) for x in p], 'n': [_r(round(x)) if abs(abs(x) - 1) < 1e-3 or abs(x) < 1e-3 else _r(x) for x in n]})
    return out


def _components(F):
    parent = {}
    def find(a):
        while parent.setdefault(a, a) != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    for f in F:
        ra = find(int(f[0]))
        for v in f[1:]:
            rb = find(int(v))
            if ra != rb: parent[rb] = ra
    comp = {}
    for i, f in enumerate(F): comp.setdefault(find(int(f[0])), []).append(i)
    return list(comp.values())


def _flat(m, sign, z, tol=0.004):
    n = m.face_normals; tri = m.triangles
    sel = np.nonzero((np.sign(n[:, 2]) == sign) & (np.abs(n[:, 2]) > 0.99999) & (np.all(np.abs(tri[:, :, 2] - z) < tol, axis=1)))[0]
    if not len(sel): return []
    return [tri[sel[c]].reshape(-1, 3) for c in _components(m.faces[sel])]


def vsockets(m):
    """Vertical sockets: {'bottom': [...], 'top': [...]}, each {'c': [x, y], 'wax': 'x'|'y', 'ear': -1|1}."""
    zs = m.bounds[:, 2]; res = {'bottom': [], 'top': []}
    for key, zcb, zroof, sign in (('bottom', zs[0] + 1.1, zs[0] + 10.6, -1), ('top', zs[1] - 1.1, zs[1] - 10.6, 1)):
        roofs = _flat(m, sign, zroof)
        P = _flat(m, sign, zcb); used = set(); cands = []
        # the counterbore consists of two ear pockets (or one face): test faces singly or in pairs
        for i in range(len(P)):
            for j in [None] + list(range(i + 1, len(P))):
                if i in used or (j is not None and j in used): continue
                S = P[i] if j is None else np.vstack([P[i], P[j]])
                wx, wy = np.ptp(S[:, 0]), np.ptp(S[:, 1])
                if (abs(wx - CB_W) < TOL and abs(wy - CB_D) < TOL) or (abs(wy - CB_W) < TOL and abs(wx - CB_D) < TOL):
                    cands.append(S); used.add(i)
                    if j is not None: used.add(j)
                    break
        for S in cands:
            wx, wy = np.ptp(S[:, 0]), np.ptp(S[:, 1])
            wax, dax = ('x', 1) if abs(wx - CB_W) < TOL else ('y', 0)
            lo, hi = S[:, dax].min(), S[:, dax].max(); wc = (S[:, 1 - dax].min() + S[:, 1 - dax].max()) / 2
            dc = [lo + VS_HALF, hi - VS_HALF]           # ears on the lo or hi side
            sc = (lo + hi) / 2
            RV = [R[(np.abs(R[:, 1 - dax] - wc) < 5) & (np.abs(R[:, dax] - sc) < 8)] for R in roofs]
            RV = [r for r in RV if len(r)]
            if not RV: continue
            RV = np.vstack(RV); rc = (RV[:, dax].min() + RV[:, dax].max()) / 2
            ci = int(np.argmin([abs(rc - d) for d in dc]))
            c = [wc, dc[ci]] if dax == 1 else [dc[ci], wc]
            res[key].append({'c': [_r(c[0]), _r(c[1])], 'wax': wax, 'ear': -1 if ci == 0 else 1})
    for k in res: res[k].sort(key=lambda s: (s['c'][0], s['c'][1]))
    return res


def measure(fn):
    tri = load_stl(fn); m = mesh(tri)
    return {'bb': np.round(m.bounds, 3).tolist(), 'ports': hsockets(m), 'vsock': vsockets(m),
            'volume': float(abs(m.volume)), 'area': float(m.area), 'bodies': int(m.body_count), 'watertight': bool(m.is_watertight)}


if __name__ == '__main__':
    for fn in sys.argv[1:]:
        print(json.dumps({'file': os.path.basename(fn), **measure(fn)}))
