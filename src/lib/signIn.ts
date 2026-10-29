/**
 * What the WORKS build does when the gate has stopped letting this device in: go through it again
 * by itself, or say so on screen.
 *
 * **Why the page has to do anything.** The service worker answers a page load from its cache
 * whenever the network answers with something other than the app (sw.template.js), and a lapsed
 * session is answered with the gate's redirect. So the gate's sign-in page never appears: the
 * cached build keeps running, and no new build can install, because every file of one comes back
 * 401. On 2026-10-29 the car's head unit lost its sign-in that way — it boots with its clock at
 * 2006, and a cookie dated by that clock died when the clock was put right — and nothing on the
 * screen said so. The update check is where it shows (`usePwa`), and this is what follows.
 *
 * **The rule, in order.**
 *
 *   - Not lapsed: nothing.
 *   - The device's clock disagrees with the gate's: say so, and wait. Through the gate now, the
 *     gate would only show its page that waits for the clock, and the tool would be off the screen
 *     until the head unit set its clock. `usePwa` asks again by itself until the clock is right.
 *   - A cable connected, work not saved, no network, or this tab already went through the gate in
 *     the last ten minutes: say so, with SIGN IN where pressing it is safe.
 *   - Otherwise: through the gate by itself (`reauthHref`). m3 sends a signed-in owner straight
 *     back, and the page comes back on the newest build.
 *
 * **Ten minutes, per tab.** A trip that comes back still lapsed — m3 wanting a sign-in that nobody
 * at the head unit gives — must not become a loop that takes the screen away again and again. The
 * second time inside the window it is the notice and SIGN IN, which a person presses.
 *
 * Production has no gate and never gets here: `usePwa` only asks on the WORKS build, so `lapse` is
 * always null there.
 */

export type SignInAction = 'repass' | 'notice-signin' | 'notice-clock' | 'none';

/** How often this tab may go through the gate by itself. */
export const REPASS_INTERVAL_MS = 10 * 60_000;

export interface SignInFacts {
    /**
     * The gate's last word on this device: null while it lets it in (or has not been asked), and
     * after a 401 whether this device's clock agreed with that answer's Date (`clockAgrees`).
     */
    readonly lapse: { readonly clockOk: boolean } | null;
    /** A cable connected, or the link doing anything at all. */
    readonly linkBusy: boolean;
    /** Something that a page load would lose: edits not exported, a save or restore in flight. */
    readonly unsaved: boolean;
    readonly online: boolean;
    /** When this tab last went through the gate by itself, by this device's clock; null if never. */
    readonly lastRepass: number | null;
    readonly now: number;
}

export function signInAction(f: SignInFacts): SignInAction {
    if (!f.lapse) return 'none';
    if (!f.lapse.clockOk) return 'notice-clock';
    if (f.linkBusy || f.unsaved || !f.online || repassedRecently(f.lastRepass, f.now)) return 'notice-signin';
    return 'repass';
}

/**
 * Either side of now: a clock put back by a few minutes must not open the window early. A clock
 * put back by years opens it, and then disagrees with the gate, which is the clock notice.
 */
function repassedRecently(at: number | null, now: number): boolean {
    return at !== null && Math.abs(now - at) < REPASS_INTERVAL_MS;
}

const REPASS_KEY = 'sign-in:repassed-at';

/**
 * When this tab last went through the gate by itself. Storage that cannot be read answers "just
 * now": with no record to keep, the safe reading is that the window is closed.
 */
export function lastRepass(now: number): number | null {
    try {
        const raw = sessionStorage.getItem(REPASS_KEY);
        const at = raw === null ? NaN : Number(raw);
        return Number.isFinite(at) ? at : null;
    } catch {
        return now;
    }
}

/**
 * Take this tab's turn: true only when the window is open AND the turn is on record. A turn that
 * cannot be written is refused — unrecorded, the next load would take another, and that is the loop.
 */
export function claimRepass(now: number): boolean {
    if (repassedRecently(lastRepass(now), now)) return false;
    try {
        sessionStorage.setItem(REPASS_KEY, String(now));
        return sessionStorage.getItem(REPASS_KEY) === String(now);
    } catch {
        return false;
    }
}
