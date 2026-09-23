/**
 * The transport: a pump, and a latch.
 *
 * Owns the port, a read buffer, readExact, and purge/recover. It must NOT know
 * the protocol — no frame shapes, no control bytes, no retry policy.
 *
 * Received bytes are drained by a single background pump into an internal
 * buffer, and readExact consumes from that buffer. This is deliberate: the Web
 * Serial reader delivers bytes on arbitrary chunk boundaries, so a DS2 echo and
 * the start of its response frequently arrive in the SAME chunk. A naive "one
 * chunk per readExact" drops the surplus and desynchronises the stream — which
 * is exactly what broke bulk reads in the reference app. Buffering never drops
 * a byte, keeping echo/response framing aligned across thousands of exchanges.
 *
 * Ported from the MSS54HP CSL Convert Tuner. Changes: explicit Web Serial types
 * instead of ambient globals, coded errors instead of English prose, and the
 * port acquisition is injectable so a device simulator can drive this exact
 * class rather than a mock of it.
 */

import { Ds2Error } from './errors';
import type { LinkTiming } from './timing';
import { getSerial, type SerialPortLike } from './webSerialTypes';

/**
 * Receive buffer requested from the Web Serial implementation. The spec default
 * is 255 bytes.
 *
 * **This is NOT the OS or FTDI driver receive buffer.** Chromium's
 * serial_port.cc passes bufferSize straight to mojo::CreateDataPipe as
 * capacity_num_bytes — it is the ring between the browser process and the
 * renderer, nothing more. On Windows, serial_io_handler_win.cc contains no
 * SetupComm() call at all, so the driver's buffers stay at their Device Manager
 * defaults no matter what we pass. **Raising it cannot add bandwidth.**
 *
 * What it does buy is room to fall behind: at 255 bytes, reads have been
 * reported to stall outright on some devices (WICG/serial#164).
 *
 * The related hazard is worth stating because it may be one of ours:
 * WICG/serial#123 reports Chromium treats this buffer as a circular queue and
 * SPLITS a write that straddles the boundary. A DS2 request frame is ~9 bytes;
 * a split write puts a gap mid-frame on a half-duplex K-line, which comes back
 * as an echo mismatch that classifyEchoMismatch would most likely score
 * 'unclassified'. The write timer is the measurement that tests it: the median
 * should be ~0. It measured 0.10 ms on the tuner, so this is not happening
 * there.
 */
export const RX_BUFFER_BYTES = 4096;

/**
 * 8E1 at 9600 is not a default to tune — it is the proven configuration.
 *
 * Do not "simplify" the parity to 8N1 while chasing line errors. DS2 is
 * even-parity; an 8N1 receiver samples the parity bit where the stop bit should
 * be, so every even-popcount byte raises a framing error. DS2's own address
 * 0x12 and its ACK 0xA0 both have popcount 2, so effectively every frame would
 * fault on its first byte.
 *
 * (The previous OldBMW-Diag-PWA opened the port 8N1. That path was unreachable
 * from its UI, which is the only reason it never showed up as a bug.)
 */
export const DS2_SERIAL_DEFAULTS = {
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: 'even',
} as const;

export interface TransportOptions {
    /** Defaults to 9600. Only 9600/38400/125000 exist on the MSS54, and only 9600 survives. */
    baudRate?: number;
    bufferSize?: number;
    /**
     * Supplies the port. Defaults to `navigator.serial.requestPort()`, which
     * MUST be called from inside a real user gesture (a click handler).
     * Injectable so a device simulator can drive this class directly.
     */
    requestPort?: () => Promise<SerialPortLike>;
}

export class WebSerialTransport {
    private port: SerialPortLike | null = null;
    private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
    private buffer: number[] = [];
    private pumpActive = false;
    private pumpError: Error | null = null;
    /**
     * A single reader parked in readExact, woken by the pump the moment enough
     * bytes have arrived.
     *
     * Replaces a setTimeout(2) polling loop. Browsers clamp nested timers to
     * ~4 ms, so that loop could sit on data that had already arrived for up to
     * a full clamp period — three times per DS2 exchange (echo, header, body).
     * At 9600 the wire dominates and it hides; the faster the rate, the larger
     * that fixed cost looms, which is why raising the baud stopped producing a
     * speed-up.
     *
     * One waiter is enough: the transport is serialised by the link's command
     * gate, so readExact is never re-entered concurrently.
     */
    private waiter: { need: number; wake: () => void } | null = null;
    private timing: LinkTiming | null = null;
    private readonly opts: Required<Omit<TransportOptions, 'requestPort'>> &
        Pick<TransportOptions, 'requestPort'>;

