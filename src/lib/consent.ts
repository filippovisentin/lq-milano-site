// Cookie / third-party consent (GDPR + Garante Privacy, linee guida cookie 2021).
// The site sets only technical storage of its own (cart, intro, this choice).
// Third-party content that sends data to Google — the Maps embeds and the
// Street View background — loads only after an explicit "yes". The choice is
// kept 6 months, then asked again (Garante: not before 6 months).
export interface Consent { v: 1; at: number; maps: boolean }

const KEY = 'lq-consent';
const MAX_AGE = 182 * 24 * 3600 * 1000;

export function getConsent(): Consent | null {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Consent | null;
    if (!c || c.v !== 1 || Date.now() - c.at > MAX_AGE) return null;
    return c;
  } catch { return null; }
}

export function setConsent(maps: boolean) {
  const c: Consent = { v: 1, at: Date.now(), maps };
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* private mode: applies to this page only */ }
  window.dispatchEvent(new CustomEvent('consent:change', { detail: c }));
  return c;
}

/** Runs now if consent is already given, and again whenever it changes. */
export function onConsent(fn: (c: Consent | null) => void) {
  fn(getConsent());
  window.addEventListener('consent:change', (e) => fn((e as CustomEvent<Consent>).detail));
}

export const openConsentPreferences = () => window.dispatchEvent(new Event('consent:open'));
