// Printing in one piece: print plates, assembly, 3MF with a single object, MakerWorld key.
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { catalog } from '../src/catalog';
import { solveChain } from '../src/chain';
import { PRINTERS, printerOf, fitOnPlate, placeOnPlate, sanitizePlate, DEFAULT_PLATE, PLATE_MARGIN } from '../src/printers';
import { assemblyItems, assemblyBounds, looseBounds, boxSize, loosePins, hasRaised, itemBox } from '../src/assembly';
import { planAssembly, buildAssemblyFiles, asmMeshKey, tfRotZ } from '../src/asm3mf';
import { checkMakerWorld3mf, keyMetadata, keyValid, zipDates, MW_RULES, tapCounter, TEST_TAPS } from '../src/mwkey';
import type { MeshData } from '../src/threemf';
import { demo, demos } from './helpers';

const A1 = PRINTERS.find((p) => p.id === 'a1')!, MINI = PRINTERS.find((p) => p.id === 'a1mini')!, H2D = PRINTERS.find((p) => p.id === 'h2d')!;

describe('Print plates', () => {
  it('Bambu build volumes from the printer profiles', () => {
    expect([MINI.x, MINI.y, MINI.z]).toEqual([180, 180, 180]);
    expect([A1.x, A1.y, A1.z]).toEqual([256, 256, 256]);
    expect([H2D.x, H2D.y, H2D.z]).toEqual([325, 320, 325]);
    expect(PRINTERS.every((p) => p.x >= 180 && p.y >= 180 && p.z >= 180)).toBe(true);
  });
  it('fits with a 5 mm margin, rotates by 90 degrees if needed, reports the overhang', () => {
    expect(fitOnPlate([240, 100, 50], A1)).toMatchObject({ fits: true, rot90: false });
    expect(fitOnPlate([247, 100, 50], A1).fits).toBe(false);                        // 247 > 256 - 2*5
    const p = { id: 'x', name: 'x', x: 300, y: 200, z: 200 };
    expect(fitOnPlate([150, 250, 50], p)).toMatchObject({ fits: true, rot90: true, size: [250, 150, 50] });
    const big = fitOnPlate([400, 100, 300], A1);
    expect(big.fits).toBe(false); expect(big.over[0]).toBeCloseTo(154); expect(big.over[2]).toBeCloseTo(44);
  });
  it('settings are sanitized (custom size 100..1000)', () => {
    expect(sanitizePlate(null)).toEqual(DEFAULT_PLATE);
    expect(sanitizePlate({ on: true, printer: 'doesnotexist' }).printer).toBe('a1');
    const c = printerOf(sanitizePlate({ printer: 'custom', custom: [50, 300.4, 5000] }));
    expect([c.x, c.y, c.z]).toEqual([100, 300, 1000]);
  });
});

