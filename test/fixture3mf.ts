// Test 3MF laid out like a print profile saved by Bambu Studio: 3D/3dmodel.model with one object per part
// (one component pointing to 3D/Objects/object_<n>.model), build items with print orientation, Metadata/model_settings.config
// with names and face_count. Meshes are stored centered on their bounding box, as Bambu Studio does (float32, 9 digits).
// No real geometry: boxMesh() builds a box with the same size and triangle count from the reference values
// (src/data/print_ref.json) - enough to check matching, coordinates and edition detection without print meshes in the repo.
import { zipSync, strToU8 } from 'fflate';
import refJson from '../src/data/print_ref.json';

export type RefRow = [number, number, number, number, number, number, number, number];
export const REF = refJson as unknown as { plain: Record<string, RefRow>; japandi: Record<string, RefRow> };

export interface FixObj {
  name: string;              // object name (English part name)
  pos: number[];             // vertices in part coordinates (stored centered)
  idx: number[];
  rotZ?: number;             // print orientation (build item)
  faces?: number | null;     // face_count in model_settings.config (default: triangle count; null: omit)
  componentTf?: string;      // component transform (default: identity)
}

/** Box with size and center from the reference values, padded to the triangle count (repeated faces). */
export function boxMesh(ref: RefRow, triangles = ref[0]): { pos: number[]; idx: number[] } {
  const [cx, cy, cz, sx, sy, sz] = ref.slice(1, 7);
  const pos: number[] = [];
  for (const z of [-1, 1]) for (const y of [-1, 1]) for (const x of [-1, 1]) pos.push(cx + (x * sx) / 2, cy + (y * sy) / 2, cz + (z * sz) / 2);
  const faces = [0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5];
  const idx: number[] = [];
  for (let t = 0; t < triangles; t++) { const k = (t % 12) * 3; idx.push(faces[k], faces[k + 1], faces[k + 2]); }
  return { pos, idx };
}

const num = (v: number) => String(Number(Math.fround(v).toPrecision(9)));

export function bambu3mf(objs: FixObj[], opts: { title?: string; meta?: Record<string, string> } = {}): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const res: string[] = [], items: string[] = [], sett: string[] = [];
  objs.forEach((o, k) => {
    const meshId = 2 * k + 1, objId = 2 * k + 2, path = `3D/Objects/object_${k + 1}.model`;
    const n = o.pos.length / 3, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], o.pos[i * 3 + a]); hi[a] = Math.max(hi[a], o.pos[i * 3 + a]); }
    const c = [0, 1, 2].map((a) => (lo[a] + hi[a]) / 2);
    const V: string[] = [];
    for (let i = 0; i < n; i++) V.push(`     <vertex x="${num(o.pos[i * 3] - c[0])}" y="${num(o.pos[i * 3 + 1] - c[1])}" z="${num(o.pos[i * 3 + 2] - c[2])}"/>\n`);
    const T: string[] = [];
    for (let i = 0; i < o.idx.length; i += 3) T.push(`     <triangle v1="${o.idx[i]}" v2="${o.idx[i + 1]}" v3="${o.idx[i + 2]}"/>\n`);
    files[path] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">\n <resources>\n  <object id="${meshId}" p:UUID="0000${k}" type="model">\n   <mesh>\n    <vertices>\n${V.join('')}    </vertices>\n    <triangles>\n${T.join('')}    </triangles>\n   </mesh>\n  </object>\n </resources>\n <build/>\n</model>\n`);
    res.push(`  <object id="${objId}" p:UUID="1111${k}" type="model">\n   <components>\n    <component p:path="/${path}" objectid="${meshId}" p:UUID="2222${k}" transform="${o.componentTf ?? '1 0 0 0 1 0 0 0 1 0 0 0'}"/>\n   </components>\n  </object>\n`);
    const a = ((o.rotZ ?? 0) * Math.PI) / 180, co = Math.round(Math.cos(a)), si = Math.round(Math.sin(a));
    items.push(`  <item objectid="${objId}" transform="${co} ${si} 0 ${-si} ${co} 0 0 0 1 ${100 + k * 40} 128 ${num((hi[2] - lo[2]) / 2)}" printable="1"/>\n`);
    const faces = o.faces === undefined ? o.idx.length / 3 : o.faces;
    sett.push(`  <object id="${objId}">\n    <metadata key="name" value="${o.name}"/>\n    <metadata key="extruder" value="1"/>\n${faces == null ? '' : `    <metadata face_count="${faces}"/>\n`}    <part id="${meshId}" subtype="normal_part">\n      <metadata key="name" value="${o.name}"/>\n      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n    </part>\n  </object>\n`);
  });
  const meta = { Application: 'BambuStudio-02.08.02.61', Title: opts.title ?? 'Test', DesignerUserId: '3696494148', ...(opts.meta ?? {}) };
  files['3D/3dmodel.model'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">\n${Object.entries(meta).map(([k, v]) => ` <metadata name="${k}">${v}</metadata>\n`).join('')} <resources>\n${res.join('')} </resources>\n <build>\n${items.join('')} </build>\n</model>\n`);
  files['Metadata/model_settings.config'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${sett.join('')}</config>\n`);
  files['[Content_Types].xml'] = strToU8('<?xml version="1.0" encoding="UTF-8"?>\n<Types/>\n');
  return zipSync(files, { level: 1 });
}
