// Print meshes from the real release profiles: every part from the profile 3MF compared against the print mesh in
// public/print(_j) - same triangles, vertices in the same order, volume < 0.01 %, bounding box < 0.01 mm.
// Runs only when the release 3MF files (../Release, ../Japandi/Release) and public/print* exist locally; they are not
// in the repository. By default a sample of parts per edition; KB_3MF=1: all parts, KB_CSV=<file>: write a comparison table.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'fflate';
import { parseKbm, type RawMesh } from '../src/kbm';
import { registerProfile, clearProfiles, getPrintMesh, getProfile, paletteFiles, groovedFile, type Ed } from '../src/meshes3mf';
import { ROOT } from './helpers';

const P3MF: Record<Ed, string> = {
  plain: join(ROOT, '..', 'Release', 'Modular_Marble_Run_16mm_Plain_Release.3mf'),
  japandi: join(ROOT, '..', 'Japandi', 'Release', 'Modular_Marble_Run_16mm_Japandi_Release.3mf'),
};
const HAVE = existsSync(P3MF.plain) && existsSync(P3MF.japandi) && existsSync(join(ROOT, 'public', 'print'));
const ALL = process.env.KB_3MF === '1';

function printMesh(file: string, jp: boolean): RawMesh {
  const b = gunzipSync(readFileSync(join(ROOT, 'public', jp ? 'print_j' : 'print', file + '.kbm.gz')));
  return parseKbm(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}
function stats(m: RawMesh) {
  const n = m.pos.length / 3, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { const v = m.pos[i * 3 + a]; lo[a] = Math.min(lo[a], v); hi[a] = Math.max(hi[a], v); }
  let vol = 0;
  for (let t = 0; t < m.idx.length; t += 3) {
    const [a, b, c] = [m.idx[t] * 3, m.idx[t + 1] * 3, m.idx[t + 2] * 3], p = m.pos;
    vol += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return { lo, hi, vol: vol / 6, tri: m.idx.length / 3 };
}

describe.runIf(HAVE)('Print meshes from the release profiles = public/print(_j)', () => {
  const rows: string[] = ['edition;part;name_in_profile;source;triangles_old;triangles_new;same_order;max_vertex_mm;volume_old_mm3;volume_new_mm3;volume_dev_percent;bbox_dev_mm;ok'];
  beforeAll(() => {
    clearProfiles();
    for (const ed of ['plain', 'japandi'] as Ed[]) {
      const r = registerProfile(new Uint8Array(readFileSync(P3MF[ed])), P3MF[ed]);
      expect(r.ok, ed).toBe(true);
      if (r.ok) expect(r.profile.edition).toBe(ed);
    }
  }, 60000);
  for (const ed of ['plain', 'japandi'] as Ed[]) {
    it(`${ed}: profile detected, all palette parts present`, () => {
      const p = getProfile(ed)!;
      expect(p.missing).toEqual([]);
      expect(p.parts).toBe(paletteFiles().length);
    });
    it(`${ed}: meshes match public/print${ed === 'japandi' ? '_j (grooved) or print' : ''}`, async () => {
      const files = ALL ? paletteFiles() : paletteFiles().filter((f, i) => i % 23 === 0 || f === 'Raststift_16mm');
      for (const file of files) {
        const jp = ed === 'japandi' && groovedFile(file);
        // in the Japandi profile: grooved parts against print_j, all others against print (identical in both editions)
        const got = ed === 'japandi' ? await getPrintMesh(file, jp) : await getPrintMesh(file, false);
        const old = printMesh(file, jp);
        expect(got, `${ed} ${file}`).not.toBeNull();
        const a = stats(old), b = stats(got!);
        let same = got!.idx.length === old.idx.length && got!.pos.length === old.pos.length;
        for (let i = 0; same && i < old.idx.length; i++) same = old.idx[i] === got!.idx[i];
        let maxd = 0;
        if (same) for (let i = 0; i < old.pos.length; i++) maxd = Math.max(maxd, Math.abs(old.pos[i] - got!.pos[i]));
        const dvol = ((b.vol - a.vol) / a.vol) * 100;
        const dbb = Math.max(...[0, 1, 2].map((k) => Math.max(Math.abs(a.lo[k] - b.lo[k]), Math.abs(a.hi[k] - b.hi[k]))));
        const ok = a.tri === b.tri && Math.abs(dvol) < 0.01 && dbb < 0.01;
        const name = getProfile(ed === 'japandi' ? 'japandi' : 'plain')!.objs.get(file)!.name;
        rows.push([ed, file, name, jp ? 'print_j' : 'print', a.tri, b.tri, same ? 'yes' : 'no', maxd.toExponential(2), a.vol.toFixed(3), b.vol.toFixed(3), dvol.toExponential(2), dbb.toExponential(2), ok ? 'yes' : 'NO'].join(';'));
        expect(b.tri, file).toBe(a.tri);
        expect(Math.abs(dvol), file).toBeLessThan(0.01);
        expect(dbb, file).toBeLessThan(0.01);
        expect(same, file + ' same order').toBe(true);
        expect(maxd, file).toBeLessThan(1e-4);
      }
    }, 600000);
  }
  it('comparison table', () => {
    if (process.env.KB_CSV) writeFileSync(process.env.KB_CSV, rows.join('\n') + '\n', 'utf-8');
    clearProfiles();
  });
});