    constructor(options: TransportOptions = {}) {
        this.opts = {
            baudRate: options.baudRate ?? DS2_SERIAL_DEFAULTS.baudRate,
            bufferSize: options.bufferSize ?? RX_BUFFER_BYTES,
            requestPort: options.requestPort,
        };
    }

    /** Attaches the instrument. The link owns exchange boundaries; the transport
     *  owns byte arrival, so both write into the same object. */
    setTiming(timing: LinkTiming | null): void {
        this.timing = timing;
    }

    /** Wakes the parked reader once its byte count is satisfiable — or once it can only fail. */
    private signalWaiter(): void {
        const w = this.waiter;
        if (w && (this.buffer.length >= w.need || this.pumpError)) {
            this.waiter = null;
            w.wake();
        }
    }

    /**
     * Releases a parked reader unconditionally. Used wherever the pump it is
     * waiting on is about to be torn down: after that point no byte can ever
     * arrive to wake it, so leaving it parked would cost a full timeout for
     * nothing.
     */
    private releaseWaiter(): void {
        const w = this.waiter;
        if (w) {
            this.waiter = null;
            w.wake();
        }
    }

    static isSupported(): boolean {
        return getSerial() !== undefined;
    }

    async open(): Promise<void> {
        this.port = await this.acquirePort();
        await this.port.open({
            baudRate: this.opts.baudRate,
            dataBits: DS2_SERIAL_DEFAULTS.dataBits,
            stopBits: DS2_SERIAL_DEFAULTS.stopBits,
            parity: DS2_SERIAL_DEFAULTS.parity,
            bufferSize: this.opts.bufferSize,
        });
        await this.deassertControlLines();
        this.attachStreams(this.port);
    }

    private async acquirePort(): Promise<SerialPortLike> {
        if (this.opts.requestPort) return this.opts.requestPort();
        const serial = getSerial();
        if (!serial) {
            throw new Ds2Error(
                'PORT_UNSUPPORTED',
                'Web Serial is not available in this browser (desktop Chrome or Edge required).',
                { kind: 'protocol' },
            );
        }
        // Must be called from within a real user gesture (e.g. a click handler).
        return serial.requestPort();
    }

    private attachStreams(port: SerialPortLike): void {
        if (!port.writable || !port.readable) {
            throw new Ds2Error('PORT_NOT_OPEN', 'The serial port opened without readable/writable streams.');
        }
        this.writer = port.writable.getWriter();
        this.reader = port.readable.getReader();
        this.buffer = [];
        this.pumpError = null;
        this.pumpActive = true;
        this.startPump();
    }

    /**
     * Puts DTR and RTS in a known, de-asserted state — matching what native
     * tools do on a COM-port transport (`DtrEnable = false; RtsEnable = false`).
     * Untouched, they sit at whatever Chromium's open() leaves behind.
     *
     * It matters more here than it does natively, because of something only a
     * Web Serial app has to do: there is no in-place baud change, so a DS2 baud
     * switch means close() + open(). Native stacks assign a property on the
     * still-open handle and never disturb the line. A close/open cycle moves
     * whatever these two lines were doing — and on some K+DCAN cables they gate
     * the K-line transceiver. Setting them identically on BOTH sides of a
     * reopen removes that variable; setting them on only one side is worse than
     * not setting them at all.
     *
     * Best-effort: a cable that does not implement the request must not fail
     * the connection.
     */
    private async deassertControlLines(): Promise<void> {
        try {
            await this.port?.setSignals?.({ dataTerminalReady: false, requestToSend: false });
        } catch {
            /* not all platforms/cables support it; the link works without it */
        }
    }

