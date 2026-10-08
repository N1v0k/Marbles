// "Track in one piece" export: a Bambu Studio 3MF with ONE object whose parts are the track parts and adapters in their
// world position (components with a transform; identical parts share one mesh). Bambu Studio loads it as one object with
// several parts and merges them while slicing (same filament = one region, no inner walls).
// No snap pins and no per-object profile settings (those would create separate regions with inner walls).
// Lift and flip-flop stay loose: their print parts lie in print orientation on plates of their own, with the snap pins
// for their joints.
import { zipSync } from 'fflate';
import { catalog, isJapandi, grooved, partGrams, partHours, SNAP_PIN, type Part } from './catalog';
import type { AABB, Layout } from './chain';
import { assemblyItems, assemblyBounds, looseBounds, boxSize, loosePins, hasRaised, type AsmItem } from './assembly';
import { placeOnPlate, PLATE_MARGIN, type Printer, type PlatePlace } from './printers';
import { Packer, printOrientation, GAP, type Plate, type PlacedJob, type PrintJob } from './plates';
import { loadPrintMesh, orient, packageFiles, esc, f, metaXml, APP_HEADER, type MeshData } from './threemf';
import { partName } from './i18n';
import { filamentKey } from './colors';

export interface AsmPlan {
  fused: AsmItem[]; bounds: AABB; size: [number, number, number]; fit: PlatePlace; printer: Printer;
  loose: Plate[]; looseTooBig: string[]; pins: number; raised: boolean; grams: number; hours: number;
}

/** Print job for a loose part (orientation as in the print profile). */
function jobFor(part: Part, key: string): PrintJob {
  const o = printOrientation(part);
  return { key, partId: part.id, part, label: partName(part), level: 0, order: 0, hours: partHours(part), grams: partGrams(part),
           w: o.w, d: o.d, h: o.h, rotZ: o.rotZ, rotFree: false, support: false, color: filamentKey(part) };
}

/** Export plan (pure, no meshes): fused parts, position on the plate, loose parts on plates of their own. */
export function planAssembly(layout: Layout, printer: Printer): AsmPlan | null {
  const items = assemblyItems(layout);
  const fused = items.filter((i) => !i.loose);
  const bounds = assemblyBounds(items);
  if (!bounds || !fused.length) return null;
  const size = boxSize(bounds);
  // plate position: the piece fits with margin; lift/flip-flop stand on it too when there is room
  const fit = placeOnPlate(bounds, looseBounds(layout), printer);
  // loose parts + the snap pins of their joints on plates of the printer's size
  const jobs: PrintJob[] = items.filter((i) => i.loose).map((i, k) => jobFor(i.part, `l${k}`));
  const pins = loosePins(layout);
  const pinPart = catalog.byId.get(SNAP_PIN);
  if (pinPart) for (let k = 0; k < pins; k++) jobs.push(jobFor(pinPart, `s${k}`));
  const loose: Plate[] = []; const looseTooBig: string[] = [];
  const iw = printer.x - 2 * PLATE_MARGIN, id = printer.y - 2 * PLATE_MARGIN;
  let cur: { plate: Plate; packer: Packer } | null = null;
  for (const job of jobs) {
    if (job.w > iw || job.d > id || job.h > printer.z) { looseTooBig.push(job.label); continue; }
    let pos = cur?.packer.insert(job.w + GAP, job.d + GAP, false) ?? null;
    if (!pos) {
      cur = { plate: { level: 0, index: loose.length + 2, jobs: [], hours: 0, grams: 0, usedArea: 0, color: null }, packer: new Packer(iw, id) };
      loose.push(cur.plate);
      pos = cur.packer.insert(job.w + GAP, job.d + GAP, false);
      if (!pos) { looseTooBig.push(job.label); continue; }
    }
    const pj: PlacedJob = { ...job, x: pos.x + PLATE_MARGIN, y: pos.y + PLATE_MARGIN, rot90: false };
    cur!.plate.jobs.push(pj); cur!.plate.hours += job.hours; cur!.plate.grams += job.grams; cur!.plate.usedArea += job.w * job.d;
  }
  const grams = fused.reduce((s, i) => s + partGrams(i.part), 0), hours = fused.reduce((s, i) => s + partHours(i.part), 0);
  return { fused, bounds, size, fit, printer, loose, looseTooBig, pins, raised: hasRaised(items), grams, hours };
}

