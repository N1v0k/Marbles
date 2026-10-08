// Writes a Bambu Studio project (.3mf) with several build plates.
// Structure as saved by Bambu Studio 2.x: 3D/3dmodel.model (mesh objects + instance objects as components,
// build items in Bambu Studio's plate grid), Metadata/model_settings.config (object names, plates with model_instance).
import { zipSync, strToU8 } from 'fflate';
import { partName } from './i18n';
import type { Plate, PlacedJob } from './plates';
import { BED, plateName } from './plates';
import { loadWebGeometry } from './viewer3d';
import { parseKbm } from './kbm';
import { getPrintMesh } from './meshes3mf';
import { isJapandi, grooved } from './catalog';
// Project settings of the release print profiles (A1 0.4, 0.20mm Standard, PLA Basic, 7.5 % gyroid, infill direction 0,
// seam at the back, supports off), included unchanged. Without this file Bambu Studio imports the 3MF as plain geometry:
// all objects on one plate, plate names and assignments lost.
import PROJECT_SETTINGS from './data/bambu_project_settings_release.config?raw';

export interface MeshData { pos: Float32Array; idx: Uint32Array; quality: 'print' | 'preview' }
/** Bambu Studio assigns instances to plates by position: plate pitch = plate width * (1 + 1/5) (LOGICAL_PART_PLATE_GAP),
 *  columns = ceil(sqrt(n)), rows towards -y. */
export const PLATE_STRIDE = BED * 1.2; // 307.2 mm
export function plateOrigin(pi: number, n: number): [number, number] {
  const cols = plateCols(n);
  return [(pi % cols) * PLATE_STRIDE, -Math.floor(pi / cols) * PLATE_STRIDE + 0];
}
export function plateCols(n: number): number { return Math.max(1, Math.ceil(Math.sqrt(n))); }

/** Print mesh for the 3MF export, taken from the print profile the user dropped in (meshes3mf.ts, in memory only).
 *  jp: grooved Japandi mesh. If the part is missing from the profile (or no matching profile is loaded), the preview
 *  mesh is used instead (quality 'preview') and the export reports it (previewQuality). No cache here: meshes3mf
 *  keeps the parsed meshes per profile. */
export async function loadPrintMesh(file: string, jp = false): Promise<MeshData> {
  const m = await getPrintMesh(file, jp);
  if (m) return { pos: m.pos, idx: m.idx, quality: 'print' };
  const g = await loadWebGeometry(file, jp);
  return { pos: g.pos, idx: g.idx, quality: 'preview' };
}

export { parseKbm };

/** Application header of a file saved by Bambu Studio: only then does Studio read model_settings.config (plates, names,
 *  per-object settings). With any other header everything ends up on a single unnamed plate. */
