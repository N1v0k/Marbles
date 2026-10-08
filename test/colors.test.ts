// Colors: groups, Bambu filaments, presets, link encoding, plates by filament.
import { describe, it, expect, afterEach } from 'vitest';
import { catalog } from '../src/catalog';
import {
  COLOR_PRESETS, COLOR_GROUPS, DEFAULT_COLORS, FILAMENTS, FIL_TYPES, colorGroup, setColors, getColors, filamentColor, sanitizeColors,
  encodeColors, decodeColors, presetState, withFilament, withOwnColor, filamentByCode, filamentName, filamentCss, keyLabel, keyHex,
  untestedTypes, viewColor,
} from '../src/colors';
import { solveChain } from '../src/chain';
import { planPlates, planMarkdown } from '../src/plates';
import { colorFor } from '../src/viewer3d';
import { linkHash, loadState } from '../src/state';
import { bom, bomCsv, trackJson } from '../src/export';
import { DEFAULT_SIM } from '../src/physics';
import { demo, part } from './helpers';

afterEach(() => { setColors(DEFAULT_COLORS); history.replaceState(null, '', location.pathname); });
const boneBrown = COLOR_PRESETS.find((p) => p.id === 'bone-brown')!;

describe('Bambu filaments (color list from Bambu Studio)', () => {
  it('unique 5-digit codes, valid colors, known types, no support material', () => {
    expect(FILAMENTS.length).toBeGreaterThan(250);
    expect(new Set(FILAMENTS.map((f) => f.code)).size).toBe(FILAMENTS.length);
    for (const f of FILAMENTS) {
      expect(f.code).toMatch(/^\d{5}$/);
      expect(FIL_TYPES).toContain(f.type);
      expect(f.hex).toMatch(/^#[0-9a-f]{6}$/);
      for (const h of f.hexes) expect(h).toMatch(/^#[0-9a-f]{6}$/);
      expect(f.en.length).toBeGreaterThan(0); expect(f.de.length).toBeGreaterThan(0);
    }
    expect(FIL_TYPES.slice(0, 2)).toEqual(['PLA Basic', 'PLA Matte']);
    expect(FIL_TYPES.some((t) => t.startsWith('Support') || t === 'PVA')).toBe(false);
  });
  it('names and colors as in Bambu Studio; multicolor ones with a gradient', () => {
    const bone = filamentByCode('11103')!;
    expect(bone.type).toBe('PLA Matte'); expect(bone.hex).toBe('#cbc6b8');
    expect(filamentName(bone, 'de')).toBe('PLA Matte Knochenweiß');
    expect(filamentName(bone, 'en')).toBe('PLA Matte Bone White');
    expect(keyLabel('11103', 'de')).toBe('PLA Matte Knochenweiß (11103)');
    expect(keyLabel('#abcdef', 'de')).toBe('#ABCDEF');
    expect(keyHex('11103')).toBe('#cbc6b8'); expect(keyHex('#abcdef')).toBe('#abcdef');
    const multi = FILAMENTS.find((f) => f.hexes.length > 1)!;
    expect(filamentCss(multi)).toMatch(/^linear-gradient/);
    expect(filamentByCode('99999')).toBeNull();
  });
});

describe('Groups and presets', () => {
  it('every part belongs to exactly one group; rails, adapters, accents as specified', () => {
    for (const p of catalog.parts) expect(COLOR_GROUPS).toContain(colorGroup(p));
    expect(colorGroup(part('SchieneBremse120_60-60_K607'))).toBe('rail');
    expect(colorGroup(part('SchieneRutsche120_100-60'))).toBe('rail');
    expect(colorGroup(part('AdapterGerade120'))).toBe('adapter');
    expect(colorGroup(part('Raststift'))).toBe('adapter');
    expect(colorGroup(part('AdapterTunnelQuer120_40-40_Q32'))).toBe('track');
    expect(colorGroup(part('StartSchale_60'))).toBe('accent');
    expect(colorGroup(part('Gerade120_60-40_Huegel'))).toBe('accent');
    expect(colorGroup(part('Trichter_100-60'))).toBe('track');
  });
  it('Japandi preset (default, first): track + rail Desert Tan, adapters + accents Dark Chocolate', () => {
    const jp = COLOR_PRESETS[0];
    expect(jp.id).toBe('japandi');
    expect(jp.f).toEqual({ track: '11401', rail: '11401', adapter: '11802', accent: '11802' });
    expect(jp.c).toEqual({ track: '#e8dbb7', rail: '#e8dbb7', adapter: '#4d3324', accent: '#4d3324' });
    expect(filamentName(filamentByCode('11401')!, 'de')).toBe('PLA Matte Wüstenbraun');
    expect(filamentName(filamentByCode('11802')!, 'de')).toBe('PLA Matte Dunkel-Schokoladenbraun');
    expect(jp.de).toBe('Japandi: Sand, Schoko'); expect(jp.en).toBe('Japandi: sand, chocolate');
    // preset link and round trip
    expect(encodeColors(presetState(jp))).toBe('11401.11401.11802.11802');
    expect(decodeColors('11401.11401.11802.11802')!.preset).toBe('japandi');
    // codes that match no preset (sand, charcoal, copper) load as a custom selection
    const custom = decodeColors('11401.11401.11101.13800')!;
    expect(custom.preset).toBeNull(); expect(custom.f.adapter).toBe('11101'); expect(custom.f.accent).toBe('13800');
  });
  it('presets: unique IDs, one Bambu filament per group, all eight color combinations', () => {
    expect(new Set(COLOR_PRESETS.map((p) => p.id)).size).toBe(COLOR_PRESETS.length);
    for (const p of COLOR_PRESETS) for (const g of COLOR_GROUPS) {
      const f = filamentByCode(p.f[g]);
      expect(f, `${p.id}/${g}`).not.toBeNull();
      expect(p.c[g]).toBe(f!.hex);
    }
    for (const n of ['Knochen auf Braun', 'Knochen auf Schwarz', 'Knochen auf Dunkelblau', 'Dunkelblau auf Kupfer', 'Hell-Blaugrau auf Weiß', 'Braun auf Schwarz', 'Weiß auf Hell-Blaugrau', 'Kupfer auf Schwarz'])
      expect(COLOR_PRESETS.some((p) => p.de === n), n).toBe(true);
    expect(boneBrown.f.track).toBe('11103');   // PLA Matte Bone White
  });
  it('family colors (default) change nothing; filament colors tint by group (darks lifted for the view)', () => {
    const g = part('Gerade120_40-40'), a = part('AdapterGerade120');
    const f0 = colorFor(g);
    expect(filamentColor(g)).toBeNull();
    setColors(presetState(boneBrown));
    expect(colorFor(g)).toBe(viewColor(boneBrown.c.track));
    expect(colorFor(a)).toBe(viewColor(boneBrown.c.adapter));
    expect(viewColor('#000000')).toBeGreaterThan(0x1a1a1a);   // black filament stays visible
    expect(viewColor('#ffffff')).toBe(0xffffff);
    setColors(DEFAULT_COLORS);
    expect(colorFor(g)).toBe(f0);
  });
  it('filament or custom color per group; preset is recognized or dropped; fit warning except for PLA Basic', () => {
    let cs = presetState(boneBrown);
    expect(untestedTypes(cs).sort()).toEqual(['PLA Matte', 'PLA Metal']);
    cs = withFilament(cs, 'track', '10100');                 // PLA Basic Jade White
    expect(cs.preset).toBeNull(); expect(cs.f.track).toBe('10100'); expect(cs.c.track).toBe('#ffffff');
    cs = withFilament(cs, 'track', '11103');                 // back -> preset again
    expect(cs.preset).toBe('bone-brown');
    cs = withOwnColor(cs, 'accent', '#ABCDEF');
    expect(cs.f.accent).toBeNull(); expect(cs.c.accent).toBe('#abcdef'); expect(cs.preset).toBeNull();
    expect(untestedTypes(cs)).toContain('?');
    let basic = DEFAULT_COLORS; for (const g of COLOR_GROUPS) basic = withFilament(basic, g, '10602');
    expect(basic.mode).toBe('filament'); expect(untestedTypes(basic)).toEqual([]);
    expect(untestedTypes(DEFAULT_COLORS)).toEqual([]);
    expect(withFilament(cs, 'track', '00000')).toEqual(cs);
  });
});

describe('Storage and link', () => {
  it('sanitizeColors drops garbage, keeps valid filaments and colors, accepts hex-only states', () => {
    expect(sanitizeColors(null)).toEqual(DEFAULT_COLORS);
    const s = sanitizeColors({ mode: 'filament', preset: 'nonexistent', c: { track: '#ABCDEF', adapter: 'red', rail: 12 }, f: { accent: '10101', rail: '99999' } });
    expect(s.mode).toBe('filament'); expect(s.preset).toBeNull();
    expect(s.c.track).toBe('#abcdef'); expect(s.f.track).toBeNull();
    expect(s.c.adapter).toBe(DEFAULT_COLORS.c.adapter); expect(s.f.adapter).toBe(DEFAULT_COLORS.f.adapter);
    expect(s.f.accent).toBe('10101'); expect(s.c.accent).toBe('#000000');
    // state with a preset and hex colors only -> preset with filaments
    const hexState = sanitizeColors({ mode: 'filament', preset: 'bone-brown', c: { track: '#d8d0bd', rail: '#d8d0bd', adapter: '#5e4231', accent: '#a8683c' } });
    expect(hexState).toEqual(presetState(boneBrown));
  });
  it('link: Bambu code or hex color per group, only for filament colors; preset is recognized; hex-only links are accepted', () => {
    const cs = presetState(boneBrown);
    const enc = encodeColors(cs)!;
    expect(enc).toBe('11103.11103.11802.13800');
    expect(decodeColors(enc)).toEqual(cs);
    const own = withOwnColor(cs, 'accent', '#123456');
    expect(encodeColors(own)).toBe('11103.11103.11802.123456');
    expect(decodeColors(encodeColors(own)!)).toEqual(own);
    const hexOnly = decodeColors('d8d0bd.d8d0bd.5e4231.a8683c')!;
    expect(hexOnly.f).toEqual({ track: null, rail: null, adapter: null, accent: null });
    expect(hexOnly.c.adapter).toBe('#5e4231');
    expect(encodeColors(DEFAULT_COLORS)).toBeNull();
    expect(decodeColors('xyz')).toBeNull();
    expect(decodeColors('99999.11103.11103.11103')).toBeNull();
    const h = linkHash(demo('mini'), false, cs);
    expect(h).toContain('&c=' + enc);
    history.replaceState(null, '', '#' + h);
    expect(loadState().colors).toEqual(cs);
  });
});

describe('Print plates by filament', () => {
  it('with filament colors every plate is single-color; the plan lists filament and amount per filament', () => {
    const L = solveChain(demo('three-levels'));
    const mixed = planPlates(L, 16).plates;
    expect(mixed.every((p) => p.color === null)).toBe(true);
    expect(mixed.some((p) => new Set(p.jobs.map((j) => colorGroup(j.part) === 'adapter')).size > 1)).toBe(true);
    setColors(presetState(boneBrown));
    const plan = planPlates(L, 16);
    for (const p of plan.plates) {
      expect(p.color).toMatch(/^\d{5}$/);
      expect(new Set(p.jobs.map((j) => j.color)).size, `plate ${p.level}/${p.index}`).toBe(1);
    }
    expect(plan.plates.length).toBeGreaterThan(mixed.length);
    const md = planMarkdown(plan, 'T');
    expect(md).toContain('PLA Matte Dunkel-Schokoladenbraun (11802)');
    expect(md).toMatch(/Filament je Farbe/);
    expect(getColors().mode).toBe('filament');
  });
  it('two filaments with the same color stay separate; a custom color gets its own plates', () => {
    const L = solveChain(demo('three-levels'));
    let cs = presetState(boneBrown);
    cs = withFilament(cs, 'adapter', '10101');   // PLA Basic Black (#000000)
    cs = withFilament(cs, 'accent', '11101');    // PLA Matte Charcoal (#000000)
    setColors(cs);
    const keys = new Set(planPlates(L, 16).plates.map((p) => p.color));
    expect(keys.has('10101') && keys.has('11101')).toBe(true);
    setColors(withOwnColor(cs, 'accent', '#000000'));
    const keys2 = new Set(planPlates(L, 16).plates.map((p) => p.color));
    expect(keys2.has('#000000') && keys2.has('10101')).toBe(true);
  });
});

describe('Parts list and JSON', () => {
  it('CSV has a filament column in filament mode; JSON stores codes and reads them back', () => {
    const els = demo('mini'), L = solveChain(els);
    expect(bomCsv(bom(L)).split('\n')[0]).toBe('Teil;Anzahl;Filament_g;Druckzeit_h;Typ');
    setColors(presetState(boneBrown));
    const csv = bomCsv(bom(L)).split('\n');
    expect(csv[0]).toBe('Teil;Anzahl;Filament_g;Druckzeit_h;Typ;Filament');
    expect(csv.find((l) => l.startsWith('Raststift'))).toMatch(/;PLA Matte Dunkel-Schokoladenbraun \(11802\)$/);
    const j = JSON.parse(trackJson(els, L, DEFAULT_SIM));
    expect(j.colors.f).toEqual(boneBrown.f);
    expect(sanitizeColors(j.colors)).toEqual(presetState(boneBrown));
  });
});
