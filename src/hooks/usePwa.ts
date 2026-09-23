'use client';

/**
 * Service-worker registration, update handling, and the install prompt.
 *
 * Three things this owns, and one it deliberately does not.
 *
 * **Registration** happens after mount, never during render — `navigator` does not exist while
 * Next prerenders this page to static HTML.
 *
 * **Updates are announced, not applied.** The worker is network-first and takes over immediately,
 * so a new build is already live for the next navigation; what this exposes is a flag so the UI can
 * offer a reload. It does NOT reload on its own: a worker that reloads the tab can interrupt a read
 * that is mid-flight, and on this app that means abandoning a two-minute extraction.
 *
 * **Install** is offered only where the browser says it is possible. `beforeinstallprompt` fires on
 * Android Chrome and desktop Chrome; iOS Safari never fires it and has no API, so the honest
 * answer there is a sentence rather than a button that does nothing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PwaState {
    /** The worker is registered and controlling this page. */
    readonly ready: boolean;
    /** A different build activated while this tab was open. */
    readonly updated: boolean;
    /** The build id the active worker reports, when it has answered. */
    readonly buildId: string | null;
    /** An install prompt is available to fire. */
    readonly installable: boolean;
    /** Already running as an installed app. */
    readonly installed: boolean;
    readonly online: boolean;
}

export interface PwaApi extends PwaState {
    install(): Promise<'accepted' | 'dismissed' | 'unavailable'>;
    reload(): void;
}

/**
 * @param currentBuildId the SOURCE id inlined into this page's bundle, so the hook can compare it
 *   with what the worker reports and answer "is the server's code different from mine?" rather
 *   than guessing from the fact that some worker activated.
 */
export function usePwa(currentBuildId: string): PwaApi {
    const [state, setState] = useState<PwaState>({
        ready: false,
        updated: false,
        buildId: null,
        installable: false,
        installed: false,
        online: true,
    });
    const promptRef = useRef<BeforeInstallPromptEvent | null>(null);
    /** Kept in a ref so the message handler never closes over a stale value. */
    const mine = useRef(currentBuildId);
    mine.current = currentBuildId;

    useEffect(() => {
        setState(s => ({
            ...s,
            online: navigator.onLine,
            installed: window.matchMedia('(display-mode: standalone)').matches
                || (navigator as Navigator & { standalone?: boolean }).standalone === true,
        }));

        const onOnline = () => setState(s => ({ ...s, online: true }));
        const onOffline = () => setState(s => ({ ...s, online: false }));
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);

        const onBeforeInstall = (event: Event) => {
            // Chrome fires this instead of showing its own bar; keeping the event is what makes a
            // deliberate INSTALL control possible later.
            event.preventDefault();
            promptRef.current = event as BeforeInstallPromptEvent;
            setState(s => ({ ...s, installable: true }));
        };
        const onInstalled = () => setState(s => ({ ...s, installable: false, installed: true }));
        window.addEventListener('beforeinstallprompt', onBeforeInstall);
        window.addEventListener('appinstalled', onInstalled);

        let cancelled = false;
        if ('serviceWorker' in navigator) {
            const onMessage = (event: MessageEvent) => {
                const data = event.data as
                    { type?: string; buildId?: string; sourceId?: string } | undefined;
                if (data?.type !== 'sw-activated' && data?.type !== 'sw-build-id') return;
                setState(s => ({
                    ...s,
                    buildId: data.buildId ?? s.buildId,
                    /**
                     * The precise condition: the worker was built from a different source than
                     * this page.
                     *
                     * Two wrong versions preceded it. "Only the second activation counts" never
                     * fired for a returning tab, so a deploy could not reach anybody — the reported
                     * symptom. "Any activation while a controller existed" fires on a fresh load
                     * too, because the browser fetches the new worker right after the new page, so
                     * it offered a reload to someone already on the newest build.
                     *
                     * Comparing source ids answers the actual question and answers it in both
                     * directions — but only on `sw-activated`. The startup `sw-build-id` query is
                     * answered by whichever worker is active at that instant, and on a FRESH load
                     * after a deploy that is still the old one while the page itself already has
                     * the new code from the network: comparing there offered a reload to someone
                     * on the newest build. Activation is the moment a worker's build becomes the
                     * one this origin serves, so it is the only moment the comparison means
                     * anything.
                     */
                    updated: data.type === 'sw-activated'
                        && data.sourceId !== undefined
                        && data.sourceId !== mine.current
                        ? true
                        : s.updated,
                }));
            };
            navigator.serviceWorker.addEventListener('message', onMessage);

            /**
             * `controllerchange` is the other half. A worker can claim this page without the
             * message arriving — a different tab's registration, or a browser that activates
             * before our listener is attached — and the page would then be running stale code
             * silently.
             */
            const onControllerChange = () => {
                // Ask, rather than assume: the answer is a source-id comparison and only the
                // worker has the other half.
                navigator.serviceWorker.controller?.postMessage({ type: 'sw-build-id' });
            };
            navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

            /**
             * And a tab that has been open for hours has to go and LOOK. The browser only checks
             * for a new `sw.js` on navigation, so a garage session left open across a deploy never
             * finds out. Checking when the tab comes back to the foreground is cheap and is the
             * moment a person is about to read the screen.
             */
            const onVisible = () => {
                if (document.visibilityState !== 'visible') return;
                navigator.serviceWorker.getRegistration().then(r => r?.update()).catch(() => {});
            };
            document.addEventListener('visibilitychange', onVisible);

            navigator.serviceWorker.register('/sw.js')
                .then(() => navigator.serviceWorker.ready)
                .then(registration => {
                    if (cancelled) return;
                    setState(s => ({ ...s, ready: true }));
                    registration.active?.postMessage({ type: 'sw-build-id' });
                })
                .catch(() => {
                    // A failed registration is not a failed app: everything except offline use
                    // works without it, so this is recorded rather than surfaced as an error.
                    if (!cancelled) setState(s => ({ ...s, ready: false }));
                });

            return () => {
                cancelled = true;
                navigator.serviceWorker.removeEventListener('message', onMessage);
                navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
                document.removeEventListener('visibilitychange', onVisible);
                window.removeEventListener('online', onOnline);
                window.removeEventListener('offline', onOffline);
                window.removeEventListener('beforeinstallprompt', onBeforeInstall);
                window.removeEventListener('appinstalled', onInstalled);
            };
        }

        return () => {
            cancelled = true;
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
            window.removeEventListener('beforeinstallprompt', onBeforeInstall);
            window.removeEventListener('appinstalled', onInstalled);
        };
    }, []);

    const install = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
        const event = promptRef.current;
        if (!event) return 'unavailable';
        await event.prompt();
        const { outcome } = await event.userChoice;
        // The event is single-use. Dropping it is what keeps the button from reappearing dead.
        promptRef.current = null;
        setState(s => ({ ...s, installable: false }));
        return outcome;
    }, []);

    const reload = useCallback(() => window.location.reload(), []);

    return { ...state, install, reload };
}
