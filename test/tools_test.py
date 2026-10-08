#!/usr/bin/env python3
"""Tests for the 16 mm data pipeline: build_catalog exits without trimesh instead of writing a catalogue without
weights; socket detection (tools/stl16.py) finds on the STL exports what the catalogue says; KBM3 files are consistent
with the catalogue; text is read/written as UTF-8; lift and Y merge ports are measured; the print-mesh reference values
(print_ref.json) match the print meshes. Usage: python test/tools_test.py"""
import json, os, struct, subprocess, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))
TOOLS = os.path.join(ROOT, 'tools')
sys.path.insert(0, TOOLS)
CFG = json.load(open(os.path.join(TOOLS, 'config.json'), encoding='utf-8'))
STL_DIR = os.path.normpath(os.path.join(ROOT, CFG['stl_dir']))
CAT = {p['id']: p for p in json.load(open(os.path.join(ROOT, 'src', 'data', 'parts.json'), encoding='utf-8'))['parts']}


def stl(pid):
    return os.path.join(STL_DIR, pid + CFG['stl_suffix'] + '.stl')


# excluded in build_catalog.py (EXCLUDE): the cross tunnel 32 parts are used instead; the exports are still in the STL folder
REPLACED = {'AdapterTunnelQuer120_40-40_16mm', 'AdapterTunnelQuer120_40-40_V20_16mm', 'AdapterTunnelQuer95_40-40_16mm'}


def lift_path(fn):
    """Same as build_catalog.lift_path: file name in lift_dir or (if it contains '/') a path relative to the builder folder."""
    return os.path.normpath(os.path.join(ROOT, fn + '.stl')) if '/' in fn else os.path.join(os.path.normpath(os.path.join(ROOT, CFG['lift_dir'])), fn + '.stl')


