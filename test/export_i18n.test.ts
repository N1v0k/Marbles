// Parts list/CSV/JSON, profile plate list, bilingual texts, plain-language wording.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bom, bomCsv, trackJson, makerworldList, download } from '../src/export';
import { t, setLang, T_KEYS, partName } from '../src/i18n';
import { catalog, SNAP_PIN } from '../src/catalog';
import { solveChain } from '../src/chain';
import { DEFAULT_SIM } from '../src/physics';
import { chain, demo, part, pinSum, ROOT } from './helpers';

afterEach(() => setLang('de'));

describe('Parts list', () => {
  it('parts - adapters - snap pins; pin count = all joints + tower stages + couplings', () => {
    const L = solveChain(demo('three-levels'));
    const rows = bom(L);
    expect(rows.filter((r) => r.kind === 'part').reduce((s, r) => s + r.count, 0)).toBe(15);
    expect(rows.filter((r) => r.kind === 'adapter').reduce((s, r) => s + r.count, 0)).toBe(L.adapters.length);
    const pins = rows.filter((r) => r.kind === 'pin');
    expect(pins.map((r) => r.id)).toEqual([SNAP_PIN]);
    expect(pins[0].count).toBe(pinSum(L));
    expect(rows[rows.length - 1].kind).toBe('pin');
  });
  it('CSV follows the language, total row', () => {
    const rows = bom(solveChain(demo('mini')));
    const de = bomCsv(rows).split('\n');
    expect(de[0]).toBe('Teil;Anzahl;Filament_g;Druckzeit_h;Typ');
    expect(de[de.length - 1].startsWith('SUMME;')).toBe(true);
    setLang('en');
    expect(bomCsv(rows).split('\n')[0]).toBe('Part;Qty;Filament_g;PrintTime_h;Type');
    expect(bomCsv(rows)).toContain('Straight120_60-50_16mm;1;');
  });
  it('trackJson: own format kugelbahn16-builder/1, chain and metrics', () => {
    const els = chain('StartSchale_60', 'Kurve90_60*');
    const j = JSON.parse(trackJson(els, solveChain(els), DEFAULT_SIM));
    expect(j.format).toBe('kugelbahn16-builder/1');
    expect(j.chain).toEqual(els);
  });
  it('profile plate list: part -> plate of the release 3MF, snap pins on plate 02', () => {
    const md = makerworldList(bom(solveChain(demo('starter-funnel'))));
    expect(md).toContain('| 03 Start and end | StartSchale_60_16mm | 1 |');
    expect(md).toContain('| 12 Level changers | Trichter_100-60_16mm | 1 |');
    expect(md).toMatch(/\| 02 Pins - duplicate as needed \| Raststift_16mm \| \d+ \|/);
    expect(md).toContain('Modular_Marble_Run_16mm_Plain_Release.3mf');
    expect(md).not.toContain('Nicht im Druckprofil');
  });
});

describe('Bilingual texts', () => {
  it('every key has German and English', () => {
    for (const k of T_KEYS) { setLang('de'); const de = t(k); setLang('en'); const en = t(k); expect(de, k).toBeTruthy(); expect(en, k).toBeTruthy(); }
  });
  it('part name: the ID in German, the profile name in English', () => {
    expect(partName(part('Gerade120_60-50'))).toBe('Gerade120_60-50_16mm');
    setLang('en');
    expect(partName(part('Gerade120_60-50'))).toBe('Straight120_60-50_16mm');
  });
  it('no outdated terms in help and UI (tenon, reverse adapter)', () => {
    for (const l of ['de', 'en'] as const) {
      setLang(l);
      const all = T_KEYS.map((k) => t(k)).join(' ');
      expect(all).not.toMatch(/Zapfen|WendeAdapter|Wende-Adapter|reverse adapter|\bpin onto pin\b/i);
      expect(t('helpText')).toMatch(l === 'de' ? /Raststift/ : /snap pin/);
    }
    const html = readFileSync(join(ROOT, 'index.html'), 'utf-8');
    expect(html).toContain('16 mm');
    expect(html).not.toMatch(/30[ -]?mm/);
  });
  it('texts without references to other tracks and without derivation jargon (UI, hints, limits)', () => {
    const bad = /30[ -]?mm|Froude|skaliert|scaled|Praxiswert|practical value|Querbeschleunigung|lateral acceleration|\((S1|LO1|T4)\)|Designsystem|design system/i;
    for (const l of ['de', 'en'] as const) {
      setLang(l);
      for (const k of T_KEYS) expect(t(k), k).not.toMatch(bad);
    }
    for (const p of catalog.parts) {
      for (const x of [p.note, p.noteEn, p.phys.limits.why, p.phys.limits.whyEn]) if (x) expect(x, p.id).not.toMatch(bad);
    }
  });
  it('all catalog hint texts are bilingual', () => {
    for (const p of catalog.parts) if (p.note) expect(p.noteEn, p.id).toBeTruthy();
  });
});

describe('Download', () => {
  it('saves the file as a browser download with the given name', () => {
    const names: string[] = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { names.push(this.download); };
    try { download('plan.md', '# x', 'text/markdown'); } finally { HTMLAnchorElement.prototype.click = orig; }
    expect(names).toEqual(['plan.md']);
  });
});
