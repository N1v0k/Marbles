"""Filament colours for the colour picker, taken from the Bambu Studio colour database.

Source: https://github.com/bambulab/BambuStudio/blob/master/resources/profiles/BBL/filament/filaments_color_codes.json
(Bambu Studio, AGPL-3.0). A copy is kept in tools/bambu/ so the build stays reproducible offline.

Usage: python tools/filament_colors.py [--fetch]
  --fetch  re-download the file from GitHub into tools/bambu/ (otherwise the local copy is read)
Output: src/data/filaments.json
  types: filament types in display order (PLA Basic, PLA Matte, other PLA, PETG, the rest)
  f:     [colour code, type (index into types), name EN, name DE ('' = same as EN), [colours 'rrggbb'], flags]
         flags: 1 gradient, 2 multicolour, 4 translucent
Support materials (Support for ..., PVA) are left out: nobody builds a track from them.
"""
import hashlib
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'tools', 'bambu', 'filaments_color_codes.json')
OUT = os.path.join(ROOT, 'src', 'data', 'filaments.json')
URL = 'https://raw.githubusercontent.com/bambulab/BambuStudio/master/resources/profiles/BBL/filament/filaments_color_codes.json'

# Colour families in grid order (first letter of color_code): light -> dark, then warm -> cold, finally gradients (M)
# and multicolour (T)
FAMILY = 'WCDKNYARPBGMT'


def type_rank(t):
    if t == 'PLA Basic': return (0, t)
    if t == 'PLA Matte': return (1, t)
    if t.startswith('PLA'): return (2, t)
    if t.startswith('PETG'): return (3, t)
    if t.startswith(('ABS', 'ASA')): return (4, t)
    return (5, t)


def main():
    if '--fetch' in sys.argv:
        os.makedirs(os.path.dirname(SRC), exist_ok=True)
        with urllib.request.urlopen(URL, timeout=60) as r, open(SRC, 'wb') as f:
            f.write(r.read())
        print('fetched:', URL)
    raw = open(SRC, 'rb').read()
    data = json.loads(raw)['data']
    rows = [x for x in data if not (x['fila_type'].startswith('Support') or x['fila_type'] == 'PVA')]
    types = sorted({x['fila_type'] for x in rows}, key=type_rank)
    seen = set()
    out = []
    for x in rows:
        code = x['fila_color_code']
        if code in seen:
            continue
        seen.add(code)
        cols = [c.lstrip('#') for c in x['fila_color']]
        hexes = [c[:6].lower() for c in cols]
        flags = 0
        kind = x.get('fila_color_type', '')
        if kind == '渐变色': flags |= 1          # gradient
        if kind == '多拼色': flags |= 2          # multicolour
        if any(len(c) == 8 and int(c[6:8], 16) < 0xff for c in cols): flags |= 4
        names = x['fila_color_name']
        en = names.get('en', '').strip()
        de = names.get('de', '').strip()
        out.append([code, types.index(x['fila_type']), en, '' if de == en else de, hexes, flags])
    cc = {x['fila_color_code']: x['color_code'] for x in rows}

    def key(r):
        c = cc[r[0]]
        fam = FAMILY.index(c[0]) if c[0] in FAMILY else len(FAMILY)
        num = int(''.join(ch for ch in c[1:] if ch.isdigit()) or 0)
        return (r[1], fam, num, r[0])
    out.sort(key=key)
    doc = {
        'src': 'Bambu Studio, resources/profiles/BBL/filament/filaments_color_codes.json (AGPL-3.0)',
        'sha256': hashlib.sha256(raw).hexdigest(),
        'types': types,
        'f': out,
    }
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    print(f'{len(out)} colours in {len(types)} types -> {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT)} bytes)')
    print('Types:', ', '.join(types))


if __name__ == '__main__':
    main()