describe('Assembly', () => {
  it('mini track: 6 parts, size as in the sample (145 x 148 x 32), fits on the A1 mini', () => {
    const L = solveChain(demo('mini'));
    const items = assemblyItems(L);
    expect(items.filter((i) => !i.loose)).toHaveLength(6);
    const s = boxSize(assemblyBounds(items)!);
    expect(s[0]).toBeCloseTo(145.07, 1); expect(s[1]).toBeCloseTo(148.27, 1); expect(s[2]).toBeCloseTo(32, 1);
    expect(fitOnPlate(s, MINI).fits).toBe(true);
    expect(hasRaised(items)).toBe(false);
    expect(loosePins(L)).toBe(0);
  });
  it('starter funnel: 12 parts (9 + 3 adapters), raised, fits on the A1, not on the A1 mini', () => {
    const L = solveChain(demo('starter-funnel'));
    const plan = planAssembly(L, A1)!;
    expect(plan.fused).toHaveLength(12);
    expect(plan.fused.filter((i) => i.adapter)).toHaveLength(3);
    expect(plan.raised).toBe(true);
    expect(plan.fit.fits).toBe(true);
    expect(planAssembly(L, MINI)!.fit.fits).toBe(false);
    expect(plan.loose).toHaveLength(0);
  });
  it('three levels is too big for every Bambu printer', () => {
    const plan0 = planAssembly(solveChain(demo('three-levels')), A1)!;
    for (const p of PRINTERS) expect(fitOnPlate(plan0.size, p).fits).toBe(false);
  });
  it('the lift stays loose: own plate with its modules and the snap pins of its joints', () => {
    const L = solveChain(demo('lift-circuit'));
    const plan = planAssembly(L, A1)!;
    const lift = L.placed.find((q) => q.part.lift)!;
    expect(plan.fused.some((i) => i.owner === lift.idx)).toBe(false);
    const looseParts = plan.loose.flatMap((p) => p.jobs).filter((j) => j.partId !== 'Raststift_16mm');
    const kit = lift.part.lift!.kit.reduce((n, k) => n + k.n, 0);
    expect(looseParts).toHaveLength(kit);
    // pins: inside the lift (lift.pins) + joint in + joint out (circuit)
    expect(plan.pins).toBe(lift.part.lift!.pins + 2);
    expect(plan.loose.flatMap((p) => p.jobs).filter((j) => j.partId === 'Raststift_16mm')).toHaveLength(plan.pins);
    for (const p of plan.loose) for (const j of p.jobs) { expect(j.x).toBeGreaterThanOrEqual(5); expect(j.x + j.w).toBeLessThanOrEqual(A1.x - 5 + 1e-6); expect(j.y + j.d).toBeLessThanOrEqual(A1.y - 5 + 1e-6); }
  });
  it('the flip-flop stays loose, its height adapter is fused', () => {
    const d = demos.demos.find((x) => x.chain.some((e) => e.part.startsWith('Kippwippe')));
    if (!d) return;
    const L = solveChain(JSON.parse(JSON.stringify(d.chain)));
    const plan = planAssembly(L, H2D);
    expect(plan).not.toBeNull();
    expect(plan!.fused.some((i) => i.part.id.startsWith('Kippwippe'))).toBe(false);
    expect(plan!.loose.flatMap((p) => p.jobs).some((j) => j.partId.startsWith('Kippwippe_Wippe'))).toBe(true);
  });
});

/** Small stand-in mesh (box around the part's bounding box) instead of the print meshes. */
function fakeMesh(p: { bbox: [number[], number[]] }): MeshData {
  const [a, b] = p.bbox;
  const pos = new Float32Array([a[0], a[1], a[2], b[0], a[1], a[2], b[0], b[1], a[2], a[0], b[1], a[2], a[0], a[1], b[2], b[0], a[1], b[2], b[0], b[1], b[2], a[0], b[1], b[2]]);
  const idx = new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
  return { pos, idx, quality: 'print' };
}
/** Mesh vertices in the 3MF (object ID -> vertices). */
function meshVerts(model: string): Map<string, number[][]> {
  const out = new Map<string, number[][]>();
  for (const m of model.matchAll(/<object id="(\d+)" type="model">\s*<mesh>\s*<vertices>([\s\S]*?)<\/vertices>/g))
    out.set(m[1], [...m[2].matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)].map((v) => [+v[1], +v[2], +v[3]]));
  return out;
}
/** Applies a 3MF row-vector transform. */
function applyTf(tf: string, v: number[]): number[] {
  const m = tf.split(' ').map(Number);
  return [v[0] * m[0] + v[1] * m[3] + v[2] * m[6] + m[9], v[0] * m[1] + v[1] * m[4] + v[2] * m[7] + m[10], v[0] * m[2] + v[1] * m[5] + v[2] * m[8] + m[11]];
}
function filesFor(name: string, meta: Record<string, string> = {}) {
  const L = solveChain(demo(name));
  const plan = planAssembly(L, A1)!;
  const meshes = new Map<string, MeshData>();
  for (const it of plan.fused) meshes.set(asmMeshKey(it, false, false), fakeMesh(it.part));
  for (const pl of plan.loose) for (const j of pl.jobs) meshes.set(asmMeshKey(j, true, false, j.rotZ), fakeMesh(j.part));
  return { plan, files: buildAssemblyFiles(plan, meshes, { title: 'Test', objectName: 'Marble Run – Test', jp: false, meta }) };
}

