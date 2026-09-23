/* eslint-disable no-restricted-globals */
/**
 * Service worker for E46M3SMG2 /// MAPPING.
 *
 * **Network-first, deliberately.** The obvious choice for an offline-capable app is cache-first,
 * and it is wrong here: the predecessor PWA shipped cache-first and a fix could not reach a user
 * who had already visited — they kept running old code with no way to know. On a tool that reads an
 * ECU, "the version you are running is not the version that was fixed" is not a cosmetic problem.
 * So the network wins whenever it answers WITH THE APP, and the cache is the fallback.
 *
 * **The origin is gated.** Every request passes the owner gate (`functions/_middleware.ts`) before
 * it reaches a file. That changes what "the network answered" means, and three rules follow:
 *
 * - `/_gate/*` and `/api/*` never touch the cache, in either direction, and are let through before
 *   anything else here runs. A cached `/_gate/status` would say "signed in" forever; a cached 201
 *   would say a session reached the cloud when it did not.
 * - A response is only the app if it is 2xx, same-origin (`basic`), not a redirect into the gate,
 *   and of the type its extension promises. A 401 JSON body where a script was expected, or m3's
 *   sign-in page where the shell was expected, is NOT an update — caching it would replace the app
 *   with an error page that then opens offline.
 * - When the answer is not the app — the session expired and the gate redirects to m3
 *   (`opaqueredirect`), m3 is down (503), anything but 2xx — the cached copy is served if there is
 *   one. An owner whose session lapsed keeps a working tool; signing in again is offered by the page,
 *   when nothing is connected.
 *
 * **Updates wait for the operator.** No `skipWaiting` on install: a read of the full image takes
 * eighteen minutes, and swapping the code under it to save a reload is a bad trade. A new build
 * installs in the background — only if EVERY file of it arrived as the app, otherwise the old one
 * stays — and waits. The page offers UPDATE when nothing is connected, and only that control sends
 * `skip-waiting`. (A same-tab reload does not release the client, so without the message the new
 * worker would wait forever; measured in BOOT, which this follows.)
 *
 * `__BUILD_ID__`, `__SOURCE_ID__` and `__PRECACHE__` are substituted by scripts/gen-sw.mjs against
 * the real build output, so the precache list can never drift from the files that actually exist.
 */

const BUILD_ID = '__BUILD_ID__';

/**
 * The id of the SOURCE this build came from — the same value the page has inlined.
 *
 * `BUILD_ID` above names the precached output and is the right key for a cache. `SOURCE_ID` names
 * the code, which is what `deploy.mjs` compares against the source on disk before it ships.
 */
const SOURCE_ID = '__SOURCE_ID__';
const CACHE_NAME = `e46m3smg2-map-${BUILD_ID}`;

/**
 * `{ key, fetch }` pairs. `key` is where the file is kept; `fetch` is where to get it. They differ
 * for pages: Pages answers `/index.html` and `/link-check.html` with a 308 to the extensionless
 * path, and a redirected response is not stored as the page — so the page is fetched at `/` and
 * `/link-check` and kept under its file name.
 */
const PRECACHE = __PRECACHE__;

/** What each extension must arrive as. A mismatch is an error page wearing the file's name. */
const EXPECTED_TYPE = {
    '.html': /^text\/html/i,
    '.js': /javascript/i,
    '.css': /^text\/css/i,
    '.woff2': /^(font\/woff2|application\/font-woff2|application\/octet-stream)/i,
    '.webmanifest': /^application\/(manifest\+)?json/i,
    '.png': /^image\/png/i,
    '.svg': /^image\/svg\+xml/i,
};

function extensionOf(path) {
    if (path === '/' || path.endsWith('/')) return '.html';
    const name = path.slice(path.lastIndexOf('/') + 1);
    const dot = name.lastIndexOf('.');
    return dot === -1 ? '.html' : name.slice(dot).toLowerCase();
}

