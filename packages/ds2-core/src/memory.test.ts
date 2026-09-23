import { describe, expect, it } from 'vitest';
import {
    DS2_MAX_WRITE_COUNT,
    buildReadMemoryPayload,
    buildWriteMemoryPayload,
    describeVerifyByte,
    isVerifyByteOk,
    parseWriteResult,
} from './memory';
import { Ds2Address, Ds2Control, Ds2Status, buildDs2Frame, parseDs2Frame, toHex } from './frame';

describe('buildReadMemoryPayload', () => {
    it('lays out [segment, addr24 big-endian, count]', () => {
        expect(toHex(buildReadMemoryPayload(0, 0xa02000, 122))).toBe('00 a0 20 00 7a');
    });

    it('masks the address to 24 bits', () => {
        expect(toHex(buildReadMemoryPayload(6, 0xffa02000, 1))).toBe('06 a0 20 00 01');
    });
});

describe('buildWriteMemoryPayload', () => {
    it('lays out [segment, addr24, count, data...]', () => {
        const data = new Uint8Array([0xaa, 0xbb]);
        expect(toHex(buildWriteMemoryPayload(2, 0x200000, data))).toBe('02 20 00 00 02 aa bb');
    });

    it('accepts exactly the cap', () => {
        expect(() =>
            buildWriteMemoryPayload(2, 0x200000, new Uint8Array(DS2_MAX_WRITE_COUNT)),
        ).not.toThrow();
    });

    it('refuses one byte over the cap', () => {
        // This guard is the last line of defence on a path that erases before it
        // writes, so it must be an error rather than a truncation.
        expect(() =>
            buildWriteMemoryPayload(2, 0x200000, new Uint8Array(DS2_MAX_WRITE_COUNT + 1)),
        ).toThrowError(expect.objectContaining({ code: 'WRITE_COUNT_TOO_LARGE' }));
    });
});

describe('parseWriteResult', () => {
    const positiveWith = (payload: number[]) =>
        parseDs2Frame(buildDs2Frame(Ds2Address.DME, Ds2Status.ACKNOWLEDGE, new Uint8Array(payload)));

    it('parses a full write response', () => {
        const r = parseWriteResult(positiveWith([0x02, 0x20, 0x00, 0x7a, 0x7a, 0x01]));
        expect(r).toEqual({
            segment: 0x02,
            nextAddress24: 0x20007a,
            writtenCount: 0x7a,
            verifyByte: 0x01,
        });
    });

    it('returns null for an empty payload — erase and finalize legitimately ack with nothing', () => {
        // Treating this as a truncated frame would fail a control command that
        // actually succeeded.
        expect(parseWriteResult(positiveWith([]))).toBeNull();
    });

    it('throws on a non-empty payload shorter than 6 bytes', () => {
        expect(() => parseWriteResult(positiveWith([0x02, 0x20, 0x00]))).toThrowError(
            expect.objectContaining({ code: 'PAYLOAD_TOO_SHORT' }),
        );
    });
});

describe('verify bytes', () => {
    it('treats only 1 as success', () => {
        expect(isVerifyByteOk(1)).toBe(true);
        for (const b of [0, 2, 3, 4, 15, 255]) expect(isVerifyByteOk(b)).toBe(false);
    });

    it('names the semantic failures that must never be retried', () => {
        // Re-sending after either of these papers over failing hardware and
        // reports success.
        expect(describeVerifyByte(2)).toBe('verify failed');
        expect(describeVerifyByte(3)).toBe('cells were not erased before programming attempt');
    });

    it('reports an unknown verify byte with its numeric value', () => {
        expect(describeVerifyByte(0x2a)).toBe('unknown verify byte 0x2a');
    });
});

describe('read and write payload shapes are independent', () => {
    it('lets a read count exceed the write cap', () => {
        // Reads are bounded by framing alone; writes additionally need an even
        // length at an even address. Sharing one constant between them is a
        // latent brick, so a read must not inherit the write cap.
        expect(() => buildReadMemoryPayload(0, 0, 200)).not.toThrow();
        expect(buildReadMemoryPayload(0, 0, 200)[4]).toBe(200);
        expect(() => buildWriteMemoryPayload(2, 0, new Uint8Array(200))).toThrow();
    });
});

describe('a write telegram fits inside a DS2 frame at the cap', () => {
    it('builds a legal frame with the maximum write count', () => {
        const payload = buildWriteMemoryPayload(2, 0x200000, new Uint8Array(DS2_MAX_WRITE_COUNT));
        const frame = buildDs2Frame(Ds2Address.DME, Ds2Control.WRITE_MEMORY, payload);
        expect(frame.length).toBe(4 + 5 + DS2_MAX_WRITE_COUNT);
        expect(frame[1]).toBe(frame.length);
        expect(() => parseDs2Frame(frame)).not.toThrow();
    });
});
