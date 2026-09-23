import { describe, expect, it } from 'vitest';
import {
    Ds2Address,
    Ds2Control,
    Ds2Status,
    buildDs2Frame,
    describeStatus,
    ds2Checksum,
    frameToBytes,
    isPositiveResponse,
    parseDs2Frame,
    toHex,
} from './frame';
import { Ds2Error } from './errors';

describe('ds2Checksum', () => {
    it('is the XOR of every byte', () => {
        expect(ds2Checksum(new Uint8Array([0x12, 0x05, 0x0b, 0x06]))).toBe(0x12 ^ 0x05 ^ 0x0b ^ 0x06);
    });

    it('is 0 for an empty buffer', () => {
        expect(ds2Checksum(new Uint8Array(0))).toBe(0);
    });

    it('is self-cancelling — XOR of a value with itself is 0', () => {
        expect(ds2Checksum(new Uint8Array([0xab, 0xab]))).toBe(0);
    });

    it('stays within a byte', () => {
        const all = new Uint8Array(256).map((_, i) => i);
        expect(ds2Checksum(all)).toBeLessThanOrEqual(0xff);
    });
});

describe('buildDs2Frame', () => {
    it('builds the documented live-value request 12 05 0B 06 1A', () => {
        // From the reference capture: read I/O status block 6 from the DME.
        // Address 0x12, length 5, control 0x0B, payload [0x06], XOR checksum.
        const frame = buildDs2Frame(Ds2Address.DME, Ds2Control.READ_IO_STATUS, new Uint8Array([0x06]));
        expect(toHex(frame)).toBe('12 05 0b 06 1a');
    });

    it('counts the whole frame in the length byte, including itself and the checksum', () => {
        const frame = buildDs2Frame(Ds2Address.DME, Ds2Control.KEEP_ALIVE);
        expect(frame.length).toBe(4);
        expect(frame[1]).toBe(4);
    });

    it('serves SMG and DSC as well as the DME — the address is a parameter', () => {
        expect(buildDs2Frame(Ds2Address.SMG, Ds2Control.KEEP_ALIVE)[0]).toBe(0x32);
        expect(buildDs2Frame(Ds2Address.DSC, Ds2Control.KEEP_ALIVE)[0]).toBe(0x56);
    });

    it('rejects a payload that would overflow the one-byte length field', () => {
        const tooBig = new Uint8Array(252);
        expect(() => buildDs2Frame(Ds2Address.DME, Ds2Control.WRITE_MEMORY, tooBig)).toThrow(Ds2Error);
        // 251 payload bytes + 4 overhead = 255, the largest legal frame.
        expect(() => buildDs2Frame(Ds2Address.DME, Ds2Control.WRITE_MEMORY, new Uint8Array(251))).not.toThrow();
    });
});

describe('parseDs2Frame', () => {
    it('round-trips a built frame', () => {
        const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
        const bytes = buildDs2Frame(Ds2Address.DME, Ds2Control.READ_MEMORY, payload);
        const frame = parseDs2Frame(bytes);
        expect(frame.address).toBe(Ds2Address.DME);
        expect(frame.length).toBe(8);
        expect(frame.controlOrStatus).toBe(Ds2Control.READ_MEMORY);
        expect(Array.from(frame.payload)).toEqual(Array.from(payload));
        expect(frameToBytes(frame)).toEqual(bytes);
    });

    it('rejects a corrupted checksum', () => {
        const bytes = buildDs2Frame(Ds2Address.DME, Ds2Control.KEEP_ALIVE);
        bytes[bytes.length - 1] ^= 0xff;
        expect(() => parseDs2Frame(bytes)).toThrowError(
            expect.objectContaining({ code: 'CHECKSUM_MISMATCH' }),
        );
    });

    it('rejects a buffer shorter than the minimum frame', () => {
        expect(() => parseDs2Frame(new Uint8Array([0x12, 0x04, 0xa0]))).toThrowError(
            expect.objectContaining({ code: 'FRAME_TOO_SHORT' }),
        );
    });

    // The tuner's parser trusted bytes[1] implicitly. A declared length of 0, 1
    // or 2 sailed through and produced a garbage payload out of
    // subarray(3, length - 1) instead of an error.
    it.each([0, 1, 2, 3])('rejects a declared length of %i', (declared) => {
        const bytes = new Uint8Array([Ds2Address.DME, declared, Ds2Status.ACKNOWLEDGE, 0x00]);
        bytes[3] = ds2Checksum(bytes.subarray(0, 3)); // make the checksum valid, so only the length can fail it
        expect(() => parseDs2Frame(bytes)).toThrowError(
            expect.objectContaining({ code: 'FRAME_LENGTH_INVALID' }),
        );
    });

    it('accepts the smallest legal frame', () => {
        const bytes = buildDs2Frame(Ds2Address.DME, Ds2Status.ACKNOWLEDGE);
        expect(parseDs2Frame(bytes).length).toBe(4);
    });
});

describe('isPositiveResponse', () => {
    it('accepts only ACKNOWLEDGE', () => {
        const frameWith = (status: number) => parseDs2Frame(buildDs2Frame(Ds2Address.DME, status));
        expect(isPositiveResponse(frameWith(Ds2Status.ACKNOWLEDGE))).toBe(true);
        for (const negative of [
            Ds2Status.BUSY,
            Ds2Status.REJECTED,
            Ds2Status.PARAMETER_ERROR,
            Ds2Status.FUNCTION_ERROR,
            Ds2Status.NOT_ACKNOWLEDGE,
        ]) {
            expect(isPositiveResponse(frameWith(negative))).toBe(false);
        }
    });
});

describe('describeStatus', () => {
    it('names PARAMETER_ERROR, the status that proved 19200 baud is unimplemented', () => {
        expect(describeStatus(Ds2Status.PARAMETER_ERROR)).toContain('does not implement');
    });

    it('reports an unknown status with its numeric code rather than swallowing it', () => {
        expect(describeStatus(0x7c)).toBe('unknown status 0x7c');
    });
});
