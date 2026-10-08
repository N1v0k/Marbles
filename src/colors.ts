// Track colors: family colors (default, for orientation) or filament colors per group (track, rail, adapter, accent).
// Filaments come from the Bambu Studio color database (src/data/filaments.json, tools/filament_colors.py); any custom
// color works too. Presets map each group to the nearest Bambu filament. In filament mode the 3D view uses these
// colors and the print plan splits plates by filament.
import type { Part } from './catalog';
import filData from './data/filaments.json';

export type ColorGroup = 'track' | 'rail' | 'adapter' | 'accent';
export const COLOR_GROUPS: ColorGroup[] = ['track', 'rail', 'adapter', 'accent'];
export type GroupColors = Record<ColorGroup, string>;              // '#rrggbb'
export type GroupFilaments = Record<ColorGroup, string | null>;    // Bambu color code ('11103') or null = custom color
export interface ColorState { mode: 'family' | 'filament'; preset: string | null; c: GroupColors; f: GroupFilaments }

// ------------------------------------------------------------------ Bambu filaments
export interface Filament {
  code: string;        // Bambu color code (fila_color_code), 5 digits
  type: string;        // material type, e.g. 'PLA Matte'
  en: string; de: string;
  hexes: string[];     // all colors of the filament ('#rrggbb'); several for gradient/multicolor
  hex: string;         // single color for the 3D view and plate swatch (mean of several)
  flags: number;       // bit flags: 1 gradient, 2 multicolor, 4 translucent
}
type FilRow = [string, number, string, string, string[], number];
export const FIL_TYPES: string[] = filData.types;
export const FIL_SOURCE: string = filData.src;
/** Material type the snap-pin fit has been verified with. */
export const FIT_TYPE = 'PLA Basic';
function meanHex(hx: string[]): string {
  const ch = [0, 2, 4].map((i) => Math.round(hx.reduce((s, h) => s + parseInt(h.slice(i, i + 2), 16), 0) / hx.length));
  return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('');
}
export const FILAMENTS: Filament[] = (filData.f as FilRow[]).map(([code, ti, en, de, hx, flags]) => ({
  code, type: FIL_TYPES[ti], en, de: de || en, hexes: hx.map((h) => '#' + h), hex: meanHex(hx), flags,
}));
const BY_CODE = new Map(FILAMENTS.map((f) => [f.code, f]));
export function filamentByCode(code: string | null | undefined): Filament | null { return code ? BY_CODE.get(code) ?? null : null; }
/** Display name, e.g. 'PLA Matte Bone White'. */
export function filamentName(f: Filament, lang: 'de' | 'en'): string { return `${f.type} ${lang === 'de' ? f.de : f.en}`; }
/** CSS background of a swatch: solid color, or gradient/stripes for multiple colors. */
export function filamentCss(f: Filament): string {
  if (f.hexes.length < 2) return f.hexes[0];
  if (f.flags & 2) { const n = f.hexes.length; return `linear-gradient(90deg, ${f.hexes.map((h, i) => `${h} ${(i / n) * 100}% ${((i + 1) / n) * 100}%`).join(', ')})`; }
  return `linear-gradient(90deg, ${f.hexes.join(', ')})`;
}

// ------------------------------------------------------------------ Presets
export interface ColorPreset { id: string; de: string; en: string; f: Record<ColorGroup, string>; c: GroupColors }
// nearest Bambu filament to each reference color (CIELAB), matte preferred
const BONE = '11103', SAND = '11401', COPPER = '13800', CHARCOAL = '11101', BROWN = '11802', NAVY = '11602',
  ASH = '11102', IVORY = '11100';
