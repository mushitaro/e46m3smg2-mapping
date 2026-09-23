/**
 * The SMG II link: identity, block length, and chunked memory reads.
 *
 * This class can only read. The guard that makes that true is `assertReadOnly()` at the bottom of
 * this file, which runs at MODULE SCOPE — adding a write control to `ALLOWED_CONTROLS`, or
 * removing one from `FORBIDDEN_CONTROLS`, fails the build rather than throwing on a car. A
 * constant that is only checked when it is used gets checked after the erase.
 *
 * Retry policy follows the rule the reference stack learned the hard way: **retry the transport
 * failure, never the semantic one.** Concretely, `exchangeWithRetry` handles timeouts and echo
 * faults, and every check on what came back happens OUTSIDE that call. A read is idempotent so
 * re-sending it is correct; nothing here is not.
 */

import {
    buildReadMemoryPayload,
    Ds2Control,
    Ds2Link,
    isPositiveResponse,
    type Ds2Frame,
} from '@tsunagi/ds2-core';

import {
    ALLOWED_CONTROLS,
    CALIBRATION_WINDOW,
    FALLBACK_READ_CHUNK,
    FULL_IMAGE,
    FORBIDDEN_CONTROLS,
    READ_CHUNK_CANDIDATES,
    SMG2_ADDRESS,
} from './layout';

export interface Smg2Identity {
    /** BMW Zusammenbaunummer, e.g. "7843260". */
    readonly zbNumber: string;
    readonly hardwareNumber: string;
    readonly softwareNumber: string;
    /** The raw response, kept because a parse we get wrong should not destroy the evidence. */
    readonly rawIdent: Uint8Array;
    readonly rawManufacturerData: Uint8Array | null;
}

export interface ReadProgress {
    readonly bytesDone: number;
    readonly bytesTotal: number;
    readonly exchanges: number;
    readonly retries: number;
    /**
     * Milliseconds since this read started.
     *
     * Here so the caller can report a rate and a finish time it MEASURED. A full image is roughly
     * 4,370 telegrams; the theoretical 9600 figure is a fine thing to write in a document and a
     * bad thing to put on screen while somebody sits in a car deciding whether to keep waiting.
     */
    readonly elapsedMs: number;
}

export interface ReadResult {
    readonly bytes: Uint8Array;
    /** Where the read started in the ECU's own address space. */
    readonly baseAddress: number;
    readonly segment: number;
    readonly chunkSize: number;
    readonly exchanges: number;
    readonly retries: number;
    readonly elapsedMs: number;
}

/**
 * A failure that says what actually happened, because "the read failed" is not a report.
 *
 * A read that died at chunk 300 of 205 tells you something about the ECU or the cable; a bare
 * rejection tells you nothing and invites a blind retry.
 */
export class Smg2ReadError extends Error {
    readonly bytesDone: number;
    readonly exchanges: number;
    readonly retries: number;
    /**
     * What HAD been read when it died.
     *
     * A full-image read is roughly 18 minutes. Throwing away 90% of it because the last telegram
     * failed turns a recoverable session into a wasted one — and the bytes that did arrive are
     * still bytes off the ECU. The caller decides whether a partial image is useful; this class
     * only refuses to destroy it.
     */
    readonly partial: Uint8Array;
    /**
     * True when the caller stopped this read, false when the ECU or the cable did.
     *
     * Carried as a flag rather than left for the caller to match on the sentence: "the operator
     * pressed stop" and "the ECU went quiet" are different events, and only one of them is a
     * fault worth showing in red or reporting as a diagnostic.
     */
    readonly cancelled: boolean;
    constructor(
        message: string,
        progress: {
            bytesDone: number; exchanges: number; retries: number;
            partial?: Uint8Array; cancelled?: boolean;
        },
    ) {
        super(`${message} (after ${progress.bytesDone} bytes / ${progress.exchanges} exchanges, ` +
            `${progress.retries} retr${progress.retries === 1 ? 'y' : 'ies'})`);
        this.name = 'Smg2ReadError';
        this.bytesDone = progress.bytesDone;
        this.exchanges = progress.exchanges;
        this.retries = progress.retries;
        this.partial = progress.partial ?? new Uint8Array(0);
        this.cancelled = progress.cancelled ?? false;
    }
}

export interface Smg2LinkOptions {
    /** Override the read chunk. Normally left alone: the ECU is asked instead. */
    readonly chunkSize?: number;
    /** Called before each request so the caller can time or trace it. */
    readonly onExchange?: (control: number, payloadLength: number) => void;
}

