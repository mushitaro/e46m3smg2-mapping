/**
 * What the WORKS build does about a lapsed sign-in: go through the gate by itself only when nothing
 * would be lost and the clock is right, and never twice in ten minutes from one tab.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { REPASS_INTERVAL_MS, claimRepass, lastRepass, signInAction, type SignInFacts } from './signIn';

const NOW = Date.UTC(2026, 9, 30, 9, 0, 0);

/** Lapsed, clock right, nothing connected or unsaved, online, never tried: the one case that leaves. */
const clear: SignInFacts = {
    lapse: { clockOk: true }, linkBusy: false, unsaved: false, online: true, lastRepass: null, now: NOW,
};

describe('the decision', () => {
    it('does nothing while the gate lets this device in', () => {
        expect(signInAction({ ...clear, lapse: null })).toBe('none');
        // Not even with everything else in the way: there is nothing to say.
        expect(signInAction({ ...clear, lapse: null, linkBusy: true, unsaved: true, online: false })).toBe('none');
    });

    it('goes through the gate by itself when nothing would be lost', () => {
        expect(signInAction(clear)).toBe('repass');
    });

    it('waits for the clock rather than sign in under one that is out', () => {
        // Signed in now, the cookie would die when the head unit sets its clock — the 2026-10-29 fault.
        expect(signInAction({ ...clear, lapse: { clockOk: false } })).toBe('notice-clock');
        // Whatever else is going on: the clock is the reason nothing can be pressed yet.
        expect(signInAction({ ...clear, lapse: { clockOk: false }, linkBusy: true })).toBe('notice-clock');
        expect(signInAction({ ...clear, lapse: { clockOk: false }, unsaved: true })).toBe('notice-clock');
    });

    it('never leaves the page with a cable connected, work unsaved or no network', () => {
        expect(signInAction({ ...clear, linkBusy: true })).toBe('notice-signin');
        expect(signInAction({ ...clear, unsaved: true })).toBe('notice-signin');
        expect(signInAction({ ...clear, online: false })).toBe('notice-signin');
    });

    it('goes by itself at most once in ten minutes', () => {
        expect(signInAction({ ...clear, lastRepass: NOW - 60_000 })).toBe('notice-signin');
        expect(signInAction({ ...clear, lastRepass: NOW - REPASS_INTERVAL_MS + 1 })).toBe('notice-signin');
        expect(signInAction({ ...clear, lastRepass: NOW - REPASS_INTERVAL_MS })).toBe('repass');
    });

    it('does not let a clock put back by minutes open the window early', () => {
        expect(signInAction({ ...clear, lastRepass: NOW + 5 * 60_000 })).toBe('notice-signin');
    });
});

/** sessionStorage in memory — or, with `refuse`, as a locked-down browser leaves it. */
function session(refuse = false) {
    const items = new Map<string, string>();
    const no = () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    vi.stubGlobal('sessionStorage', refuse
        ? { getItem: no, setItem: no }
        : { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, String(v)) });
}

describe('the turn, on record', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('takes one turn, records it, and refuses a second inside the window', () => {
        session();
        expect(lastRepass(NOW)).toBeNull();
        expect(claimRepass(NOW)).toBe(true);
        expect(lastRepass(NOW)).toBe(NOW);
        expect(claimRepass(NOW + 60_000)).toBe(false);
        expect(claimRepass(NOW + REPASS_INTERVAL_MS)).toBe(true);
    });

    it('takes no turn it cannot record, so a refused write cannot become a loop', () => {
        session(true);
        expect(claimRepass(NOW)).toBe(false);
        // And reads as "just now", which keeps the decision on the notice.
        expect(signInAction({ ...clear, lastRepass: lastRepass(NOW) })).toBe('notice-signin');
    });
});
