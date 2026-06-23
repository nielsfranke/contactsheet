// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

// Per-request nonce-based Content-Security-Policy. Next 16 renamed the middleware convention to
// `proxy.ts`. A fresh nonce is generated per request and injected into the CSP header; Next reads
// it back (via the `x-nonce` request header / the CSP header) and stamps it onto its own framework
// scripts, bundles and inline styles, so we can drop 'unsafe-inline' from script-src. Our one
// hand-written inline script (the pre-hydration theme script in app/layout.tsx) reads the nonce via
// headers() and carries it explicitly. See node_modules/next/dist/docs/.../content-security-policy.md.
//
// Nonces require dynamic rendering — fine here, every route is already `ƒ` (server-rendered on
// demand). `upgrade-insecure-requests` is intentionally omitted: ContactSheet is commonly self-
// hosted over plain HTTP on a LAN, and that must keep working. TLS/HSTS is the edge proxy's job.

import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  // script-src: strict nonce + strict-dynamic (host allowlist ignored; only nonced scripts and what
  //   they load run). 'unsafe-eval' only in dev (React uses eval for richer error overlays). This is
  //   the XSS-critical directive — no 'unsafe-inline', so injected <script> can't execute.
  // style-src: 'unsafe-inline' (NOT a nonce). Our UI libs (e.g. the toast layer) inject <style>
  //   elements at runtime via the CSSOM, which can't carry our per-request nonce — and CSP3 ignores
  //   'unsafe-inline' whenever a nonce is also present, so a nonced style-src would break their
  //   styling. Inline styles can't execute JS, so this is the standard, low-risk compromise.
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `font-src 'self'`,
    `connect-src 'self'`, // same-origin REST + realtime WebSocket (ws/wss to 'self' is covered)
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Run on page documents only — skip API routes, Next static assets, image optimizer, the
    // favicon, and next/link prefetches (which don't need a CSP and shouldn't force dynamic work).
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
