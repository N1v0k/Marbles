#!/usr/bin/env python3
"""STL exports -> compact web format .kbm for the 3D preview and the thumbnails.

KBM3: 'KBM3' | nV u32 | nT u32 | scale f32 | gzip(positions + indices). Positions are int16-quantised (scale = mm per
unit), vertices in order of first use, per axis as delta to the previous vertex, low and high bytes stored separately
(x/y/z lo, then x/y/z hi); indices as delta to the previous index, zigzag-encoded, uint32 split into 4 byte planes.
About a third of the size of KBM1 - matters for the single-file build (plain + Japandi meshes embedded).

Source: tools/config.json (stl_dir, japandi_dir). Parts with more than MAXTRIS triangles are simplified (pymeshlab,
quadric edge collapse). Japandi: grooved parts only (catalogue field jp), output src/meshes_j/.
Usage: python tools/convert_meshes.py [--plain | --japandi] [part ...]   - without parts: the whole catalogue.
"""
import gzip, json, struct, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))
CFG = json.load(open(os.path.join(HERE, 'config.json'), encoding='utf-8'))
STL_DIR = os.path.normpath(os.path.join(ROOT, CFG['stl_dir']))
OUT = os.path.join(ROOT, 'src', 'meshes')
J_DIR = os.path.normpath(os.path.join(ROOT, CFG['japandi_dir'])) if CFG.get('japandi_dir') else None
J_OUT = os.path.join(ROOT, 'src', 'meshes_j')
sys.path.insert(0, HERE)
from stl16 import load_stl, indexed  # noqa: E402
try:
    import pymeshlab  # noqa: E402
except ImportError:
    sys.exit('ERROR: pymeshlab is missing (pip install pymeshlab) - without it there is no usable simplification.')

args = sys.argv[1:]
do_plain = '--japandi' not in args; do_j = '--plain' not in args
args = [a for a in args if not a.startswith('--')]
os.makedirs(OUT, exist_ok=True); os.makedirs(J_OUT, exist_ok=True)
cat = json.load(open(os.path.join(ROOT, 'src', 'data', 'parts.json'), encoding='utf-8'))['parts']
only = set(args)
if only:
    unknown = only - {p['id'] for p in cat}
    if unknown: sys.exit('Unknown parts: %s' % sorted(unknown))
    cat = [p for p in cat if p['id'] in only]
MAXTRIS = 12000
MAXTRIS_J = 16000   # grooved parts: larger budget, otherwise the simplification smooths the grooves away
SCALE = 0.005  # mm per unit (16 mm parts are small); coarsened per part if the coordinates do not fit into int16



def reduce(V, F, maxtris=None):
    """Reduce to at most maxtris triangles (default MAXTRIS): MeshLab quadric edge collapse (pymeshlab) preserving
    topology and boundaries. Finely tessellated parts (rail brakes, rail slide, banked curves: 200 000+ triangles) keep
    their shape this way; simpler vertex clustering distorts them beyond recognition."""
    maxtris = maxtris or MAXTRIS
    if len(F) <= maxtris: return V, F
    ms = pymeshlab.MeshSet()
    ms.add_mesh(pymeshlab.Mesh(np.asarray(V, np.float64), np.asarray(F, np.int32)))
    ms.meshing_decimation_quadric_edge_collapse(targetfacenum=maxtris, preservetopology=True, preserveboundary=True,
                                                 planarquadric=True, qualitythr=0.3, optimalplacement=True)
    m = ms.current_mesh()
    return np.asarray(m.vertex_matrix(), float), np.asarray(m.face_matrix(), np.int64)


def kbm3(V, F):
    """Mesh -> KBM3 bytes (format: see module docstring)."""
    scale = SCALE
    while np.abs(V).max() / scale >= 32767: scale *= 2
    q = np.round(V / scale).astype(np.int64)
    assert np.abs(q).max() < 32767
    F = np.asarray(F, np.int64)
    _, first = np.unique(F.reshape(-1), return_index=True)        # order vertices by first use
    order = np.argsort(first, kind='stable'); inv = np.empty(len(V), np.int64); inv[order] = np.arange(len(V))
    q = q[order]; F = inv[F]
    d = np.diff(q.T, axis=1, prepend=0).astype(np.int16).view(np.uint16)
    lo = (d & 0xff).astype(np.uint8); hi = (d >> 8).astype(np.uint8)
    di = np.diff(F.reshape(-1), prepend=0)
    zz = ((di << 1) ^ (di >> 63)).astype('<u4')
    planes = zz.view(np.uint8).reshape(-1, 4).T
    body = lo.tobytes() + hi.tobytes() + planes.tobytes()
    return b'KBM3' + struct.pack('<IIf', len(q), len(F), scale) + gzip.compress(body, compresslevel=9, mtime=0), q, F, scale


def check_kbm3(data, q, F):
    """Decode in Python (like the browser) - must return exactly the quantised points and indices."""
    nV, nT, scale = struct.unpack('<IIf', data[4:16]); b = np.frombuffer(gzip.decompress(data[16:]), np.uint8)
    lo = b[:3 * nV].reshape(3, nV).astype(np.uint16); hi = b[3 * nV:6 * nV].reshape(3, nV).astype(np.uint16)
    d = ((hi << 8) | lo).view(np.int16).astype(np.int64)
    qq = np.cumsum(d, axis=1); qq = ((qq + 32768) % 65536 - 32768).T
    pl = b[6 * nV:].reshape(4, 3 * nT).astype(np.uint32)
    zz = (pl[0] | (pl[1] << 8) | (pl[2] << 16) | (pl[3] << 24)).astype(np.int64)
    ii = np.cumsum((zz >> 1) ^ -(zz & 1)).reshape(-1, 3)
    assert np.array_equal(qq, q) and np.array_equal(ii, F), 'KBM3 round trip'


def convert(src, out, maxtris):
    V, F = indexed(load_stl(src))
    n_in = len(F)
    V, F = reduce(V, F, maxtris)
    data, q, Fq, _ = kbm3(V, F)
    check_kbm3(data, q, Fq)
    with open(out, 'wb') as fh: fh.write(data)
    return n_in, len(F), len(data)


total = {'plain': [0, 0, 0, 0], 'japandi': [0, 0, 0, 0]}
def source(p, jp=False):
    """STL of a part: export folder (stl_dir) or Japandi folder; parts with their own source (catalogue field src/srcJ)
    are read from there."""
    if jp:
        return os.path.normpath(os.path.join(ROOT, p['srcJ'])) if p.get('srcJ') else os.path.join(J_DIR, p['file'] + CFG['japandi_suffix'] + '.stl')
    return os.path.normpath(os.path.join(ROOT, p['src'])) if p.get('src') else os.path.join(STL_DIR, p['file'] + CFG['stl_suffix'] + '.stl')


for p in cat:
    if not p['file']: continue          # assembled parts (lift, flip-flop): meshes come from the modules
    jobs = []
    if do_plain: jobs.append(('plain', source(p), os.path.join(OUT, p['file'] + '.kbm'), MAXTRIS))
    if do_j and p.get('jp') and (J_DIR or p.get('srcJ')):
        jobs.append(('japandi', source(p, True), os.path.join(J_OUT, p['file'] + '.kbm'), MAXTRIS_J))
    for kind, src, out, mt in jobs:
        a, b, c = convert(src, out, mt)
        t = total[kind]; t[0] += 1; t[1] += a; t[2] += b; t[3] += c
for kind, (n, a, b, c) in total.items():
    if n: print('%-8s %3d parts, triangles %d -> %d, %.2f MB' % (kind, n, a, b, c / 1e6))
