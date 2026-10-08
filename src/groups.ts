// Parts list grouped by base part: one card per base part (straight, curve R24, slide …) instead of one per STL,
// with select fields for the variants (kind groove/rail/tunnel, length, rim, height …). The direction (left/right,
// lift head, flip-flop exit) is NOT a select field: it is chosen on insertion - automatically if only one direction
// has room, otherwise by clicking the ghost in the 3D view (main.ts). Pure logic over the catalog (testable).
import { catalog, LANES, LIFT_TESTED, type Part } from './catalog';

export type GroupId = 'start' | 'straight' | 'curve' | 'longCurve' | 'spacer' | 'brake' | 'slide' | 'spiral' | 'funnel' | 'zigzag'
  | 'lift' | 'flipflop' | 'ymerge' | 'crossing' | 'crossTunnel' | 'hill' | 'loop' | 'offset' | 'end';
export type Chip = 'straight' | 'curve' | 'level' | 'special' | 'startEnd';
export type DimKey = 'kind' | 'len' | 'rim' | 'type' | 'h' | 'cross';
export type Dir = 'left' | 'right' | 'straight' | 'back';

/** A concrete placement: part, reversed, lane (X crossing), direction for the choice in 3D. */
export interface Orientation { part: string; reversed: boolean; lane: number; dir: Dir | null }
/** A variant = one combination of select-field values; opts = the directions to choose from on insertion. */
export interface Variant { dims: Partial<Record<DimKey, string>>; opts: Orientation[]; up: boolean; released: boolean }
export interface Group { id: GroupId; chip: Chip; dims: DimKey[]; variants: Variant[]; extra: boolean }

export const CHIPS: Chip[] = ['straight', 'curve', 'level', 'special', 'startEnd'];
const CHIP_OF: Record<GroupId, Chip> = {
  start: 'startEnd', end: 'startEnd', straight: 'straight', spacer: 'straight', brake: 'straight', curve: 'curve', longCurve: 'curve',
  slide: 'level', spiral: 'level', funnel: 'level', zigzag: 'level', lift: 'level',
  flipflop: 'special', ymerge: 'special', crossing: 'special', crossTunnel: 'special', hill: 'special', loop: 'special', offset: 'special',
};
export const GROUP_ORDER: GroupId[] = ['start', 'straight', 'curve', 'longCurve', 'spacer', 'brake', 'slide', 'spiral', 'funnel', 'lift',
  'flipflop', 'ymerge', 'crossing', 'crossTunnel', 'zigzag', 'hill', 'loop', 'offset', 'end'];
/** Value order in the select fields. */
const KIND_ORDER = ['groove', 'rail', 'rail-banked', 'tunnel-hex', 'tunnel-slot', 'tunnel-closed'];
const TYPE_ORDER = ['K420', 'S500', 'S600', 'K607', '120', '120-V16', '120-V16-rev', '95', '95-rev', 'v1', 'v2'];

/** Base part group of a catalog part (null: not in the parts list - adapters, pins, modules, display-only parts). */
export function groupOf(p: Part): GroupId | null {
  if (p.display || ['adapter', 'pin', 'liftPart', 'flipflopPart'].includes(p.family)) return null;
  const id = p.id;
  if (p.family === 'start') return 'start';
  if (p.family === 'end') return 'end';
  if (p.family === 'lift') return 'lift';
  if (id.startsWith('Kippwippe')) return 'flipflop';
  if (id.startsWith('YMerge')) return 'ymerge';
  if (id.startsWith('XKreuzung')) return 'crossing';
  if (id.startsWith('AdapterTunnelQuer')) return 'crossTunnel';
  if (/Huegel/.test(id)) return 'hill';
  if (/Looping/.test(id)) return 'loop';
  if (/Versatz/.test(id)) return 'offset';
  if (/^Zickzack/.test(id)) return 'zigzag';
  if (/^Spirale/.test(id)) return 'spiral';
  if (/^Trichter/.test(id)) return 'funnel';
  if (/Rutsche/.test(id)) return 'slide';
  if (p.family === 'brake') return 'brake';
  if (p.family === 'spacer') return 'spacer';
  if (p.family === 'curve') return 'curve';
  if (p.family === 'longCurve') return 'longCurve';
  if (p.family === 'straight') return 'straight';
  return null;
}
function kindOf(p: Part): string {
  if (p.system === 'tunnel') return 'tunnel-' + (/_Hex/.test(p.id) ? 'hex' : /_Schlitz/.test(p.id) ? 'slot' : 'closed');
  if (p.system === 'rail') return /Bank/.test(p.id) ? 'rail-banked' : 'rail';
  return 'groove';
}
/** Effective rims in travel direction (reversed: exit -> entry). */
function rims(p: Part, rev: boolean): [number | null, number | null] { return rev && p.reversible ? [p.rimOut, p.rimIn] : [p.rimIn, p.rimOut]; }
const rimKey = (a: number | null, b: number | null) => `${a}-${b}`;
/** Effective turn: +90 left, -90 right. */
function turnOf(p: Part, rev: boolean): number { return rev && p.reversible ? -p.turn : p.turn; }

