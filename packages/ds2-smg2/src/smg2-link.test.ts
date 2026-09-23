/**
 * The SMG II read path, driven against a simulated DEVICE.
 *
 * Not a mock link. `WebSerialTransport` and `Ds2Link` are the real classes here; only the serial
 * port is simulated, so echo verification, framing, checksums and retries are genuinely exercised.
 * The assertions are on the TELEGRAM TRACE as well as the outcome — the trace is what proves the
 * chunk constant that was actually used and the order things happened in.
 */

import { describe, expect, it } from 'vitest';

import {
    Ds2Address,
    Ds2Control,
    Ds2Link,
    Ds2Status,
    WebSerialTransport,
    parseDs2Frame,
    simulatedPort,
    type Ds2Frame,
    type SimulatedEcuOptions,
} from '@tsunagi/ds2-core';

import {
    ALLOWED_CONTROLS,
    CALIBRATION_WINDOW,
    FALLBACK_READ_CHUNK,
    FORBIDDEN_CONTROLS,
    IDENTITY_ANCHORS,
} from './layout';
import { assertReadOnly, Smg2ReadError, Smg2ReadLink } from './link';
import { probeAddressSpace, readTwiceAndCompare } from './probe';

/** The reference car, from the recorded capture: ZB 7843260, HW 2F, SW 10. */
const ZB_NUMBER = '7843260';
const TRUE_SEGMENT = 0x00;
const TRUE_BASE = 0x000000;

/**
 * An SMG II with addressable memory.
 *
 * The image is the full 512 KiB, filled with a position-derived pattern so a chunking mistake
 * shows up as wrong data rather than as plausible zeros, and with the identity strings planted at
 * the addresses the definition says they live at.
 */
function makeEcuImage(): Uint8Array {
    const image = new Uint8Array(0x80000);
    for (let i = 0; i < image.length; i++) image[i] = (i * 31 + (i >> 8)) & 0xff;

    const put = (address: number, text: string, length: number) => {
        for (let i = 0; i < length; i++) {
            image[address + i] = i < text.length ? text.charCodeAt(i) : 0x20;
        }
    };
    // Laid out the way the real ECU is, measured in dump `5c5a0c857acd`. The ZB number appears
    // ONLY in the zbBlock anchor — ident0 and ident1 do not contain it. A fixture that put the
    // ZB in ident0 was what let the "the probe can never confirm" defect pass every test.
    put(0x2ff70, '0549T0510510'.repeat(3), 36);
    put(0x2ff94, ZB_NUMBER.repeat(6), 42);
    put(0x2ffbe, '--+', 3);
    put(IDENTITY_ANCHORS.ident0.address, '0549T05105100570'.repeat(3), IDENTITY_ANCHORS.ident0.length);
    put(IDENTITY_ANCHORS.ident1.address, '0.0252.00-HW_622.0.0248.00-PR_622.P.B100.50', IDENTITY_ANCHORS.ident1.length);
    return image;
}

function ecuOptions(image: Uint8Array, extra: Partial<SimulatedEcuOptions> = {}): SimulatedEcuOptions {
    return {
        address: Ds2Address.SMG,
        respond: (request: Ds2Frame) => {
            if (request.controlOrStatus === Ds2Control.READ_MEMORY) {
                const [segment, a2, a1, a0, count] = request.payload;
                const address = (a2 << 16) | (a1 << 8) | a0;
                // Only the true segment decodes; everything else answers "unmapped" as 0xFF,
                // which is what a real decode gap tends to look like.
                if (segment !== TRUE_SEGMENT || address + count > image.length) {
                    return { payload: new Uint8Array(count).fill(0xff) };
                }
                return { payload: image.subarray(address - TRUE_BASE, address - TRUE_BASE + count) };
            }
            if (request.controlOrStatus === 0x53) {
                return { payload: new TextEncoder().encode(`FEP ${ZB_NUMBER}`) };
            }
            return null;
        },
        ...extra,
    };
}