function preset(id: string, de: string, en: string, f: Record<ColorGroup, string>): ColorPreset {
  const c = Object.fromEntries(COLOR_GROUPS.map((g) => [g, BY_CODE.get(f[g])!.hex])) as GroupColors;
  return { id, de, en, f, c };
}
/** Presets named "track on adapter"; accents (start, end, attractions) get one calm color each. */
export const COLOR_PRESETS: ColorPreset[] = [
  // Japandi: track + rail PLA Matte Desert Tan, adapter + accents PLA Matte Dark Chocolate
  preset('japandi', 'Japandi: Sand, Schoko', 'Japandi: sand, chocolate', { track: SAND, rail: SAND, adapter: BROWN, accent: BROWN }),
  preset('bone-brown', 'Knochen auf Braun', 'Bone on brown', { track: BONE, rail: BONE, adapter: BROWN, accent: COPPER }),
  preset('bone-black', 'Knochen auf Schwarz', 'Bone on black', { track: BONE, rail: BONE, adapter: CHARCOAL, accent: COPPER }),
  preset('bone-blue', 'Knochen auf Dunkelblau', 'Bone on dark blue', { track: BONE, rail: BONE, adapter: NAVY, accent: COPPER }),
  preset('blue-copper', 'Dunkelblau auf Kupfer', 'Dark blue on copper', { track: NAVY, rail: NAVY, adapter: COPPER, accent: BONE }),
  preset('bluegrey-white', 'Hell-Blaugrau auf Weiß', 'Light blue-grey on white', { track: ASH, rail: ASH, adapter: IVORY, accent: NAVY }),
  preset('brown-black', 'Braun auf Schwarz', 'Brown on black', { track: BROWN, rail: BROWN, adapter: CHARCOAL, accent: COPPER }),
  preset('white-bluegrey', 'Weiß auf Hell-Blaugrau', 'White on light blue-grey', { track: IVORY, rail: IVORY, adapter: ASH, accent: NAVY }),
  preset('copper-black', 'Kupfer auf Schwarz', 'Copper on black', { track: COPPER, rail: COPPER, adapter: CHARCOAL, accent: BONE }),
  preset('sand-copper', 'Sand auf Kupfer', 'Sand on copper', { track: SAND, rail: SAND, adapter: COPPER, accent: CHARCOAL }),
  preset('charcoal-copper', 'Kohle auf Kupfer', 'Charcoal on copper', { track: CHARCOAL, rail: CHARCOAL, adapter: COPPER, accent: SAND }),
];
/** Color state of a preset in filament mode. */
export function presetState(p: ColorPreset): ColorState { return { mode: 'filament', preset: p.id, c: { ...p.c }, f: { ...p.f } }; }

export const DEFAULT_COLORS: ColorState = { ...presetState(COLOR_PRESETS[0]), mode: 'family', preset: null };

let current: ColorState = copy(DEFAULT_COLORS);
function copy(cs: ColorState): ColorState { return { mode: cs.mode, preset: cs.preset, c: { ...cs.c }, f: { ...cs.f } }; }
export function setColors(cs: ColorState) { current = copy(cs); }
export function getColors(): ColorState { return copy(current); }
export function isFilamentMode(): boolean { return current.mode === 'filament'; }
/** Sets a group to a Bambu filament (the preset is re-matched). */
export function withFilament(cs: ColorState, g: ColorGroup, code: string): ColorState {
  const fil = BY_CODE.get(code); if (!fil) return cs;
  const n = copy(cs); n.mode = 'filament'; n.f[g] = code; n.c[g] = fil.hex; n.preset = matchPreset(n.f); return n;
}
/** Sets a group to a custom color (no filament, no preset). */
export function withOwnColor(cs: ColorState, g: ColorGroup, hex: string): ColorState {
  if (!HEX.test(hex)) return cs;
  const n = copy(cs); n.mode = 'filament'; n.f[g] = null; n.c[g] = normHex(hex); n.preset = null; return n;
}
function matchPreset(f: GroupFilaments): string | null {
  return COLOR_PRESETS.find((p) => COLOR_GROUPS.every((g) => p.f[g] === f[g]))?.id ?? null;
}

/** Color group of a part: rail (incl. brakes and rail slides), adapter (incl. snap pins), accent (start, end,
 *  attractions, lift), everything else is track (channel, tunnel, level changers). */