export class Smg2ReadLink {
    private readonly link: Ds2Link;
    private readonly options: Smg2LinkOptions;
    /** null until the ECU has answered; never guessed from a constant. */
    private negotiatedChunk: number | null = null;
    /**
     * Latched by `abort()`, cleared at the start of every read.
     *
     * The clearing is not tidiness. The reference tool records a bug where this latch stayed set
     * after a cancel, so every later operation in the session failed immediately with "cancelled"
     * — including a verify pass, which then reported a write as unverified. A latch that is only
     * ever set is a trap for the operation after the one it was meant for.
     */
    private aborted = false;

    constructor(link: Ds2Link, options: Smg2LinkOptions = {}) {
        if (link.address !== SMG2_ADDRESS) {
            throw new Error(
                `Smg2ReadLink was given a link addressed to 0x${link.address.toString(16)}; ` +
                `it must be 0x${SMG2_ADDRESS.toString(16)} (SMG II). Talking to the DME with the ` +
                `gearbox's memory map would read the wrong bytes and call them a gearbox dump.`);
        }
        this.link = link;
        this.options = options;
    }

    /**
     * Stop the read in progress at the next chunk boundary.
     *
     * Safe at any time; a stop with nothing running is discarded by the next read's clear. The
     * read rejects with a cancelled `Smg2ReadError` carrying the bytes that did arrive, so
     * stopping an eighteen-minute dump at minute ten hands back ten minutes of flash rather than
     * nothing. Stopping between telegrams is safe here for a reason that will not survive into a
     * write path: a read leaves no state in the ECU to be half-finished.
     */
    abort(): void {
        this.aborted = true;
    }

    /** What the ECU agreed to, or null if it has not been asked yet. Never a guess. */
    get chunkSize(): number | null {
        return this.negotiatedChunk;
    }

    /** The one place a control byte reaches the wire. Everything below goes through it. */
    private async send(control: number, payload: Uint8Array = new Uint8Array(0), attempts = 3): Promise<Ds2Frame> {
        const forbidden = FORBIDDEN_CONTROLS.get(control);
        if (forbidden) {
            throw new Error(`refusing to send ${forbidden}: this tool has no write path`);
        }
        if (!ALLOWED_CONTROLS.has(control)) {
            throw new Error(`control 0x${control.toString(16)} is not on the SMG II read-only allow list`);
        }
        this.options.onExchange?.(control, payload.length);
        return this.link.exchangeWithRetry(control, payload, { attempts, tolerateBusy: true });
    }

    /**
     * Establish how long a read this ECU will actually answer, by asking it.
     *
     * BMW's own `FLASH_LESEN` job uses 120 and the reference DME tool defaults to 122, but both
     * are facts about other software. The SGBD does publish a `BLOCKLAENGE_MAX` job — except that
     * job is itself a memory read at an address patched in at run time, which is one of the very
     * things the probe has to settle. So it cannot be the first question.
     *
     * What can be asked without knowing anything: try the largest candidate and see whether a
     * full-length answer comes back. A read is idempotent and non-destructive, so probing costs
     * one exchange per candidate and nothing else. The first size that answers in full wins.
     *
     * This matters for more than tidiness. At the 32-byte floor a 24 KiB window is 768 telegrams
     * per pass; at 120 it is 205. Two passes at 9600 is the difference between about two minutes
     * and about eight.
     */
    async negotiateChunkSize(segment: number, probeAddress: number): Promise<number> {
        if (this.options.chunkSize !== undefined) {
            this.negotiatedChunk = this.options.chunkSize;
            return this.negotiatedChunk;
        }
        if (this.negotiatedChunk !== null) return this.negotiatedChunk;

        for (const candidate of READ_CHUNK_CANDIDATES) {
            try {
                const payload = await this.readBlock(segment, probeAddress, candidate);
                if (payload.length === candidate) {
                    this.negotiatedChunk = candidate;
                    return candidate;
                }
            } catch {
                // A refusal or a short answer at this size is information, not a failure: it means
                // try smaller. Only running out of candidates is a failure, and the floor is small
                // enough that an ECU refusing it has a different problem.
            }
        }

        this.negotiatedChunk = FALLBACK_READ_CHUNK;
        return this.negotiatedChunk;
    }

    /** One read-memory exchange. Returns the payload bytes, or throws with what came back. */
    async readBlock(segment: number, address: number, count: number): Promise<Uint8Array> {
        const frame = await this.send(
            Ds2Control.READ_MEMORY, buildReadMemoryPayload(segment, address, count));

        // Validation lives here, outside the retry. A negative response means the ECU received
        // the request and declined it; re-sending would paper over that and report success.
        if (!isPositiveResponse(frame)) {
            throw new Error(
                `read of ${count} byte(s) at segment 0x${segment.toString(16)} ` +
                `address 0x${address.toString(16)} answered DS2 status ` +
                `0x${frame.controlOrStatus.toString(16)}`);
        }
        if (frame.payload.length !== count) {
            throw new Error(
                `asked for ${count} byte(s) and got ${frame.payload.length}. A short answer is not a ` +
                `short read: the offsets after it would be wrong and the dump would look complete.`);
        }
        return frame.payload;
    }