describe('3MF in one piece', () => {
  it('one object with all parts as components, identical parts share a mesh, plate 1', () => {
    const { plan, files } = filesFor('starter-funnel');
    const objs = [...files.model.matchAll(/<object id="(\d+)" type="model">\n   <(mesh|components)>/g)];
    const meshObjs = objs.filter((o) => o[2] === 'mesh'), asm = objs.filter((o) => o[2] === 'components');
    expect(asm).toHaveLength(1);
    expect(meshObjs.length).toBeLessThan(plan.fused.length);           // AdapterKurve90 and Kurve90_40 twice each
    expect(new Set(plan.fused.map((i) => i.part.file)).size).toBe(meshObjs.length);
    expect((files.model.match(/<component /g) ?? [])).toHaveLength(plan.fused.length);
    expect((files.model.match(/<item /g) ?? [])).toHaveLength(1);
    expect(files.settings.match(/<part id=/g)).toHaveLength(plan.fused.length);
    expect(files.settings).toContain('<metadata key="support_on_build_plate_only" value="1"/>');
    expect(files.settings).toMatch(/<plate>\n    <metadata key="plater_id" value="1"\/>[\s\S]*?<metadata key="object_id" value="\d+"\/>/);
    expect(files.parts).toBe(12); expect(files.plates).toBe(1);
    // no per-object profile settings on the piece (they would create separate regions with inner walls)
    const asmCfg = files.settings.slice(0, files.settings.indexOf('</object>'));
    expect(asmCfg).not.toMatch(/sparse_infill|top_surface|infill_direction/);
  });
  it('components carry the world placement (rotation about z, position minus object center, floor 0; meshes centered)', () => {
    for (const id of ['mini', 'tunnel-pretzel', 'starter-funnel']) {
      const { plan, files } = filesFor(id);
      const b = plan.bounds, cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
      const objs = meshVerts(files.model);
      const comps = [...files.model.matchAll(/<component objectid="(\d+)" transform="([^"]+)"\/>/g)].map((m) => ({ id: m[1], tf: m[2] }));
      plan.fused.forEach((it, k) => {
        const w = objs.get(comps[k].id)!.map((v) => applyTf(comps[k].tf, v));
        const want = itemBox(it);
        for (let a = 0; a < 3; a++) {
          const off = a === 0 ? cx : a === 1 ? cy : b.min[2];
          expect(Math.min(...w.map((v) => v[a]))).toBeCloseTo(want.min[a] - off, 3);
          expect(Math.max(...w.map((v) => v[a]))).toBeCloseTo(want.max[a] - off, 3);
        }
      });
    }
    expect(tfRotZ(90, 1, 2, 3)).toBe('0 1 0 -1 0 0 0 0 1 1 2 3');
    expect(filesFor('mini').files.settings).not.toContain('enable_support');   // everything on the floor
  });
  it('loading in Bambu Studio: every mesh centered -> rotated repeats of a part are placed correctly (tunnel pretzel, 2nd Gerade60)', () => {
    // Bambu centers every mesh (center s) and applies component * T(s) to the first part, but component + s to every
    // repeat of the same mesh (bbs_3mf.cpp). The two only agree when s = 0 (or the component is not rotated).
    const { plan, files } = filesFor('tunnel-pretzel');
    const objs = meshVerts(files.model);
    for (const [, vs] of objs) for (let a = 0; a < 3; a++) {
      const lo = Math.min(...vs.map((v) => v[a])), hi = Math.max(...vs.map((v) => v[a]));
      expect(Math.abs((lo + hi) / 2)).toBeLessThan(1e-3);
    }
    const comps = [...files.model.matchAll(/<component objectid="(\d+)" transform="([^"]+)"\/>/g)].map((m) => m[1]);
    const g60 = plan.fused.map((it, k) => ({ it, id: comps[k] })).filter((x) => x.it.part.id === 'Gerade60_50-50_16mm');
    expect(g60.length).toBe(2); expect(g60[0].id).toBe(g60[1].id);            // one mesh, two parts (rot 180 and 270)
    expect(g60[0].it.rot).not.toBe(g60[1].it.rot);
  });
  it('MakerWorld IDs end up in 3dmodel.model', () => {
    const { files } = filesFor('mini', { Designer: 'OverEngineer', DesignerUserId: '3696494148', DesignModelId: 'US1', DesignProfileId: '42' });
    expect(files.model).toContain('<metadata name="DesignProfileId">42</metadata>');
    expect(files.model).toContain('<metadata name="Designer">OverEngineer</metadata>');
    expect(files.model.indexOf('DesignModelId')).toBeLessThan(files.model.indexOf('<resources>'));
  });
  it('lift circuit: loose parts on plate 2', () => {
    const { plan, files } = filesFor('lift-circuit');
    expect(files.plates).toBe(1 + plan.loose.length);
    expect(files.settings).toContain('<metadata key="plater_id" value="2"/>');
    expect((files.model.match(/<item /g) ?? [])).toHaveLength(1 + plan.loose.reduce((n, p) => n + p.jobs.length, 0));
  });
});

