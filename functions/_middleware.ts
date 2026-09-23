/**
 * The owner gate, in front of everything this origin serves.
 *
 * The preview is for owners — people who bought MILE and owners whose cars we have worked on — and
 * m3.tsunagi.app is where that is known. `createGate` (a byte-for-byte copy of
 * tsunagi-m3/tools/owner-gate/server/gate.ts; `npm run gate:verify` checks it) sends a browser
 * without a session to m3 and back, and lets nothing else through: not the page, not the
 * service worker, not the XDFs and factory files, not /api.
 *
 * The exceptions are the web app manifest and the icons it and the page name — browsers fetch
 * those without cookies, and an install prompt with a broken icon is how an owner learns the app
 * is "not installable". Both sets are listed, production and -dev-, because the source names the
 * former and the branded preview build names the latter.
 */

import { createGate } from './_owner-gate/gate';

const ICON_SIZES = ['512', '256', '192', '32', 'maskable-512', 'maskable-192'];

export const onRequest = createGate({
    clientId: 'smg2-preview',
    canonicalHost: 'e46m3smg2-mapping-preview.pages.dev',
    name: 'E46M3SMG2 /// MAPPING — PREVIEW',
    publicPaths: [
        '/manifest.webmanifest',
        ...ICON_SIZES.map(size => `/icons/mapping-${size}.png`),
        ...ICON_SIZES.map(size => `/icons/mapping-dev-${size}.png`),
    ],
});
