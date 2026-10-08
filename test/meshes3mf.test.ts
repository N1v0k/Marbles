// Print meshes from the print profile: reading the profile 3MF, mapping name -> part, coordinates back into the part
// coordinate system, edition detection and switching, foreign/missing file, no fetch of print*.
// Uses a test 3MF built from boxes (test/fixture3mf.ts) - runs without print meshes and without the release 3MF.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { catalog } from '../src/catalog';
import { scanProfile, registerProfile, clearProfiles, getPrintMesh, getProfile, hasProfile, sourceFor, paletteFiles, groovedFile, FILE_BY_NAME, MIN_PARTS } from '../src/meshes3mf';
import { loadPrintMesh } from '../src/threemf';
import { bambu3mf, boxMesh, REF, type FixObj } from './fixture3mf';
import { readMesh } from './helpers';

const nameOf = (file: string) => catalog.parts.find((p) => p.file === file && !p.display)!.nameEn;
// the smallest palette parts (few triangles -> small test file), including grooved ones for edition detection
const ALL = paletteFiles();
const plain = ALL.filter((f) => !groovedFile(f)).sort((a, b) => REF.plain[a][0] - REF.plain[b][0]).slice(0, 18);
const grooved = ALL.filter((f) => groovedFile(f)).sort((a, b) => REF.japandi[a][0] - REF.japandi[b][0]).slice(0, 8);
const FILES = [...plain, ...grooved];

function fixture(ed: 'plain' | 'japandi', over: (o: FixObj, file: string) => FixObj = (o) => o, extra: FixObj[] = []): Uint8Array {
  const objs = FILES.map((file, k) => {
    const ref = ed === 'japandi' && groovedFile(file) ? REF.japandi[file] : REF.plain[file];
    return over({ name: nameOf(file), ...boxMesh(ref), rotZ: [0, 90, 180, -90][k % 4] }, file);
  });
  return bambu3mf([...objs, ...extra], { title: `Modular Marble Run 16 mm - ${ed === 'japandi' ? 'Japandi' : 'Plain'} Edition` });
}
function bounds(pos: ArrayLike<number>) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], pos[i + a]); hi[a] = Math.max(hi[a], pos[i + a]); }
  return { c: [0, 1, 2].map((a) => (lo[a] + hi[a]) / 2), s: [0, 1, 2].map((a) => hi[a] - lo[a]) };
}

afterEach(() => { clearProfiles(); vi.unstubAllGlobals(); });

describe('Reading and mapping the profile 3MF', () => {
  it('catalog: every English part name belongs to exactly one print mesh, all palette parts have one', () => {
    expect(FILE_BY_NAME.size).toBe(ALL.length + catalog.parts.filter((p) => !p.released && REF.plain[p.file] && !p.display).length);
    for (const f of ALL) expect(FILE_BY_NAME.get(nameOf(f)), f).toBe(f);
    expect(FILE_BY_NAME.get('SnapPin_16mm')).toBe('Raststift_16mm');
    expect(ALL.length).toBe(137);                                   // release profile: 140 parts = 137 + 3 fit tests
    expect(ALL.filter(groovedFile).length).toBe(82);                // grooved in the Japandi profile
  });
  it('plain profile: objects, names, edition; fit test and repeated snap pins are skipped', () => {
    const pin = boxMesh(REF.plain.Raststift_16mm);
    const extra: FixObj[] = [{ name: 'FitTest_Block_top_16mm', ...boxMesh(REF.plain[plain[0]]) }, { name: 'SnapPin_16mm', ...pin }, { name: 'SnapPin_16mm', ...pin }];
    const r = scanProfile(fixture('plain', (o) => o, extra), 'p.3mf');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile.edition).toBe('plain');
    expect(r.profile.parts).toBe(FILES.length + (FILES.includes('Raststift_16mm') ? 0 : 1));
    expect(r.profile.title).toContain('Plain');
    expect(r.profile.missing.length).toBe(ALL.length - r.profile.parts);
  });
  it('Japandi profile detected from the triangle counts of the grooved parts (title irrelevant)', () => {
    const r = scanProfile(fixture('japandi'));
    expect(r.ok && r.profile.edition).toBe('japandi');
    // without face_count: counted on the first grooved part
    const r2 = scanProfile(fixture('japandi', (o) => ({ ...o, faces: null })));
    expect(r2.ok && r2.profile.edition).toBe('japandi');
    const r3 = scanProfile(fixture('plain', (o) => ({ ...o, faces: null })));
    expect(r3.ok && r3.profile.edition).toBe('plain');
  });
  it('coordinates: print orientation and Bambu centering removed, mesh lies like the print mesh (center, size, triangles)', async () => {
    expect(registerProfile(fixture('plain')).ok).toBe(true);
    for (const file of FILES) {
      const m = await getPrintMesh(file, false);
      expect(m, file).not.toBeNull();
      const b = bounds(m!.pos), ref = REF.plain[file];
      expect(m!.idx.length / 3).toBe(ref[0]);
      for (let a = 0; a < 3; a++) { expect(b.c[a]).toBeCloseTo(ref[1 + a], 4); expect(b.s[a]).toBeCloseTo(ref[4 + a], 4); }
    }
  });
  it('component with translation: applied, same result; a mesh stored rotated does not match -> no print mesh', async () => {
    const f0 = plain[0], f1 = plain.find((f) => f !== f0 && Math.abs(REF.plain[f][4] - REF.plain[f][5]) > 1)!;
    registerProfile(fixture('plain', (o, file) => (file === f0 ? { ...o, componentTf: '1 0 0 0 1 0 0 0 1 12.5 -3 7' } : file === f1 ? { ...o, componentTf: '0 1 0 -1 0 0 0 0 1 0 0 0' } : o)));
    const m = await getPrintMesh(f0);
    expect(bounds(m!.pos).c[0]).toBeCloseTo(REF.plain[f0][1], 4);
    expect(await getPrintMesh(f1)).toBeNull();
  });
  it('wrong triangle count in the mesh -> no print mesh (the export then visibly uses the preview mesh)', async () => {
    const f0 = plain[0];
    registerProfile(fixture('plain', (o, file) => (file === f0 ? { ...o, ...boxMesh(REF.plain[f0], REF.plain[f0][0] - 2), faces: REF.plain[f0][0] } : o)));
    expect(await getPrintMesh(f0)).toBeNull();
    expect(await getPrintMesh(plain[1])).not.toBeNull();
  });
});

