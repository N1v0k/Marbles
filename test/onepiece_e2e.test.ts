// End-to-end (only with KB_E2E=1): real print meshes from public/print(_j) -> one-piece 3MF into out/,
// for checking with verify (manifold3d: one body) and for slicing in Bambu Studio. Not part of the regular test run.
import { it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, zipSync } from 'fflate';
import { solveChain } from '../src/chain';
import { setEdition, grooved } from '../src/catalog';
import { PRINTERS } from '../src/printers';
import { planAssembly, buildAssemblyFiles, asmMeshKey } from '../src/asm3mf';
import { planPlates } from '../src/plates';
import { parseKbm } from '../src/kbm';
import { orient, orientMeshes, packageFiles, buildThreeMfFiles, type MeshData } from '../src/threemf';
import { ROOT, demo } from './helpers';

const RUN = process.env.KB_E2E === '1';
function printMesh(file: string, jp: boolean): MeshData {
  const dir = jp && existsSync(join(ROOT, 'public', 'print_j', file + '.kbm.gz')) ? 'print_j' : 'print';
  const b = gunzipSync(readFileSync(join(ROOT, 'public', dir, file + '.kbm.gz')));
  return { ...parseKbm(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer), quality: 'print' };
}

it.runIf(RUN)('E2E: one-piece 3MF from the demos', () => {
  mkdirSync(join(ROOT, 'out'), { recursive: true });
  const a1 = PRINTERS.find((p) => p.id === 'a1')!;
  const meta = { Designer: 'OverEngineer', DesignerUserId: '3696494148', DesignModelId: 'USTEST0000000', DesignProfileId: '1', ProfileTitle: 'Test' };
  for (const jp of [true, false]) {
    setEdition(jp ? 'japandi' : 'plain');
    for (const id of ['mini', 'starter-funnel', 'lift-circuit']) {
      const plan = planAssembly(solveChain(demo(id)), a1)!;
      const meshes = new Map<string, MeshData>();
      for (const it2 of plan.fused) meshes.set(asmMeshKey(it2, false, jp), printMesh(it2.part.file, jp && grooved(it2.part)));
      for (const pl of plan.loose) for (const j of pl.jobs) {
        const md = printMesh(j.part.file, jp && grooved(j.part)); const o = orient(md, j.rotZ);
        meshes.set(asmMeshKey(j, true, jp, j.rotZ), { pos: o.pos, idx: md.idx, quality: 'print' });
      }
      const title = `Builder ${id}${jp ? ' Japandi' : ''}`;
      const files = buildAssemblyFiles(plan, meshes, { title, objectName: title, jp, meta: id === 'mini' ? meta : {} });
      const z = zipSync(packageFiles({ model: files.model, settings: files.settings, instances: [] }), { level: 6 });
      writeFileSync(join(ROOT, 'out', `Builder_${id}_${jp ? 'japandi' : 'plain'}.3mf`), z);
    }
  }
  // plates of all levels: starter funnel, Japandi
  setEdition('japandi');
  const L = solveChain(demo('starter-funnel'));
  const plan = planPlates(L, 8);
  const raw = new Map<string, MeshData>();
  for (const p of plan.plates) for (const j of p.jobs) if (!raw.has(j.part.file)) raw.set(j.part.file, printMesh(j.part.file, grooved(j.part)));
  const files = buildThreeMfFiles(plan.plates, orientMeshes(plan.plates, raw), 'Builder plates starter-funnel Japandi', meta);
  writeFileSync(join(ROOT, 'out', 'Builder_plates_starter-funnel_japandi.3mf'), zipSync(packageFiles(files), { level: 6 }));
  setEdition('plain');
}, 120000);