/** 3MF row-vector transform (v' = v * M) for a rotation about z (degrees) plus translation. */
export function tfRotZ(deg: number, tx: number, ty: number, tz: number): string {
  const a = (deg * Math.PI) / 180, c = Math.round(Math.cos(a) * 1e9) / 1e9, s = Math.round(Math.sin(a) * 1e9) / 1e9;
  return `${f(c)} ${f(s)} 0 ${f(-s)} ${f(c)} 0 0 0 1 ${f(tx)} ${f(ty)} ${f(tz)}`;
}
/** The same as a 4x4 matrix (column-vector convention, row by row) for model_settings.config. */
function mat4RotZ(deg: number, tx: number, ty: number, tz: number): string {
  const a = (deg * Math.PI) / 180, c = Math.round(Math.cos(a) * 1e9) / 1e9, s = Math.round(Math.sin(a) * 1e9) / 1e9;
  return `${f(c)} ${f(-s)} 0 ${f(tx)} ${f(s)} ${f(c)} 0 ${f(ty)} 0 0 1 ${f(tz)} 0 0 0 1`;
}

export interface AsmFiles { model: string; settings: string; objects: number; parts: number; plates: number }
/** Mesh keys: 'w:<file>' (model coordinates, fused) or 'l:<rot>:<file>' (loose, rotated and centred). */
export function asmMeshKey(it: { part: Part }, loose: boolean, jp: boolean, rotZ = 0): string {
  return (loose ? `l:${rotZ}:` : 'w:') + (jp && grooved(it.part) ? 'j:' : '') + it.part.file;
}

