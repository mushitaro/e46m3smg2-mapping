/**
 * The link: exchanges, retries, the command gate.
 *
 * Owns the protocol state machine over one transport. It must NOT know about
 * React, and it must NOT contain product verbs — `readPartialBin`,
 * `resetFlashCounter` and friends belong to an ECU layer built on top. A
 * diagnostic app that only reads fault memory should not have to stub a flash
 * writer, which is exactly what the tuner's application-shaped DmeLink forces.
 *
 * Ported from the MSS54HP CSL Convert Tuner's webSerialDmeLink, reduced to the
 * protocol core and with the timing constants surfaced as options.
 */

import type { Ds2ByteTransport } from './byteTransport';
import { Ds2Error } from './errors';
import {
    DS2_MIN_FRAME_LENGTH,
    Ds2Control,
    Ds2Status,
    buildDs2Frame,
    describeStatus,
    isPositiveResponse,
    parseDs2Frame,
    toHex,
    type Ds2Frame,
} from './frame';
import { classifyEchoMismatch } from './echo';
import {
    DS2_DEFAULT_ACCESS_LEVEL,
    buildKeyPayload,
    buildSeedRequestPayload,
    calculateLoginKey,
    isAlreadyUnlockedResponse,
    isSeedResponse,
} from './login';
import type { LinkTiming } from './timing';

/**
 * Every timing constant, in one overridable object.
 *
 * The tuner keeps these as file-local constants, so changing one means forking
 * the file — and a different ECU or a different cable will want different
 * numbers. The defaults below are the tuner's, which were measured on a real
 * vehicle; treat them as evidence, not as taste.
 */
export interface Ds2Timings {
    /** Per readExact phase (echo, header, body each get a fresh deadline). */
    responseTimeoutMs: number;
    /** Base pause between retry attempts, multiplied by the attempt number. */
    retryDelayMs: number;
    /**
     * Base pause after a LATCHED break, multiplied by the attempt number →
     * 400/800/1200. Longer than the normal delay on purpose: a flat delay gives
     * the line about a second of total settling across three attempts, which is
     * why automatic retries fail where a manual retry seconds later works.
     */
    breakSettleMs: number;
    /** Max reader re-acquisitions when draining a latched line. */
    breakRecoveryRounds: number;
    /**
     * Pause between a resync and the write that follows. Purging and immediately
     * transmitting gives the line no settle time; every other tool leaves an
     * inter-message gap. This is hygiene, not a cure.
     */
    resyncSettleMs: number;
    /** Quiet window that counts as "the K-line is silent". */
    drainQuietMs: number;
    drainMaxRounds: number;
    /**
     * A BUSY status is not a failure. It gets its OWN budget so a slow commit
     * cannot burn the retries that exist for line faults.
     */
    busyPollIntervalMs: number;
    busyPollAttempts: number;
    /** Settle after recovering a latched reader, inside the transport. */
    readRecoverySettleMs: number;
}

export const DS2_DEFAULT_TIMINGS: Ds2Timings = {
    responseTimeoutMs: 2000,
    retryDelayMs: 300,
    breakSettleMs: 400,
    breakRecoveryRounds: 3,
    resyncSettleMs: 30,
    drainQuietMs: 150,
    drainMaxRounds: 8,
    busyPollIntervalMs: 150,
    busyPollAttempts: 13,
    readRecoverySettleMs: 100,
};

/**
 * There is deliberately NO inter-telegram delay option, and that is a measured
 * decision rather than an omission.
 *
 * BMW's own stacks all use one — EDIABAS spins until ParRegenTime has elapsed,
 * BMW Scanner ships Delay=20/Delay2=40 — while the reference C# tool declares a
 * CommandDelay hook and never assigns it. Running at zero looked like the
 * outlier worth fixing.
 *
 * A selectable 0/5/10/20/40 ms gap was built and swept on the car. It changed
 * NOTHING: turnaround stayed 104-121 ms at every setting and the fast-rate read
 * still died at the same chunks. The hypothesis it was built to test was itself
 * an artifact of comparing a partial run's median against a whole run's. At
 * 9600 a 40 ms gap is 21 s of pure loss across 538 chunks. Removed rather than
 * left as a knob that can only hurt.
 */

