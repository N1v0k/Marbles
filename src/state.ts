// App state, undo/redo, persistence (localStorage + URL).
import { catalog } from './catalog';
import type { ChainElement } from './chain';
import { DEFAULT_SIM, MASS_RANGE, type SimOptions } from './physics';
import { DEFAULT_COLORS, sanitizeColors, encodeColors, decodeColors, type ColorState } from './colors';

/** japandi: Japandi edition (grooved parts, Japandi app styling); in links &s=j or &s=g.
 *  editionChosen: the edition was picked explicitly (toggle, link or JSON) - only then is a saved plain choice honored. */
export interface AppState { elements: ChainElement[]; sim: SimOptions; showLegacy: boolean; japandi: boolean; editionChosen?: boolean; colors: ColorState }
/** Default edition for new visitors and links without s=. */
export const DEFAULT_JAPANDI = true;

const KEY = 'kugelbahn16-builder-v1';   // localStorage key of this app
const code2id = new Map(catalog.parts.map((p) => [p.code, p.id]));
export const SIM_RANGE = { v0: [0, 400] as const, crr: [0.005, 0.04] as const };
/** URL prefix of encoded chains (part codes are only valid for this catalog; links with another prefix are rejected). */
export const CHAIN_PREFIX = 'm1.';
/** Maximum parts per track (real tracks have a few dozen to a hundred-odd parts); more are truncated on load and reported. */
export const MAX_ELEMENTS = 600;

/** Encodes a chain as a short URL string using stable part codes from the catalog (tools/codes.json). */
export function encodeChain(elements: ChainElement[]): string {
  // 'm1.' + dot-separated tokens, one per part: <code>[*][!][~<slots>][@<anchor>:<port>]
  // '*' = reversed, '!' = second lane (X crossing), '~013' = adapter slots 0, 1 and 3 omitted (freestyle tunnel),
  // '@5:3' = branch from socket 3 of part 5 (0-based index)
  const plain = toPlain(elements);
  return CHAIN_PREFIX + plain.map((e) => catalog.byId.get(e.part)!.code + (e.reversed ? '*' : '') + (e.lane === 1 ? '!' : '')
    + (e.omit?.length ? '~' + encodeOmit(e.omit) : '') + (e.branch ? `@${e.branch.from}:${e.branch.port}` : '')).join('.');
}
/** Decodes an m1 chain; unknown tokens are skipped and counted (instead of rejecting the whole track). */
export function decodeChain(s: string): { elements: ChainElement[]; unknown: number } | null {
  if (!s.startsWith(CHAIN_PREFIX)) return null;
  const raw: PlainElement[] = []; let unknown = 0;
  const toks = s.slice(CHAIN_PREFIX.length).split('.').filter((x) => x);
  for (const tok of toks) {
    const [head, br] = tok.split('@');
    const [core0, om] = head.split('~');
    const lane = core0.endsWith('!'); const core = lane ? core0.slice(0, -1) : core0;
    const rev = core.endsWith('*'); const id = code2id.get(rev ? core.slice(0, -1) : core);
    if (!id) { unknown++; raw.push({ part: '?' }); continue; }   // placeholder keeps branch anchor indices valid
    const el: PlainElement = { part: id };
    if (rev) el.reversed = true;
    if (lane) el.lane = 1;
    const omit = sanitizeOmit(om ? (om.includes(',') ? om.split(',') : om.split('')).map(Number) : undefined);
    if (omit) el.omit = omit;
    if (br) { const [f, pt] = br.split(':').map(Number); if (Number.isInteger(f) && Number.isInteger(pt)) el.branch = { from: f, port: pt }; }
    raw.push(el);
  }
  const elements = sanitizeElements(raw);
  return { elements, unknown: unknown + Math.max(0, raw.length - unknown - elements.length) };   // + those beyond MAX_ELEMENTS
}

/** Chain element in links, JSON, localStorage and undo: like ChainElement, but the branch anchor is an index. */
export interface PlainElement { part: string; reversed?: boolean; omit?: number[]; lane?: number; branch?: { from: number; port: number } }
/** Chain -> plain data (anchors as indices, no object references). */
export function toPlain(elements: ChainElement[]): PlainElement[] {
  const idx = new Map(elements.map((e, i) => [e, i]));
  return elements.map((e) => {
    const o: PlainElement = { part: e.part };
    if (e.reversed) o.reversed = true;
    if (e.lane === 1) o.lane = 1;
    if (e.omit?.length) o.omit = e.omit.slice();
    if (e.branch) { const f = idx.get(e.branch.from); if (f != null) o.branch = { from: f, port: e.branch.port }; }
    return o;
  });
}
/** Deep copy of a chain (new objects; anchors point to the copies). */
export function cloneChain(elements: ChainElement[]): ChainElement[] { return sanitizeElements(toPlain(elements)); }

/** Highest adapter slot (towers up to 48 levels, see chain.ts MAX_LEVELS). */
export const OMIT_MAX = 47;
/** Omitted adapter slots: unique, sorted integers 0..OMIT_MAX; undefined if empty. */
export function sanitizeOmit(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const s = [...new Set(raw.filter((v) => Number.isInteger(v) && v >= 0 && v <= OMIT_MAX) as number[])].sort((a, b) => a - b);
  return s.length ? s : undefined;
}
/** Slots in links: single digits without separator ('~013'), comma-separated once any slot is >= 10 ('~0,1,10'). */
export function encodeOmit(omit: number[]): string {
  const s = [...omit].sort((a, b) => a - b);
  return s.some((x) => x > 9) ? s.join(',') : s.join('');
}
/** Keeps only valid chain elements (known part, boolean reversed, omit as slot list, lane 1, branch anchored to an earlier
 *  element) - for localStorage, JSON import, demos and links. Branch anchors are indices into raw and become references.
 *  If the anchor is dropped (unknown part), the element stays in the preceding strand without an anchor. */
