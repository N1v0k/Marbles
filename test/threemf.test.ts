// Bambu 3MF: mesh format, print orientation, per-object settings, plate grid, ZIP.
import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8 } from 'fflate';
import { parseKbm, orientMeshes, buildThreeMfFiles, packageFiles, plateOrigin, plateCols, PLATE_STRIDE, type MeshData } from '../src/threemf';
import { parseKbm1, decodeDataUrl } from '../src/viewer3d';
import { planPlates, BED } from '../src/plates';
import { solveChain } from '../src/chain';
import { demo, readMesh, part } from './helpers';

function rawMeshes(ids: Set<string>): Map<string, MeshData> {
  const m = new Map<string, MeshData>();
  for (const id of ids) { const p = part(id); if (!m.has(p.file)) m.set(p.file, { ...parseKbm(readMesh(p.file)), quality: 'preview' }); }
  return m;
}

describe('KBM mesh format', () => {
  it('preview meshes are KBM3, viewer and 3MF read them the same way; Gerade 64 long, adapter 32 high', () => {
    const buf = readMesh('Gerade120_40-40');
    expect(String.fromCharCode(...new Uint8Array(buf, 0, 4))).toBe('KBM3');
    const a = parseKbm(buf), b = parseKbm1(buf);
    expect(a.pos).toEqual(b.pos); expect(a.idx).toEqual(b.idx);
    const nV = a.pos.length / 3;
    for (const i of a.idx) expect(i).toBeLessThan(nV);
    let minx = Infinity, maxx = -Infinity; for (let i = 0; i < nV; i++) { minx = Math.min(minx, a.pos[i * 3]); maxx = Math.max(maxx, a.pos[i * 3]); }
    expect(maxx - minx).toBeCloseTo(64, 1);
    const ad = parseKbm(readMesh('AdapterGerade120')); let maxz = 0; for (let i = 2; i < ad.pos.length; i += 3) maxz = Math.max(maxz, ad.pos[i]);
    expect(maxz).toBeCloseTo(32, 1);
  });
  it('every preview has at most ~15,000 triangles', () => {
    for (const id of ['SchieneLooping240_40-40_v2', 'SchieneBremse120_60-60_K607', 'Spirale_100-60', 'Raststift']) {
      const m = parseKbm(readMesh(id));
      expect(m.idx.length / 3, id).toBeLessThanOrEqual(15000);
    }
  });
  it('data: URL is decoded without fetch', () => {
    const u8 = new Uint8Array(decodeDataUrl('data:application/octet-stream;base64,S0JNMQ=='));
    expect(String.fromCharCode(...u8)).toBe('KBM1');
  });
});

describe('3MF files', () => {
  const plan = planPlates(solveChain(demo('starter-funnel')), 16);
  const raw = rawMeshes(new Set(plan.plates.flatMap((p) => p.jobs.map((j) => j.partId))));
  const meshes = orientMeshes(plan.plates, raw);
  const files = buildThreeMfFiles(plan.plates, meshes, 'Test 16 mm');
  it('plate grid as in Bambu Studio (307.2 mm, columns = ceil(sqrt(n)))', () => {
    expect(PLATE_STRIDE).toBeCloseTo(BED * 1.2, 9);
    expect(plateCols(5)).toBe(3); expect(plateOrigin(4, 5)).toEqual([PLATE_STRIDE, -PLATE_STRIDE]);
  });
  it('print orientation: curves rotated 90 degrees (bounding box swapped), mesh centered', () => {
    const k = meshes.get('Kurve90_40_16mm')!;
    const p = part('Kurve90_40');
    expect(k.size[0]).toBeCloseTo(p.bbox[1][1] - p.bbox[0][1], 0);
    let cz = 0; for (let i = 2; i < k.pos.length; i += 3) cz += k.pos[i];
    expect(Math.abs(cz / (k.pos.length / 3))).toBeLessThan(k.size[2] / 2);
  });
  it('per-object settings as in the release profile (curves: concentric top surface, adapters without overrides)', () => {
    expect(files.settings).toMatch(/<metadata key="name" value="Kurve90_40_16mm"\/>\n {4}<metadata key="extruder" value="1"\/>\n {4}<metadata key="top_surface_pattern" value="concentric"\/>/);
    expect(files.settings).toMatch(/<metadata key="name" value="AdapterKurve90_16mm"\/>\n {4}<metadata key="extruder" value="1"\/>\n {4}<metadata face_count=/);
    expect(files.model).toContain('<metadata name="Application">BambuStudio-');   // otherwise Studio does not read the plates
    expect((files.settings.match(/<plate>/g) ?? []).length).toBe(plan.plates.length);
    expect(files.instances.length).toBe(plan.plates.reduce((s, p) => s + p.jobs.length, 0));
  });
  it('ZIP contains the required files', () => {
    const z = unzipSync(zipSync(packageFiles(files)));
    expect(Object.keys(z).sort()).toEqual(['3D/3dmodel.model', 'Metadata/model_settings.config', 'Metadata/project_settings.config', 'Metadata/slice_info.config', '[Content_Types].xml', '_rels/.rels']);
    // project settings of the release profile (without them Bambu Studio loads only geometry, no plates)
    expect(JSON.parse(strFromU8(z['Metadata/project_settings.config'])).printer_settings_id).toBe('Bambu Lab A1 0.4 nozzle');
    expect(strFromU8(z['3D/3dmodel.model'])).toContain('<build>');
  });
});
