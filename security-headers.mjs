// HTTP security headers for the production server (server.mjs).
// CSP: only this site's own code runs; the only outside content allowed is
// Google Maps / Street View (loaded after cookie consent) and, if configured,
// the contact-form endpoint. 'unsafe-inline' stays for scripts and styles
// because Astro inlines small scripts and the pages use style attributes;
// with no third-party script sources that is a contained risk.
export function securityHeaders(env = process.env, secure = true) {
  const connect = ["'self'"];
  for (const u of [env.PUBLIC_CONTACT_ENDPOINT, env.PUBLIC_COMMERCE_API]) {
    try { if (u) connect.push(new URL(u).origin); } catch { /* not a URL */ }
  }
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://maps.googleapis.com https://maps.gstatic.com",
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    'frame-src https://www.google.com https://maps.google.com',
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(secure ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  return [
    ['Content-Security-Policy', csp],
    ...(secure ? [['Strict-Transport-Security', 'max-age=31536000; includeSubDomains']] : []),
    ['X-Content-Type-Options', 'nosniff'],
    ['X-Frame-Options', 'SAMEORIGIN'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    // the site never asks for camera, microphone, position, sensors…
    ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), magnetometer=(), gyroscope=(), accelerometer=(), browsing-topics=(), interest-cohort=()'],
    ['Cross-Origin-Opener-Policy', 'same-origin-allow-popups'],
    ['X-Permitted-Cross-Domain-Policies', 'none'],
  ];
}
