/**
 * A simulated DS2 device, and the scripted port it speaks through.
 *
 * This is NOT a mock of the link. A mock link proves the UI works; it proves
 * nothing about the link. To test the protocol — and above all to test a
 * destructive path — you simulate the DEVICE and drive the real
 * WebSerialTransport and Ds2Link classes through it.
 *
 * What that buys:
 *   - the echo is produced by the "device", so echo verification is genuinely
 *     exercised rather than bypassed
 *   - failures can be injected one exchange at a time, in order
 *   - assertions can be made on the TELEGRAM TRACE, not just the outcome —
 *     which is what proves the right constants were used and the right order
 *     was followed
 *   - a guard's test can assert the trace is EMPTY, i.e. that nothing reached
 *     the device at all
 */

import { Ds2Status, buildDs2Frame, parseDs2Frame, type Ds2Frame } from './frame';
import type { SerialOptions, SerialPortLike } from './webSerialTypes';

/** What the device does with one incoming request. */
export type ExchangeBehavior =
    /** Echo the request, then answer with this control/status and payload. */
    | { kind: 'respond'; status?: number; payload?: Uint8Array }
    /** Echo the request, then say nothing. Produces a read timeout. */
    | { kind: 'silent' }
    /** Say nothing at all — not even the echo. */
    | { kind: 'dead' }
    /**
     * Echo with bits pulled LOW, the way an open-collector line corrupts.
     * `mask` is ANDed with each echoed byte, so bits can only go 1→0 — the
     * physically honest corruption, and the one the classifier calls
     * 'electrical'.
     */
    | { kind: 'corruptEcho'; mask: number; trailingZeros?: number }
    /**
     * Emit a stale response frame where the echo belonged. The classifier must
     * call this a 'desync', because it is software-recoverable.
     */
    | { kind: 'staleResponse' }
    /** Answer BUSY this many times, then behave normally. */
    | { kind: 'busy'; times: number };

export interface SimulatedEcuOptions {
    address: number;
    /**
     * Behaviours applied in order, one per exchange. Once exhausted, the device
     * falls back to a plain positive acknowledgement.
     */
    script?: ExchangeBehavior[];
    /**
     * Answers a request that the script did not override. Return the response
     * payload, or null for a bare ACK.
     */
    respond?: (request: Ds2Frame) => { status?: number; payload?: Uint8Array } | null;
}

export interface TraceEntry {
    request: Ds2Frame;
    /** Raw request bytes, so a test can assert on the wire form. */
    bytes: Uint8Array;
    behavior: ExchangeBehavior['kind'];
}

/**
 * A SerialPortLike backed by an in-memory DS2 slave.
 *
 * Pass `port.requestPort` to a WebSerialTransport and the whole real stack runs
 * against it.
 */
export class SimulatedSerialPort implements SerialPortLike {
    readonly trace: TraceEntry[] = [];
    /** Every option set the port was opened with, so a reopen can be asserted. */
    readonly opens: SerialOptions[] = [];
    /** Signals set on the port, so the DTR/RTS discipline can be asserted. */
    readonly signals: Array<Record<string, boolean | undefined>> = [];

    private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    private _readable: ReadableStream<Uint8Array> | null = null;
    private _writable: WritableStream<Uint8Array> | null = null;
    private scriptIndex = 0;
    private busyRemaining = 0;
    private opened = false;

    constructor(private readonly options: SimulatedEcuOptions) {}

    get readable(): ReadableStream<Uint8Array> | null {
        return this._readable;
    }
    get writable(): WritableStream<Uint8Array> | null {
        return this._writable;
    }

    async open(options: SerialOptions): Promise<void> {
        this.opens.push(options);
        this.opened = true;
        this._readable = new ReadableStream<Uint8Array>({
            start: (c) => {
                this.controller = c;
            },
        });
        this._writable = new WritableStream<Uint8Array>({
            write: (chunk) => {
                this.handleRequest(chunk);
            },
        });
    }

    async close(): Promise<void> {
        this.opened = false;
        try {
            this.controller?.close();
        } catch {
            /* already closed */
        }
        this.controller = null;
        this._readable = null;
        this._writable = null;
    }

    async setSignals(signals: Record<string, boolean | undefined>): Promise<void> {
        this.signals.push({ ...signals });
    }

    /** Injects bytes as if the device had sent them unprompted. */
    emit(bytes: Uint8Array): void {
        this.controller?.enqueue(bytes);
    }

    /** Breaks the read side, the way a serial break latches the pump. */
    breakLine(message = 'BreakError'): void {
        const err = new Error(message);
        err.name = 'BreakError';
        try {
            this.controller?.error(err);
        } catch {
            /* already errored */
        }
    }

    private nextBehavior(): ExchangeBehavior {
        const script = this.options.script ?? [];
        if (this.busyRemaining > 0) {
            this.busyRemaining--;
            return { kind: 'respond', status: Ds2Status.BUSY };
        }
        if (this.scriptIndex < script.length) {
            const b = script[this.scriptIndex++];
            if (b.kind === 'busy') {
                this.busyRemaining = Math.max(0, b.times - 1);
                return { kind: 'respond', status: Ds2Status.BUSY };
            }
            return b;
        }
        return { kind: 'respond' };
    }

    private handleRequest(chunk: Uint8Array): void {
        if (!this.opened || !this.controller) return;
        let request: Ds2Frame;
        try {
            request = parseDs2Frame(chunk);
        } catch {
            // A malformed request is echoed and ignored, like a device that
            // could not make sense of it.
            this.controller.enqueue(chunk);
            return;
        }

        const behavior = this.nextBehavior();
        this.trace.push({ request, bytes: Uint8Array.from(chunk), behavior: behavior.kind });

        switch (behavior.kind) {
            case 'dead':
                return;

            case 'corruptEcho': {
                const corrupted = Uint8Array.from(chunk, (b) => b & behavior.mask);
                const zeros = behavior.trailingZeros ?? 0;
                for (let i = 0; i < zeros && i < corrupted.length; i++) {
                    corrupted[corrupted.length - 1 - i] = 0;
                }
                this.controller.enqueue(corrupted);
                return;
            }

            case 'staleResponse': {
                // A previous reply arriving where the echo belonged.
                this.controller.enqueue(
                    buildDs2Frame(this.options.address, Ds2Status.ACKNOWLEDGE, new Uint8Array([0x00])),
                );
                return;
            }

            case 'silent':
                this.controller.enqueue(chunk); // echo only
                return;

            case 'respond':
            default: {
                this.controller.enqueue(chunk); // echo
                const scripted =
                    behavior.kind === 'respond'
                        ? { status: behavior.status, payload: behavior.payload }
                        : null;
                const custom = this.options.respond?.(request) ?? null;
                const status = scripted?.status ?? custom?.status ?? Ds2Status.ACKNOWLEDGE;
                const payload = scripted?.payload ?? custom?.payload ?? new Uint8Array(0);
                this.controller.enqueue(buildDs2Frame(this.options.address, status, payload));
                return;
            }
        }
    }
}

/**
 * Convenience: a `requestPort` function for TransportOptions, plus the port so a
 * test can inspect the trace.
 */
export function simulatedPort(options: SimulatedEcuOptions): {
    port: SimulatedSerialPort;
    requestPort: () => Promise<SerialPortLike>;
} {
    const port = new SimulatedSerialPort(options);
    return { port, requestPort: async () => port };
}
