/**
 * Screen Wake Lock, which TypeScript's DOM library still does not declare.
 *
 * Copied from the reference tuner's ambient declarations rather than re-derived, so the two apps
 * agree on the shape of the same browser API. `wakeLock` is optional because it genuinely is:
 * Firefox and older Android WebViews have no such property, and `useScreenWakeLock` checks.
 */

interface WakeLockSentinel extends EventTarget {
    readonly released: boolean;
    readonly type: 'screen';
    release(): Promise<void>;
}

interface WakeLock {
    request(type: 'screen'): Promise<WakeLockSentinel>;
}

interface Navigator {
    wakeLock?: WakeLock;
}