export interface Ds2LinkOptions {
    /** DS2 slave address of the module in session (Ds2Address.DME / SMG / DSC). */
    address: number;
    timings?: Partial<Ds2Timings>;
    timing?: LinkTiming | null;
}

export interface RetryOptions {
    attempts?: number;
    timeoutMs?: number;
    /** Poll a BUSY status on its own budget instead of spending an attempt. */
    tolerateBusy?: boolean;
}

export class Ds2Link {
    readonly address: number;
    readonly timings: Ds2Timings;
    private readonly transport: Ds2ByteTransport;
    private timing: LinkTiming | null;
    private gateHeld = false;
    private connected = false;

    constructor(transport: Ds2ByteTransport, options: Ds2LinkOptions) {
        this.transport = transport;
        this.address = options.address;
        this.timings = { ...DS2_DEFAULT_TIMINGS, ...options.timings };
        this.timing = options.timing ?? null;
        // Optional: a backend without an instrument simply has no setTiming. See Ds2ByteTransport.
        if (this.timing) transport.setTiming?.(this.timing);
    }

    get isConnected(): boolean {
        return this.connected;
    }

    /**
     * There is no 5-baud or fast-init handshake on DS2 — open the port and
     * exchange frames.
     */
    async connect(): Promise<void> {
        await this.transport.open();
        this.connected = true;
    }

    async disconnect(): Promise<void> {
        this.connected = false;
        await this.transport.close();
    }

    // ---- the command gate ---------------------------------------------------

    /**
     * One transport, one frame in flight.
     *
     * Without this, UI state is the only thing preventing two operations
     * interleaving frames — which holds exactly until something OTHER than a
     * user action sends a request. A heartbeat timer is that something.
     *
     * A non-queuing mutex on purpose: a second entrant THROWS rather than
     * waiting. Only keepAlive treats a held gate as "skip".
     *
     * Every public operation takes it, and the bodies live in private `…Inner`
     * methods so internal composition cannot deadlock on its own gate. An
     * operation that internally re-uses another *public* method will deadlock —
     * split the shared part into a private helper and have both call it.
     */
    async withGate<T>(fn: () => Promise<T>): Promise<T> {
        if (this.gateHeld) {
            throw new Ds2Error('GATE_HELD', 'Another device operation is already in progress', {
                kind: 'protocol',
            });
        }
        this.gateHeld = true;
        try {
            return await fn();
        } finally {
            this.gateHeld = false;
        }
    }

    get isBusy(): boolean {
        return this.gateHeld;
    }

    // ---- exchanges ----------------------------------------------------------

    /** Gated single exchange. */
    async exchange(control: number, payload: Uint8Array = new Uint8Array(0), timeoutMs?: number): Promise<Ds2Frame> {
        return this.withGate(() => this.exchangeInner(control, payload, timeoutMs));
    }