export function colorGroup(p: Part): ColorGroup {
  if (p.id.startsWith('AdapterTunnelQuer')) return 'track';          // carries the lower track (channel passing through)
  if (p.family === 'adapter') return 'adapter';
  if (p.family === 'pin') return 'adapter';
  if (p.system === 'rail') return 'rail';
  if (p.family === 'start' || p.family === 'end' || p.family === 'attraction' || p.family === 'lift' || p.family === 'liftPart' || p.family === 'flipflopPart') return 'accent';
  return 'track';
}
/** Color for the 3D view: shadows lifted slightly so black filament still shows its shape. */
export function viewColor(hex: string): number {
  const ch = [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16)).map((v) => Math.round(42 + v * (213 / 255)));
  return (ch[0] << 16) | (ch[1] << 8) | ch[2];
}
/** Filament color of a part as a number (three.js); null unless in filament mode. */
export function filamentColor(p: Part): number | null {
  if (current.mode !== 'filament') return null;
  return viewColor(current.c[colorGroup(p)]);
}

// ------------------------------------------------------------------ Print plates: filament per part
/** Filament key of a part ('11103' for Bambu, '#rrggbb' for a custom color); null unless in filament mode. */
export function filamentKey(p: Part): string | null {
  if (current.mode !== 'filament') return null;
  const g = colorGroup(p);
  return current.f[g] ?? current.c[g];
}
export function keyHex(key: string): string { return BY_CODE.get(key)?.hex ?? key; }
export function keyCss(key: string): string { const f = BY_CODE.get(key); return f ? filamentCss(f) : key; }
/** 'PLA Matte Bone White (11103)' or '#AABBCC'. */
export function keyLabel(key: string, lang: 'de' | 'en'): string {
  const f = BY_CODE.get(key);
  return f ? `${filamentName(f, lang)} (${f.code})` : key.toUpperCase();
}
/** Material types of the chosen filaments other than the verified one (custom colors count as untested). */
export function untestedTypes(cs: ColorState): string[] {
  if (cs.mode !== 'filament') return [];
  const out = new Set<string>();
  for (const g of COLOR_GROUPS) { const f = filamentByCode(cs.f[g]); if (!f || f.type !== FIT_TYPE) out.add(f ? f.type : '?'); }
  return [...out];
}

// ------------------------------------------------------------------ Persistence and links
const HEX = /^#?[0-9a-fA-F]{6}$/;
const CODE = /^\d{5}$/;
const normHex = (v: string) => ('#' + v.replace('#', '')).toLowerCase();
/** Sanitizes a saved/loaded color state (groups may hold a filament code or only a hex color). */
export function sanitizeColors(raw: unknown): ColorState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ColorState> & { c?: Partial<Record<ColorGroup, unknown>>; f?: Partial<Record<ColorGroup, unknown>> };
  const mode = r.mode === 'filament' ? 'filament' : 'family';
  const pr = typeof r.preset === 'string' ? COLOR_PRESETS.find((p) => p.id === r.preset) : undefined;
  if (pr) return { ...presetState(pr), mode, preset: mode === 'filament' ? pr.id : null };
  const cs = copy(DEFAULT_COLORS); cs.mode = mode; cs.preset = null;
  for (const g of COLOR_GROUPS) {
    const code = r.f?.[g], v = r.c?.[g];
    const fil = typeof code === 'string' ? BY_CODE.get(code) : undefined;
    if (fil) { cs.f[g] = fil.code; cs.c[g] = fil.hex; }
    else if (typeof v === 'string' && HEX.test(v)) { cs.f[g] = null; cs.c[g] = normHex(v); }
  }
  if (mode === 'filament') cs.preset = matchPreset(cs.f);
  return cs;
}
/** Link encoding (filament mode only): per group a Bambu code (5 digits) or hex color (6 chars), dot-separated
 *  as track.rail.adapter.accent. */
export function encodeColors(cs: ColorState): string | null {
  return cs.mode === 'filament' ? COLOR_GROUPS.map((g) => cs.f[g] ?? cs.c[g].replace('#', '')).join('.') : null;
}
export function decodeColors(s: string): ColorState | null {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  const cs = copy(DEFAULT_COLORS); cs.mode = 'filament';
  for (let i = 0; i < 4; i++) {
    const g = COLOR_GROUPS[i], x = parts[i];
    const fil = CODE.test(x) ? BY_CODE.get(x) : undefined;
    if (fil) { cs.f[g] = fil.code; cs.c[g] = fil.hex; }
    else if (x.length === 6 && HEX.test(x)) { cs.f[g] = null; cs.c[g] = normHex(x); }
    else return null;
  }
  cs.preset = matchPreset(cs.f);
  return cs;
}