function typeFits(path, contentType) {
    const want = EXPECTED_TYPE[extensionOf(path)];
    if (want) return want.test(contentType);
    // An extension with no registered type (.xdf, .0DA): anything but a page or an error body.
    return !/^(text\/html|application\/json)/i.test(contentType);
}

/** Is this response the app's file `path`, as opposed to the gate, an error, or somewhere else? */
function isTheApp(response, path) {
    if (!response || !response.ok || response.type !== 'basic') return false;
    if (response.redirected) {
        const landed = new URL(response.url);
        if (landed.origin !== self.location.origin || landed.pathname.startsWith('/_gate/')) return false;
    }
    return typeFits(path, response.headers.get('content-type') ?? '');
}

self.addEventListener('install', event => {
    // No skipWaiting — see the note at the top.
    event.waitUntil((async () => {
        // Everything is fetched before anything is stored, and any file that is not the app fails
        // the install. A failed install leaves the current worker and its cache exactly as they
        // were: a partial or poisoned build must never be the one that opens offline.
        const arrived = await Promise.all(PRECACHE.map(async entry => {
            const response = await fetch(entry.fetch, { cache: 'no-store', credentials: 'same-origin' });
            if (!isTheApp(response, entry.key)) {
                throw new Error(`precache refused ${entry.fetch}: ${response.status} ${response.type} `
                    + `${response.headers.get('content-type') ?? ''}`);
            }
            return [entry.key, response];
        }));
        const cache = await caches.open(CACHE_NAME);
        await Promise.all(arrived.map(([key, response]) => cache.put(key, response)));
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)));
        await self.clients.claim();
    })());
});

self.addEventListener('message', event => {
    const type = typeof event.data === 'string' ? event.data : event.data?.type;
    if (type === 'sw-build-id') {
        event.source?.postMessage({ type: 'sw-build-id', buildId: BUILD_ID, sourceId: SOURCE_ID });
    }
    // The operator pressed UPDATE, with nothing connected. Only ever reached from that control.
    if (type === 'skip-waiting') void self.skipWaiting();
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    // Network-only, and first: the gate's own routes and the SYNC API. Nothing below may answer them.
    if (url.pathname.startsWith('/_gate/') || url.pathname.startsWith('/api/')) return;

    event.respondWith(networkFirst(request, url));
});

/** Where a page load can be answered from the cache: the page itself, then the shell. */
function pageKeysFor(pathname) {
    if (pathname === '/' || pathname === '/index.html') return ['/', '/index.html'];
    const bare = pathname.replace(/\.html$/, '').replace(/\/$/, '');
    return [bare, `${bare}.html`, '/index.html', '/'];
}

async function fromCache(request, url) {
    if (request.mode === 'navigate') {
        // Matched on the path, not the request: a launch with a query string (`?source=pwa`, a
        // tracking parameter) was never cached under that exact URL.
        for (const key of pageKeysFor(url.pathname)) {
            const hit = await caches.match(key, { ignoreVary: true });
            if (hit) return hit;
        }
        return undefined;
    }
    return caches.match(request, { ignoreVary: true });
}

async function networkFirst(request, url) {
    let response = null;
    try {
        // `redirect: manual` is what a navigation already uses; the gate's redirect to m3 comes back
        // as `opaqueredirect`, which is the case below.
        response = await fetch(request);
    } catch {
        response = null;
    }

    if (isTheApp(response, url.pathname)) {
        // Assets fetched on demand (the factory files, a chunk after a deploy) are kept for next
        // time. Pages are not: a page from a newer deploy stored beside this build's scripts would
        // open offline naming chunks this cache does not hold. Pages come from the precache only.
        if (request.mode !== 'navigate') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
        }
        return response;
    }

    // Offline, or an answer that is not the app: serve what this build cached, if anything.
    const cached = await fromCache(request, url);
    if (cached) return cached;
    // Nothing better. On a first visit this is the redirect to m3 — let the browser follow it.
    if (response) return response;
    throw new Error('offline and not cached');
}
