// "Print in one piece": the track as ONE object made of many parts. Bambu Studio merges the parts of an object
// that share a filament while slicing (PrintObjectSlice.cpp, slices_to_regions), so the track prints fused,
// without snap pins.
import { catalog, kitOf, asmOf, type Part } from './catalog';
import type { AABB, Layout } from './chain';

/** A print part in world position (as in the 3D view: rotation about z, then position t and height z). loose: prints
 *  separately (lift and flip-flop have moving parts; they stay loose and are joined with snap pins as usual). */
export interface AsmItem { part: Part; rot: number; t: [number, number]; z: number; adapter: boolean; owner: number; loose: boolean }

/** Chain parts that are not fused (kits with moving parts). */
export function isLoose(p: Part): boolean { return !!kitOf(p); }

export function assemblyItems(layout: Layout): AsmItem[] {
  const out: AsmItem[] = [];
  for (const q of layout.placed) {
    if (!q.connected) continue;
    const kit = kitOf(q.part);
    if (kit) {
      for (const k of kit) {
        const m = catalog.byId.get(k.id); if (!m) continue;
        for (let i = 0; i < k.n; i++) out.push({ part: m, rot: 0, t: [0, 0], z: 0, adapter: false, owner: q.idx, loose: true });
      }
      continue;
    }
    out.push({ part: q.part, rot: q.rot, t: q.t, z: q.S, adapter: false, owner: q.idx, loose: false });
  }
  for (const a of layout.adapters) out.push({ part: a.part, rot: a.rot, t: a.t, z: a.z, adapter: true, owner: a.owner, loose: false });
  return out;
}

/** Bounding box of a part in world position (from the catalog bounding box). */
export function itemBox(it: AsmItem): AABB {
  const [a, b] = it.part.bbox;
  const r = (it.rot * Math.PI) / 180, c = Math.round(Math.cos(r)), s = Math.round(Math.sin(r));
  const xs: number[] = [], ys: number[] = [];
  for (const x of [a[0], b[0]]) for (const y of [a[1], b[1]]) { xs.push(c * x - s * y + it.t[0]); ys.push(s * x + c * y + it.t[1]); }
  return { min: [Math.min(...xs), Math.min(...ys), it.z + a[2]], max: [Math.max(...xs), Math.max(...ys), it.z + b[2]] };
}

/** Bounding box of all fused parts (null: nothing to print). */
export function assemblyBounds(items: AsmItem[]): AABB | null {
  let box: AABB | null = null;
  for (const it of items) {
    if (it.loose) continue;
    const b = itemBox(it);
    if (!box) box = { min: [...b.min], max: [...b.max] };
    else for (let i = 0; i < 3; i++) { box.min[i] = Math.min(box.min[i], b.min[i]); box.max[i] = Math.max(box.max[i], b.max[i]); }
  }
  return box;
}
/** Bounding box of the loose kits (lift, flip-flop) as the 3D view shows them: the modules of their assembly in
 *  world position. The lift crank rotates and is ignored. Only used to position the build plate: lift and flip-flop
 *  should stand on the plate too when there is room, although they print separately. */
export function looseBounds(layout: Layout): AABB | null {
  let box: AABB | null = null;
  for (const q of layout.placed) {
    if (!q.connected || !isLoose(q.part)) continue;
    for (const m of asmOf(q.part) ?? [{ id: q.part.id, z: 0, rot: 0 }]) {
      if (/Kurbel/.test(m.id)) continue;
      const p = catalog.byId.get(m.id); if (!p) continue;
      const b = itemBox({ part: p, rot: (q.rot + m.rot) % 360, t: q.t, z: q.S + m.z, adapter: false, owner: q.idx, loose: true });
      if (!box) box = { min: [...b.min], max: [...b.max] };
      else for (let i = 0; i < 3; i++) { box.min[i] = Math.min(box.min[i], b.min[i]); box.max[i] = Math.max(box.max[i], b.max[i]); }
    }
  }
  return box;
}
export function boxSize(b: AABB): [number, number, number] { return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]]; }

/** Snap pins still needed for the one-piece print: at the joints and tower steps of lift and flip-flop (they stay loose)
 *  and inside the lift itself. All other joints are fused. */
export function loosePins(layout: Layout): number {
  const loose = new Set(layout.placed.filter((q) => q.connected && isLoose(q.part)).map((q) => q.idx + 1));
  if (!loose.size) return 0;
  const touches = (lbl: string) => { const m = /^(\d+)\. /.exec(lbl); return lbl === 'Lift' || (!!m && loose.has(Number(m[1]))); };
  return layout.pins.filter((j) => touches(j.a) || touches(j.b)).reduce((s, j) => s + j.n, 0);
}

/** Raised parts (the one-piece print needs supports: tree supports on the build plate only). */
export function hasRaised(items: AsmItem[]): boolean { return items.some((it) => !it.loose && it.z > 0.01); }