async function connect(options: SimulatedEcuOptions) {
    const { port, requestPort } = simulatedPort(options);
    const transport = new WebSerialTransport({ requestPort });
    const link = new Ds2Link(transport, { address: Ds2Address.SMG, timings: { responseTimeoutMs: 200 } });
    await link.connect();
    return { port, link };
}

describe('read-only guarantee', () => {
    it('holds at load time', () => {
        expect(() => assertReadOnly()).not.toThrow();
    });

    it('keeps every mutating control off the allow list', () => {
        for (const control of FORBIDDEN_CONTROLS.keys()) {
            expect(ALLOWED_CONTROLS.has(control)).toBe(false);
        }
        expect(ALLOWED_CONTROLS.has(Ds2Control.WRITE_MEMORY)).toBe(false);
        expect(ALLOWED_CONTROLS.has(Ds2Control.SET_IO_STATUS)).toBe(false);
        expect(ALLOWED_CONTROLS.has(Ds2Control.CLEAR_ADAPTATIONS)).toBe(false);
    });

    it('refuses to address anything but the gearbox', async () => {
        const { port, requestPort } = simulatedPort({ address: Ds2Address.DME });
        const transport = new WebSerialTransport({ requestPort });
        const dmeLink = new Ds2Link(transport, { address: Ds2Address.DME });
        expect(() => new Smg2ReadLink(dmeLink)).toThrow(/must be 0x32/);
        expect(port.trace).toHaveLength(0);
    });
});

