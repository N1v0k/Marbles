// Ball check: energy model, limits, brakes, crest, uphill.
import { describe, it, expect } from 'vitest';
import { simulate, DEFAULT_SIM, worstStatus, heightEquivalent, crestRise, ballEnergy, G } from '../src/physics';
import { solveChain } from '../src/chain';
import { solve, demo } from './helpers';

describe('Energy model', () => {
  it('default: glass marble 5.4 g, push 70 mm/s, C_rr 0.021 (rolling test)', () => {
    expect(DEFAULT_SIM).toEqual({ crr: 0.021, v0: 70, mass: 5.4 });
  });
  it('Gerade 60-50: v^2 = v0^2 + (2/1.4) g (5.333 - C_rr * 64)', () => {
    const st = simulate(solve('StartSchale_60', 'Gerade120_60-50'), DEFAULT_SIM);
    const want = Math.sqrt(70 ** 2 + (2 / 1.4) * G * (20 * 8 / 15 / 2 - 0.021 * 64));
    expect(st[1].vOut).toBeCloseTo(want, 1);
    expect(st[0]).toMatchObject({ vIn: 0, vOut: 70 });
  });
  it('flat straight without momentum: the ball stops, nothing arrives afterwards', () => {
    const st = simulate(solve('StartSchale_60', 'Gerade120_60-60', 'Gerade120_60-50'), DEFAULT_SIM);
    expect(st[1].status).toBe('stop');
    expect(st[2]).toMatchObject({ status: 'stop', vOut: 0 });
    expect(worstStatus(st)).toBe('stop');
  });
  it('slide from rest: drop of 32 mm over 72 mm rolling distance -> sqrt((2/1.4) g (32 - 0.021 * 72)) = 654 mm/s', () => {
    const st = simulate(solve('StartSchale_60', 'Rutsche_120-60'), { ...DEFAULT_SIM, v0: 0 });
    expect(st[1].vOut).toBeCloseTo(Math.sqrt((2 / 1.4) * G * (32 - 0.021 * 72)), 3);
    expect(Math.round(st[1].vOut)).toBe(654);
  });
});

describe('Limits and special parts', () => {
  it('starter slide: K607 is entered at 657 mm/s (limit 621) and caps at 445', () => {
    const st = simulate(solveChain(demo('starter-slide')), DEFAULT_SIM);
    expect(Math.round(st[1].vOut)).toBe(657);
    expect(st[2].status).toBe('warn');
    expect(st[2].vOut).toBe(445);
    expect(worstStatus(st)).toBe('warn');
  });
  it('open rail curve R24 too fast -> error with reason', () => {
    const st = simulate(solve('StartSchale_60', 'SchieneGerade120_60-50', 'SchieneKurve90_50'), DEFAULT_SIM);
    expect(st[2].status).toBe('error');
    expect(st[2].msgs[0]).toMatch(/zu schnell: \d+ mm\/s \(höchstens 226\)/);
    expect(st[2].msgs[1]).toMatch(/Schienenkurve.*fliegt sie aus der Kurve/);
  });
  it('funnel: fixed exit speed, spiral/zigzag marked as estimates', () => {
    const st = simulate(solveChain(demo('starter-funnel')), DEFAULT_SIM);
    expect(st[3].vOut).toBe(453);
    const z = simulate(solve('StartSchale_60', 'Zickzack240_180-60'), DEFAULT_SIM);
    expect(z[1]).toMatchObject({ vOut: 580, estimate: true });
  });
  it('hill: crest 3.2 mm; too slow the ball does not make it, too fast it lifts off', () => {
    const slow = simulate(solve('StartSchale_60', 'Gerade120_60-50_Huegel'), { ...DEFAULT_SIM, v0: 50 });
    expect(slow[1].status).toBe('stop');
    const fast = simulate(solve('StartSchale_60', 'Rutsche_120-60', 'Gerade120_60-50_Huegel'), DEFAULT_SIM);
    expect(fast[2].status).toBe('error');
    expect(fast[2].msgs.join(' ')).toMatch(/zu schnell|hebt/);
    expect(crestRise(3.2, 5.33, true)).toBeCloseTo(8.53, 2);
  });
  it('installed uphill: the ball has to make the climb', () => {
    const st = simulate(solve('StartSchale_60', 'Gerade120_60-50', 'Gerade120_50-40', 'Gerade120_50-40*', 'Gerade120_60-50*'), { ...DEFAULT_SIM, v0: 0 });
    expect(st[3].status).toBe('ok');                       // the first climb (5.3 mm) still works
    expect(st[4].status).toBe('stop');
    expect(st[4].msgs.join(' ')).toMatch(/Anstieg von 5\.3 mm/);
    expect(heightEquivalent(1000)).toBeCloseTo(1.4 * 1e6 / (2 * G), 6);
  });
  it('energy at the end: 1/2 k m v^2 in mJ (5.4 g at 500 mm/s: 0.95 mJ)', () => {
    expect(ballEnergy(500, 5.4)).toBeCloseTo(0.5 * 1.4 * 0.0054 * 0.25 * 1000, 6);
  });
});
