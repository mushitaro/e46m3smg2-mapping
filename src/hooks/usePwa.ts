'use client';

/**
 * Service-worker registration, update handling, and the install prompt.
 *
 * Three things this owns, and one it deliberately does not.
 *
 * **Registration** happens after mount, never during render — `navigator` does not exist while
 * Next prerenders this page to static HTML.
 *
 * **Updates are announced, and applied only when asked.** The worker does not take over on its
 * own (`sw.template.js`): a new build installs in the background and waits. This hook notices the
 * waiting worker and sets `updated`; `applyUpdate` — reached only from the UPDATE control, which
 * the page shows only while nothing is connected — tells it to take over and reloads once it has.
 * A plain reload is not enough: a same-tab reload does not release the client, so the waiting
 * worker keeps waiting and the page comes back on the old build (measured in BOOT, whose pattern
 * this follows).
 *
 * **It does not go looking while the link is busy.** A tab left open for hours checks for a new
 * `sw.js` when it comes back to the foreground — but not while a cable is connected or a read is
 * running, because an eighteen-minute read is exactly when downloading a new build over a phone
 * tether is the wrong thing to be doing.
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
    /** A newer build is installed and waiting for the operator to take it. */
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
    /** A plain reload. Comes back on the same build if one is waiting. */
    reload(): void;
    /** Switch to the waiting build, then reload onto it. Only from UPDATE, only while idle. */
    applyUpdate(): Promise<void>;
}

/** How long UPDATE waits for the new worker to take over before reloading anyway. */
const TAKEOVER_TIMEOUT_MS = 5000;

/**
 * @param busy true while a cable is connected or an operation runs. No update check is started
 *   while it is true; the page also hides UPDATE for the same span.
 */
export function usePwa(busy: boolean): PwaApi {
    const [state, setState] = useState<PwaState>({
        ready: false,
        updated: false,
        buildId: null,
        installable: false,
        installed: false,
        online: true,
    });
    const promptRef = useRef<BeforeInstallPromptEvent | null>(null);
    /** Kept in a ref so the visibility handler never closes over a stale value. */
    const busyRef = useRef(busy);
    busyRef.current = busy;

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

        const removeWindowListeners = () => {
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
            window.removeEventListener('beforeinstallprompt', onBeforeInstall);
            window.removeEventListener('appinstalled', onInstalled);
        };

        if (!('serviceWorker' in navigator)) return removeWindowListeners;

        let cancelled = false;
        const onMessage = (event: MessageEvent) => {
            const data = event.data as { type?: string; buildId?: string } | undefined;
            if (data?.type === 'sw-build-id') setState(s => ({ ...s, buildId: data.buildId ?? s.buildId }));
        };
        navigator.serviceWorker.addEventListener('message', onMessage);

        /**
         * A worker that is installed and waiting means a newer build is ready.
         *
         * `controller` is the test for "this is an update, not a first install" — without it every
         * first visit would announce one. Checked at the moment of the call, not captured, because a
         * first visit becomes a controlled page moments later.
         */
        const announceIfWaiting = (worker: ServiceWorker | null) => {
            if (!cancelled && worker?.state === 'installed' && navigator.serviceWorker.controller) {
                setState(s => ({ ...s, updated: true }));
            }
        };

        const onVisible = () => {
            if (document.visibilityState !== 'visible' || busyRef.current) return;
            navigator.serviceWorker.getRegistration().then(r => r?.update()).catch(() => {});
        };
        document.addEventListener('visibilitychange', onVisible);

        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                if (cancelled) return;
                announceIfWaiting(registration.waiting);
                registration.addEventListener('updatefound', () => {
                    const installing = registration.installing;
                    if (!installing) return;
                    // Called immediately AND on every transition: listening only for `statechange`
                    // loses the race whenever the worker finishes installing before this line runs.
                    announceIfWaiting(installing);
                    installing.addEventListener('statechange', () => announceIfWaiting(installing));
                });
                return navigator.serviceWorker.ready;
            })
            .then(registration => {
                if (cancelled || !registration) return;
                setState(s => ({ ...s, ready: true }));
                registration.active?.postMessage({ type: 'sw-build-id' });
            })
            .catch(() => {
                // A failed registration is not a failed app: everything except offline use works
                // without it, so this is recorded rather than surfaced as an error.
                if (!cancelled) setState(s => ({ ...s, ready: false }));
            });

        return () => {
            cancelled = true;
            navigator.serviceWorker.removeEventListener('message', onMessage);
            document.removeEventListener('visibilitychange', onVisible);
            removeWindowListeners();
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

    const applyUpdate = useCallback(async () => {
        const registration = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
        const waiting = registration?.waiting;
        if (!waiting) { window.location.reload(); return; }

        // Once, however many times `controllerchange` fires: a reload loop on a tool that talks to
        // hardware would be worse than a stale build. And the reload waits for the new worker to
        // control the page — reloading first just loads the old build again. If it never takes
        // over, the operator still asked for a reload and gets one.
        let reloaded = false;
        const go = () => {
            if (reloaded) return;
            reloaded = true;
            window.location.reload();
        };
        navigator.serviceWorker.addEventListener('controllerchange', go);
        setTimeout(go, TAKEOVER_TIMEOUT_MS);
        waiting.postMessage({ type: 'skip-waiting' });
    }, []);

    return { ...state, install, reload, applyUpdate };
}