export function sanitizeElements(raw: unknown): ChainElement[] {
  if (!Array.isArray(raw)) return [];
  const out: ChainElement[] = [];
  const byRaw = new Map<number, ChainElement>();
  raw.forEach((e, i) => {
    if (out.length >= MAX_ELEMENTS) return;   // cap: a short link/JSON must not freeze the tab
    if (!e || typeof e !== 'object') return;
    const part = (e as { part?: unknown }).part;
    if (typeof part !== 'string' || !catalog.byId.has(part)) return;
    const el: ChainElement = (e as { reversed?: unknown }).reversed === true ? { part, reversed: true } : { part };
    if ((e as { lane?: unknown }).lane === 1) el.lane = 1;
    const omit = sanitizeOmit((e as { omit?: unknown }).omit);
    if (omit) el.omit = omit;
    const br = (e as { branch?: { from?: unknown; port?: unknown } }).branch;
    // anchor: index (JSON, link, storage) or reference to an element of the same list (an already sanitized chain,
    // e.g. when loaded JSON is sanitized again by setElements)
    const fi = !br || typeof br !== 'object' ? -1 : Number.isInteger(br.from) ? (br.from as number)
      : br.from && typeof br.from === 'object' ? raw.indexOf(br.from) : -1;
    if (br && typeof br === 'object' && Number.isInteger(br.port) && fi >= 0 && fi < i && out.length > 0) {
      const anchor = byRaw.get(fi);
      if (anchor) el.branch = { from: anchor, port: br.port as number };
    }
    byRaw.set(i, el);
    out.push(el);
  });
  return out;
}
function clampNum(v: unknown, lo: number, hi: number, dflt: number): number {
  if (v == null || v === '') return dflt;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}
export function sanitizeSim(raw: unknown): SimOptions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof SimOptions, unknown>>;
  return { v0: clampNum(r.v0, SIM_RANGE.v0[0], SIM_RANGE.v0[1], DEFAULT_SIM.v0), crr: clampNum(r.crr, SIM_RANGE.crr[0], SIM_RANGE.crr[1], DEFAULT_SIM.crr),
           mass: Math.round(clampNum(r.mass, MASS_RANGE[0], MASS_RANGE[1], DEFAULT_SIM.mass!) * 10) / 10 };
}

export function loadState(): AppState {
  const st: AppState = { elements: [], sim: { ...DEFAULT_SIM }, showLegacy: false, japandi: DEFAULT_JAPANDI, colors: sanitizeColors(DEFAULT_COLORS) };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const j = JSON.parse(raw) as Partial<AppState>;
      st.elements = sanitizeElements(j.elements);
      st.sim = sanitizeSim(j.sim);
      st.showLegacy = j.showLegacy === true;
      // a saved edition counts only if it was chosen explicitly
      if (j.editionChosen === true) { st.japandi = j.japandi === true; st.editionChosen = true; }
      st.colors = sanitizeColors(j.colors);
    }
  } catch { /* empty or corrupt -> defaults */ }
  try {
    const h = new URLSearchParams(location.hash.replace(/^#/, ''));
    const tr = h.get('t');
    if (tr) { const dec = decodeChain(tr); if (dec && (dec.elements.length || !dec.unknown)) st.elements = dec.elements; }
    const sty = h.get('s');
    if (sty === 'j' || sty === 'g') { st.japandi = sty === 'j'; st.editionChosen = true; }   // without s=: saved choice or default
    const col = h.get('c'); const dc = col ? decodeColors(col) : null; if (dc) st.colors = dc;
  } catch { /* ignore */ }
  return st;
}
export function saveState(st: AppState) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...st, elements: toPlain(st.elements) })); } catch { /* full or blocked */ }
  try {
    const url = st.elements.length ? '#' + linkHash(st.elements, st.japandi, st.colors) : '';
    if (location.hash !== url) history.replaceState(null, '', url || location.pathname + location.search);
  } catch { /* e.g. sandboxed */ }
}
/** Link hash: t=<chain>, always an explicit edition (s=j Japandi, s=g plain), plus c=<colors> in filament mode. */
export function linkHash(elements: ChainElement[], japandi = DEFAULT_JAPANDI, colors?: ColorState): string {
  const c = colors ? encodeColors(colors) : null;
  return 't=' + encodeChain(elements) + (japandi ? '&s=j' : '&s=g') + (c ? '&c=' + c : '');
}
/** Share link: current page (incl. query) with chain, edition and colors in the hash. */
export function shareUrl(elements: ChainElement[], japandi = DEFAULT_JAPANDI, colors?: ColorState): string {
  return location.href.split('#')[0] + '#' + linkHash(elements, japandi, colors);
}

export class History {
  private past: string[] = []; private future: string[] = [];
  constructor(private limit = 100) {}
  private enc(e: ChainElement[]) { return JSON.stringify(toPlain(e)); }
  private dec(s: string) { return sanitizeElements(JSON.parse(s)); }
  push(elements: ChainElement[]) { this.past.push(this.enc(elements)); if (this.past.length > this.limit) this.past.shift(); this.future = []; }
  undo(current: ChainElement[]): ChainElement[] | null { const s = this.past.pop(); if (s == null) return null; this.future.push(this.enc(current)); return this.dec(s); }
  redo(current: ChainElement[]): ChainElement[] | null { const s = this.future.pop(); if (s == null) return null; this.past.push(this.enc(current)); return this.dec(s); }
  get canUndo() { return this.past.length > 0; } get canRedo() { return this.future.length > 0; }
}