    /**
     * One request, one response. Reads the K-line echo first, then the response
     * header, then exactly the remainder the ECU declared.
     *
     * Deliberately does NOT resync on failure. Recovery belongs to the layers
     * that own retry, because a resync here would silently clear a latch
     * mid-write and let a fallback re-issue a destructive command after what may
     * have been an ECU reset.
     */
    private async exchangeInner(
        control: number,
        payload: Uint8Array,
        timeoutMs = this.timings.responseTimeoutMs,
    ): Promise<Ds2Frame> {
        this.timing?.exchangeStart(now());
        const request = buildDs2Frame(this.address, control, payload);
        await this.transport.write(request);

        // On a half-duplex bus the ECU echoes our request back.
        const echo = await this.transport.readExact(request.length, timeoutMs);
        this.timing?.echoComplete(now());
        if (!bytesEqual(echo, request)) {
            const analysis = classifyEchoMismatch(request, echo, this.address);
            const latched = this.transport.peekReadError();
            throw new Ds2Error(
                'ECHO_MISMATCH',
                `Unexpected K-line echo (sent ${toHex(request)}, got ${toHex(echo)}) — ${analysis.verdict} ` +
                    `[lag +${analysis.lag}, ${analysis.flips1to0} bit(s) 1→0, ${analysis.flips0to1} bit(s) 0→1, ` +
                    `${analysis.trailingZeroRun}-byte zero tail, ${this.transport.bufferedLength()} byte(s) still buffered` +
                    `${latched ? `, latched ${latched.name}` : ''}]`,
                {
                    // The verdict rides as DATA, not prose. A UI cannot branch on a sentence.
                    kind: analysis.kind === 'unclassified' ? 'unclassified' : analysis.kind,
                    detail: {
                        analysis,
                        sent: toHex(request),
                        got: toHex(echo),
                        latchedError: latched?.name ?? null,
                        stillBuffered: this.transport.bufferedLength(),
                    },
                },
            );
        }

        // Validate the address BEFORE trusting the length byte. Out of frame, a
        // bogus length would swallow the next response or stall a whole timeout.
        const header = await this.transport.readExact(2, timeoutMs);
        if (header[0] !== this.address) {
            throw new Ds2Error(
                'ADDRESS_MISMATCH',
                `DS2 response out of frame: expected address 0x${this.address.toString(16)}, got ${toHex(header)}`,
                { kind: 'desync', detail: { expected: this.address, got: header[0] } },
            );
        }
        const declaredLength = header[1];
        if (declaredLength < DS2_MIN_FRAME_LENGTH) {
            throw new Ds2Error(
                'FRAME_LENGTH_INVALID',
                `Invalid DS2 response length byte ${declaredLength}`,
                { kind: 'desync', detail: { declaredLength } },
            );
        }
        const rest = await this.transport.readExact(declaredLength - 2, timeoutMs);

        const bytes = new Uint8Array(declaredLength);
        bytes.set(header, 0);
        bytes.set(rest, 2);
        const frame = parseDs2Frame(bytes);
        this.timing?.exchangeEnd(now());
        return frame;
    }

    /**
     * Retrying exchange.
     *
     * Order within an attempt is **delay, THEN resync**. Resyncing first lets a
     * late response from the ECU arrive into the freshly-cleared buffer and
     * desync the next attempt.
     *
     * Backoff escalates, and is SKIPPED after the final attempt — there is
     * nothing left to settle for, and paying it anyway delays the user's error
     * by up to a second.
     *
     * **What this must never be used for:** re-sending a request is only safe
     * when the request is idempotent. A pure read is. A memory write or a
     * programming control command is not, and validating its result inside this
     * loop would retry a semantic failure — see the note on describeVerifyByte.
     * Keep validation OUTSIDE the retry, always.
     */
    async exchangeWithRetry(
        control: number,
        payload: Uint8Array = new Uint8Array(0),
        options: RetryOptions = {},
    ): Promise<Ds2Frame> {
        return this.withGate(() => this.exchangeWithRetryInner(control, payload, options));
    }

