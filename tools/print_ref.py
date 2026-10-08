"""Write per-mesh reference values of the print meshes to src/data/print_ref.json.

Per file: [triangle count, bbox centre x, y, z, bbox size x, y, z, volume mm3], read from public/print/<file>.kbm.gz
(plain) and public/print_j/<file>.kbm.gz (Japandi, grooved parts only). The builder uses these values to place meshes
read from a 3MF print profile (stored centred on their bounding box) back into part coordinates (src/meshes3mf.ts);
triangle count, size and volume identify the part and edition.
Usage after tools/convert_print_meshes.py: python tools/print_ref.py
"""
import gzip
import json
import struct
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent


def read_kbm2(path: Path):
    b = gzip.decompress(path.read_bytes())
    if b[:4] != b'KBM2':
        raise SystemExit(f'{path}: not a KBM2 file')
    nv, nt = struct.unpack_from('<II', b, 4)
    use16 = b[16] == 1
    off = 17
    pos = np.frombuffer(b, '<f4', nv * 3, off).reshape(-1, 3).astype(np.float64)
    off += nv * 12
    idx = np.frombuffer(b, '<u2' if use16 else '<u4', nt * 3, off).reshape(-1, 3).astype(np.int64)
    return pos, idx


def ref_row(path: Path):
    pos, idx = read_kbm2(path)
    lo, hi = pos.min(0), pos.max(0)
    a, b, c = pos[idx[:, 0]], pos[idx[:, 1]], pos[idx[:, 2]]
    vol = float(np.einsum('ij,ij->i', a, np.cross(b, c)).sum() / 6)
    mid, size = (lo + hi) / 2, hi - lo
    return [int(len(idx)), *[round(float(v), 6) for v in mid], *[round(float(v), 6) for v in size], round(vol, 3)]


def main():
    out = {'_info': 'tools/print_ref.py: per print mesh [triangles, bbox centre xyz, bbox size xyz, volume] (no geometry)'}
    for ed, sub in (('plain', 'print'), ('japandi', 'print_j')):
        files = sorted((ROOT / 'public' / sub).glob('*.kbm.gz'))
        if not files:
            raise SystemExit(f'public/{sub} is empty - run tools/convert_print_meshes.py first')
        out[ed] = {f.name[:-len('.kbm.gz')]: ref_row(f) for f in files}
        print(ed, len(out[ed]), 'parts')
    dst = ROOT / 'src' / 'data' / 'print_ref.json'
    dst.write_text(json.dumps(out, separators=(',', ':'), ensure_ascii=False) + '\n', encoding='utf-8', newline='\n')
    print(dst, dst.stat().st_size, 'bytes')


if __name__ == '__main__':
    main()