describe('Editions', () => {
  const g = grooved[0], n = plain[0];
  it('plain profile only: plain meshes yes, grooved (Japandi) no', async () => {
    registerProfile(fixture('plain'));
    expect(hasProfile('plain')).toBe(true); expect(hasProfile('japandi')).toBe(false);
    expect((await getPrintMesh(g, false))!.idx.length / 3).toBe(REF.plain[g][0]);
    expect(await getPrintMesh(g, true)).toBeNull();
    expect(await getPrintMesh(n, false)).not.toBeNull();
  });
  it('Japandi profile only: grooved yes; the same part plain no (same name, but grooved); non-grooved from the Japandi profile', async () => {
    registerProfile(fixture('japandi'));
    expect((await getPrintMesh(g, true))!.idx.length / 3).toBe(REF.japandi[g][0]);
    expect(await getPrintMesh(g, false)).toBeNull();
    expect(sourceFor(n, false)?.edition).toBe('japandi');
    expect(await getPrintMesh(n, false)).not.toBeNull();
  });
  it('both profiles in turn: each edition from its own profile; the same edition again replaces the old profile', async () => {
    registerProfile(fixture('plain')); registerProfile(fixture('japandi'));
    expect((await getPrintMesh(g, false))!.idx.length / 3).toBe(REF.plain[g][0]);
    expect((await getPrintMesh(g, true))!.idx.length / 3).toBe(REF.japandi[g][0]);
    expect(sourceFor(n, false)?.edition).toBe('plain');
    const first = getProfile('japandi');
    registerProfile(fixture('japandi'));
    expect(getProfile('japandi')).not.toBe(first);
    clearProfiles();
    expect(hasProfile('plain') || hasProfile('japandi')).toBe(false);
  });
});

describe('Foreign or missing file', () => {
  it('no ZIP, ZIP without model, foreign model, too few parts, unknown edition', () => {
    expect(scanProfile(strToU8('hello world, this is not a 3mf file'))).toMatchObject({ ok: false, reason: 'notZip' });
    expect(scanProfile(zipSync({ 'a.txt': strToU8('x') }))).toMatchObject({ ok: false, reason: 'notThreeMf' });
    const foreign = bambu3mf(Array.from({ length: 30 }, (_, k) => ({ name: 'Benchy_' + k, ...boxMesh(REF.plain[plain[0]]) })));
    expect(scanProfile(foreign)).toMatchObject({ ok: false, reason: 'noParts', detail: '0' });
    const few = bambu3mf(ALL.slice(0, MIN_PARTS - 1).map((f) => ({ name: nameOf(f), ...boxMesh(REF.plain[f]) })));
    expect(scanProfile(few)).toMatchObject({ ok: false, reason: 'noParts', detail: String(MIN_PARTS - 1) });
    // grooved parts with an unknown triangle count (e.g. a newer profile than the builder)
    const odd = fixture('plain', (o, file) => (groovedFile(file) ? { ...o, ...boxMesh(REF.plain[file], REF.plain[file][0] + 6) } : o));
    expect(scanProfile(odd)).toMatchObject({ ok: false, reason: 'unknownEdition' });
    expect(registerProfile(odd).ok).toBe(false);
    expect(hasProfile('plain')).toBe(false);
  });
});

describe('Export meshes (loadPrintMesh): only from the profile, never via fetch of print*', () => {
  it('without a profile: preview mesh (quality preview), no request to print/', async () => {
    const calls: string[] = [];
    const kbm = new Uint8Array(readMesh('Gerade120_40-40'));
    vi.stubGlobal('fetch', async (url: string) => { calls.push(String(url)); return new Response(kbm); });
    const m = await loadPrintMesh('Gerade120_40-40_16mm');
    expect(m.quality).toBe('preview');
    expect(calls.filter((u) => /print/.test(u))).toEqual([]);
  });
  it('with a profile: print mesh from the file, no network request at all', async () => {
    vi.stubGlobal('fetch', async (url: string) => { throw new Error('fetch ' + url); });
    registerProfile(fixture('plain'));
    const m = await loadPrintMesh(plain[1]);
    expect(m.quality).toBe('print');
    expect(m.idx.length / 3).toBe(REF.plain[plain[1]][0]);
  });
});
