import { describe, it, expect, afterEach } from 'vitest';
import { GOATCOUNTER, initAnalytics, trackEvent, analyticsActive } from '../src/analytics';

const EP = 'https://example.goatcounter.com/count';
const fakeWin = (hostname: string, query: Record<string, string> = {}) => {
  const w = {
    location: { hostname, pathname: '/Marbles/', hash: '#t=m1.secret' },
    document,
    goatcounter: { get_query: (n: string) => query[n] },
  };
  return w as unknown as Window;
};
afterEach(() => { document.querySelectorAll('script[data-goatcounter]').forEach((s) => s.remove()); delete window.goatcounter; });

describe('analytics', () => {
  it('is off by default: no endpoint, no script', () => {
    expect(analyticsActive()).toBe(GOATCOUNTER !== '');
    expect(initAnalytics('', fakeWin('n1v0k.github.io'))).toBe(false);
    expect(document.querySelector('script[data-goatcounter]')).toBeNull();
  });

  it('never counts local hosts', () => {
    for (const h of ['localhost', '127.0.0.1', '[::1]', 'dev.localhost']) expect(initAnalytics(EP, fakeWin(h))).toBe(false);
    expect(document.querySelector('script[data-goatcounter]')).toBeNull();
  });

  it('loads count.js once on the public host, path without the share hash, ?ref= wins over the referrer', () => {
    const w = fakeWin('n1v0k.github.io', { ref: 'reddit-3dp' });
    expect(initAnalytics(EP, w)).toBe(true);
    expect(initAnalytics(EP, w)).toBe(true);
    const scripts = document.querySelectorAll<HTMLScriptElement>('script[data-goatcounter]');
    expect(scripts.length).toBe(1);
    expect(scripts[0].dataset.goatcounter).toBe(EP);
    expect(scripts[0].src).toBe('https://gc.zgo.at/count.js');
    expect(w.goatcounter!.path!()).toBe('/Marbles/');
    expect(w.goatcounter!.referrer!()).toBe('reddit-3dp');
  });

  it('trackEvent is a no-op without count.js and never throws', () => {
    expect(() => trackEvent('click-makerworld')).not.toThrow();
    const calls: unknown[] = [];
    window.goatcounter = { count: (o) => { calls.push(o); } };
    trackEvent('click-makerworld');
    expect(calls).toEqual([{ path: 'click-makerworld', title: 'click-makerworld', event: true }]);
    window.goatcounter = { count: () => { throw new Error('x'); } };
    expect(() => trackEvent('click-makerworld')).not.toThrow();
  });
});
