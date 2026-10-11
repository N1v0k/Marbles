// Anonymous visitor counting with GoatCounter (no cookies, no personal data stored).
// Inactive while GOATCOUNTER is empty: no script is loaded and trackEvent() does nothing.
//
// Counted: page views (path only, never the share-link hash), the referrer, and named events
// such as a click on the MakerWorld button. A ?ref=… or ?utm_source=… parameter on the builder
// link overrides the referrer, so tagged links (e.g. ?ref=reddit-3dp) show up as their own source.

/** Count endpoint, e.g. 'https://NAME.goatcounter.com/count' (public, not a secret). Empty = off. */
export const GOATCOUNTER = '';

interface GoatCounter {
  count?: (o: { path: string; title?: string; event?: boolean }) => void;
  get_query?: (name: string) => string | undefined;
  referrer?: () => string;
  path?: () => string;
}
declare global { interface Window { goatcounter?: GoatCounter } }

export const analyticsActive = () => GOATCOUNTER !== '';

/** Load count.js once. Skipped for local hosts, so development and UI tests are never counted. */
export function initAnalytics(endpoint = GOATCOUNTER, win: Window = window): boolean {
  if (!endpoint) return false;
  const host = win.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost')) return false;
  if (win.document.querySelector('script[data-goatcounter]')) return true;
  win.goatcounter = {
    ...(win.goatcounter ?? {}),
    // tagged links win over the browser referrer
    referrer: () => win.goatcounter?.get_query?.('ref') || win.goatcounter?.get_query?.('utm_source') || win.document.referrer,
    // path only: the #t=… share link describes the visitor's track and is never sent
    path: () => win.location.pathname,
  };
  const s = win.document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.dataset.goatcounter = endpoint;
  win.document.head.appendChild(s);
  return true;
}

/** Count a named event (e.g. 'click-makerworld'). Never throws. */
export function trackEvent(name: string, win: Window = window): void {
  try { win.goatcounter?.count?.({ path: name, title: name, event: true }); } catch { /* counting must never break the app */ }
}