export const APP_HEADER = 'BambuStudio-02.07.01.62';
export function esc(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
export function f(v: number) { return (Math.round(v * 10000) / 10000).toString(); }
/** MakerWorld identifiers (mwkey.ts) as 3dmodel.model metadata, as in the file downloaded from MakerWorld. */
export function metaXml(meta: Record<string, string>): string {
  return Object.entries(meta).filter(([k, v]) => /^[A-Za-z][A-Za-z0-9_:]*$/.test(k) && v).map(([k, v]) => ` <metadata name="${k}">${esc(v)}</metadata>\n`).join('');
}

/** Rotates a mesh into print orientation (rotation about z as in the print profile) and centres it on its bounding box.
 *  Every part prints upright as designed, adapters included. */
export function orient(m: MeshData, rotZ: number): { pos: Float32Array; size: [number, number, number] } {
  const a = (rotZ * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const n = m.pos.length / 3; const out = new Float32Array(m.pos.length);
  let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  for (let i = 0; i < n; i++) {
    let x = m.pos[i * 3], y = m.pos[i * 3 + 1], z = m.pos[i * 3 + 2];
    const rx = c * x - s * y, ry = s * x + c * y; x = rx; y = ry;
    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
    if (x < minx) minx = x; if (y < miny) miny = y; if (z < minz) minz = z;
    if (x > maxx) maxx = x; if (y > maxy) maxy = y; if (z > maxz) maxz = z;
  }
  const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2, cz = (minz + maxz) / 2;
  for (let i = 0; i < n; i++) { out[i * 3] -= cx; out[i * 3 + 1] -= cy; out[i * 3 + 2] -= cz; }
  return { pos: out, size: [maxx - minx, maxy - miny, maxz - minz] };
}

export interface ThreeMfResult { blob: Blob; previewQuality: string[]; plates: number }
export interface OrientedMesh { pos: Float32Array; idx: Uint32Array; size: [number, number, number]; objId: number; quality: string }
export interface ThreeMfFiles { model: string; settings: string; instances: { objId: number; partId: string; plate: number; x: number; y: number; z: number; rot90: boolean }[] }

export async function buildThreeMf(plates: Plate[], title: string, onProgress?: (msg: string) => void, meta: Record<string, string> = {}): Promise<ThreeMfResult> {
  // one mesh per part (the orientation is a property of the part)
  const partIds = [...new Set(plates.flatMap((p) => p.jobs.map((j) => j.partId)))];
  const meshes = new Map<string, OrientedMesh>();
  const previewQuality: string[] = [];
  let objId = 0;
  const jp = isJapandi();   // capture the edition at export start (switching it while meshes load would mix editions)
  for (const id of partIds) {
    const job = plates.flatMap((p) => p.jobs).find((j) => j.partId === id)!;
    onProgress?.(id);
    const md = await loadPrintMesh(job.part.file, jp && grooved(job.part));
    if (md.quality === 'preview') previewQuality.push(id);
    const o = orient(md, job.rotZ);
    meshes.set(id, { pos: o.pos, idx: md.idx, size: o.size, objId: ++objId, quality: md.quality });
  }
  const files = buildThreeMfFiles(plates, meshes, title, meta);
  onProgress?.('zip');
  const zipped = zipSync(packageFiles(files), { level: 4 });
  return { blob: new Blob([zipped as unknown as ArrayBuffer], { type: 'model/3mf' }), previewQuality, plates: plates.length };
}

/** Rotates meshes into print orientation (pure function, testable without network). */
export function orientMeshes(plates: Plate[], raw: Map<string, MeshData>): Map<string, OrientedMesh> {
  const meshes = new Map<string, OrientedMesh>();
  let objId = 0;
  for (const id of [...new Set(plates.flatMap((p) => p.jobs.map((j) => j.partId)))]) {
    const job = plates.flatMap((p) => p.jobs).find((j) => j.partId === id)!;
    const md = raw.get(job.part.file); if (!md) throw new Error('Missing mesh: ' + job.part.file);
    const o = orient(md, job.rotZ);
    meshes.set(id, { pos: o.pos, idx: md.idx, size: o.size, objId: ++objId, quality: md.quality });
  }
  return meshes;
}

export function packageFiles(files: ThreeMfFiles): Record<string, Uint8Array> {
  return {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n <Default Extension="png" ContentType="image/png"/>\n</Types>\n'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>\n'),
    '3D/3dmodel.model': strToU8(files.model),
    'Metadata/model_settings.config': strToU8(files.settings),
    'Metadata/project_settings.config': strToU8(PROJECT_SETTINGS),
    'Metadata/slice_info.config': strToU8('<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <header>\n    <header_item key="X-BBL-Client-Type" value="slicer"/>\n    <header_item key="X-BBL-Client-Version" value="02.07.01.62"/>\n  </header>\n</config>\n'),
  };
}

/** 3dmodel.model + model_settings.config as text (pure function). */
export function buildThreeMfFiles(plates: Plate[], meshes: Map<string, OrientedMesh>, title: string, meta: Record<string, string> = {}): ThreeMfFiles {
  let objId = Math.max(0, ...[...meshes.values()].map((m) => m.objId));
  // 3dmodel.model
  const X: string[] = [];
  X.push('<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">\n');
  X.push(` <metadata name="Application">${APP_HEADER}</metadata>\n <metadata name="BambuStudio:3mfVersion">1</metadata>\n`);
  X.push(` <metadata name="Title">${esc(title)}</metadata>\n <metadata name="CreationDate">${new Date().toISOString().slice(0, 10)}</metadata>\n`);
  X.push(metaXml(meta) + ' <resources>\n');
  for (const [id, m] of meshes) {
    X.push(`  <object id="${m.objId}" type="model">\n   <mesh>\n    <vertices>\n`);
    const n = m.pos.length / 3;
    for (let i = 0; i < n; i++) X.push(`     <vertex x="${f(m.pos[i * 3])}" y="${f(m.pos[i * 3 + 1])}" z="${f(m.pos[i * 3 + 2])}"/>\n`);
    X.push('    </vertices>\n    <triangles>\n');
    const t = m.idx.length / 3;
    for (let i = 0; i < t; i++) X.push(`     <triangle v1="${m.idx[i * 3]}" v2="${m.idx[i * 3 + 1]}" v3="${m.idx[i * 3 + 2]}"/>\n`);
    X.push('    </triangles>\n   </mesh>\n  </object>\n');
    void id;
  }
  // instance objects (components) + build items
  interface Inst { objId: number; job: PlacedJob; plate: Plate; tf: string; pos: [number, number, number] }
  const insts: Inst[] = [];
  plates.forEach((plate, pi) => {
    const [ox, oy] = plateOrigin(pi, plates.length);
    for (const job of plate.jobs) {
      const m = meshes.get(job.partId)!;
      const w = job.rot90 ? m.size[1] : m.size[0], d = job.rot90 ? m.size[0] : m.size[1];
      const cx = ox + job.x + w / 2, cy = oy + job.y + d / 2, cz = m.size[2] / 2;
      const rot = job.rot90 ? '0 1 0 -1 0 0 0 0 1' : '1 0 0 0 1 0 0 0 1';
      insts.push({ objId: ++objId, job, plate, tf: `${rot} ${f(cx)} ${f(cy)} ${f(cz)}`, pos: [cx, cy, cz] });
    }
  });
  for (const ins of insts) X.push(`  <object id="${ins.objId}" type="model">\n   <components>\n    <component objectid="${meshes.get(ins.job.partId)!.objId}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>\n   </components>\n  </object>\n`);
  X.push(' </resources>\n <build>\n');
  for (const ins of insts) X.push(`  <item objectid="${ins.objId}" transform="${ins.tf}" printable="1"/>\n`);
  X.push(' </build>\n</model>\n');

  // model_settings.config
  const S: string[] = ['<?xml version="1.0" encoding="UTF-8"?>\n<config>\n'];
  for (const ins of insts) {
    const m = meshes.get(ins.job.partId)!; const faces = m.idx.length / 3;
    S.push(`  <object id="${ins.objId}">\n    <metadata key="name" value="${esc(partName(ins.job.part))}"/>\n    <metadata key="extruder" value="1"/>\n`);
    // per-object settings as in the print profile (e.g. curves: infill direction 45 + bridge direction 0, adapters 10 %)
    for (const [k, v] of Object.entries(ins.job.part.printMeta ?? {})) S.push(`    <metadata key="${esc(k)}" value="${esc(v)}"/>\n`);
    if (ins.job.support) S.push('    <metadata key="enable_support" value="1"/>\n    <metadata key="support_type" value="tree(auto)"/>\n');
    S.push(`    <metadata face_count="${faces}"/>\n    <part id="${m.objId}" subtype="normal_part">\n      <metadata key="name" value="${esc(partName(ins.job.part))}"/>\n      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n      <metadata key="source_file" value="${esc(partName(ins.job.part))}.stl"/>\n      <metadata key="source_object_id" value="0"/>\n      <metadata key="source_volume_id" value="0"/>\n      <metadata key="source_offset_x" value="0"/>\n      <metadata key="source_offset_y" value="0"/>\n      <metadata key="source_offset_z" value="0"/>\n      <mesh_stat face_count="${faces}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>\n    </part>\n  </object>\n`);
  }
  let ident = 100;
  plates.forEach((plate, pi) => {
    S.push(`  <plate>\n    <metadata key="plater_id" value="${pi + 1}"/>\n    <metadata key="plater_name" value="${esc(plateName(plate))}"/>\n    <metadata key="locked" value="false"/>\n`);
    for (const ins of insts.filter((x) => x.plate === plate)) S.push(`    <model_instance>\n      <metadata key="object_id" value="${ins.objId}"/>\n      <metadata key="instance_id" value="0"/>\n      <metadata key="identify_id" value="${++ident}"/>\n    </model_instance>\n`);
    S.push('  </plate>\n');
  });
  S.push('</config>\n');
  return {
    model: X.join(''), settings: S.join(''),
    instances: insts.map((ins) => ({ objId: ins.objId, partId: ins.job.partId, plate: plates.indexOf(ins.plate), x: ins.pos[0], y: ins.pos[1], z: ins.pos[2], rot90: ins.job.rot90 })),
  };
}