class ToolsTest(unittest.TestCase):
    def test_build_catalog_without_trimesh_exits_and_writes_nothing(self):
        out = os.path.join(ROOT, 'src', 'data', 'parts.json')
        before = os.stat(out).st_mtime
        path = os.path.join(TOOLS, 'build_catalog.py')
        code = "import sys; sys.modules['trimesh'] = None; exec(compile(open(%r, encoding='utf-8').read(), %r, 'exec'), {'__file__': %r, '__name__': '__main__'})" % (path, path, path)
        r = subprocess.run([sys.executable, '-c', code], capture_output=True, text=True, cwd=ROOT)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('trimesh', r.stdout + r.stderr)
        self.assertEqual(os.stat(out).st_mtime, before, 'parts.json must not be touched')

    def test_convert_meshes_scale_adapts_to_size(self):
        import numpy as np
        src = open(os.path.join(TOOLS, 'convert_meshes.py'), encoding='utf-8').read()
        self.assertIn('while np.abs(V).max() / scale >= 32767: scale *= 2', src)
        for vmax, want in [(100, 0.005), (163, 0.005), (200, 0.01), (400, 0.02)]:
            V = np.array([[vmax, 0, 0]], float); scale = 0.005
            while np.abs(V).max() / scale >= 32767: scale *= 2
            self.assertEqual(scale, want)

    def test_kbm3_files_match_catalog(self):
        import gzip
        for p in CAT.values():
            if not p['file']:          # lift, flip-flop: assembled, meshes per module
                asm = (p.get('lift') or p)['asm']
                self.assertTrue(asm, p['id'])
                for a in asm: self.assertIn(a['id'], CAT)
                continue
            dirs = [('meshes', 12000)] + ([('meshes_j', 16000)] if p.get('jp') else [])
            for d, maxt in dirs:
                fn = os.path.join(ROOT, 'src', d, p['file'] + '.kbm')
                self.assertTrue(os.path.exists(fn), fn)
                with open(fn, 'rb') as fh: b = fh.read()
                self.assertEqual(b[:4], b'KBM3')
                nV, nT, scale = struct.unpack('<IIf', b[4:16])
                self.assertGreater(nV, 0); self.assertGreater(nT, 0); self.assertGreater(scale, 0)
                self.assertLessEqual(nT, maxt, p['id'])
                self.assertEqual(len(gzip.decompress(b[16:])), 6 * nV + 12 * nT, p['id'])

    def test_all_text_io_uses_utf8(self):
        for f in ['build_catalog.py', 'convert_meshes.py', 'convert_print_meshes.py', 'stl16.py', 'filament_colors.py']:
            src = open(os.path.join(TOOLS, f), encoding='utf-8').read()
            for line in src.splitlines():
                if 'open(' not in line or "'rb'" in line or "'wb'" in line or line.strip().startswith('#') or 'zipfile' in line or 'ZipFile' in line: continue
                self.assertIn('encoding', line, '%s: %s' % (f, line.strip()))

    def test_filament_colors_reproducible(self):
        """src/data/filaments.json is reproduced unchanged from the copy of the Bambu colour list (tools/bambu/)."""
        out = os.path.join(ROOT, 'src', 'data', 'filaments.json')
        before = open(out, 'rb').read()
        r = subprocess.run([sys.executable, os.path.join(TOOLS, 'filament_colors.py')], capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(open(out, 'rb').read(), before)
        d = json.loads(before.decode('utf-8'))
        codes = [f[0] for f in d['f']]
        self.assertEqual(len(codes), len(set(codes)))
        self.assertFalse(any(t.startswith('Support') or t == 'PVA' for t in d['types']))

    @unittest.skipUnless(os.path.isdir(STL_DIR), 'STL exports not found')
    def test_socket_detection_matches_catalog(self):
        """Sockets are measured, not maintained: horizontal ports and vertical sockets match the catalogue."""
        from stl16 import load_stl, mesh, hsockets, vsockets
        for pid in ['Gerade120_40-40_16mm', 'Kurve90_50-40_gespiegelt_16mm', 'AdapterKurve90_16mm', 'Rutsche_120-60_16mm',
                    'XKreuzung_50-40_16mm', 'StartSchale_60_16mm', 'SchieneLangeKurveBank90_R90_40_v2_16mm']:
            m = mesh(load_stl(stl(pid)))
            hs = sorted(tuple(q['p']) + tuple(q['n']) for q in hsockets(m))
            self.assertEqual(hs, sorted(tuple(q['p']) + tuple(q['n']) for q in CAT[pid]['ports']), pid)
            self.assertEqual(vsockets(m), CAT[pid]['vsock'], pid)

    @unittest.skipUnless(os.path.isdir(STL_DIR), 'STL exports not found')
    def test_every_export_is_in_catalog(self):
        ids = sorted(f[:-len(CFG['stl_suffix'] + '.stl')] for f in os.listdir(STL_DIR) if f.endswith(CFG['stl_suffix'] + '.stl'))
        missing = [i for i in ids if i not in CAT and not i.startswith('Passprobe') and i not in REPLACED]
        self.assertEqual(missing, [], 'exports without a catalogue entry - run tools/build_catalog.py')

    @unittest.skipUnless(os.path.isdir(os.path.normpath(os.path.join(ROOT, CFG.get('lift_dir', '-')))), 'lift STL files not found')
    def test_lift_ports_measured(self):
        """Lift: inlet at the foot and outlet at the head are measured on the STL; the catalogue lifts follow from them."""
        from stl16 import load_stl, mesh, hsockets
        fin = hsockets(mesh(load_stl(lift_path(CFG['lift_parts']['LiftFuss_40_16mm']))))
        fout = hsockets(mesh(load_stl(lift_path(CFG['lift_parts']['LiftKopf_60_16mm']))))
        self.assertEqual(len(fin), 1); self.assertEqual(len(fout), 1)
        self.assertEqual(CAT['Lift1_Gerade_16mm']['ports'][0], fin[0])
        self.assertEqual(CAT['Lift1_Gerade_16mm']['ports'][1]['p'][:2], fout[0]['p'][:2])
        self.assertAlmostEqual(CAT['Lift3_Gerade_16mm']['ports'][1]['p'][2], 3 * 32 + fout[0]['p'][2], 3)
        for pid, fn in CFG['lift_parts'].items():
            self.assertEqual(CAT[pid]['src'], os.path.relpath(lift_path(fn), ROOT).replace(os.sep, '/'))

    @unittest.skipUnless(CFG.get('ymerge_parts'), 'no Y merge in config.json')
    def test_ymerge_ports_measured(self):
        """Y merge: three horizontal sockets and the vertical one match the catalogue; the Japandi version has the same sockets."""
        from stl16 import load_stl, mesh, hsockets, vsockets
        for pid, rel in CFG['ymerge_parts'].items():
            m = mesh(load_stl(os.path.normpath(os.path.join(ROOT, rel))))
            hs = sorted(tuple(q['p']) + tuple(q['n']) for q in hsockets(m))
            self.assertEqual(hs, sorted(tuple(q['p']) + tuple(q['n']) for q in CAT[pid]['ports']), pid)
            self.assertEqual(vsockets(m), CAT[pid]['vsock'], pid)
            self.assertEqual(CAT[pid]['lanes'], [[0, 1], [2, 1]], pid)
            mj = mesh(load_stl(os.path.normpath(os.path.join(ROOT, CFG['ymerge_parts_j'][pid]))))
            self.assertEqual(sorted(tuple(q['p']) + tuple(q['n']) for q in hsockets(mj)), hs, pid + ' Japandi')


    def test_indexed_drops_vertices_of_degenerate_triangles(self):
        # a degenerate triangle with a vertex of its own must not leave an unused vertex behind (kbm3() would fail
        # with a shape mismatch)
        import numpy as np
        from stl16 import indexed
        tri = np.array([[[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[5, 5, 5], [5, 5, 5], [0, 0, 0]]], float)
        V, F = indexed(tri)
        self.assertEqual(len(V), 3)
        self.assertEqual(sorted(np.unique(F).tolist()), [0, 1, 2])
        self.assertEqual(sorted(map(tuple, V[F[0]].tolist())), [(0, 0, 0), (0, 1, 0), (1, 0, 0)])

    def test_print_ref_matches_print_meshes(self):
        # reference values used to place meshes read from a print profile (src/meshes3mf.ts): up to date with
        # public/print(_j) and present for every palette part (otherwise meshes from the 3MF are misplaced or missing)
        from pathlib import Path
        from print_ref import ref_row
        ref = json.load(open(os.path.join(ROOT, 'src', 'data', 'print_ref.json'), encoding='utf-8'))
        for ed, sub in (('plain', 'print'), ('japandi', 'print_j')):
            files = sorted(Path(ROOT, 'public', sub).glob('*.kbm.gz'))
            self.assertEqual(sorted(f.name[:-7] for f in files), sorted(ref[ed]), ed)
            for f in files:
                self.assertEqual(ref_row(f), ref[ed][f.name[:-7]], f.name)
        for p in CAT.values():
            if p.get('released') and p.get('plate') and not p.get('display') and not p.get('kit') and not p.get('lift'):
                self.assertIn(p['file'], ref['plain'], p['id'])
                if p.get('jp'):
                    self.assertIn(p['file'], ref['japandi'], p['id'] + ' grooved')


if __name__ == '__main__':
    unittest.main(verbosity=2)
