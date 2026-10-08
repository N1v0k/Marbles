// Print meshes for the 3MF exports, read from the all-parts print profile 3MF the user drops in. The file is kept in
// memory for this session only (nothing is stored or uploaded); after a reload it has to be dropped in again.
//
// Profile 3MF layout (Bambu Studio 2.x): 3D/3dmodel.model holds one component per object referencing
// 3D/Objects/object_<n>.model (the mesh); the build items place the objects on the plates (print rotation + position).
// Metadata/model_settings.config gives each object's name (= English part name nameEn) and face_count; the names are
// mapped to catalog parts. Bambu Studio stores every mesh centred on its bounding box; it is moved back into part
// coordinates with the centre from src/data/print_ref.json (tools/print_ref.py): mesh - own centre + reference centre.
// The edition (plain or Japandi) is detected from the triangle counts of the grooved parts.
import { unzipSync, strFromU8 } from 'fflate';
import refJson from './data/print_ref.json';
import { catalog, type Part } from './catalog';
import type { RawMesh } from './kbm';

export type Ed = 'plain' | 'japandi';
/** [triangles, centre x, y, z, size x, y, z, volume] per print mesh (tools/print_ref.py). */
type RefRow = [number, number, number, number, number, number, number, number];
const REF = refJson as unknown as { plain: Record<string, RefRow>; japandi: Record<string, RefRow> };
/** Maximum deviation of the bounding-box size from the reference print mesh (mm). */
export const SIZE_TOL = 0.01;
/** Minimum number of 16 mm parts a file must contain (the all-parts profile has 137). */
export const MIN_PARTS = 20;

/** An object of the profile 3MF that belongs to a builder part. */
export interface ProfileObj { name: string; file: string; path: string; objectId: number; tf: number[] | null; faces: number | null }
export interface Profile {
  edition: Ed; fileName: string; title: string; parts: number;
  /** print meshes missing from the profile (palette parts only, without extras) */
  missing: string[];
  objs: Map<string, ProfileObj>; bytes: Uint8Array; cache: Map<string, Promise<RawMesh | null>>;
}
export type ScanResult =
  | { ok: true; profile: Profile }
  | { ok: false; reason: 'notZip' | 'notThreeMf' | 'noParts' | 'unknownEdition'; detail?: string };

function unesc(s: string): string { return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }
function attrs(s: string): Record<string, string> {
  const a: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) a[m[1]] = unesc(m[2]);
  return a;
}

/** Part name (English, without .stl) -> print mesh file; only parts with their own print mesh (catalog + print_ref). */
export const FILE_BY_NAME = new Map<string, string>();
/** Print mesh file -> catalog part. */
const PART_BY_FILE = new Map<string, Part>();
for (const p of catalog.parts) {
  if (!REF.plain[p.file] || p.display) continue;
  if (!PART_BY_FILE.has(p.file)) PART_BY_FILE.set(p.file, p);
  if (p.nameEn && !FILE_BY_NAME.has(p.nameEn)) FILE_BY_NAME.set(p.nameEn, p.file);
}
/** Grooved parts (own Japandi mesh): grooved in the Japandi profile, smooth in the plain profile, same name in both. */
export function groovedFile(file: string): boolean { return !!REF.japandi[file]; }

