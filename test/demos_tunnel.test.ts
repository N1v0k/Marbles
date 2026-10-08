// Demos with cross tunnel 32: the tunnel carries the track above it, the ball arrives or runs in a loop.
import { describe, it, expect } from 'vitest';
import { solveChain } from '../src/chain';
import { simulate, worstStatus, DEFAULT_SIM } from '../src/physics';
import { demo } from './helpers';

describe('Tunnel demos', () => {
  it('tunnel pretzel: Q32 center under the straight 60-50, no adapter below, ball arrives', () => {
    const L = solveChain(demo('tunnel-pretzel'));
    expect(L.adapters.filter((a) => a.owner === 1)).toEqual([]);
    expect(L.placed.find((q) => q.part.id.includes('Q32'))!.S).toBe(0);
    expect(worstStatus(simulate(L, DEFAULT_SIM))).toBe('ok');
  });
  it('endless eight: circuit over and through the tunnel, ball check without stalling', () => {
    const L = solveChain(demo('endless-eight'));
    expect(L.ring).toBe(true);
    expect(L.adapters.filter((a) => a.owner === 1 && a.slot === 0)).toEqual([]);
    expect(['ok', 'warn']).toContain(worstStatus(simulate(L, DEFAULT_SIM)));
  });
});
