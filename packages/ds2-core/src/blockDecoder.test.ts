import { describe, expect, it } from 'vitest';
import {
    byteLength,
    decodeField,
    minPayloadLength,
    readRaw,
    type FieldDef,
} from './blockDecoder';

describe('byteLength', () => {
    it('sizes every format', () => {
        expect(byteLength('int7')).toBe(1);
        expect(byteLength('uint8')).toBe(1);
        expect(byteLength('uint10')).toBe(2);
        expect(byteLength('int15')).toBe(2);
        expect(byteLength('uint16')).toBe(2);
        expect(byteLength('int31')).toBe(4);
        expect(byteLength('uint32')).toBe(4);
    });
});

describe('readRaw', () => {
    it('sign-extends int7 (which is really an int8)', () => {
        expect(readRaw(new Uint8Array([0x7f]), 'int7')).toBe(127);
        expect(readRaw(new Uint8Array([0x80]), 'int7')).toBe(-128);
        expect(readRaw(new Uint8Array([0xff]), 'int7')).toBe(-1);
    });

    it('reads uint8 unsigned', () => {
        expect(readRaw(new Uint8Array([0xff]), 'uint8')).toBe(255);
    });

    it('reads 16-bit values big-endian', () => {
        expect(readRaw(new Uint8Array([0x12, 0x34]), 'uint16')).toBe(0x1234);
        expect(readRaw(new Uint8Array([0x12, 0x34]), 'uint10')).toBe(0x1234);
    });

    it('sign-extends int15 (which is really an int16)', () => {
        expect(readRaw(new Uint8Array([0x7f, 0xff]), 'int15')).toBe(32767);
        expect(readRaw(new Uint8Array([0x80, 0x00]), 'int15')).toBe(-32768);
        expect(readRaw(new Uint8Array([0xff, 0xff]), 'int15')).toBe(-1);
    });

    it('reads uint32 unsigned — the >>> 0 is load-bearing', () => {
        expect(readRaw(new Uint8Array([0xff, 0xff, 0xff, 0xff]), 'uint32')).toBe(4294967295);
        expect(readRaw(new Uint8Array([0x80, 0x00, 0x00, 0x00]), 'uint32')).toBe(2147483648);
    });

    it('reads int31 signed', () => {
        expect(readRaw(new Uint8Array([0xff, 0xff, 0xff, 0xff]), 'int31')).toBe(-1);
        expect(readRaw(new Uint8Array([0x80, 0x00, 0x00, 0x00]), 'int31')).toBe(-2147483648);
    });
});

describe('decodeField', () => {
    // The MSS54 standard measurement block: RPM at offset 0, coolant at 11.
    const rpm: FieldDef = { symbol: 'n', offset: 0, format: 'uint16', scale: 1, add: 0 };
    const coolant: FieldDef = { symbol: 'tmot', offset: 11, format: 'uint8', scale: 1, add: -48 };

    const block = (() => {
        const b = new Uint8Array(35);
        b[0] = 0x0b;
        b[1] = 0xb8; // 3000 rpm
        b[11] = 133; // 133 - 48 = 85 degC
        return b;
    })();

    it('applies scale and offset', () => {
        expect(decodeField(block, rpm)).toBe(3000);
        expect(decodeField(block, coolant)).toBe(85);
    });

    it('returns null when the field runs past the payload', () => {
        // Real case: block length varies by ECU software version. Callers must
        // tell this apart from a decoded 0.
        expect(decodeField(new Uint8Array(5), coolant)).toBeNull();
    });

    it('returns null rather than reading a partially-present field', () => {
        // 12 bytes holds offset 11 for a uint8 but not for a uint16.
        const short = new Uint8Array(12);
        expect(decodeField(short, coolant)).toBe(-48);
        expect(decodeField(short, { ...coolant, format: 'uint16' })).toBeNull();
    });

    it('returns null for a negative offset', () => {
        expect(decodeField(block, { ...rpm, offset: -1 })).toBeNull();
    });

    it('distinguishes a decoded zero from an undecodable field', () => {
        // The whole reason decodeField returns null instead of 0.
        expect(decodeField(new Uint8Array(4), rpm)).toBe(0);
        expect(decodeField(new Uint8Array(1), rpm)).toBeNull();
    });

    it('applies fractional scales without drifting', () => {
        // aq_rel on the MSS54 is raw * 200/65536, verified in the tuner against
        // a real Testo log. Two of its three worked examples reproduce exactly:
        //   79    -> 0.2410888671875
        //   222   -> 0.677490234375
        //
        // The third does not. That comment reads "63.3575 = 20763*", but
        // 20763 * 200/65536 = 63.3636474609375. The raw that actually yields the
        // logged 63.3575 is 20761 — a two-digit transcription slip in the
        // comment, not an error in the scale, which the first two pin down
        // exactly. Asserted here so the scale stays verified against real values
        // rather than against the typo.
        const rawLoad: FieldDef = {
            symbol: 'aq_rel',
            offset: 0,
            format: 'uint16',
            scale: 0.0030517578125,
            add: 0,
        };
        const at = (raw: number) => {
            const b = new Uint8Array([(raw >> 8) & 0xff, raw & 0xff]);
            return decodeField(b, rawLoad);
        };
        expect(at(79)).toBe(0.2410888671875);
        expect(at(222)).toBe(0.677490234375);
        expect(at(20761)).toBeCloseTo(63.3575, 4);
        expect(at(20763)).toBeCloseTo(63.36365, 4);
    });
});

describe('minPayloadLength', () => {
    it('is driven by the field table, not a documented constant', () => {
        // Reference documentation is routinely self-contradictory — one block
        // declared 83 bytes while its own field table ran to offset 92. Deriving
        // the bound from the table fails only in the case that would otherwise
        // produce silent nulls.
        const fields: FieldDef[] = [
            { symbol: 'a', offset: 0, format: 'uint16', scale: 1, add: 0 },
            { symbol: 'b', offset: 90, format: 'uint16', scale: 1, add: 0 },
            { symbol: 'c', offset: 40, format: 'uint8', scale: 1, add: 0 },
        ];
        expect(minPayloadLength(fields)).toBe(92);
    });

    it('is 0 for an empty table', () => {
        expect(minPayloadLength([])).toBe(0);
    });

    it('agrees with decodeField at the boundary', () => {
        const fields: FieldDef[] = [{ symbol: 'a', offset: 10, format: 'uint16', scale: 1, add: 0 }];
        const need = minPayloadLength(fields);
        expect(decodeField(new Uint8Array(need), fields[0])).not.toBeNull();
        expect(decodeField(new Uint8Array(need - 1), fields[0])).toBeNull();
    });
});
