/* eslint-disable no-restricted-globals */
/**
 * Service worker for SMG II DRIVELOGIC.
 *
 * **Network-first, deliberately.** The obvious choice for an offline-capable app is cache-first,
 * and it is wrong here: the predecessor PWA shipped cache-first and a fix could not reach a user
 * who had already visited — they kept running old code with no way to know. On a tool that reads an
 * ECU, "the version you are running is not the version that was fixed" is not a cosmetic problem.
 * So the network wins whenever it answers, and the cache is strictly the offline fallback.
 *
 * The cost is that a garage with no signal serves the last-seen build, which is exactly what the
 * cache is for. The benefit is that the moment there is signal, the newest code is what runs.
 *
 * `__BUILD_ID__` and `__PRECACHE__` are substituted by scripts/gen-sw.mjs against the real build
 * output, so the precache list can never drift from the files that actually exist.
 */

const BUILD_ID = '__BUILD_ID__';

/**
 * The id of the SOURCE this build came from — the same value the page has inlined.
 *
 * `BUILD_ID` above names the precached output and is the right key for a cache. It is the wrong
 * thing to compare against the page: the page knows its source id, not the output hash. Carrying
 * both lets a tab ask the one question that matters — "is the code on the server different from
 * the code I am running?" — instead of inferring it from the fact that some worker activated.
 */
const SOURCE_ID = '__SOURCE_ID__';
const CACHE_NAME = `smg2-drivelogic-${BUILD_ID}`;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', event => {
    // Take over immediately. Waiting for every tab to close is how a stale worker survives for
    // days, which is the same failure as cache-first by another route.
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE)).catch(() => {
            // A precache miss must not fail the install: an app that will not install offline is
            // worse than one that installs with a partial cache and fills it on use.
        }),
    );
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)));
        await self.clients.claim();
        // Tell open tabs which build is now live. The page decides whether to reload; a worker that
        // reloads tabs on its own can interrupt a read that is mid-flight.
        const clients = await self.clients.matchAll({ type: 'window' });
        for (const client of clients) client.postMessage({ type: 'sw-activated', buildId: BUILD_ID, sourceId: SOURCE_ID });
    })());
});

self.addEventListener('message', event => {
    if (event.data?.type === 'sw-build-id') {
        event.source?.postMessage({ type: 'sw-build-id', buildId: BUILD_ID, sourceId: SOURCE_ID });
    }
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    // The sync API is never cached. A cached 201 would tell someone their extraction reached D1
    // when it did not, and a cached listing would hide the row that just arrived.
    if (url.pathname.startsWith('/api/')) return;

    event.respondWith((async () => {
        try {
            const response = await fetch(request);
            if (response && response.status === 200 && response.type === 'basic') {
                const copy = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
            }
            return response;
        } catch {
            const cached = await caches.match(request);
            if (cached) return cached;
            // A navigation that misses both is still better served by the shell than by the
            // browser's offline page: the app can then say what it can and cannot do offline.
            if (request.mode === 'navigate') {
                const shell = await caches.match('/index.html') ?? await caches.match('/');
                if (shell) return shell;
            }
            throw new Error('offline and not cached');
        }
    })());
});
