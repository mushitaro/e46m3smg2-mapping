#!/usr/bin/env node
/**
 * Stamp the service worker against the build that actually exists.
 *
 * Runs AFTER `next build`, over `out/`, so the precache list is enumerated from real files rather
 * than written by hand. A hand-written list is a list that goes stale silently: the app installs,
 * the cache fills with four of five files, and the failure only shows up offline.
 *
 * The build id is a hash of the precached content, not a timestamp. That means an unchanged build
 * produces an unchanged worker — so a redeploy that changed nothing does not evict every user's
 * cache and re-download the app on a phone tether.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'out');
const TEMPLATE = join(ROOT, 'scripts', 'sw.template.js');

/**
 * What must be present for the app to start with no network.
 *
 * The XDF definitions are in here on purpose: without them the app opens and can do nothing with a
 * .bin, which is the state that looks like a bug rather than like being offline.
 */
const PRECACHE_EXTENSIONS = new Set(['.html', '.js', '.css', '.woff2', '.webmanifest', '.png', '.svg', '.xdf']);

/**
 * Never precache these.
 *
 * `sw.js` is on the list because a worker that precaches ITSELF can serve its own old code back on
 * a later visit — the exact stale-code failure the network-first design exists to prevent. It also
 * only appears in the listing on the second run, which is how it slipped in: the first build has no
 * out/sw.js to enumerate.
 */
const SKIP_PATTERNS = [
    /\.map$/, /\/_next\/static\/chunks\/polyfills/, /^\/sw\.js$/,
    // Error pages. Nothing navigates to them by name, and what Pages answers at their paths is not
    // a 200 anyone promised — and one precache entry that fails is an update that never installs.
    /^\/404\.html$/, /^\/_not-found\.html$/,
];

/**
 * Where to fetch a file that is kept under `rel`.
 *
 * Pages answers `/index.html` and `/link-check.html` with a 308 to the extensionless path, and a
 * redirected response cannot answer a navigation from the cache (the browser rejects it). So a page
 * is fetched where Pages serves it and stored under its file name — the key the navigation
 * fallback asks for.
 */
function fetchPathOf(rel) {
    if (rel === '/index.html') return '/';
    if (rel.endsWith('/index.html')) return rel.slice(0, -'index.html'.length);
    if (rel.endsWith('.html')) return rel.slice(0, -'.html'.length);
    return rel;
}

function walk(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { out.push(...walk(full)); continue; }
        out.push(full);
    }
    return out;
}

let files;
try {
    files = walk(OUT);
} catch {
    console.error(`[sw] ${OUT} does not exist — run \`next build\` first.`);
    process.exit(1);
}

const precache = [];
const hash = createHash('sha256');

for (const file of files.sort()) {
    const rel = '/' + relative(OUT, file).split(sep).join('/');
    const dot = rel.lastIndexOf('.');
    const ext = dot === -1 ? '' : rel.slice(dot);
    if (!PRECACHE_EXTENSIONS.has(ext)) continue;
    if (SKIP_PATTERNS.some(p => p.test(rel))) continue;
    precache.push({ key: rel, fetch: fetchPathOf(rel) });
    hash.update(rel).update(readFileSync(file));
}

// `/` as well as `/index.html`: a navigation request asks for the former and the export writes the
// latter, and precaching only one of them leaves the offline shell unreachable by the path the
// browser actually requests.
if (precache.some(e => e.key === '/index.html')) precache.unshift({ key: '/', fetch: '/' });

const buildId = hash.digest('hex').slice(0, 12);
const template = readFileSync(TEMPLATE, 'utf8');

// `replaceAll`, not `replace`. With a string pattern `replace` substitutes only the FIRST match —
// and the first `__BUILD_ID__` in the template is the one in its own doc comment. That shipped a
// worker whose code still read `const PRECACHE = __PRECACHE__`, an undefined identifier, so the
// browser refused it with "ServiceWorker script evaluation failed" and the app silently had no
// offline support and no install prompt.
// Passed in by `build.mjs`, which computed it BEFORE `next build` so the bundler could inline the
// same value into the page. An empty one would make every tab think it is up to date forever, so
// it is checked rather than defaulted.
const sourceId = process.env.NEXT_PUBLIC_BUILD_ID;
if (!/^[0-9a-f]{12}$/.test(sourceId ?? '')) {
    console.error(`[sw] NEXT_PUBLIC_BUILD_ID is ${JSON.stringify(sourceId)}, expected 12 hex chars`);
    process.exit(1);
}

const sw = template
    .replaceAll('__SOURCE_ID__', sourceId)
    .replaceAll('__BUILD_ID__', buildId)
    .replaceAll('__PRECACHE__', JSON.stringify(precache, null, 4));

// The guard that would have caught the above at build time instead of in a browser. A worker is
// never exercised by `next build`, so this is the only place a placeholder can be caught early.
const leftover = sw.match(/__[A-Z_]+__/g);
if (leftover) {
    console.error(`[sw] unsubstituted placeholder(s) remain: ${[...new Set(leftover)].join(', ')}`);
    process.exit(1);
}

// Parse it too. `new Function` will not run the worker, but it will reject anything that is not
// valid JavaScript — the other half of "the browser is not the first thing to find this out".
try {
    new Function(sw);
} catch (error) {
    console.error(`[sw] generated worker is not valid JavaScript: ${error.message}`);
    process.exit(1);
}

writeFileSync(join(OUT, 'sw.js'), sw, 'utf8');
console.log(`[sw] build ${buildId}, ${precache.length} precached files -> out/sw.js`);