describe('chunked reads', () => {
    it('reads the whole calibration window byte-exactly', async () => {
        const image = makeEcuImage();
        const { port, link } = await connect(ecuOptions(image));
        const smg2 = new Smg2ReadLink(link, { chunkSize: 120 });

        const progress: number[] = [];
        const result = await smg2.readCalibrationWindow(
            TRUE_SEGMENT, TRUE_BASE + CALIBRATION_WINDOW.start, p => progress.push(p.bytesDone));

        expect(result.bytes).toHaveLength(CALIBRATION_WINDOW.length);
        expect(Array.from(result.bytes)).toEqual(
            Array.from(image.subarray(CALIBRATION_WINDOW.start, CALIBRATION_WINDOW.end)));

        // The trace proves the chunk size actually used, which a byte-comparison alone does not:
        // 0x6000 / 120 = 204.8, so 205 telegrams with a 96-byte remainder on the last.
        expect(result.exchanges).toBe(205);
        expect(port.trace).toHaveLength(205);
        expect(progress[progress.length - 1]).toBe(CALIBRATION_WINDOW.length);

        const counts = port.trace.map(t => t.request.payload[4]);
        expect(new Set(counts.slice(0, -1))).toEqual(new Set([120]));
        expect(counts[counts.length - 1]).toBe(0x6000 % 120);

        // Every request is a read. Nothing else reached the device.
        expect(new Set(port.trace.map(t => t.request.controlOrStatus))).toEqual(
            new Set([Ds2Control.READ_MEMORY]));
    });

    it('asks the device for a chunk size instead of assuming one', async () => {
        const image = makeEcuImage();
        // A device that refuses anything over 64 bytes — a limit no constant in this repo knows.
        const { port, link } = await connect({
            address: Ds2Address.SMG,
            respond: (request: Ds2Frame) => {
                const [, a2, a1, a0, count] = request.payload;
                if (count > 64) return { status: Ds2Status.PARAMETER_ERROR ?? 0xb0 };
                const address = (a2 << 16) | (a1 << 8) | a0;
                return { payload: image.subarray(address, address + count) };
            },
        });
        const smg2 = new Smg2ReadLink(link);

        expect(await smg2.negotiateChunkSize(TRUE_SEGMENT, 0x32000)).toBe(64);

        // The trace is what proves it negotiated rather than picked: 120 and 96 were tried and
        // refused before 64 was accepted.
        const tried = port.trace.map(t => t.request.payload[4]);
        expect(tried.slice(0, 3)).toEqual([120, 96, 64]);
    });

    it('falls back to the floor when nothing is accepted, and says so by using it', async () => {
        const { link } = await connect({
            address: Ds2Address.SMG,
            respond: () => ({ status: Ds2Status.PARAMETER_ERROR ?? 0xb0 }),
        });
        const smg2 = new Smg2ReadLink(link);
        expect(await smg2.negotiateChunkSize(TRUE_SEGMENT, 0x32000)).toBe(FALLBACK_READ_CHUNK);
    });

    it('negotiates once and reuses the answer', async () => {
        const image = makeEcuImage();
        const { port, link } = await connect(ecuOptions(image));
        const smg2 = new Smg2ReadLink(link);
        const first = await smg2.negotiateChunkSize(TRUE_SEGMENT, 0x32000);
        const exchangesAfterFirst = port.trace.length;
        expect(await smg2.negotiateChunkSize(TRUE_SEGMENT, 0x32000)).toBe(first);
        expect(port.trace).toHaveLength(exchangesAfterFirst);
    });

    it('walks addresses without gaps or overlaps', async () => {
        const image = makeEcuImage();
        const { port, link } = await connect(ecuOptions(image));
        const smg2 = new Smg2ReadLink(link, { chunkSize: 64 });
        await smg2.readRange(TRUE_SEGMENT, 0x32000, 1000);

        let expected = 0x32000;
        for (const entry of port.trace) {
            const [, a2, a1, a0, count] = entry.request.payload;
            expect((a2 << 16) | (a1 << 8) | a0).toBe(expected);
            expected += count;
        }
        expect(expected).toBe(0x32000 + 1000);
    });

    it('recovers from a dropped telegram and says how many retries it took', async () => {
        const image = makeEcuImage();
        // One silent exchange: the request never landed, so re-sending the same bytes is correct
        // and idempotent. This is the failure class that SHOULD be retried.
        const { link } = await connect(ecuOptions(image, { script: [{ kind: 'silent' }] }));
        const smg2 = new Smg2ReadLink(link, { chunkSize: 64 });

        const result = await smg2.readRange(TRUE_SEGMENT, 0x32000, 256);
        expect(Array.from(result.bytes)).toEqual(Array.from(image.subarray(0x32000, 0x32000 + 256)));
        expect(result.exchanges).toBe(4);
    });

    it('keeps the bytes that did arrive when a long read dies late', async () => {
        // A full-image read is ~4,370 telegrams and roughly 18 minutes. Discarding all of it
        // because the last telegram failed wastes a session for nothing — and the bytes that
        // landed are still bytes off the ECU. They come back marked, never zero-padded to length.
        const image = makeEcuImage();
        const { link } = await connect(ecuOptions(image, {
            script: [
                { kind: 'respond' }, { kind: 'respond' }, { kind: 'respond' },
                { kind: 'dead' }, { kind: 'dead' }, { kind: 'dead' }, { kind: 'dead' },
            ],
        }));
        const smg2 = new Smg2ReadLink(link, { chunkSize: 64 });

        try {
            await smg2.readRange(TRUE_SEGMENT, 0x32000, 1024);
            expect.unreachable('the read should have failed');
        } catch (error) {
            const failure = error as Smg2ReadError;
            expect(failure).toBeInstanceOf(Smg2ReadError);
            expect(failure.partial).toHaveLength(192);
            expect(failure.bytesDone).toBe(192);
            // Exactly the bytes that arrived — not the buffer, which would carry a zero tail that
            // decodes as data.
            expect(Array.from(failure.partial))
                .toEqual(Array.from(image.subarray(0x32000, 0x32000 + 192)));
        }
    }, 20_000);

    it('stops when asked and hands back what arrived', async () => {
        const image = makeEcuImage();
        const { link } = await connect(ecuOptions(image));
        const smg2 = new Smg2ReadLink(link, { chunkSize: 64 });

        // Stop after the third telegram. The read must end at a telegram boundary, not mid-frame,
        // and must return the bytes already in hand rather than nothing.
        let seen = 0;
        try {
            await smg2.readRange(TRUE_SEGMENT, 0x32000, 4096, () => {
                if (++seen === 3) smg2.abort();
            });
            expect.unreachable('the read should have stopped');
        } catch (error) {
            const failure = error as Smg2ReadError;
            expect(failure.cancelled).toBe(true);
            expect(failure.partial).toHaveLength(192);
            expect(Array.from(failure.partial))
                .toEqual(Array.from(image.subarray(0x32000, 0x32000 + 192)));
        }

        // The latch must not survive into the next read. The reference tool records a session
        // lost to exactly this: a stale cancel failed every later operation, including a verify.
        const after = await smg2.readRange(TRUE_SEGMENT, 0x32000, 256);
        expect(after.bytes).toHaveLength(256);
    }, 30_000);

    it('reads the whole 512 KiB image', async () => {
        const image = makeEcuImage();
        const { link } = await connect(ecuOptions(image));
        const smg2 = new Smg2ReadLink(link, { chunkSize: 120 });

        const result = await smg2.readFullImage(TRUE_SEGMENT, 0x000000);
        expect(result.bytes).toHaveLength(0x80000);
        expect(Array.from(result.bytes.subarray(0x32000, 0x32000 + 64)))
            .toEqual(Array.from(image.subarray(0x32000, 0x32000 + 64)));
        // 0x80000 / 120 = 4369.06 -> 4370 telegrams. This is the number that makes it 18 minutes.
        expect(result.exchanges).toBe(4370);
    }, 120_000);

    it('fails a short answer instead of padding it', async () => {
        const image = makeEcuImage();
        const { link } = await connect({
            address: Ds2Address.SMG,
            // A device that answers fewer bytes than asked. Accepting it would shift every
            // subsequent offset and produce a dump that opens and is wrong.
            respond: () => ({ payload: new Uint8Array(4) }),
        });
        const smg2 = new Smg2ReadLink(link, { chunkSize: 64 });
        await expect(smg2.readRange(TRUE_SEGMENT, 0x32000, 256)).rejects.toThrow(/short answer is not a short read/);
        expect(image.length).toBe(0x80000);
    });

    it('reports where a failed read died rather than just failing', async () => {
        const image = makeEcuImage();
        const { link } = await connect(ecuOptions(image, {
            script: [
                { kind: 'respond' }, { kind: 'respond' },
                { kind: 'dead' }, { kind: 'dead' }, { kind: 'dead' }, { kind: 'dead' },
            ],
        }));
        const smg2 = new Smg2ReadLink(link, { chunkSize: 64 });
        try {
            await smg2.readRange(TRUE_SEGMENT, 0x32000, 1024);
            expect.unreachable('the read should have failed');
        } catch (error) {
            expect(error).toBeInstanceOf(Smg2ReadError);
            const failure = error as Smg2ReadError;
            expect(failure.bytesDone).toBe(128);
            expect(failure.message).toMatch(/after 128 bytes/);
        }
    });
});