    private async exchangeWithRetryInner(
        control: number,
        payload: Uint8Array,
        options: RetryOptions,
    ): Promise<Ds2Frame> {
        const attempts = options.attempts ?? 3;
        const timeoutMs = options.timeoutMs ?? this.timings.responseTimeoutMs;
        let lastError: unknown;

        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                // Resync always — a purge is free and a latched pump must be
                // recovered before we transmit. The SETTLE is different: it
                // exists to give a disturbed line quiet after we cleared it, so
                // paying it on a clean first attempt is pure loss.
                //
                // Measured: it put a 30 ms floor under every exchange, which is
                // ~15% of a 197 ms bulk-read round trip but the DOMINANT cost of
                // a small block poll. Skipped when there is nothing to settle
                // from — first attempt, no latched error, nothing buffered.
                const dirty = this.transport.hasReadError() || this.transport.bufferedLength() > 0;
                await this.resyncInner();
                if (attempt > 1 || dirty) await delay(this.timings.resyncSettleMs);
                let frame = await this.exchangeInner(control, payload, timeoutMs);

                if (options.tolerateBusy) {
                    frame = await this.pollWhileBusy(frame, control, payload, timeoutMs);
                }
                return frame;
            } catch (e) {
                lastError = e;
                if (attempt < attempts) {
                    // Longer after a latched break: the line needs real silence.
                    const base = this.transport.hasReadError()
                        ? this.timings.breakSettleMs
                        : this.timings.retryDelayMs;
                    await delay(base * attempt);
                }
            }
        }

        // Resync once more, guarded, so a failed cleanup cannot overwrite the
        // error we are about to report — and so the NEXT operation (typically a
        // telemetry start) is not left desynced.
        try {
            await this.resyncInner();
        } catch {
            /* keep lastError */
        }
        throw lastError;
    }

    /**
     * A BUSY status is not a failure — the ECU is committing. Poll it on its own
     * budget so a slow EEPROM write cannot consume the retries that exist for
     * line faults.
     */
    private async pollWhileBusy(
        frame: Ds2Frame,
        control: number,
        payload: Uint8Array,
        timeoutMs: number,
    ): Promise<Ds2Frame> {
        let current = frame;
        for (let i = 0; i < this.timings.busyPollAttempts; i++) {
            if (current.controlOrStatus !== Ds2Status.BUSY) return current;
            await delay(this.timings.busyPollIntervalMs);
            current = await this.exchangeInner(control, payload, timeoutMs);
        }
        return current;
    }

    /**
     * Throws unless the frame is a positive acknowledgement.
     *
     * A negative status is a fact about the device and must NEVER be retried:
     * the ECU received the request, considered it, and said no. Log the numeric
     * code verbatim — "rejected (status 0xB0)" is a fact about the device,
     * "rejected" is a fact about nothing.
     */
    assertPositive(frame: Ds2Frame, what: string): Ds2Frame {
        if (isPositiveResponse(frame)) return frame;
        const status = frame.controlOrStatus;
        throw new Ds2Error(
            'NEGATIVE_RESPONSE',
            `${what} rejected by the ECU: ${describeStatus(status)} (status 0x${status
                .toString(16)
                .padStart(2, '0')})`,
            { kind: 'refused', detail: { status, what, description: describeStatus(status) } },
        );
    }

    // ---- resync -------------------------------------------------------------

    /** Gated resync, for callers outside an operation. */
    async resync(): Promise<void> {
        return this.withGate(() => this.resyncInner());
    }

    /**
     * Recover the reader if the pump has latched, otherwise just purge.
     *
     * Every recovery point must go through this. A bare purge cannot clear a
     * latch, and one recovery site that forgets it poisons the whole session
     * until a reconnect.
     *
     * Touches only the READ side — it sends nothing to the ECU — which is what
     * makes it safe to call inside a programming session.
     */
    private async resyncInner(): Promise<void> {
        if (this.transport.hasReadError()) {
            await this.drainUntilQuiet();
        } else {
            this.transport.purge();
        }
    }

    /**
     * Escalating recovery. The pump cannot self-heal: a fresh reader re-latches
     * the same fault, so cycling it quickly is churn, not recovery — the line
     * never gets a quiet stretch long enough to come back. Give it real silence
     * (400 / 800 / 1200 ms) and stop after a few rounds rather than looping
     * forever.
     */
    private async drainUntilQuiet(): Promise<void> {
        for (let round = 1; round <= this.timings.breakRecoveryRounds; round++) {
            await this.transport.recoverRead(this.timings.readRecoverySettleMs);
            if (!this.transport.hasReadError()) {
                // Wait for the line to be quiet, not merely for the reader to exist.
                for (let i = 0; i < this.timings.drainMaxRounds; i++) {
                    const before = this.transport.bufferedLength();
                    await delay(this.timings.drainQuietMs);
                    if (this.transport.bufferedLength() === before) {
                        this.transport.purge();
                        return;
                    }
                    this.transport.purge();
                }
                return;
            }
            await delay(this.timings.breakSettleMs * round);
        }
    }

    // ---- keep-alive ---------------------------------------------------------

    /**
     * Tester-present.
     *
     * A dialog that shows values and waits for a human can leave the bus silent
     * for minutes, and then send the consequential command. If the ECU drops its
     * session in that window, the failure lands exactly where the user
     * experiences it.
     *
     * **Best effort, never throws.** It runs on a timer with nothing to catch
     * it; a rejection would surface as an unhandled promise rejection. The try
     * wraps withGate too, not just the exchange — losing the race for the gate
     * is a normal outcome.
     *
     * **Skips rather than queues.** A tester-present frame is only worth sending
     * when the line is idle.
     *
     * Nothing should branch on the result: it is a heartbeat, not a health
     * check. The next real operation reports the link's actual state.
     */
    async keepAlive(): Promise<boolean> {
        if (!this.connected || this.gateHeld) return false;
        try {
            return await this.withGate(async () => {
                const frame = await this.exchangeInner(
                    Ds2Control.KEEP_ALIVE,
                    new Uint8Array(0),
                    this.timings.responseTimeoutMs,
                );
                return isPositiveResponse(frame);
            });
        } catch {
            return false;
        }
    }

    /**
     * Ends the diagnostic session explicitly.
     *
     * The tuner never sends this — it closes the port and lets the session lapse,
     * which is enough when you talk to one module and always disconnect
     * afterwards. A diagnostic app switches between three modules in one
     * session, so leaving the previous one holding a session is a real
     * possibility. Available here; whether to call it is the app's decision, and
     * it is worth confirming on a car which behaviour the ECUs actually want.
     *
     * Best-effort, like keepAlive: this runs during teardown and must not
     * prevent the port from closing.
     */
    async endDiagnosticSession(): Promise<boolean> {
        if (!this.connected) return false;
        try {
            return await this.withGate(async () => {
                const frame = await this.exchangeInner(
                    Ds2Control.END_DIAGNOSTIC_MODE,
                    new Uint8Array(0),
                    this.timings.responseTimeoutMs,
                );
                return isPositiveResponse(frame);
            });
        } catch {
            return false;
        }
    }

    // ---- security access ----------------------------------------------------

    /**
     * Seed/key login (control 0x90).
     *
     * The exchange SHAPE is a DS2 mechanism. The key derivation is
     * MSS54-verified only — do not assume it holds on SMG or DSC until a car has
     * said so, and record that in the verified ledger when it does.
     */
    async login(accessLevel: number = DS2_DEFAULT_ACCESS_LEVEL): Promise<'already-unlocked' | 'unlocked'> {
        return this.withGate(() => this.loginInner(accessLevel));
    }

    private async loginInner(accessLevel: number): Promise<'already-unlocked' | 'unlocked'> {
        const seedFrame = await this.exchangeInner(
            Ds2Control.REQUEST_LOGIN_SEED,
            buildSeedRequestPayload(accessLevel),
        );
        this.assertPositive(seedFrame, 'Login seed request');
        if (isAlreadyUnlockedResponse(seedFrame)) return 'already-unlocked';
        if (!isSeedResponse(seedFrame)) {
            throw new Ds2Error(
                'SEED_LENGTH_INVALID',
                `Unexpected login response length ${seedFrame.length} (expected 5 or 46)`,
                { detail: { length: seedFrame.length } },
            );
        }
        // The algorithm indexes the WHOLE frame, not the payload.
        const key = calculateLoginKey(accessLevel, frameBytes(seedFrame));
        const keyFrame = await this.exchangeInner(Ds2Control.SEND_LOGIN_KEY, buildKeyPayload(key));
        this.assertPositive(keyFrame, 'Login key');
        return 'unlocked';
    }
}

function frameBytes(frame: Ds2Frame): Uint8Array {
    const bytes = new Uint8Array(frame.length);
    bytes[0] = frame.address;
    bytes[1] = frame.length;
    bytes[2] = frame.controlOrStatus;
    bytes.set(frame.payload, 3);
    bytes[frame.length - 1] = frame.checksum;
    return bytes;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

function delay(ms: number): Promise<void> {
    return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

function now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
