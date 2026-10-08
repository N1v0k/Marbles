// Shared helpers for the unit tests (16 mm catalog: IDs carry the _16mm suffix, the helpers append it).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { catalog } from '../src/catalog';
import { solveChain, type ChainElement, type Layout } from '../src/chain';
import { sanitizeElements } from '../src/state';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Short name -> catalog ID ('Gerade120_40-40' -> 'Gerade120_40-40_16mm'). */
export function id(s: string): string { return s.endsWith('_16mm') ? s : s + '_16mm'; }
/** Chain elements from short names; suffix '*' = reversed. */
export function chain(...ids: string[]): ChainElement[] {
  return ids.map((s) => (s.endsWith('*') ? { part: id(s.slice(0, -1)), reversed: true } : { part: id(s) }));
}
export function solve(...ids: string[]): Layout { return solveChain(chain(...ids)); }
export function ids(elements: ChainElement[]): string[] { return elements.map((e) => e.part.replace(/_16mm$/, '') + (e.reversed ? '*' : '')); }
export function part(s: string) { const p = catalog.byId.get(id(s)); if (!p) throw new Error('no part ' + s); return p; }
export function readMesh(file: string): ArrayBuffer {
  const b = readFileSync(join(ROOT, 'src', 'meshes', id(file) + '.kbm'));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
export const demos = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'demos.json'), 'utf-8')) as { demos: { id: string; name: Record<string, string>; chain: ChainElement[] }[] };
/** Demo track as chain elements (branch anchors become references, see state.ts). */
export function demo(d: string): ChainElement[] { const x = demos.demos.find((q) => q.id === d); if (!x) throw new Error('no demo ' + d); return sanitizeElements(JSON.parse(JSON.stringify(x.chain))); }
export const pinSum = (L: Layout, kind?: string) => L.pins.filter((j) => !kind || j.kind === kind).reduce((s, j) => s + j.n, 0);