    private startPump(): void {
        const reader = this.reader!;
        void (async () => {
            try {
                while (this.pumpActive) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    if (value) {
                        // Timestamped HERE, not in readExact: readExact only ever
                        // learns that enough bytes exist, never when each arrived.
                        // Byte arrival times are the whole point — they are what
                        // separates "the ECU was thinking" from "the bytes were
                        // here and we were slow to notice".
                        this.timing?.rx(now());
                        for (let i = 0; i < value.length; i++) this.buffer.push(value[i]);
                        this.signalWaiter();
                    }
                }
            } catch (e: unknown) {
                this.pumpError = e instanceof Error ? e : new Error(String(e));
                // A latched error must wake the reader too, or it waits out its
                // whole timeout for bytes that can no longer arrive — turning a
                // break into a multi-second stall.
                this.signalWaiter();
            }
        })();
    }

    async close(): Promise<void> {
        this.pumpActive = false;
        this.releaseWaiter();
        try {
            await this.reader?.cancel();
        } catch {}
        try {
            this.reader?.releaseLock();
        } catch {}
        try {
            this.writer?.releaseLock();
        } catch {}
        try {
            await this.port?.close();
        } catch {}
        this.reader = null;
        this.writer = null;
        this.port = null;
        this.buffer = [];
    }

    /**
     * Reconfigures the port to a new baud rate. Web Serial has no way to change
     * baud on an open port, so this closes and reopens the SAME port object and
     * restarts the pump.
     *
     * Because no other tool does this, any failure that appears only on switched
     * rates should be suspected here first.
     */
    async reopen(baudRate: number): Promise<void> {
        const port = this.port;
        if (!port) throw new Ds2Error('PORT_NOT_OPEN', 'Serial port is not open');
        this.pumpActive = false;
        this.releaseWaiter();
        try {
            await this.reader?.cancel();
        } catch {}
        try {
            this.reader?.releaseLock();
        } catch {}
        try {
            this.writer?.releaseLock();
        } catch {}
        await port.close();
        await port.open({
            baudRate,
            dataBits: DS2_SERIAL_DEFAULTS.dataBits,
            stopBits: DS2_SERIAL_DEFAULTS.stopBits,
            parity: DS2_SERIAL_DEFAULTS.parity,
            bufferSize: this.opts.bufferSize,
        });
        // Same state as open() left, so crossing this reopen does not move the control lines.
        await this.deassertControlLines();
        this.attachStreams(port);
    }

    async write(bytes: Uint8Array): Promise<void> {
        if (!this.writer) throw new Ds2Error('PORT_NOT_OPEN', 'Serial port is not open');
        // Timed because it should be ~0, and a non-zero median would be a
        // finding — see the WICG/serial#123 note on RX_BUFFER_BYTES.
        this.timing?.writeStart(now());
        try {
            await this.writer.write(bytes);
        } catch (e) {
            throw new Ds2Error('WRITE_FAILED', `Serial write failed: ${describeError(e)}`, {
                kind: 'electrical',
                cause: e,
            });
        }
        this.timing?.writeEnd(now());
    }

    /** Discards buffered bytes — used to resynchronise after a timeout before retrying. */
    purge(): void {
        // No waiter can be parked here: purge runs between exchanges, and the
        // link's command gate makes those strictly sequential. Emptying the
        // buffer under a parked reader would strand it until its deadline, so if
        // that invariant ever changes this needs a signalWaiter().
        this.buffer = [];
    }

    /**
     * How many received bytes are waiting. Lets a caller tell whether the line
     * has gone quiet (buffer stays empty across a pause) before starting a fresh
     * exchange, rather than purging into a stream that is still arriving.
     */
    bufferedLength(): number {
        return this.buffer.length;
    }

    /** True if the pump has latched an error — most often a serial break. */
    hasReadError(): boolean {
        return this.pumpError !== null;
    }

    /**
     * The latched pump error, WITHOUT clearing it, so a caller can name the
     * cause in its own message.
     *
     * Deliberately non-consuming: clearing the latch here would make
     * hasReadError() report false, and a resync would then purge() instead of
     * recoverRead() — leaving the dead pump unrestarted, which is strictly worse
     * than not looking at all. Only recoverRead/open/reopen clear it.
     */
    peekReadError(): Error | null {
        return this.pumpError;
    }

    /**
     * Restarts the read side after an error latched the pump, without closing
     * the port.
     *
     * A serial break — the K-line held low by an ECU reset or a transient fault
     * — rejects the pump's read() and sets pumpError, after which every readExact
     * throws until the port is reopened. That is why one break used to kill all
     * further communication until a full reconnect.
     *
     * The pump cannot self-heal, and pretending otherwise is the trap: a fresh
     * reader re-latches the same fault, so cycling it every 150 ms is churn, not
     * recovery — the line never gets a quiet stretch long enough to come back.
     * Recovery must be explicit and escalating, which is the caller's job.
     */
    async recoverRead(settleMs = 100): Promise<void> {
        const port = this.port;
        if (!port) throw new Ds2Error('PORT_NOT_OPEN', 'Serial port is not open');
        this.pumpActive = false;
        this.releaseWaiter();
        try {
            await this.reader?.cancel();
        } catch {}
        try {
            this.reader?.releaseLock();
        } catch {}
        await delay(settleMs); // let the break / idle condition settle
        // A break is recoverable; the device physically vanishing is not.
        // Chromium leaves readable null after a fatal NetworkError, and a bare
        // `!` here would surface that as an opaque TypeError — retried by the
        // caller's recovery loop — instead of naming the real cause.
        if (!port.readable) {
            throw new Ds2Error(
                'READ_FAILED',
                'The serial device disconnected — unplug and replug the cable, then reconnect.',
                { kind: 'electrical' },
            );
        }
        this.reader = port.readable.getReader();
        this.buffer = [];
        this.pumpError = null;
        this.pumpActive = true;
        this.startPump();
    }

    /**
     * Reads exactly `length` bytes, waiting up to `timeoutMs`.
     *
     * **Wait for bytes, never for a clock.** The park below is how often we
     * look, not how long we wait — it returns the instant the bytes land.
     * Surplus bytes received alongside are RETAINED for the next call, never
     * dropped: that is what stops an echo and a response arriving in one chunk
     * from desyncing the stream.
     *
     * If you find yourself adding a delay so a response "has time to arrive",
     * the bug is in the wait, not in the timing.
     */
    async readExact(length: number, timeoutMs: number): Promise<Uint8Array> {
        const deadline = Date.now() + timeoutMs;
        while (this.buffer.length < length) {
            // Name the error class: a BreakError/FramingError (recoverable, the
            // signature of a disturbed K-line) and a NetworkError (device gone)
            // otherwise read identically.
            if (this.pumpError) {
                throw new Ds2Error(
                    'READ_FAILED',
                    `Serial read failed: ${this.pumpError.name} (${this.pumpError.message})`,
                    {
                        kind: 'electrical',
                        detail: { errorName: this.pumpError.name },
                        cause: this.pumpError,
                    },
                );
            }
            const remaining = deadline - Date.now();
            if (remaining <= 0) {
                throw new Ds2Error(
                    'READ_TIMEOUT',
                    `Timed out waiting for ${length} byte(s) (received ${this.buffer.length})`,
                    {
                        kind: 'timeout',
                        detail: { expected: length, received: this.buffer.length, timeoutMs },
                    },
                );
            }
            // Park until the pump says the bytes are here, or the deadline
            // passes — whichever first. The loop re-checks afterwards, so a
            // spurious wake costs one comparison.
            //
            // Parked time is measured because it is the honest accounting of
            // "waiting for the wire" versus "us being slow": if parked time is
            // close to the total, the bytes genuinely were not here yet and no
            // host-side change helps.
            this.timing?.parkStart(now());
            await new Promise<void>((resolve) => {
                // The entry is compared by identity below rather than by its
                // callback, so the deadline only ever clears the waiter it
                // actually created — never one a later readExact installed.
                const entry = {
                    need: length,
                    wake: () => {
                        clearTimeout(timer);
                        resolve();
                    },
                };
                const timer = setTimeout(() => {
                    if (this.waiter === entry) this.waiter = null;
                    resolve();
                }, remaining);
                this.waiter = entry;
            });
            this.timing?.parkEnd(now());
        }
        return Uint8Array.from(this.buffer.splice(0, length));
    }
}

function now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

function describeError(e: unknown): string {
    return e instanceof Error ? `${e.name} (${e.message})` : String(e);
}
