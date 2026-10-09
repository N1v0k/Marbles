// Connect preview: top view of a suggestion - which parts are new, which stay, which go; view centred on the change.
import { describe, it, expect } from 'vitest';
import { solveChain } from '../src/chain';
import { decodeChain } from '../src/state';
import { findConnections, findRunAdjustments, applyConnection } from '../src/connect';
import { previewParts, connectPreview } from '../src/preview';
import { chain } from './helpers';

const count = (svg: string, cls: string) => svg.split(`class="${cls}"`).length - 1;

describe('Connect preview', () => {
  it('appended loop: the new parts are new, the existing ones stay, nothing goes', () => {
    const els = chain('Lift1_Gerade', 'Gerade120_60-60');
    const s = findConnections(els, { kind: 'ring' }, { maxParts: 10, max: 1 })[0];
    const work = applyConnection(els, s);
    const P = previewParts({ elements: els, L: solveChain(els) }, { elements: work, L: solveChain(work) });
    expect(P.filter((p) => p.kind === 'new').length).toBe(s.n);
    expect(P.filter((p) => p.kind === 'keep').length).toBe(2);
    expect(P.filter((p) => p.kind === 'gone')).toEqual([]);
  });
  it('run change: Distanz46 goes, Gerade60 is new, everything else stays; the view is centred on the change', () => {
    const els = decodeChain('m1.9.23.x.u.c.2w.g.2h.12@7:2.y*.g.d.s*.9.52')!.elements;
    const L = solveChain(els), e = L.placed[0].entry!;
    const s = findRunAdjustments(els, { kind: 'port', p: e.p, n: e.n }, { strand: 1 })[0];
    const work = applyConnection(els, s), L2 = solveChain(work);
    const P = previewParts({ elements: els, L }, { elements: work, L: L2 });
    expect(P.filter((p) => p.kind === 'new').map((p) => p.q.part.id)).toEqual(['Gerade60_40-40_16mm']);
    expect(P.filter((p) => p.kind === 'gone').map((p) => p.q.part.id)).toEqual(['Distanz46-0_40-40_16mm']);
    expect(P.filter((p) => p.kind === 'keep').length).toBe(els.length - 1);
    const svg = connectPreview({ elements: els, L }, { elements: work, L: L2 }, [e.p[0], e.p[1]], 'Preview');
    expect([count(svg, 'cp-new'), count(svg, 'cp-gone'), count(svg, 'cp-end')]).toEqual([1, 1, 1]);
    const vb = /viewBox="([-\d. ]+)"/.exec(svg)![1].split(' ').map(Number);
    expect(vb[2]).toBeGreaterThanOrEqual(180);                                     // some track around the change
    expect(vb[2]).toBeLessThan(L2.bounds!.max[0] - L2.bounds!.min[0]);             // but not the whole track
    expect(vb[2] / vb[3]).toBeCloseTo(132 / 96, 3);                                // fills the box
  });
  it('the label is escaped into the aria-label', () => {
    const els = chain('Lift1_Gerade', 'Gerade120_60-60'), L = solveChain(els);
    expect(connectPreview({ elements: els, L }, { elements: els, L }, null, 'a "b" <c>')).toContain('aria-label="a b c"');
  });
});