function dimsFor(g: GroupId): DimKey[] {
  switch (g) {
    case 'straight': return ['kind', 'len', 'rim'];
    case 'curve': case 'longCurve': return ['kind', 'rim'];
    case 'spacer': return ['kind', 'len'];
    case 'brake': return ['rim', 'type'];
    case 'slide': return ['kind', 'rim'];
    case 'lift': return ['h'];
    case 'crossing': return ['cross', 'rim'];
    case 'ymerge': return ['rim'];
    case 'crossTunnel': return ['type'];
    case 'hill': return ['rim'];
    case 'loop': return ['kind', 'type'];
    case 'offset': return ['kind'];
    default: return [];
  }
}

function build(): Group[] {
  const by = new Map<GroupId, Part[]>();
  for (const p of catalog.parts) { const g = groupOf(p); if (g) { if (!by.has(g)) by.set(g, []); by.get(g)!.push(p); } }
  const groups: Group[] = [];
  for (const gid of GROUP_ORDER) {
    const parts = by.get(gid); if (!parts?.length) continue;
    const variants = new Map<string, Variant>();
    const addOpt = (dims: Variant['dims'], o: Orientation, p: Part, up = false) => {
      const k = JSON.stringify(dims);
      let v = variants.get(k);
      if (!v) { v = { dims, opts: [], up, released: false }; variants.set(k, v); }
      if (!v.opts.some((x) => x.part === o.part && x.reversed === o.reversed && x.lane === o.lane)) v.opts.push(o);
      v.released = v.released || p.released;
    };
    for (const p of parts) {
      const kind = kindOf(p);
      if (gid === 'curve' || gid === 'longCurve') {
        for (const rev of p.reversible ? [false, true] : [false]) {
          const [a, b] = rims(p, rev);
          const up = a != null && b != null && b > a;
          addOpt({ kind, rim: rimKey(a, b) }, { part: p.id, reversed: rev, lane: 0, dir: turnOf(p, rev) > 0 ? 'left' : 'right' }, p, up);
        }
      } else if (gid === 'straight' || gid === 'hill') {
        const len = /Gerade(\d+)/.exec(p.id)?.[1] ?? '';
        for (const rev of p.reversible && p.rimIn !== p.rimOut ? [false, true] : [false]) {
          const [a, b] = rims(p, rev);
          addOpt(gid === 'straight' ? { kind, len, rim: rimKey(a, b) } : { rim: rimKey(a, b) }, { part: p.id, reversed: rev, lane: 0, dir: null }, p, rev);
        }
      } else if (gid === 'spacer') {
        addOpt({ kind, len: /Distanz(\d+)/.exec(p.id)?.[1] ?? '' }, { part: p.id, reversed: false, lane: 0, dir: null }, p);
      } else if (gid === 'brake') {
        addOpt({ rim: rimKey(p.rimIn, p.rimOut), type: /_(K\d+|S\d+)_/.exec(p.id)?.[1] ?? '' }, { part: p.id, reversed: false, lane: 0, dir: null }, p);
      } else if (gid === 'slide') {
        addOpt({ kind, rim: rimKey(p.rimIn, p.rimOut) }, { part: p.id, reversed: false, lane: 0, dir: null }, p);
      } else if (gid === 'lift') {
        const L = p.lift!;
        addOpt({ h: String(L.n) }, { part: p.id, reversed: false, lane: 0, dir: L.dir }, p);
      } else if (gid === 'flipflop') {
        addOpt({}, { part: p.id, reversed: false, lane: 0, dir: p.turn > 0 ? 'left' : 'right' }, p);
      } else if (gid === 'ymerge') {
        // Y merge: the direction is the entry - lane 0 = entry +y (exit 16 mm to the right of the track),
        // lane 1 = entry -y (16 mm to the left); chosen on insertion (ghost), like curves and the flip-flop
        for (const lane of [0, 1]) addOpt({ rim: rimKey(p.rimIn, p.rimOut) }, { part: p.id, reversed: false, lane, dir: lane === 0 ? 'right' : 'left' }, p);
      } else if (gid === 'crossing') {
        for (const rev of [false, true]) for (const lane of LANES[p.id] ? [0, 1] : [0]) {
          const [a, b] = rims(p, rev);
          addOpt({ cross: lane === 0 ? 'left' : 'right', rim: rimKey(a, b) }, { part: p.id, reversed: rev, lane, dir: null }, p, rev);
        }
      } else if (gid === 'crossTunnel') {
        // cross tunnel: centre, offset 16 (reversed 48), 95 under the 100 straight (24 from start or end)
        const type = /Quer95/.test(p.id) ? '95' : /V16/.test(p.id) ? '120-V16' : '120';
        addOpt({ type }, { part: p.id, reversed: false, lane: 0, dir: null }, p);
        if (type !== '120') addOpt({ type: type + '-rev' }, { part: p.id, reversed: true, lane: 0, dir: null }, p);
      } else if (gid === 'loop') {
        addOpt({ kind, type: /_v2/.test(p.id) ? 'v2' : 'v1' }, { part: p.id, reversed: false, lane: 0, dir: null }, p);
      } else if (gid === 'offset') {
        addOpt({ kind }, { part: p.id, reversed: false, lane: 0, dir: null }, p);
      } else {
        addOpt({}, { part: p.id, reversed: false, lane: 0, dir: null }, p);
      }
    }
    // order directions per variant; on duplicates prefer the simple placement (not reversed, not mirrored)
    for (const v of variants.values()) {
      const pickOne = (list: Orientation[]) => list.sort((x, y) => Number(x.reversed) - Number(y.reversed) || Number(/gespiegelt/.test(x.part)) - Number(/gespiegelt/.test(y.part)))[0];
      if (gid === 'curve' || gid === 'longCurve' || gid === 'flipflop' || gid === 'ymerge') {
        const out: Orientation[] = [];
        for (const d of ['left', 'right'] as Dir[]) { const o = pickOne(v.opts.filter((x) => x.dir === d)); if (o) out.push(o); }
        v.opts = out;
      } else if (gid === 'lift') {
        const order: Dir[] = ['straight', 'left', 'back', 'right'];
        v.opts.sort((x, y) => order.indexOf(x.dir!) - order.indexOf(y.dir!));
      }
    }
    const dims = dimsFor(gid);
    const list = [...variants.values()].sort((x, y) => cmpDims(x.dims, y.dims, dims));
    groups.push({ id: gid, chip: CHIP_OF[gid], dims, variants: list, extra: !list.some((v) => v.released) });
  }
  return groups;
}