describe('address-space probe', () => {
    it('confirms from the block that actually holds the ZB number', async () => {
        // The regression this pins is not "the probe scores badly". It is that on a real car,
        // with a correct ZB typed in, `identified` was permanently null: the ZB lives at 0x2FF94
        // and the probe only ever read 0x37715 and 0x37FC0. Practice hid it, because the practice
        // image planted the ZB in ident0 — a simulator kinder than the hardware.
        const image = makeEcuImage();
        const { link } = await connect(ecuOptions(image));
        const smg2 = new Smg2ReadLink(link, { chunkSize: 64 });

        const report = await probeAddressSpace(smg2, { expectedZbNumber: ZB_NUMBER });
        expect(report.confidence).toBe('confirmed');
        expect(report.identified).not.toBeNull();
        expect(report.identified!.segment).toBe(TRUE_SEGMENT);
        expect(report.identified!.baseAddress).toBe(TRUE_BASE);
        expect(report.summary).toMatch(new RegExp(`found the expected ZB number ${ZB_NUMBER}`));
    }, 30_000);

    it('does not claim a confirmation from ident0 and ident1, which do not carry the ZB', async () => {
        // Drop the zbBlock anchor and the same ECU must fall back to `unconfirmed` — proving the
        // confirmation above comes from the new anchor and not from somewhere else in the read.
        const image = makeEcuImage();
        const { link } = await connect(ecuOptions(image));
        const smg2 = new Smg2ReadLink(link, { chunkSize: 64 });

        const report = await probeAddressSpace(smg2, {
            expectedZbNumber: ZB_NUMBER, anchors: ['ident0', 'ident1'],
        });
        expect(report.confidence).toBe('unconfirmed');
        expect(report.identified).toBeNull();
        expect(report.best).not.toBeNull();
        expect(report.best!.segment).toBe(TRUE_SEGMENT);
    }, 30_000);

    it('identifies the segment and base from the identity anchors alone', async () => {
        const image = makeEcuImage();
        const { port, link } = await connect(ecuOptions(image));
        const smg2 = new Smg2ReadLink(link);

        const report = await probeAddressSpace(smg2, { expectedZbNumber: ZB_NUMBER });

        expect(report.identified).toEqual({ segment: TRUE_SEGMENT, baseAddress: TRUE_BASE });
        expect(report.summary).toMatch(/found the expected ZB number 7843260/);

        // Exactly one candidate may score strongly; if two did, the probe must refuse to choose.
        expect(report.candidates.filter(c => c.score >= 0.75)).toHaveLength(1);

        // The whole probe is small reads. Nothing else was sent.
        expect(new Set(port.trace.map(t => t.request.controlOrStatus))).toEqual(
            new Set([Ds2Control.READ_MEMORY]));
        expect(port.trace.every(t => t.request.payload[4] <= 60)).toBe(true);
    });

    it('still yields a usable address space when no ZB number is supplied', async () => {
        // THE regression. Without a ZB number to match, scoring caps at 0.6 against a 0.75
        // threshold, so `identified` is null on every real vehicle. An earlier build gated the
        // READ face on `identified`, which made the app unable to read a car at all while passing
        // every practice run — because practice supplied the number internally.
        //
        // A read is read-only and harmless. Certainty is worth REPORTING, not worth blocking on.
        const image = makeEcuImage();
        const { link } = await connect(ecuOptions(image));
        const smg2 = new Smg2ReadLink(link);

        const report = await probeAddressSpace(smg2); // no expectedZbNumber, as on a real car

        expect(report.identified).toBeNull();
        expect(report.best).toEqual({ segment: TRUE_SEGMENT, baseAddress: TRUE_BASE });
        expect(report.confidence).toBe('unconfirmed');
        expect(report.summary).toMatch(/Reading from it is safe/);
    });

    it('reports ambiguity instead of picking one', async () => {
        const image = makeEcuImage();
        // A device that aliases every segment onto the same memory: two candidates now look
        // equally right, and "equally right" must not be laundered into an answer.
        const { link } = await connect({
            address: Ds2Address.SMG,
            respond: (request: Ds2Frame) => {
                const [, a2, a1, a0, count] = request.payload;
                const address = (a2 << 16) | (a1 << 8) | a0;
                if (address + count > image.length) return { payload: new Uint8Array(count).fill(0xff) };
                return { payload: image.subarray(address, address + count) };
            },
        });
        const smg2 = new Smg2ReadLink(link);
        const report = await probeAddressSpace(smg2, {
            expectedZbNumber: ZB_NUMBER,
            segments: [0x00, 0x01],
            bases: [0x000000],
        });
        expect(report.identified).toBeNull();
        expect(report.summary).toMatch(/Ambiguous/);
    });

    it('finds nothing when nothing is there, and says so', async () => {
        const { link } = await connect({
            address: Ds2Address.SMG,
            respond: (request: Ds2Frame) => ({ payload: new Uint8Array(request.payload[4]).fill(0xff) }),
        });
        const smg2 = new Smg2ReadLink(link);
        const report = await probeAddressSpace(smg2, { expectedZbNumber: ZB_NUMBER });
        expect(report.identified).toBeNull();
        expect(report.best).toBeNull();
        expect(report.confidence).toBe('none');
        expect(report.summary).toMatch(/Nothing answered with data/);
    });
});

