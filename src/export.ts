// Exports: bill of materials (CSV), track as JSON, file download.
import type { Layout } from './chain';
import type { ChainElement } from './chain';
import { toPlain } from './state';
import { catalog, partGrams, partHours, isJapandi, kitOf } from './catalog';
import { SNAP_PIN } from './plates';
import { t, tf, partName, getLang } from './i18n';
import { getColors, isFilamentMode, filamentKey, keyLabel } from './colors';

export interface BomRow { id: string; count: number; grams: number; hours: number; kind: 'part' | 'adapter' | 'pin'; note?: string }
const KIND_ORDER: BomRow['kind'][] = ['part', 'adapter', 'pin'];

export function bom(layout: Layout): BomRow[] {
  const m = new Map<string, BomRow>();
  const add = (id: string, kind: BomRow['kind'], count = 1) => {
    const p = catalog.byId.get(id); if (!p || count <= 0) return;
    const r = m.get(id) ?? { id, count: 0, grams: 0, hours: 0, kind };
    r.count += count; r.grams += count * partGrams(p); r.hours += count * partHours(p); m.set(id, r);
  };
  // Kits are counted per print part - lift: base, middle pieces, top, screw segments, crank; flip-flop: body, rocker, axle pin
  for (const q of layout.placed) if (q.connected) { const kit = kitOf(q.part); if (kit) for (const k of kit) add(k.id, 'part', k.n); else add(q.part.id, 'part'); }
  for (const a of layout.adapters) add(a.part.id, 'adapter');
  // Snap pins: one per joint, per tower step and per coupling of two towers
  add(SNAP_PIN, 'pin', layout.pins.reduce((s, j) => s + j.n, 0));
  return [...m.values()].sort((a, b) => (a.kind === b.kind ? b.count - a.count : KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)));
}

export function bomCsv(rows: BomRow[]): string {
  // filament mode adds a column: the filament per part (Bambu name and code, or custom colour)
  const fil = isFilamentMode();
  const lines = [t('csvHeader') + (fil ? ';' + t('csvFilament') : '')];
  for (const r of rows) {
    const p = catalog.byId.get(r.id), k = fil && p ? filamentKey(p) : null;
    lines.push(`${partName(p ?? { id: r.id })};${r.count};${r.grams.toFixed(0)};${r.hours.toFixed(1)};${r.kind}${fil ? ';' + (k ? keyLabel(k, getLang()) : '') : ''}`);
  }
  const g = rows.reduce((s, r) => s + r.grams, 0), h = rows.reduce((s, r) => s + r.hours, 0), n = rows.reduce((s, r) => s + r.count, 0);
  lines.push(`${t('csvSum')};${n};${g.toFixed(0)};${h.toFixed(1)};`);
  return lines.join('\n');
}

export function trackJson(elements: ChainElement[], layout: Layout, sim: unknown): string {
  return JSON.stringify({
    format: 'kugelbahn16-builder/1', created: new Date().toISOString(), edition: isJapandi() ? 'japandi' : 'plain', colors: getColors(), sim,
    chain: toPlain(elements),
    stats: { parts: layout.placed.length, adapters: layout.adapters.length, height: layout.height, drop: layout.drop, length: layout.length },
  }, null, 1);
}

/** Hands a file to the user as a regular browser download. */
export function download(name: string, content: string | Blob, type = 'application/json'): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Release print profile of the active edition (both editions share the same plate layout). */
export function profileFile(): string {
  return isJapandi() ? 'Modular_Marble_Run_16mm_Japandi_Release.3mf' : 'Modular_Marble_Run_16mm_Plain_Release.3mf';
}
/** Export file names per edition. */
export function exportName(kind: 'json' | 'csv' | 'plan' | 'mw' | '3mfAll' | '3mfLevel' | '3mfOne', level = 0): string {
  const j = isJapandi();
  switch (kind) {
    case 'json': return j ? 'marble_run16_japandi.json' : 'marble_run16.json';
    case 'csv': return j ? 'marble_run16_japandi_parts.csv' : 'marble_run16_parts.csv';
    case 'plan': return j ? 'Marble_Run16_Japandi_print_plan.md' : 'Marble_Run16_print_plan.md';
    case 'mw': return j ? 'Modular_Marble_Run_16mm_Japandi_plate_list.md' : 'Modular_Marble_Run_16mm_plate_list.md';
    case '3mfAll': return j ? 'Marble_Run16_Japandi_all_levels.3mf' : 'Marble_Run16_all_levels.3mf';
    case '3mfOne': return j ? 'Marble_Run16_Japandi_one_piece.3mf' : 'Marble_Run16_one_piece.3mf';
    case '3mfLevel': return `Marble_Run16${j ? '_Japandi' : ''}_level${String(level).padStart(3, '0')}.3mf`;
  }
}

/** Profile plate list: how many times each plate of the release print profile (profileFile(), every part
 *  exactly once) is needed for the track. */
export function makerworldList(rows: BomRow[]): string {
  const byPlate = new Map<number, { name: string; items: { name: string; count: number }[] }>();
  const missing: string[] = [];
  for (const r of rows) {
    const p = catalog.byId.get(r.id); if (!p) continue;
    if (!p.plate) { missing.push(`${partName(p)} ×${r.count}`); continue; }
    const e = byPlate.get(p.plate.no) ?? { name: p.plate.name, items: [] };
    e.items.push({ name: partName(p), count: r.count }); byPlate.set(p.plate.no, e);
  }
  const lines = [`# ${tf('mwListTitle', { ed: isJapandi() ? ' Japandi Edition' : '' })}`, '', tf('mwListIntro', { file: profileFile() }), '', t('mwCols'), '|---|---|---:|'];
  for (const no of [...byPlate.keys()].sort((a, b) => a - b)) {
    const e = byPlate.get(no)!;
    for (const it of e.items.sort((a, b) => b.count - a.count)) lines.push(`| ${String(no).padStart(2, '0')} ${e.name.replace(/^\d+\s*/, '')} | ${it.name} | ${it.count} |`);
  }
  if (missing.length) lines.push('', `**${t('mwNotReleased')}** ${missing.join(', ')}`);
  return lines.join('\n') + '\n';
}