    /**
     * Read a contiguous range, chunked.
     *
     * The whole range is read into one buffer and only returned if every chunk landed. A partial
     * dump that is silently padded is the worst possible artifact — it opens, it looks like a
     * calibration, and the parts that were never read decode as zeros.
     */
    async readRange(
        segment: number,
        baseAddress: number,
        length: number,
        onProgress?: (p: ReadProgress) => void,
    ): Promise<ReadResult> {
        // Every read starts un-cancelled, and this is the only place that says so.
        this.aborted = false;
        const chunkSize = this.negotiatedChunk ?? await this.negotiateChunkSize(segment, baseAddress);
        const bytes = new Uint8Array(length);
        const startedAt = Date.now();

        let bytesDone = 0;
        let exchanges = 0;
        let retries = 0;

        while (bytesDone < length) {
            if (this.aborted) {
                throw new Smg2ReadError('read stopped by the operator', {
                    bytesDone, exchanges, retries,
                    partial: bytes.slice(0, bytesDone), cancelled: true,
                });
            }
            const count = Math.min(chunkSize, length - bytesDone);
            const before = exchanges;
            try {
                const payload = await this.readBlock(segment, baseAddress + bytesDone, count);
                bytes.set(payload, bytesDone);
            } catch (error) {
                throw new Smg2ReadError((error as Error).message, {
                    bytesDone, exchanges, retries,
                    // Only what actually landed. Handing back the zero-filled tail would be an
                    // image that opens and is silently wrong past the failure point.
                    partial: bytes.slice(0, bytesDone),
                });
            }
            exchanges++;
            retries += Math.max(0, exchanges - before - 1);
            bytesDone += count;
            onProgress?.({
                bytesDone, bytesTotal: length, exchanges, retries,
                elapsedMs: Date.now() - startedAt,
            });
        }

        return {
            bytes,
            baseAddress,
            segment,
            chunkSize,
            exchanges,
            retries,
            elapsedMs: Date.now() - startedAt,
        };
    }

    /** The calibration window the MS4X definition describes, at a probed segment and base. */
    async readCalibrationWindow(
        segment: number,
        windowBase: number,
        onProgress?: (p: ReadProgress) => void,
    ): Promise<ReadResult> {
        return this.readRange(segment, windowBase, CALIBRATION_WINDOW.length, onProgress);
    }

    /**
     * The whole 512 KiB flash.
     *
     * `imageBase` is the base the probe established — the same one the window read uses, without
     * the window offset. The program area is what makes this worth 18 minutes: it holds the code
     * that indexes the calibration tables, and the range the stored checksum actually covers.
     */
    async readFullImage(
        segment: number,
        imageBase: number,
        onProgress?: (p: ReadProgress) => void,
    ): Promise<ReadResult> {
        return this.readRange(segment, imageBase, FULL_IMAGE.length, onProgress);
    }

    /**
     * Manufacturer data (DS2 0x53). Returns the raw frame payload.
     *
     * The SGBD describes this as returning the FEP area start plus the addresses of the BMW
     * assembly number, the Siemens hardware number, the SG software number and the serial. Those
     * addresses are the cheapest independent check on any address-space theory, which is why this
     * is read before anything else and kept raw.
     */
    async readManufacturerData(): Promise<Uint8Array> {
        const frame = await this.send(0x53);
        if (!isPositiveResponse(frame)) {
            throw new Error(`manufacturer data read answered DS2 status 0x${frame.controlOrStatus.toString(16)}`);
        }
        return frame.payload;
    }
}

/**
 * Load-time invariant.
 *
 * Proving it fires is part of owning it: set `ALLOWED_CONTROLS` to include `Ds2Control.WRITE_MEMORY`,
 * confirm `npm run build` fails with the message below, then put it back. An unproven guard is
 * decoration.
 */
function assertReadOnly(): void {
    for (const [control, name] of FORBIDDEN_CONTROLS) {
        if (ALLOWED_CONTROLS.has(control)) {
            throw new Error(
                `@tsunagi/ds2-smg2 is a READ-ONLY package and ${name} is on its allow list. ` +
                `This ECU has no bench recovery route available here; a failed erase means ` +
                `replacing it. Remove the control, or move this package to one that owns a ` +
                `verified write path.`);
        }
    }
    if (ALLOWED_CONTROLS.has(Ds2Control.WRITE_MEMORY)) {
        throw new Error('@tsunagi/ds2-smg2 must never allow WRITE_MEMORY (0x07)');
    }
}

assertReadOnly();

export { assertReadOnly };