describe('read twice and compare', () => {
    it('passes on a stable device', async () => {
        const image = makeEcuImage();
        const { link } = await connect(ecuOptions(image));
        const smg2 = new Smg2ReadLink(link, { chunkSize: 120 });
        const check = await readTwiceAndCompare(smg2, TRUE_SEGMENT, 0x32000, 512);
        expect(check.identical).toBe(true);
        expect(check.firstDifference).toBeNull();
    });

    it('catches a device that answers differently the second time', async () => {
        const image = makeEcuImage();
        let call = 0;
        const { link } = await connect({
            address: Ds2Address.SMG,
            respond: (request: Ds2Frame) => {
                const [, a2, a1, a0, count] = request.payload;
                const address = (a2 << 16) | (a1 << 8) | a0;
                const slice = Uint8Array.from(image.subarray(address, address + count));
                // Flip one byte once the second pass has started.
                if (call++ >= 5) slice[0] ^= 0xff;
                return { payload: slice };
            },
        });
        const smg2 = new Smg2ReadLink(link, { chunkSize: 120 });
        const check = await readTwiceAndCompare(smg2, TRUE_SEGMENT, 0x32000, 512);
        expect(check.identical).toBe(false);
        expect(check.firstDifference).not.toBeNull();
    });
});

describe('manufacturer data', () => {
    it('is returned raw', async () => {
        const image = makeEcuImage();
        const { port, link } = await connect(ecuOptions(image));
        const smg2 = new Smg2ReadLink(link);
        const data = await smg2.readManufacturerData();
        expect(new TextDecoder().decode(data)).toContain(ZB_NUMBER);
        expect(port.trace[0].request.controlOrStatus).toBe(0x53);
    });

    it('surfaces a negative response instead of returning empty bytes', async () => {
        const { link } = await connect({
            address: Ds2Address.SMG,
            respond: () => ({ status: Ds2Status.PARAMETER_ERROR ?? 0xb0 }),
        });
        const smg2 = new Smg2ReadLink(link);
        await expect(smg2.readManufacturerData()).rejects.toThrow(/answered DS2 status/);
    });
});

