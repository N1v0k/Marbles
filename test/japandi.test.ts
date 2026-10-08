// Japandi edition: grooved parts (catalog field jp), switching weight/time, meshes, exports, state.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { catalog, setEdition, isJapandi, grooved, partGrams, partHours } from '../src/catalog';
import { solveChain } from '../src/chain';
import { bom, makerworldList, exportName, profileFile, trackJson } from '../src/export';
import { planPlates } from '../src/plates';
import { parseKbm } from '../src/kbm';
import { groovedFile, paletteFiles } from '../src/meshes3mf';
import { linkHash, loadState, saveState } from '../src/state';
import { setLang } from '../src/i18n';
import { demo, part, ROOT } from './helpers';

afterEach(() => { setEdition('plain'); setLang('de'); vi.unstubAllGlobals(); try { localStorage.clear(); } catch { /* ignore */ } history.replaceState(null, '', location.pathname); });

const P = catalog.parts;
// Grooved part families; rails, brakes, spiral, zigzag, loopings, offset and snap pin stay smooth
const GROOVED_FAMILIES = /^(Adapter(Gerade|Kurve|LangeKurve|Start|Trichter|TunnelQuer|Kippwippe|Spirale|XKreuzung|YMerge120|Distanz)|Distanz|EndSchale|Gerade(120|100|88|80|60)_|Kurve90|LangeKurve90|Rutsche|StartSchale|Trichter|TunnelGerade120|TunnelKurve90|XKreuzung|YMerge120)/;

describe('Catalog', () => {
  it('80 grooved parts, exactly the grooved families; rails and snap pin stay smooth', () => {
    const T = P.filter((p) => p.family !== 'lift' && p.family !== 'liftPart' && !p.id.startsWith('Kippwippe'));
    const g = T.filter(grooved);
    expect(g.length).toBe(80);
    for (const p of T) expect(grooved(p), p.id).toBe(GROOVED_FAMILIES.test(p.id));
    // lift: the three housings are grooved, screws and crank are not
    expect(P.filter((p) => p.family === 'liftPart' && grooved(p)).map((p) => p.id).sort()).toEqual(['LiftFuss_40_16mm', 'LiftKopf_60_16mm', 'LiftMitte_16mm']);
    // flip-flop: only the body is grooved, rocker and axle pin are not
    expect(P.filter((p) => p.family === 'flipflopPart' && grooved(p)).map((p) => p.id)).toEqual(['Kippwippe_120-60_16mm']);
    expect(P.filter((p) => p.system === 'rail').some(grooved)).toBe(false);
    expect(grooved(part('Raststift'))).toBe(false);
  });
  it('weight and time switch with the edition; non-grooved parts stay the same', () => {
    const g = part('Gerade120_40-40'), s = part('SchieneGerade120_40-40');
    expect(isJapandi()).toBe(false);
    expect(partGrams(g)).toBe(g.grams); expect(partHours(g)).toBe(g.hours);
    setEdition('japandi');
    expect(isJapandi()).toBe(true);
    expect(partGrams(g)).toBe(g.jp!.grams); expect(partHours(g)).toBe(g.jp!.hours);
    expect(partGrams(s)).toBe(s.grams);
    // grooves: weight within +-8 %, print time clearly longer (measured on the Japandi release profile, correction per cm2 of groove area)
    // lift housings excluded: the Japandi release 3MF prints them with a different infill than the plain one
    // (a setting, not the grooves)
    for (const p of P.filter(grooved).filter((q) => q.family !== 'liftPart' && q.family !== 'lift')) {
      expect(Math.abs(p.jp!.grams / p.grams - 1), p.id).toBeLessThan(0.08);
      expect(p.jp!.hours, p.id).toBeGreaterThan(p.hours);
    }
    expect(g.jp!.hours / g.hours).toBeGreaterThan(1.25);           // straight: about +45 %
    expect(catalog.calib.plateH).toBeGreaterThan(0);
  });
  it('BOM and print plates use the active edition', () => {
    const L = solveChain(demo('three-levels'));
    const g0 = bom(L).reduce((s, r) => s + r.grams, 0), p0 = planPlates(L, 8).plates.reduce((s, p) => s + p.hours, 0);
    setEdition('japandi');
    const g1 = bom(L).reduce((s, r) => s + r.grams, 0), p1 = planPlates(L, 8).plates.reduce((s, p) => s + p.hours, 0);
    expect(g1).not.toBe(g0); expect(p1).toBeGreaterThan(p0);
  });
});