/** Reads objects, components and names of a profile 3MF (without unpacking the meshes). */
export function scanProfile(bytes: Uint8Array, fileName = ''): ScanResult {
  if (bytes.length < 30 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return { ok: false, reason: 'notZip' };
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes, { filter: (f) => f.name === '3D/3dmodel.model' || f.name === 'Metadata/model_settings.config' }); }
  catch { return { ok: false, reason: 'notZip' }; }
  if (!files['3D/3dmodel.model']) return { ok: false, reason: 'notThreeMf' };
  const model = strFromU8(files['3D/3dmodel.model']);
  const settings = files['Metadata/model_settings.config'] ? strFromU8(files['Metadata/model_settings.config']) : '';
  const title = unesc(/<metadata\s+name="Title"\s*>([^<]*)<\/metadata>/.exec(model)?.[1] ?? '').trim();
  // objects with exactly one component referencing a mesh file (this is how Bambu Studio saves every object)
  const comps = new Map<number, { path: string; objectId: number; tf: number[] | null }>();
  for (const m of model.matchAll(/<object\s([^>]*)>([\s\S]*?)<\/object>/g)) {
    const id = Number(attrs(m[1]).id);
    const cs = [...m[2].matchAll(/<component\s([^>]*?)\/?>/g)].map((c) => attrs(c[1]));
    if (cs.length !== 1 || !cs[0]['p:path']) continue;
    const tf = cs[0].transform ? cs[0].transform.trim().split(/\s+/).map(Number) : null;
    const ident = !tf || (tf.length === 12 && tf.every((v, i) => Math.abs(v - [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0][i]) < 1e-9));
    comps.set(id, { path: cs[0]['p:path'].replace(/^\//, ''), objectId: Number(cs[0].objectid), tf: ident ? null : tf });
  }
  // name and triangle count per object from model_settings.config
  const objs = new Map<string, ProfileObj>();
  for (const m of settings.matchAll(/<object\s+id="(\d+)"\s*>([\s\S]*?)<\/object>/g)) {
    const c = comps.get(Number(m[1])); if (!c) continue;
    const name = unesc(/<metadata\s+key="name"\s+value="([^"]*)"/.exec(m[2])?.[1] ?? '').trim().replace(/\.stl$/i, '');
    const file = FILE_BY_NAME.get(name);
    if (!file || objs.has(file)) continue;      // unknown object (e.g. fit test) or repeated object (e.g. snap pins)
    const fc = /<metadata\s+face_count="(\d+)"/.exec(m[2]);
    objs.set(file, { name, file, path: c.path, objectId: c.objectId, tf: c.tf, faces: fc ? Number(fc[1]) : null });
  }
  if (objs.size < MIN_PARTS) return { ok: false, reason: 'noParts', detail: String(objs.size) };
  // edition from the grooved parts: does the triangle count match the plain or the Japandi print mesh?
  let g = 0, j = 0;
  for (const o of objs.values()) {
    if (o.faces == null || !groovedFile(o.file)) continue;
    if (o.faces === REF.plain[o.file][0]) g++; else if (o.faces === REF.japandi[o.file][0]) j++;
  }
  const profile: Profile = { edition: 'plain', fileName, title, parts: objs.size, missing: [], objs, bytes, cache: new Map() };
  if (g === j) {
    // no face_count: count the triangles of the first grooved part
    const o = [...objs.values()].find((x) => groovedFile(x.file));
    const n = o ? readObjectMesh(bytes, o)?.idx.length : undefined;
    if (o && n != null && n / 3 === REF.japandi[o.file][0]) j++;
    else if (o && n != null && n / 3 === REF.plain[o.file][0]) g++;
  }
  if (g === j) return { ok: false, reason: 'unknownEdition', detail: title };
  profile.edition = j > g ? 'japandi' : 'plain';
  profile.missing = paletteFiles().filter((f) => !objs.has(f));
  return { ok: true, profile };
}

/** Print mesh files a track built from the palette may need (released parts, without extras/display parts). */
export function paletteFiles(): string[] {
  return [...PART_BY_FILE.values()].filter((p) => p.released && p.plate).map((p) => p.file).sort();
}

/** Mesh in double precision (before it is moved into part coordinates). */
export interface Mesh64 { pos: Float64Array; idx: Uint32Array }
/** Reads the mesh of an object from the 3MF (object coordinates, component transform applied). */
export function readObjectMesh(bytes: Uint8Array, o: Pick<ProfileObj, 'path' | 'objectId' | 'tf'>): Mesh64 | null {
  let raw: Uint8Array | undefined;
  try { raw = unzipSync(bytes, { filter: (f) => f.name === o.path })[o.path]; } catch { return null; }
  if (!raw) return null;
  const xml = strFromU8(raw);
  const start = xml.search(new RegExp(`<object\\s[^>]*\\bid="${o.objectId}"`));
  if (start < 0) return null;
  const end = xml.indexOf('</object>', start);
  const body = xml.slice(start, end < 0 ? undefined : end);
  const v: number[] = [];
  for (const m of body.matchAll(/<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"/g)) v.push(+m[1], +m[2], +m[3]);
  const t: number[] = [];
  for (const m of body.matchAll(/<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"/g)) t.push(+m[1], +m[2], +m[3]);
  const nV = v.length / 3;
  if (!nV || !t.length || t.some((i) => i >= nV) || v.some((x) => !Number.isFinite(x))) return null;
  const pos = new Float64Array(v);
  if (o.tf) {   // 3MF: row vector, v' = v * M (m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32)
    const M = o.tf;
    for (let i = 0; i < nV; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      pos[i * 3] = x * M[0] + y * M[3] + z * M[6] + M[9];
      pos[i * 3 + 1] = x * M[1] + y * M[4] + z * M[7] + M[10];
      pos[i * 3 + 2] = x * M[2] + y * M[5] + z * M[8] + M[11];
    }
  }
  return { pos, idx: Uint32Array.from(t) };
}

/** Moves a mesh into part coordinates and checks it against the reference (triangle count, size). null: no match. */
export function toPartCoords(m: Mesh64, ref: RefRow): RawMesh | null {
  const n = m.pos.length / 3;
  if (m.idx.length / 3 !== ref[0]) return null;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { const x = m.pos[i * 3 + a]; if (x < lo[a]) lo[a] = x; if (x > hi[a]) hi[a] = x; }
  for (let a = 0; a < 3; a++) if (Math.abs(hi[a] - lo[a] - ref[4 + a]) > SIZE_TOL) return null;
  const d = [0, 1, 2].map((a) => ref[1 + a] - (lo[a] + hi[a]) / 2);
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) pos[i * 3 + a] = m.pos[i * 3 + a] + d[a];
  return { pos, idx: m.idx };
}

// ---------------------------------------------------------------- profiles of this session (in memory only)
const profiles: Partial<Record<Ed, Profile>> = {};
let listeners: (() => void)[] = [];

/** Checks a profile 3MF and keeps it for this session (replaces an earlier profile of the same edition). */
export function registerProfile(bytes: Uint8Array, fileName = ''): ScanResult {
  const r = scanProfile(bytes, fileName);
  if (r.ok) { profiles[r.profile.edition] = r.profile; listeners.forEach((f) => f()); }
  return r;
}
export function getProfile(ed: Ed): Profile | null { return profiles[ed] ?? null; }
export function hasProfile(ed: Ed): boolean { return !!profiles[ed]; }
export function clearProfiles() { delete profiles.plain; delete profiles.japandi; listeners.forEach((f) => f()); }
export function onProfilesChange(f: () => void) { listeners.push(f); return () => { listeners = listeners.filter((x) => x !== f); }; }

/** Which profile supplies a print mesh? jp: the grooved Japandi mesh. The smooth version of a grooved part exists only in
 *  the plain profile (the Japandi profile has the grooved one under the same name); all other parts are identical in both. */
export function sourceFor(file: string, jp: boolean): Profile | null {
  if (jp) return profiles.japandi ?? null;
  if (groovedFile(file)) return profiles.plain ?? null;
  return profiles.plain ?? profiles.japandi ?? null;
}

/** Print mesh in part coordinates from the dropped profile; null if no profile is loaded or it lacks a matching part. */
export function getPrintMesh(file: string, jp = false): Promise<RawMesh | null> {
  const prof = sourceFor(file, jp);
  if (!prof) return Promise.resolve(null);
  const ref = jp ? REF.japandi[file] : REF.plain[file];
  const o = prof.objs.get(file);
  if (!ref || !o) return Promise.resolve(null);
  let c = prof.cache.get(file);
  if (!c) {
    c = (async () => {
      await new Promise((r) => setTimeout(r, 0));   // yield to the UI between parts (progress updates)
      const m = readObjectMesh(prof.bytes, o);
      return m ? toPartCoords(m, ref) : null;
    })();
    prof.cache.set(file, c);
  }
  return c;
}