// ------------------------------------------------------------------ MakerWorld key
const NAMES = new Set(catalog.parts.map((p) => p.nameEn));
function fixture(meta: Record<string, string>, names: string[], mtime = new Date('2026-10-20T10:30:00')): Uint8Array {
  const md = Object.entries(meta).map(([k, v]) => ` <metadata name="${k}">${v}</metadata>`).join('\n');
  const model = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n <metadata name="Application">BambuStudio-02.08.02.61</metadata>\n${md}\n <resources/>\n <build/>\n</model>\n`;
  const cfg = '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n' + names.map((n, i) => `  <object id="${i + 1}">\n    <metadata key="name" value="${n}"/>\n  </object>\n`).join('') + '</config>\n';
  return zipSync({ '3D/3dmodel.model': [strToU8(model), { mtime }], 'Metadata/model_settings.config': [strToU8(cfg), { mtime }], 'Metadata/plate_1.png': new Uint8Array(10) });
}
const MW_META = { Title: '16mm Modular Marble Run', Designer: 'OverEngineer', DesignerUserId: '3696494148', License: 'Standard Digital File License', Origin: 'original',
  ProfileTitle: 'Japandi – all parts', ProfileUserId: '3696494148', ProfileUserName: 'OverEngineer', DesignRegion: 'US', DesignModelId: 'US0000000000aa', DesignProfileId: '991400001' };
const ALL = [...NAMES].slice(0, 60);

describe('MakerWorld key', () => {
  it('recognizes the MakerWorld profile (designer, model, profile, parts, timestamp)', () => {
    const r = checkMakerWorld3mf(fixture(MW_META, ALL), 'x.3mf', NAMES);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.key).toMatchObject({ designerUserId: '3696494148', modelId: 'US0000000000aa', profileId: '991400001', profileTitle: 'Japandi – all parts', parts: 60 });
    expect(r.key.stamp.slice(0, 16)).toBe('2026-10-20T10:30');
    expect(keyValid(r.key)).toBe(true);
    expect(keyMetadata(r.key)).toMatchObject({ Designer: 'OverEngineer', DesignProfileId: '991400001', DesignModelId: 'US0000000000aa', License: 'Standard Digital File License' });
  });
  it('rejects: no 3MF, no designer (e.g. the local release file), other designer, too few parts, outdated', () => {
    expect(checkMakerWorld3mf(strToU8('hello world, no zip file here'), 'a.3mf', NAMES)).toMatchObject({ ok: false, reason: 'notZip' });
    const noDes = { ...MW_META } as Record<string, string>; delete noDes.Designer; delete noDes.DesignerUserId;
    expect(checkMakerWorld3mf(fixture(noDes, ALL), 'b.3mf', NAMES)).toMatchObject({ ok: false, reason: 'notMakerWorld' });
    expect(checkMakerWorld3mf(fixture({ ...MW_META, DesignerUserId: '1' }, ALL), 'c.3mf', NAMES)).toMatchObject({ ok: false, reason: 'otherDesigner' });
    expect(checkMakerWorld3mf(fixture(MW_META, ALL.slice(0, 5)), 'd.3mf', NAMES)).toMatchObject({ ok: false, reason: 'tooFewParts', detail: '5' });
    const rules = { ...MW_RULES, minStamp: '2026-11-01' };
    expect(checkMakerWorld3mf(fixture(MW_META, ALL), 'e.3mf', NAMES, rules)).toMatchObject({ ok: false, reason: 'outdated' });
    const rules2 = { ...MW_RULES, modelIds: ['US999'] };
    expect(checkMakerWorld3mf(fixture(MW_META, ALL), 'f.3mf', NAMES, rules2)).toMatchObject({ ok: false, reason: 'otherModel' });
  });
  it('reads the ZIP times from the central directory', () => {
    const z = fixture(MW_META, ALL, new Date('2026-09-20T21:54:00'));
    expect(zipDates(z).get('3D/3dmodel.model')).toBe('2026-09-20T21:54:00');
    expect(Object.keys(unzipSync(z))).toContain('Metadata/model_settings.config');
    expect(strFromU8(unzipSync(z)['3D/3dmodel.model'])).toContain('DesignProfileId');
  });
});

describe('Test mode (tap the logo 7 times)', () => {
  it('toggles only on the 7th quick tap, a pause resets the count', () => {
    expect(TEST_TAPS).toBe(7);
    const tap = tapCounter();
    let t = 0;
    for (let i = 0; i < 6; i++) expect(tap((t += 200))).toBe(false);
    expect(tap((t += 1600))).toBe(false);          // pause > 1.5 s: counting restarts (1)
    for (let i = 0; i < 5; i++) expect(tap((t += 300))).toBe(false); // 2..6
    expect(tap((t += 300))).toBe(true);            // 7th
    for (let i = 0; i < 6; i++) expect(tap((t += 100))).toBe(false); // starts over afterwards
    expect(tap((t += 100))).toBe(true);            // 7 again -> toggles back
  });
});

describe('Plate placement with lift and flip-flop', () => {
  const box = (x0: number, y0: number, x1: number, y1: number, z = 64) => ({ min: [x0, y0, 0], max: [x1, y1, z] });
  const inside = (b: { min: number[]; max: number[] }, f: { cx: number; cy: number; w: number; d: number }, m: number) =>
    b.min[0] >= f.cx - f.w / 2 + m - 1e-6 && b.max[0] <= f.cx + f.w / 2 - m + 1e-6 && b.min[1] >= f.cy - f.d / 2 + m - 1e-6 && b.max[1] <= f.cy + f.d / 2 - m + 1e-6;

  it('endless eight on the A1: plate shifted toward the lift tower (overhang ~16 -> ~2 mm; fully on the plate only without the 5 mm margin at the piece)', () => {
    const L = solveChain(demo('endless-eight'));
    const plan = planAssembly(L, A1)!;
    const lb = looseBounds(L)!;
    expect(boxSize(lb)[0]).toBeCloseTo(64, 0);                       // housing without the crank circle
    expect(plan.fit.fits).toBe(true);
    expect(inside(plan.bounds, plan.fit, PLATE_MARGIN)).toBe(true);  // piece with margin
    const over = (f: { cx: number; w: number }) => Math.max(0, (f.cx - f.w / 2) - lb.min[0]);
    const centered = { cx: (plan.bounds.min[0] + plan.bounds.max[0]) / 2, w: 256 };
    expect(over(centered)).toBeGreaterThan(15);                      // plate centered under the piece
    expect(over(plan.fit)).toBeLessThan(2.5);                        // shifted: piece at the right edge, tower 2.3 mm over
    expect(plan.fit.whole).toBe(false);
    expect(plan.fit.cx + plan.fit.w / 2 - PLATE_MARGIN).toBeCloseTo(plan.bounds.max[0], 6);
    // lift circuit: fits entirely
    const R = planAssembly(solveChain(demo('lift-circuit')), A1)!;
    expect(R.fit.whole).toBe(true);
  });

  it('tower next to the piece, together smaller than the plate: plate shifted so that both fit', () => {
    // piece 200 wide, tower 40 beside it: centered, the tower would stick out 15 mm; shifted, everything fits (200 + 5 margin + 40 <= 256)
    const f = placeOnPlate(box(0, 0, 200, 150), box(-40, 50, 0, 100, 200), A1);
    expect(f.fits).toBe(true); expect(f.whole).toBe(true);
    expect(f.cx - f.w / 2).toBeLessThanOrEqual(-40 + 1e-6);
    expect(f.cx + f.w / 2).toBeGreaterThanOrEqual(200 + PLATE_MARGIN - 1e-6);
  });

  it('without loose parts centered; whole track does not fit -> piece stays on with margin, plate as close to the tower as possible', () => {
    for (const id of ['starter-funnel', 'mini']) {
      const plan = planAssembly(solveChain(demo(id)), A1)!;
      expect(plan.fit.cx).toBeCloseTo((plan.bounds.min[0] + plan.bounds.max[0]) / 2, 6);
      expect(plan.fit.cy).toBeCloseTo((plan.bounds.min[1] + plan.bounds.max[1]) / 2, 6);
      expect(plan.fit.whole).toBe(true);
    }
    const f = placeOnPlate(box(0, 0, 200, 100), box(-100, 20, 0, 80, 300), A1);
    expect(f.fits).toBe(true); expect(f.whole).toBe(false);
    expect(f.cx - f.w / 2).toBeCloseTo(200 + PLATE_MARGIN - 256, 6);  // shifted all the way to the tower, piece at the edge
    expect(f.cy).toBeCloseTo(50, 6);
  });

  it('piece does not fit: plate centered under the piece, not whole', () => {
    const f = placeOnPlate(box(0, 0, 300, 100), box(-60, 0, 0, 60), A1);
    expect(f.fits).toBe(false); expect(f.whole).toBe(false);
    expect(f.cx).toBeCloseTo(150, 6);
  });

  it('non-square plate: the rotation that also fits the tower wins', () => {
    const pr = { id: 'x', name: 'x', x: 400, y: 200, z: 300 };
    // piece 150 x 150 fits in both rotations; the tower stands 120 mm beside it in y -> only rotated (plate 400 long in y)
    const f = placeOnPlate(box(0, 0, 150, 150), box(40, 150, 110, 270), pr);
    expect(f.fits).toBe(true); expect(f.rot90).toBe(true); expect(f.whole).toBe(true);
    expect([f.w, f.d]).toEqual([200, 400]);
    const g = placeOnPlate(box(0, 0, 150, 150), null, pr);
    expect(g.rot90).toBe(false);                                     // without a tower: not rotated
  });

  it('3MF with the plate rotated by 90 degrees: offset rotated too, piece with margin on the plate', () => {
    const pr = { id: 'q', name: 'q', x: 300, y: 150, z: 300 };
    const L = solveChain(demo('lift-circuit'));
    const plan = planAssembly(L, pr)!;
    expect(plan.fit.fits).toBe(true); expect(plan.fit.rot90).toBe(true); expect(plan.fit.whole).toBe(true);
    const meshes = new Map<string, MeshData>();
    for (const it of plan.fused) meshes.set(asmMeshKey(it, false, false), fakeMesh(it.part));
    for (const pl of plan.loose) for (const j of pl.jobs) meshes.set(asmMeshKey(j, true, false, j.rotZ), fakeMesh(j.part));
    const files = buildAssemblyFiles(plan, meshes, { title: 'T', objectName: 'T', jp: false });
    const v = /<build>\s*<item objectid="\d+" transform="([^"]+)"/.exec(files.model)![1].split(' ').map(Number);
    expect(v[0]).toBeCloseTo(0, 9); expect(v[1]).toBeCloseTo(1, 9);   // 90 degrees
    const [px, py] = [v[9], v[10]];
    // rotated: world width (x) lies along plate y, world depth (y) along plate x
    expect(px - plan.size[1] / 2).toBeGreaterThanOrEqual(PLATE_MARGIN - 1e-6); expect(px + plan.size[1] / 2).toBeLessThanOrEqual(300 - PLATE_MARGIN + 1e-6);
    expect(py - plan.size[0] / 2).toBeGreaterThanOrEqual(PLATE_MARGIN - 1e-6); expect(py + plan.size[0] / 2).toBeLessThanOrEqual(150 - PLATE_MARGIN + 1e-6);
    const dx = (plan.bounds.min[0] + plan.bounds.max[0]) / 2 - plan.fit.cx, dy = (plan.bounds.min[1] + plan.bounds.max[1]) / 2 - plan.fit.cy;
    expect(px).toBeCloseTo(150 - dy, 6); expect(py).toBeCloseTo(75 + dx, 6);
  });

  it('3MF: the piece lies on the plate as in the 3D view (offset against the plate center, with margin)', () => {
    const { plan, files } = filesFor('endless-eight');
    const m = /<build>\s*<item objectid="\d+" transform="([^"]+)"/.exec(files.model)!;
    const v = m[1].split(' ').map(Number);
    const [tx, ty] = [v[9], v[10]];
    const dx = (plan.bounds.min[0] + plan.bounds.max[0]) / 2 - plan.fit.cx, dy = (plan.bounds.min[1] + plan.bounds.max[1]) / 2 - plan.fit.cy;
    expect(tx).toBeCloseTo(128 + dx, 3); expect(ty).toBeCloseTo(128 + dy, 3);
    expect(Math.abs(dx)).toBeGreaterThan(1);                         // really shifted
    expect(tx - plan.size[0] / 2).toBeGreaterThanOrEqual(PLATE_MARGIN - 1e-6);
    expect(tx + plan.size[0] / 2).toBeLessThanOrEqual(256 - PLATE_MARGIN + 1e-6);
  });
});
