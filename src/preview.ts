// Connect preview: a small top view of what a suggestion does to the track. Parts that stay are muted (drawn where they
// end up - a run change moves everything after the run), new or replaced parts are in the accent colour, removed parts
// are dashed where they were, and a ring marks where the open end connects. Footprints come from the solver (world
// coordinates, mm); upper levels are drawn over lower ones. The view is centred on what changes.
import type { ChainElement, Layout, Placed } from './chain';
import type { WPiece } from './footprint';

export interface PreviewState { elements: ChainElement[]; L: Layout }
export type PreviewKind = 'keep' | 'new' | 'gone';

/** Parts of the preview with their role: parts of `after` that were not in `before` are new, parts of `before` that
 *  are no longer in `after` are gone (elements are compared by identity, as applyConnection keeps unchanged ones). */
export function previewParts(before: PreviewState, after: PreviewState): { kind: PreviewKind; q: Placed }[] {
  const was = new Set(before.elements), now = new Set(after.elements);
  const out: { kind: PreviewKind; q: Placed }[] = [];
  for (const q of after.L.placed) if (q.connected) out.push({ kind: was.has(after.elements[q.idx]) ? 'keep' : 'new', q });
  for (const q of before.L.placed) if (q.connected && !now.has(before.elements[q.idx])) out.push({ kind: 'gone', q });
  const order: Record<PreviewKind, number> = { keep: 0, gone: 1, new: 2 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.q.S - b.q.S);
}

const f1 = (v: number) => (Math.round(v * 10) / 10).toString();
function pathOf(pieces: WPiece[]): string {
  return pieces.map((pc) => 'M' + pc.poly.map((v) => `${f1(v[0])} ${f1(-v[1])}`).join('L') + 'Z').join('');
}

/** SVG markup (w x h px) of the preview; end: where the open end connects (world x, y), or null. */
export function connectPreview(before: PreviewState, after: PreviewState, end: [number, number] | null, label: string, w = 132, h = 96): string {
  const parts = previewParts(before, after);
  // view: the changed parts and the connection with some track around them (at least MIN mm), not the whole track -
  // a one-part change on a large track would be a speck otherwise
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x: number, y: number) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, -y); y1 = Math.max(y1, -y); };
  for (const { kind, q } of parts) if (kind !== 'keep') for (const pc of q.pieces) for (const v of pc.poly) grow(v[0], v[1]);
  if (end) grow(end[0], end[1]);
  if (!Number.isFinite(x0)) for (const { q } of parts) for (const pc of q.pieces) for (const v of pc.poly) grow(v[0], v[1]);
  if (!Number.isFinite(x0)) return '';
  const MIN = 180, pad = 30;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let vw = Math.max(x1 - x0 + 2 * pad, MIN), vh = Math.max(y1 - y0 + 2 * pad, MIN * h / w);
  if (vw / vh > w / h) vh = vw * h / w; else vw = vh * w / h;                // fill the box, keep the aspect ratio
  x0 = cx - vw / 2; y0 = cy - vh / 2;
  const paths = parts.map(({ kind, q }) => `<path class="cp-${kind}" d="${pathOf(q.pieces)}"/>`).join('');
  const ring = end ? `<circle class="cp-end" cx="${f1(end[0])}" cy="${f1(-end[1])}" r="${f1(Math.max(vw, vh) / 22)}"/>` : '';
  return `<svg class="cp" role="img" aria-label="${label.replace(/[&<>"]/g, '')}" width="${w}" height="${h}" ` +
    `viewBox="${f1(x0)} ${f1(y0)} ${f1(vw)} ${f1(vh)}" preserveAspectRatio="xMidYMid meet">${paths}${ring}</svg>`;
}
