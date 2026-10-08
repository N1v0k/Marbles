#!/usr/bin/env python3
"""Print meshes for the 3MF export (local builds only, DEV_UI=1): STL export at full resolution -> KBM2
(float32 positions, indexed), gzip-compressed (.kbm.gz; the browser decompresses with DecompressionStream).
numpy only. Output: public/print/*.kbm.gz (vite copies them 1:1 to dist/print); Japandi (grooved parts only, catalogue
field jp): public/print_j/*.kbm.gz.
Usage: python tools/convert_print_meshes.py [out_dir [part ...]]   (out_dir defaults to public/print; print_j sits next to it)"""
import gzip, json, struct, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))
CFG = json.load(open(os.path.join(HERE, 'config.json'), encoding='utf-8'))
STL_DIR = os.path.normpath(os.path.join(ROOT, CFG['stl_dir']))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'public', 'print')
J_OUT = os.path.join(os.path.dirname(os.path.normpath(OUT)), 'print_j')
J_DIR = os.path.normpath(os.path.join(ROOT, CFG['japandi_dir'])) if CFG.get('japandi_dir') else None
sys.path.insert(0, HERE)
from stl16 import load_stl, indexed  # noqa: E402

os.makedirs(OUT, exist_ok=True); os.makedirs(J_OUT, exist_ok=True)
cat = json.load(open(os.path.join(ROOT, 'src', 'data', 'parts.json'), encoding='utf-8'))['parts']


def write(fn, out):
    V, F = indexed(load_stl(fn))
    use16 = len(V) < 65535
    data = b'KBM2' + struct.pack('<IIfB', len(V), len(F), 0.0, 1 if use16 else 0)
    data += V.astype('<f4').tobytes() + F.astype('<u2' if use16 else '<u4').tobytes()
    gz = gzip.compress(data, compresslevel=6, mtime=0)
    with open(out, 'wb') as fh: fh.write(gz)
    return len(F), len(gz)


tot = {'plain': [0, 0, 0], 'japandi': [0, 0, 0]}
missing = []
only = set(sys.argv[2:])          # optional: only these parts (after the output folder)
for p in cat:
    if not p['file'] or (only and p['id'] not in only): continue   # assembled parts (lift, flip-flop): modules individually
    src = os.path.normpath(os.path.join(ROOT, p['src'])) if p.get('src') else os.path.join(STL_DIR, p['file'] + CFG['stl_suffix'] + '.stl')
    jobs = [('plain', src, os.path.join(OUT, p['file'] + '.kbm.gz'))]
    if p.get('jp') and (J_DIR or p.get('srcJ')):
        srcj = os.path.normpath(os.path.join(ROOT, p['srcJ'])) if p.get('srcJ') else os.path.join(J_DIR, p['file'] + CFG['japandi_suffix'] + '.stl')
        jobs.append(('japandi', srcj, os.path.join(J_OUT, p['file'] + '.kbm.gz')))
    for kind, fn, out in jobs:
        if not os.path.exists(fn):
            print('MISSING', fn); missing.append(fn); continue
        t, b = write(fn, out); x = tot[kind]; x[0] += 1; x[1] += t; x[2] += b
for kind, (n, t, b) in tot.items():
    print('%-8s %3d parts, triangles %d, %.1f MB (gz)' % (kind, n, t, b / 1e6))
# missing sources are an error: the old .kbm.gz would otherwise stay in place silently and end up in 3MF exports with
# outdated geometry; all other parts have been written anyway
if missing:
    print('ERROR: %d source STL files missing - their print meshes were NOT updated' % len(missing), file=sys.stderr)
    sys.exit(1)
