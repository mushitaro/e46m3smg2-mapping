import { describe, expect, it } from 'vitest';
import {
    DS2_ALREADY_UNLOCKED_LENGTH,
    DS2_DEFAULT_ACCESS_LEVEL,
    DS2_SEED_FRAME_LENGTH,
    buildKeyPayload,
    buildSeedRequestPayload,
    calculateLoginKey,
    isAlreadyUnlockedResponse,
    isSeedResponse,
} from './login';
import { Ds2Address, Ds2Status, buildDs2Frame, parseDs2Frame, toHex } from './frame';

/**
 * Builds a 46-byte seed frame with known bytes at the four offset triples the
 * algorithm reads, so the expected key can be computed by hand rather than
 * snapshotted. A snapshot would only detect change; this detects wrongness.
 */
function seedFrame(lengthByte = DS2_SEED_FRAME_LENGTH, byteZero = 0x00): Uint8Array {
    const f = new Uint8Array(DS2_SEED_FRAME_LENGTH);
    f[0] = byteZero;
    f[1] = lengthByte;
    f[5] = 0x10;
    f[6] = 0x01;
    f[7] = 0xff;
    f[8] = 0x80;
    f[18] = 0x20;
    f[19] = 0x02;
    f[20] = 0xff;
    f[21] = 0x80;
    f[41] = 0x30;
    f[42] = 0x03;
    f[43] = 0xff;
    f[44] = 0x01;
    return f;
}

describe('calculateLoginKey', () => {
    it('matches a hand-computed key', () => {
        // key = 0; for i in 0..3: idx = (level + i) % frame[1];
        //       term = frame[idx] + frame[18+i] + frame[41+i]; key = key<<8 | term&0xFF
        //   i=0 idx=5 -> 0x10+0x20+0x30 = 0x60
        //   i=1 idx=6 -> 0x01+0x02+0x03 = 0x06
        //   i=2 idx=7 -> 0xFF+0xFF+0xFF = 0x2FD -> 0xFD   (the & 0xFF matters)
        //   i=3 idx=8 -> 0x80+0x80+0x01 = 0x101 -> 0x01   (and again)
        expect(calculateLoginKey(DS2_DEFAULT_ACCESS_LEVEL, seedFrame())).toBe(0x6006fd01);
    });

    it('uses the LENGTH byte as the modulus, not the array length', () => {
        // frame[1] is the modulus. With a length byte of 8 the fourth index
        // wraps to 0 instead of reading offset 8, so byte 0 enters the key.
        //   i=3 idx=(5+3)%8=0 -> 0x11 + 0x80 + 0x01 = 0x92
        expect(calculateLoginKey(DS2_DEFAULT_ACCESS_LEVEL, seedFrame(8, 0x11))).toBe(0x6006fd92);
    });

    it('changes with the access level', () => {
        const f = seedFrame();
        expect(calculateLoginKey(6, f)).not.toBe(calculateLoginKey(5, f));
    });

    it('always returns an unsigned 32-bit value', () => {
        // The high bit set would make a plain << produce a negative number; the
        // >>> 0 in the implementation is what keeps this true.
        const f = seedFrame();
        f[5] = 0xff;
        f[18] = 0xff;
        f[41] = 0xff; // first term -> 0xFD, high bit set
        const key = calculateLoginKey(DS2_DEFAULT_ACCESS_LEVEL, f);
        expect(key).toBeGreaterThan(0);
        expect(Number.isInteger(key)).toBe(true);
        expect(key).toBeLessThanOrEqual(0xffffffff);
    });

    it('refuses anything that is not a 46-byte frame', () => {
        // Passing the payload instead of the whole frame produces a
        // plausible-looking wrong key, so this has to be a hard error.
        expect(() => calculateLoginKey(5, new Uint8Array(42))).toThrowError(
            expect.objectContaining({ code: 'SEED_LENGTH_INVALID' }),
        );
    });
});

describe('buildSeedRequestPayload', () => {
    it('is ASCII "BMW" followed by the access level', () => {
        expect(toHex(buildSeedRequestPayload(5))).toBe('42 4d 57 05');
        expect(toHex(buildSeedRequestPayload(3))).toBe('42 4d 57 03');
    });

    it('defaults to the access level proven on a real DME', () => {
        expect(buildSeedRequestPayload()[3]).toBe(DS2_DEFAULT_ACCESS_LEVEL);
    });
});

describe('buildKeyPayload', () => {
    it('serialises the key big-endian', () => {
        expect(toHex(buildKeyPayload(0x6006fd01))).toBe('60 06 fd 01');
    });

    it('handles a key with the high bit set', () => {
        expect(toHex(buildKeyPayload(0xdeadbeef))).toBe('de ad be ef');
    });
});

describe('login response shapes', () => {
    const positiveOfLength = (length: number) =>
        parseDs2Frame(
            buildDs2Frame(Ds2Address.DME, Ds2Status.ACKNOWLEDGE, new Uint8Array(length - 4)),
        );

    it('reads a 5-byte positive response as already unlocked', () => {
        const frame = positiveOfLength(DS2_ALREADY_UNLOCKED_LENGTH);
        expect(isAlreadyUnlockedResponse(frame)).toBe(true);
        expect(isSeedResponse(frame)).toBe(false);
    });

    it('reads a 46-byte positive response as a seed', () => {
        const frame = positiveOfLength(DS2_SEED_FRAME_LENGTH);
        expect(isSeedResponse(frame)).toBe(true);
        expect(isAlreadyUnlockedResponse(frame)).toBe(false);
    });

    it('treats a negative response as neither', () => {
        const rejected = parseDs2Frame(
            buildDs2Frame(Ds2Address.DME, Ds2Status.REJECTED, new Uint8Array(42)),
        );
        expect(isSeedResponse(rejected)).toBe(false);
        expect(isAlreadyUnlockedResponse(rejected)).toBe(false);
    });
});
