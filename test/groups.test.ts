// Part list by base part: groups, selection fields, directions, field resolution.
import { describe, it, expect } from 'vitest';
import { catalog } from '../src/catalog';
import { GROUPS, GROUP_BY_ID, groupOf, resolve, variantOf, valueLabel, cmpVal, CHIPS, type Variant } from '../src/groups';
import { id } from './helpers';

const g = (x: string) => GROUP_BY_ID.get(x as never)!;
const opts = (v: Variant) => v.opts.map((o) => `${o.part.replace(/_16mm$/, '')}${o.reversed ? '*' : ''}${o.lane ? '!' : ''}:${o.dir ?? ''}`);
const find = (gid: string, dims: Record<string, string>) => g(gid).variants.find((v) => Object.entries(dims).every(([k, x]) => v.dims[k as never] === x))!;

describe('Groups', () => {
  it('every chain part belongs to exactly one group and is in a variant; modules, adapters, pins are not', () => {
    for (const p of catalog.parts) {
      const gid = groupOf(p);
      if (['adapter', 'pin', 'liftPart', 'flipflopPart'].includes(p.family) || p.display) { expect(gid, p.id).toBeNull(); continue; }
      expect(gid, p.id).not.toBeNull();
      const hits = GROUPS.flatMap((gr) => gr.variants.flatMap((v) => v.opts.filter((o) => o.part === p.id)));
      expect(hits.length, p.id).toBeGreaterThan(0);
      expect(new Set(GROUPS.filter((gr) => gr.variants.some((v) => v.opts.some((o) => o.part === p.id))).map((gr) => gr.id)).size, p.id).toBe(1);
    }
  });
  it('19 base parts in fixed order, chips, extras', () => {
    expect(GROUPS.map((x) => x.id)).toEqual(['start', 'straight', 'curve', 'longCurve', 'spacer', 'brake', 'slide', 'spiral', 'funnel', 'lift',
      'flipflop', 'ymerge', 'crossing', 'crossTunnel', 'zigzag', 'hill', 'loop', 'offset', 'end']);
    expect(CHIPS).toEqual(['straight', 'curve', 'level', 'special', 'startEnd']);
    expect(GROUPS.filter((x) => x.extra).map((x) => x.id)).toEqual(['zigzag', 'hill', 'loop', 'offset']);
    expect(g('straight').dims).toEqual(['kind', 'len', 'rim']);
    expect(g('lift').dims).toEqual(['h']);
  });
  it('straights: groove/rail 60..120 x 5 rims, Gerade88 groove 60-40 only, tunnel 120 60-50 only; uphill = reversed', () => {
    const fwd = g('straight').variants.filter((v) => !v.up);
    expect(fwd.filter((v) => v.dims.kind === 'groove').length).toBe(4 * 5 + 1);
    expect(fwd.filter((v) => v.dims.kind === 'rail').length).toBe(4 * 5);
    expect(fwd.filter((v) => v.dims.kind!.startsWith('tunnel')).map((v) => `${v.dims.kind} ${v.dims.len} ${v.dims.rim}`)).toEqual(
      ['tunnel-hex 120 60-50', 'tunnel-slot 120 60-50', 'tunnel-closed 120 60-50']);
    expect(opts(find('straight', { kind: 'groove', len: '88', rim: '60-40' }))).toEqual(['Gerade88_60-40:']);
    expect(opts(find('straight', { kind: 'groove', len: '100', rim: '40-50' }))).toEqual(['Gerade100_50-40*:']);
    expect(find('straight', { kind: 'groove', len: '100', rim: '40-50' }).up).toBe(true);
    expect(g('straight').variants.some((v) => v.dims.rim === '40-40' && v.up)).toBe(false);   // level parts not listed twice
  });
  it('curves: left/right per variant - flat reversed, descending curve mirrored, banked curve mirrored', () => {
    expect(opts(find('curve', { kind: 'groove', rim: '40-40' }))).toEqual(['Kurve90_40:left', 'Kurve90_40*:right']);
    expect(opts(find('curve', { kind: 'groove', rim: '50-40' }))).toEqual(['Kurve90_50-40:left', 'Kurve90_50-40_gespiegelt:right']);
    expect(opts(find('curve', { kind: 'groove', rim: '40-50' }))).toEqual(['Kurve90_50-40_gespiegelt*:left', 'Kurve90_50-40*:right']);
    expect(opts(find('longCurve', { kind: 'rail-banked', rim: '60-60' }))).toEqual(['SchieneLangeKurveBank90_R90_60_v2:left', 'SchieneLangeKurveBank90_R90_60_v2_gespiegelt:right']);
    expect(opts(find('curve', { kind: 'tunnel-closed', rim: '60-50' }))).toEqual(['TunnelKurve90_60-50_Voll_v3:left', 'TunnelKurve90_60-50_Voll_gespiegelt_v3:right']);
    for (const gid of ['curve', 'longCurve']) for (const v of g(gid).variants) {
      expect(v.opts.map((o) => o.dir), JSON.stringify(v.dims)).toEqual(['left', 'right']);
      for (const o of v.opts) { const p = catalog.byId.get(o.part)!; expect((o.reversed ? -p.turn : p.turn) > 0).toBe(o.dir === 'left'); }
    }
  });
  it('lift: height 1..10, four directions each; flip-flop: one variant left/right; X-crossing: cross lane and rim', () => {
    expect(g('lift').variants.map((v) => v.dims.h)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    for (const v of g('lift').variants) expect(v.opts.map((o) => o.dir)).toEqual(['straight', 'left', 'back', 'right']);
    expect(opts(g('flipflop').variants[0])).toEqual(['Kippwippe_120-60_Links:left', 'Kippwippe_120-60_Rechts:right']);
    expect(g('crossing').variants.map((v) => `${v.dims.cross} ${v.dims.rim} ${opts(v)}`)).toEqual([
      'left 50-40 XKreuzung_50-40:', 'left 40-50 XKreuzung_50-40*:', 'right 50-40 XKreuzung_50-40!:', 'right 40-50 XKreuzung_50-40*!:']);
  });
});

describe('Selection fields', () => {
  it('default: groove, 120, level; dependent fields jump to the first matching value', () => {
    const all = () => true;
    let r = resolve(g('straight'), {}, all);
    expect(r.sel).toEqual({ kind: 'groove', len: '120', rim: '60-60' });
    expect(r.values.len).toEqual(['60', '80', '88', '100', '120']);
    r = resolve(g('straight'), { kind: 'tunnel-hex', len: '60', rim: '40-40' }, all);
    expect(r.sel).toEqual({ kind: 'tunnel-hex', len: '120', rim: '60-50' });
    expect(opts(r.variant!)).toEqual(['TunnelGerade120_60-50_Hex:']);
    // only rim 40 allowed (open end at rim 40): length 88 and tunnels drop out
    const at40 = (v: Variant) => !v.up && v.dims.rim!.startsWith('40-');
    r = resolve(g('straight'), { kind: 'groove', len: '88' }, at40);
    expect(r.values.kind).toEqual(['groove', 'rail']);
    expect(r.values.len).toEqual(['60', '80', '100', '120']);
    expect(r.sel).toEqual({ kind: 'groove', len: '120', rim: '40-40' });
  });
  it('values sorted: descending rims before level before uphill, higher entry first', () => {
    expect(['50-50', '60-50', '40-50', '60-60', '50-40'].sort((a, b) => cmpVal('rim', a, b))).toEqual(['60-50', '60-60', '50-40', '50-50', '40-50']);
  });
  it('value labels (DE/EN)', () => {
    expect(valueLabel('rim', '60-50', 'de')).toBe('60 → 50');
    expect(valueLabel('rim', '40-50', 'en')).toBe('40 → 50 ↗');
    expect(valueLabel('len', '120', 'de')).toBe('120 · 64 mm');
    expect(valueLabel('len', '80', 'de')).toBe('80 · 42,7 mm');
    expect(valueLabel('len', '46', 'en')).toBe('46 · 24.5 mm');
    expect(valueLabel('h', '6', 'de')).toBe('+6 (ungeprüft)');
    expect(valueLabel('h', '5', 'en')).toBe('+5');
    expect(valueLabel('kind', 'rail-banked', 'de')).toBe('Schiene geneigt');
    expect(valueLabel('cross', 'right', 'en')).toBe('cross lane from right');
  });
  it('variantOf: chain element -> group, variant, direction (also reversed and lane 1)', () => {
    let v = variantOf(id('Kurve90_50'), true)!;
    expect([v.group.id, v.variant.dims.rim, v.opt.dir]).toEqual(['curve', '50-50', 'right']);
    v = variantOf(id('Kurve90_60-50_gespiegelt'), false)!;
    expect([v.variant.dims.rim, v.opt.dir]).toEqual(['60-50', 'right']);
    v = variantOf(id('XKreuzung_50-40'), false, 1)!;
    expect(v.variant.dims).toEqual({ cross: 'right', rim: '50-40' });
    v = variantOf(id('Lift7_Zurueck'), false)!;
    expect([v.variant.dims.h, v.opt.dir]).toEqual(['7', 'back']);
    v = variantOf(id('Gerade120_60-60'), true)!;                     // flat reversed = same variant
    expect(v.variant.dims).toEqual({ kind: 'groove', len: '120', rim: '60-60' });
    expect(variantOf(id('AdapterGerade120'), false)).toBeNull();
  });
});