describe('Meshes', () => {
  it('every grooved part has its own preview mesh (KBM3, <= 16,000 triangles, same bounding box as plain)', () => {
    for (const p of P.filter((q) => grooved(q) && q.file)) {     // lift: meshes per module
      const fj = join(ROOT, 'src', 'meshes_j', p.file + '.kbm');
      expect(existsSync(fj), fj).toBe(true);
      const bj = readFileSync(fj), bg = readFileSync(join(ROOT, 'src', 'meshes', p.file + '.kbm'));
      expect(bj.subarray(0, 4).toString()).toBe('KBM3');
      const mj = parseKbm(bj.buffer.slice(bj.byteOffset, bj.byteOffset + bj.byteLength));
      const mg = parseKbm(bg.buffer.slice(bg.byteOffset, bg.byteOffset + bg.byteLength));
      expect(mj.idx.length / 3, p.id).toBeLessThanOrEqual(16000);
      const box = (pos: Float32Array) => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < pos.length; i++) { lo[i % 3] = Math.min(lo[i % 3], pos[i]); hi[i % 3] = Math.max(hi[i % 3], pos[i]); } return [...lo, ...hi]; };
      const a = box(mj.pos), b = box(mg.pos);
      for (let k = 0; k < 6; k++) expect(Math.abs(a[k] - b[k]), p.id).toBeLessThan(0.05);
    }
  });
  it('print meshes from the print profile: grooved exactly for the parts with Japandi values (print_ref.json)', () => {
    for (const f of paletteFiles()) {
      const p = catalog.parts.find((q) => q.file === f && !q.display)!;
      expect(groovedFile(f), f).toBe(grooved(p));
    }
  });
});

describe('Exports and state', () => {
  it('plate list and file names name the Japandi print profile', () => {
    const rows = bom(solveChain(demo('mini')));
    expect(profileFile()).toBe('Modular_Marble_Run_16mm_Plain_Release.3mf');
    expect(exportName('3mfAll')).toBe('Marble_Run16_all_levels.3mf');
    expect(makerworldList(rows)).not.toContain('Japandi');
    setEdition('japandi');
    expect(profileFile()).toBe('Modular_Marble_Run_16mm_Japandi_Release.3mf');
    const md = makerworldList(rows);
    expect(md).toContain('Modular_Marble_Run_16mm_Japandi_Release.3mf');
    expect(md.split('\n')[0]).toContain('Japandi Edition');
    expect(exportName('3mfAll')).toBe('Marble_Run16_Japandi_all_levels.3mf');
    expect(exportName('3mfLevel', 32)).toBe('Marble_Run16_Japandi_level032.3mf');
    expect(exportName('mw')).toBe('Modular_Marble_Run_16mm_Japandi_plate_list.md');
    expect(JSON.parse(trackJson([], solveChain([]), {})).edition).toBe('japandi');
  });
  it('Japandi is the default; the edition is always in the link (&s=j / &s=g) and is saved once chosen', () => {
    const els = demo('mini');
    expect(linkHash(els, true)).toMatch(/^t=m1\..*&s=j$/);
    expect(linkHash(els, false)).toMatch(/^t=m1\..*&s=g$/);
    expect(linkHash(els)).toContain('&s=j');                          // default
    const st = loadState(); expect(st.japandi).toBe(true); expect(st.editionChosen).toBeUndefined();
    // saved state without an explicit edition choice -> Japandi (default)
    localStorage.setItem('kugelbahn16-builder-v1', JSON.stringify({ elements: els, japandi: false }));
    expect(loadState().japandi).toBe(true);
    // chosen: plain stays plain
    saveState({ ...st, elements: els, japandi: false, editionChosen: true });
    expect(location.hash).toContain('&s=g');
    history.replaceState(null, '', location.pathname);
    expect(loadState().japandi).toBe(false);
    // the link wins and counts as a choice
    history.replaceState(null, '', '#' + linkHash(els, true));
    const s2 = loadState(); expect(s2.japandi).toBe(true); expect(s2.editionChosen).toBe(true);
  });
});
