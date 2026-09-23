/**
 * A transport decorator that records what actually went over the wire.
 *
 * **Why a decorator, and why at this layer.** The bytes the link writes and the bytes it reads back
 * are the only complete account of a DS2 session. Prose log lines say "read failed"; a telegram
 * trace says which frame, what came back instead, and how long the ECU took before it stopped
 * answering. Sitting between `Ds2Link` and the real transport means it captures BOTH backends
 * identically — a phone's trace and a laptop's trace are comparable because they are produced by
 * the same code.
 *
 * **What it records is what the link saw**, not what the driver received: `readExact` returns bytes
 * as the protocol layer consumes them, so a trace entry boundary is a protocol boundary (echo,
 * header, body). That is the useful framing for reading a failure back.
 *
 * **Retention is bounded and the truncation is stated.** A failed 512 KiB read is thousands of
 * exchanges; keeping all of them would make an upload that never completes on a phone tether. The
 * head is kept because that is where setup goes wrong, and the tail because that is where the run
 * died. `dropped` is carried out with the trace so a reader is never shown a gap that looks like
 * silence on the wire.
 */

import type { Ds2ByteTransport, LinkTiming } from '@tsunagi/ds2-core';

export interface TraceEntry {
    /** Milliseconds since the trace started. Relative on purpose: it is a duration, not a clock. */
    readonly t: number;
    readonly dir: 'tx' | 'rx';
    /** Space-separated lowercase hex, the form every DS2 document in this repo uses. */
    readonly hex: string;
}

export interface TraceSnapshot {
    readonly entries: readonly TraceEntry[];
    /** Entries discarded between head and tail. Zero means the trace is complete. */
    readonly dropped: number;
    readonly txBytes: number;
    readonly rxBytes: number;
    readonly startedAt: number;
}

export interface TracingOptions {
    /** Entries kept from the start of the session. Setup faults live here. */
    readonly head?: number;
    /** Entries kept from the end. A failure lives here. */
    readonly tail?: number;
}

const DEFAULT_HEAD = 200;
const DEFAULT_TAIL = 400;

function toHex(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
        out += (i ? ' ' : '') + bytes[i].toString(16).padStart(2, '0');
    }
    return out;
}

export class TracingTransport implements Ds2ByteTransport {
    private readonly inner: Ds2ByteTransport;
    private readonly headCap: number;
    private readonly tailCap: number;
    private readonly head: TraceEntry[] = [];
    /** A ring, so a long run costs a bounded amount of memory rather than a growing array. */
    private readonly tail: TraceEntry[] = [];
    private tailNext = 0;
    private dropped = 0;
    private txBytes = 0;
    private rxBytes = 0;
    private startedAt = Date.now();
    private origin = 0;

    constructor(inner: Ds2ByteTransport, options: TracingOptions = {}) {
        this.inner = inner;
        this.headCap = options.head ?? DEFAULT_HEAD;
        this.tailCap = options.tail ?? DEFAULT_TAIL;
        this.origin = performance.now();
    }

    private record(dir: 'tx' | 'rx', bytes: Uint8Array): void {
        if (bytes.length === 0) return;
        if (dir === 'tx') this.txBytes += bytes.length; else this.rxBytes += bytes.length;
        const entry: TraceEntry = {
            t: Math.round(performance.now() - this.origin),
            dir,
            hex: toHex(bytes),
        };
        if (this.head.length < this.headCap) { this.head.push(entry); return; }
        if (this.tail.length < this.tailCap) { this.tail.push(entry); return; }
        // The ring is full: the entry being overwritten is the one that gets counted as dropped.
        this.dropped++;
        this.tail[this.tailNext] = entry;
        this.tailNext = (this.tailNext + 1) % this.tailCap;
    }

    /** The trace so far, head first, tail in chronological order. */
    snapshot(): TraceSnapshot {
        const ordered = this.tail.length < this.tailCap
            ? this.tail.slice()
            : [...this.tail.slice(this.tailNext), ...this.tail.slice(0, this.tailNext)];
        return {
            entries: [...this.head, ...ordered],
            dropped: this.dropped,
            txBytes: this.txBytes,
            rxBytes: this.rxBytes,
            startedAt: this.startedAt,
        };
    }

    /** Start a fresh trace. Called when a new operation begins so a report is about one run. */
    reset(): void {
        this.head.length = 0;
        this.tail.length = 0;
        this.tailNext = 0;
        this.dropped = 0;
        this.txBytes = 0;
        this.rxBytes = 0;
        this.startedAt = Date.now();
        this.origin = performance.now();
    }

    async open(): Promise<void> { return this.inner.open(); }
    async close(): Promise<void> { return this.inner.close(); }

    async write(bytes: Uint8Array): Promise<void> {
        this.record('tx', bytes);
        return this.inner.write(bytes);
    }

    async readExact(length: number, timeoutMs: number): Promise<Uint8Array> {
        try {
            const bytes = await this.inner.readExact(length, timeoutMs);
            this.record('rx', bytes);
            return bytes;
        } catch (error) {
            // A failed read is the most informative entry in the whole trace, and it has no bytes.
            // Recording it as a zero-length rx would be dropped by `record`, so it is written here
            // in the one form that survives: the reason, in the position it happened.
            const message = (error as Error).message.replace(/\s+/g, ' ').slice(0, 160);
            const entry: TraceEntry = {
                t: Math.round(performance.now() - this.origin),
                dir: 'rx',
                hex: `!! ${message}`,
            };
            if (this.head.length < this.headCap) this.head.push(entry);
            else if (this.tail.length < this.tailCap) this.tail.push(entry);
            else {
                this.dropped++;
                this.tail[this.tailNext] = entry;
                this.tailNext = (this.tailNext + 1) % this.tailCap;
            }
            throw error;
        }
    }

    purge(): void { this.inner.purge(); }
    bufferedLength(): number { return this.inner.bufferedLength(); }
    hasReadError(): boolean { return this.inner.hasReadError(); }
    peekReadError(): Error | null { return this.inner.peekReadError(); }
    async recoverRead(settleMs?: number): Promise<void> { return this.inner.recoverRead(settleMs); }
    setTiming(timing: LinkTiming | null): void { this.inner.setTiming?.(timing); }
}

/** Render a snapshot as the text form used in the repo's docs and in an uploaded report. */
export function formatTrace(snapshot: TraceSnapshot): string {
    const lines = snapshot.entries.map(e => `${String(e.t).padStart(7)}ms ${e.dir.toUpperCase()} ${e.hex}`);
    if (snapshot.dropped > 0) {
        // Stated in place, not in a footnote: a reader scanning the middle of a trace must not
        // mistake a truncation for a gap on the wire.
        const at = Math.min(snapshot.entries.length, DEFAULT_HEAD);
        lines.splice(at, 0, `        ---- ${snapshot.dropped} entries omitted (head/tail retention) ----`);
    }
    return lines.join('\n');
}