/** Sort order of a select field's values. */
export function cmpVal(k: DimKey, a: string, b: string): number {
  if (k === 'kind') return KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b);
  if (k === 'type') return TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b);
  if (k === 'len' || k === 'h') return Number(a) - Number(b);
  if (k === 'cross') return a === b ? 0 : a === 'left' ? -1 : 1;
  if (k === 'rim') {
    // higher entry first, then downhill / flat / uphill, then higher exit
    const [a0, a1] = a.split('-').map(Number), [b0, b1] = b.split('-').map(Number);
    const ka = a1 > a0 ? 2 : a1 === a0 ? 1 : 0, kb = b1 > b0 ? 2 : b1 === b0 ? 1 : 0;
    return b0 - a0 || ka - kb || b1 - a1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
function cmpDims(x: Variant['dims'], y: Variant['dims'], keys: DimKey[]): number {
  for (const k of keys) { const c = cmpVal(k, x[k] ?? '', y[k] ?? ''); if (c) return c; }
  return 0;
}

export const GROUPS: Group[] = build();
export const GROUP_BY_ID = new Map(GROUPS.map((g) => [g.id, g]));

/** Base part group and variant of a chain element (for the detail panel). */
export function variantOf(partId: string, reversed: boolean, lane = 0): { group: Group; variant: Variant; opt: Orientation } | null {
  const p = catalog.byId.get(partId); if (!p) return null;
  const gid = groupOf(p); if (!gid) return null;
  const g = GROUP_BY_ID.get(gid)!;
  const rev = !!reversed && p.reversible;
  for (const v of g.variants) {
    const o = v.opts.find((x) => x.part === partId && x.reversed === rev && x.lane === (LANES[partId] ? lane : 0));
    if (o) return { group: g, variant: v, opt: o };
  }
  // flat straight parts: reversed is the same variant
  for (const v of g.variants) { const o = v.opts.find((x) => x.part === partId); if (o) return { group: g, variant: v, opt: o }; }
  return null;
}

/** Selection on a card: the chosen value per field. */
export type Selection = Partial<Record<DimKey, string>>;
/** Values per field among the allowed variants (fields cascade: each field only offers values matching the fields
 *  before it) and the resulting variant. Valid selections are kept; invalid ones fall back to the field's default. */
export function resolve(g: Group, sel: Selection, allowed: (v: Variant) => boolean): { values: Record<string, string[]>; sel: Selection; variant: Variant | null } {
  let pool = g.variants.filter(allowed);
  const values: Record<string, string[]> = {};
  const out: Selection = {};
  for (const k of g.dims) {
    const vals = [...new Set(pool.map((v) => v.dims[k]!).filter((x) => x != null))].sort((a, b) => cmpVal(k, a, b));
    values[k] = vals;
    if (!vals.length) { out[k] = sel[k]; continue; }
    const want = sel[k] != null && vals.includes(sel[k]!) ? sel[k]! : defaultValue(g.id, k, vals);
    out[k] = want;
    pool = pool.filter((v) => v.dims[k] === want);
  }
  return { values, sel: out, variant: pool[0] ?? null };
}
/** Default value of a field: groove, the 120 straight (else the longest), flat before sloped, the lowest lift. */
function defaultValue(g: GroupId, k: DimKey, vals: string[]): string {
  if (k === 'len' && g === 'straight') return vals.includes('120') ? '120' : vals[vals.length - 1];
  if (k === 'rim') { const flat = vals.find((v) => { const [a, b] = v.split('-'); return a === b; }); if (flat && g !== 'crossing' && g !== 'hill') return flat; }
  return vals[0];
}

/** Display text for a field value (DE/EN). */
export function valueLabel(k: DimKey, v: string, lang: 'de' | 'en'): string {
  const de = lang === 'de';
  if (k === 'kind') return ({ groove: de ? 'Rille' : 'Groove', rail: de ? 'Schiene' : 'Rail', 'rail-banked': de ? 'Schiene geneigt' : 'Banked rail',
    'tunnel-hex': de ? 'Tunnel Hex' : 'Tunnel hex', 'tunnel-slot': de ? 'Tunnel Schlitz' : 'Tunnel slotted', 'tunnel-closed': de ? 'Tunnel voll' : 'Tunnel closed' } as Record<string, string>)[v] ?? v;
  if (k === 'rim') { const [a, b] = v.split('-').map(Number); return `${a} → ${b}${b > a ? ' ↗' : ''}`; }
  if (k === 'len') { const mm = Math.round(Number(v) * 8 / 15 * 10) / 10; return `${v} · ${String(mm).replace('.', de ? ',' : '.')} mm`; }
  if (k === 'h') return `+${v}${Number(v) > LIFT_TESTED ? (de ? ' (ungeprüft)' : ' (untested)') : ''}`;
  if (k === 'cross') return v === 'left' ? (de ? 'Querspur von links' : 'cross lane from left') : (de ? 'Querspur von rechts' : 'cross lane from right');
  if (k === 'type') return ({ '120': de ? '120 Mitte' : '120 centre', '120-V16': de ? '120 Spur 16' : '120 lane 16', '120-V16-rev': de ? '120 Spur 48 (umgedreht)' : '120 lane 48 (reversed)',
                             '95': de ? '95 Spur 24' : '95 lane 24', '95-rev': de ? '95 Spur 24 ab Ende (umgedreht)' : '95 lane 24 from end (reversed)', v1: 'v1', v2: 'v2' } as Record<string, string>)[v] ?? v;
  return v;
}
