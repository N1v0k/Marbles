// Footprint polygons and SAT collision.
import { describe, it, expect } from 'vitest';
import { footprintPieces, penetration, piecesCollide, pointInside, type Poly } from '../src/footprint';
import { part } from './helpers';

const sq = (x0: number, y0: number, x1: number, y1: number): Poly => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

describe('penetration (SAT)', () => {
  it('separate/touching 0, overlapping returns penetration depth', () => {
    expect(penetration(sq(0, 0, 10, 10), sq(20, 0, 30, 10))).toBe(0);
    expect(penetration(sq(0, 0, 10, 10), sq(10, 0, 20, 10))).toBe(0);
    expect(penetration(sq(0, 0, 10, 10), sq(7, 0, 20, 10))).toBe(3);
  });
  it('piecesCollide respects z ranges and tolerance', () => {
    const a = [{ poly: sq(0, 0, 10, 10), z0: 0, z1: 32 }], b = [{ poly: sq(9.7, 0, 20, 10), z0: 0, z1: 32 }];
    expect(piecesCollide(a, b, 0.4)).toBe(0);
    expect(piecesCollide(a, [{ poly: sq(0, 0, 10, 10), z0: 32, z1: 64 }], 0.4)).toBe(0);
  });
});

describe('footprintPieces (16 mm)', () => {
  it('straight: foot 64 x 26.67; adapter 0..32', () => {
    const g = footprintPieces(part('Gerade120_40-40'));
    expect(g.length).toBe(1); expect(g[0].poly).toEqual(sq(0, -13.333, 64, 13.333));
    expect(footprintPieces(part('AdapterGerade120'))[0]).toMatchObject({ z0: 0, z1: 32 });
  });
  it('curve R24: ring sector 10.67..37.33 around the center, outer corner free', () => {
    const pieces = footprintPieces(part('Kurve90_40'));
    expect(pieces.length).toBe(6);
    const wp = pieces.map((pc) => ({ ...pc }));
    expect(pointInside(wp, 24 * Math.SQRT1_2, 24 * Math.SQRT1_2, 5)).toBe(true);
    expect(pointInside(wp, 36, 36, 5)).toBe(false);       // outer corner
    expect(pointInside(wp, 3, 3, 5)).toBe(false);         // inside the inner radius
  });
  it('spiral, funnel, bowls, crossing: special shapes within the bounding box', () => {
    for (const s of ['Spirale_100-60', 'Trichter_100-60', 'AdapterTrichter_100-60', 'StartSchale_60', 'EndSchale_40', 'XKreuzung_50-40']) {
      const p = part(s); const pcs = footprintPieces(p);
      expect(pcs.length, s).toBeGreaterThan(0);
      // ring sectors put the chord outside (r / cos(15 degrees)) - up to 1.3 mm beyond the bounding box
      for (const pc of pcs) for (const [x, y] of pc.poly) {
        expect(x, s).toBeGreaterThanOrEqual(p.bbox[0][0] - 1.3); expect(x, s).toBeLessThanOrEqual(p.bbox[1][0] + 1.3);
        expect(y, s).toBeGreaterThanOrEqual(p.bbox[0][1] - 1.3); expect(y, s).toBeLessThanOrEqual(p.bbox[1][1] + 1.3);
      }
    }
  });
});