/** 3dmodel.model + model_settings.config (pure). meshes: meshes by asmMeshKey. */
export function buildAssemblyFiles(plan: AsmPlan, meshes: Map<string, MeshData>, opts: { title: string; objectName: string; jp: boolean; meta?: Record<string, string> }): AsmFiles {
  const ids = new Map<string, number>();
  const X: string[] = [];
  X.push('<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">\n');
  X.push(` <metadata name="Application">${APP_HEADER}</metadata>\n <metadata name="BambuStudio:3mfVersion">1</metadata>\n`);
  X.push(` <metadata name="Title">${esc(opts.title)}</metadata>\n <metadata name="CreationDate">${new Date().toISOString().slice(0, 10)}</metadata>\n`);
  X.push(metaXml(opts.meta ?? {}) + ' <resources>\n');
  // Every mesh is stored centred (bounding-box centre = 0); the offset goes into the component transform.
  // Bambu Studio centres each mesh on load and shifts the part back by the centre: correctly for the FIRST part
  // (component * centre), but unrotated for every further part sharing that mesh (component, then + centre;
  // bbs_3mf.cpp, _generate_volumes_new, "shared_volume" branch), so rotated repeats ended up misplaced.
  // With centred meshes the centre is 0 and both paths agree.
  const centers = new Map<string, [number, number, number]>();
  const meshObj = (key: string): number => {
    let id = ids.get(key); if (id) return id;
    const m = meshes.get(key); if (!m) throw new Error('Missing mesh: ' + key);
    id = ids.size + 1; ids.set(key, id);
    const n = m.pos.length / 3;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { const v = m.pos[i * 3 + a]; if (v < lo[a]) lo[a] = v; if (v > hi[a]) hi[a] = v; }
    const c: [number, number, number] = n ? [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2] : [0, 0, 0];
    centers.set(key, c);
    X.push(`  <object id="${id}" type="model">\n   <mesh>\n    <vertices>\n`);
    for (let i = 0; i < n; i++) X.push(`     <vertex x="${f(m.pos[i * 3] - c[0])}" y="${f(m.pos[i * 3 + 1] - c[1])}" z="${f(m.pos[i * 3 + 2] - c[2])}"/>\n`);
    X.push('    </vertices>\n    <triangles>\n');
    for (let i = 0; i < m.idx.length / 3; i++) X.push(`     <triangle v1="${m.idx[i * 3]}" v2="${m.idx[i * 3 + 1]}" v3="${m.idx[i * 3 + 2]}"/>\n`);
    X.push('    </triangles>\n   </mesh>\n  </object>\n');
    return id;
  };
  // fused parts: world position, object centre xy = 0, bottom z = 0
  const b = plan.bounds, cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, z0 = b.min[2];
  const comps = plan.fused.map((it) => {
    const key = asmMeshKey(it, false, opts.jp);
    const id = meshObj(key), c = centers.get(key)!;
    // component = rotation about z, then translation; the centred mesh also needs the rotated centre
    const a = (it.rot * Math.PI) / 180, co = Math.round(Math.cos(a) * 1e9) / 1e9, si = Math.round(Math.sin(a) * 1e9) / 1e9;
    return { it, key, id, tx: it.t[0] - cx + co * c[0] - si * c[1], ty: it.t[1] - cy + si * c[0] + co * c[1], tz: it.z - z0 + c[2] };
  });
  // loose parts: one mesh per part in print orientation (centred)
  const looseObjs: { job: PlacedJob; plate: number; key: string; id: number; size: [number, number, number] }[] = [];
  plan.loose.forEach((plate, pi) => {
    for (const job of plate.jobs) {
      const key = asmMeshKey(job, true, opts.jp, job.rotZ);
      looseObjs.push({ job, plate: pi + 1, key, id: meshObj(key), size: [job.w, job.d, job.h] });
    }
  });
  let nextId = ids.size;
  const asmId = ++nextId;
  X.push(`  <object id="${asmId}" type="model">\n   <components>\n`);
  for (const c of comps) X.push(`    <component objectid="${c.id}" transform="${tfRotZ(c.it.rot, c.tx, c.ty, c.tz)}"/>\n`);
  X.push('   </components>\n  </object>\n');
  const looseIds = looseObjs.map((o) => {
    const id = ++nextId, c = centers.get(o.key)!;
    X.push(`  <object id="${id}" type="model">\n   <components>\n    <component objectid="${o.id}" transform="${tfRotZ(0, c[0], c[1], c[2])}"/>\n   </components>\n  </object>\n`);
    return id;
  });
  X.push(' </resources>\n <build>\n');
  const pr = plan.printer;
  // position on the plate as in the 3D view: offset of the piece centre from the plate centre, rotated along at 90°
  const dx = cx - plan.fit.cx, dy = cy - plan.fit.cy;
  const [px, py] = plan.fit.rot90 ? [pr.x / 2 - dy, pr.y / 2 + dx] : [pr.x / 2 + dx, pr.y / 2 + dy];
  X.push(`  <item objectid="${asmId}" transform="${tfRotZ(plan.fit.rot90 ? 90 : 0, px, py, 0)}" printable="1"/>\n`);
  // plate grid as in Bambu Studio: plate size * 1.2, columns = ceil(sqrt(n)), rows towards -y
  const nPlates = 1 + plan.loose.length, cols = Math.max(1, Math.ceil(Math.sqrt(nPlates)));
  const origin = (pi: number): [number, number] => [(pi % cols) * pr.x * 1.2, -Math.floor(pi / cols) * pr.y * 1.2];
  looseObjs.forEach((o, k) => {
    const [ox, oy] = origin(o.plate);
    X.push(`  <item objectid="${looseIds[k]}" transform="${tfRotZ(0, ox + o.job.x + o.size[0] / 2, oy + o.job.y + o.size[1] / 2, o.size[2] / 2)}" printable="1"/>\n`);
  });
  X.push(' </build>\n</model>\n');

  // model_settings.config
  const S: string[] = ['<?xml version="1.0" encoding="UTF-8"?>\n<config>\n'];
  const faces = (key: string) => meshes.get(key)!.idx.length / 3;
  S.push(`  <object id="${asmId}">\n    <metadata key="name" value="${esc(opts.objectName)}"/>\n    <metadata key="extruder" value="1"/>\n`);
  if (plan.raised) S.push('    <metadata key="enable_support" value="1"/>\n    <metadata key="support_type" value="tree(auto)"/>\n    <metadata key="support_on_build_plate_only" value="1"/>\n');
  S.push(`    <metadata face_count="${comps.reduce((s, c) => s + faces(c.key), 0)}"/>\n`);
  comps.forEach((c, k) => {
    S.push(`    <part id="${c.id}" subtype="normal_part">\n      <metadata key="name" value="${esc(String(k + 1).padStart(2, '0') + ' ' + partName(c.it.part))}"/>\n` +
      `      <metadata key="matrix" value="${mat4RotZ(c.it.rot, c.tx, c.ty, c.tz)}"/>\n` +
      `      <mesh_stat face_count="${faces(c.key)}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>\n    </part>\n`);
  });
  S.push('  </object>\n');
  looseObjs.forEach((o, k) => {
    const nm = esc(partName(o.job.part));
    S.push(`  <object id="${looseIds[k]}">\n    <metadata key="name" value="${nm}"/>\n    <metadata key="extruder" value="1"/>\n`);
    for (const [mk, mv] of Object.entries(o.job.part.printMeta ?? {})) S.push(`    <metadata key="${esc(mk)}" value="${esc(mv)}"/>\n`);
    S.push(`    <metadata face_count="${faces(o.key)}"/>\n    <part id="${o.id}" subtype="normal_part">\n      <metadata key="name" value="${nm}"/>\n      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n` +
      `      <mesh_stat face_count="${faces(o.key)}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>\n    </part>\n  </object>\n`);
  });
  let ident = 100;
  const plateXml = (no: number, name: string, oids: number[]) => {
    S.push(`  <plate>\n    <metadata key="plater_id" value="${no}"/>\n    <metadata key="plater_name" value="${esc(name)}"/>\n    <metadata key="locked" value="false"/>\n`);
    for (const oid of oids) S.push(`    <model_instance>\n      <metadata key="object_id" value="${oid}"/>\n      <metadata key="instance_id" value="0"/>\n      <metadata key="identify_id" value="${++ident}"/>\n    </model_instance>\n`);
    S.push('  </plate>\n');
  };
  // plate names without <>:/\\|?* (Studio discards the name otherwise)
  plateXml(1, opts.objectName.replace(/[<>:/\\|?*"]/g, '-'), [asmId]);
  plan.loose.forEach((_, pi) => plateXml(pi + 2, `Loose parts ${pi + 1} - lift, flip-flop, pins`, looseIds.filter((_, k) => looseObjs[k].plate === pi + 1)));
  S.push('</config>\n');
  return { model: X.join(''), settings: S.join(''), objects: 1 + looseIds.length, parts: comps.length, plates: nPlates };
}

export interface AsmResult { blob: Blob; previewQuality: string[]; plates: number; parts: number }
export async function buildAssemblyThreeMf(plan: AsmPlan, opts: { title: string; objectName: string; meta?: Record<string, string> }, onProgress?: (msg: string) => void): Promise<AsmResult> {
  const jp = isJapandi();
  const meshes = new Map<string, MeshData>();
  const previewQuality: string[] = [];
  const need = new Map<string, { part: Part; loose: boolean; rotZ: number }>();
  for (const it of plan.fused) need.set(asmMeshKey(it, false, jp), { part: it.part, loose: false, rotZ: 0 });
  for (const pl of plan.loose) for (const j of pl.jobs) need.set(asmMeshKey(j, true, jp, j.rotZ), { part: j.part, loose: true, rotZ: j.rotZ });
  for (const [key, n] of need) {
    onProgress?.(n.part.id);
    const md = await loadPrintMesh(n.part.file, jp && grooved(n.part));
    if (md.quality === 'preview') previewQuality.push(n.part.id);
    if (n.loose) { const o = orient(md, n.rotZ); meshes.set(key, { pos: o.pos, idx: md.idx, quality: md.quality }); }
    else meshes.set(key, md);
  }
  const files = buildAssemblyFiles(plan, meshes, { title: opts.title, objectName: opts.objectName, jp, meta: opts.meta });
  onProgress?.('zip');
  const zipped = zipSync(packageFiles({ model: files.model, settings: files.settings, instances: [] }), { level: 4 });
  return { blob: new Blob([zipped as unknown as ArrayBuffer], { type: 'model/3mf' }), previewQuality, plates: files.plates, parts: files.parts };
}