describe('the guard leaves no trace', () => {
    it('sends nothing when a forbidden control is attempted', async () => {
        const image = makeEcuImage();
        const { port, link } = await connect(ecuOptions(image));
        const smg2 = new Smg2ReadLink(link);
        // Reach past the public surface on purpose: the point is that the refusal happens before
        // any byte is composed, not that no public method offers it.
        const send = (smg2 as unknown as {
            send: (control: number, payload?: Uint8Array) => Promise<Ds2Frame>;
        }).send.bind(smg2);

        await expect(send(Ds2Control.WRITE_MEMORY, new Uint8Array([2, 0, 0, 0, 0]))).rejects
            .toThrow(/no write path/);
        await expect(send(Ds2Control.CLEAR_ADAPTATIONS, new Uint8Array([0x80]))).rejects
            .toThrow(/no write path/);
        expect(port.trace).toHaveLength(0);
    });

    it('parses its own frames the way the device does, so the trace assertions mean something', async () => {
        const image = makeEcuImage();
        const { port, link } = await connect(ecuOptions(image));
        const smg2 = new Smg2ReadLink(link, { chunkSize: 33 });
        await smg2.readRange(TRUE_SEGMENT, 0x000000, 33);
        // The SGBD's own SPEICHER_LESEN template is `32 09 06 01 00 00 00 21 1d` — same shape,
        // count 0x21 = 33. Ours differs only in the segment byte, which is what the probe settles.
        const bytes = Array.from(port.trace[0].bytes);
        expect(bytes.slice(0, 3)).toEqual([0x32, 0x09, 0x06]);
        expect(bytes[7]).toBe(0x21);
        expect(parseDs2Frame(Uint8Array.from(bytes))!.payload[4]).toBe(33);
    });
});
